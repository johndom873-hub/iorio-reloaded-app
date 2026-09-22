import { ApiError, apiBaseUrl, apiRequest } from "./client";

// Front end of the stream multiplexer (backend: routes/streamMultiplexer.ts,
// streams/streamProtocol.ts; design: PROGRESS.md "Stream multiplexing —
// design plan"). ONE EventSource per browser tab carries every live
// subscription that tab has open, so a tab never uses more than one of the
// browser's HTTP/1.1 connections per host for live data. The public
// functions in src/api/*.ts keep their exact signatures and always go
// through openMultiplexedStream(). Each also keeps its old per-stream
// EventSource as `openLegacy`, used only when the API is an older version
// without the multiplexer (the front end and the API deploy separately, so a
// new browser can briefly meet an old server) — see connect(). Both go away
// once the legacy routes are deleted.

export type MultiplexedStreamKind = "greeks" | "pnl" | "exposure" | "pricePerformancePrices" | "tradeAlertPrices" | "signalsScreen" | "signalsTicker" | "notifications" | "pulses";

type ServerFrame =
  | { type: "hello"; connectionId: string; protocolVersion: number }
  | { type: "data"; subscriptionId: string; data: unknown }
  | { type: "error"; subscriptionId: string; message: string }
  | { type: "end"; subscriptionId: string };

interface Subscription {
  subscriptionId: string;
  kind: MultiplexedStreamKind;
  parameters: Record<string, unknown>;
  onData: (data: unknown) => void;
  onError: () => void;
  /** Opens the legacy per-stream connection; used only when the API predates the multiplexer. */
  openLegacy: () => () => void;
  closeLegacy: (() => void) | null;
  /** True once a subscribe request for the CURRENT connection has been sent. */
  isSentToServer: boolean;
}

export interface MultiplexerConnectionStatus {
  /** True from the moment the live connection is lost until it is re-established. */
  isReconnecting: boolean;
  /** When the current outage began, for the caller's own "only show after N seconds" rule. */
  reconnectingSinceMs: number | null;
}

type ConnectionState = "idle" | "connecting" | "ready" | "reconnecting" | "unavailable";

// Pause before the next attempt by number of consecutive failures; the last
// value repeats forever. Retrying indefinitely is safe: an attempt only asks
// for the cheap status route and the SSE connection — nothing touches IBKR
// until the connection is back and the subscriptions are re-sent. ±25%
// jitter keeps every open tab from hitting a recovering dyno at once.
const reconnectDelaysMs = [1_000, 2_000, 5_000, 10_000, 30_000];

const subscriptions = new Map<string, Subscription>();
let connectionState: ConnectionState = "idle";
let source: EventSource | null = null;
let connectionId: string | null = null;
let consecutiveFailures = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectingSinceMs: number | null = null;
let isEvaluationScheduled = false;
// Bumped whenever the connection is torn down, so late callbacks from an old
// connection (a slow POST, a stale status check) can tell they are stale.
let connectionGeneration = 0;
// Subscribe/unsubscribe requests are sent strictly one at a time, in order:
// they are separate HTTP requests and could otherwise be applied by the
// server out of order (the server also ignores a late subscribe that follows
// its own unsubscribe, as a second line of defence).
let controlQueue: Promise<void> = Promise.resolve();

const statusListeners = new Set<(status: MultiplexerConnectionStatus) => void>();

function publishStatus() {
  const status: MultiplexerConnectionStatus = {
    isReconnecting: connectionState === "reconnecting",
    reconnectingSinceMs,
  };
  for (const listener of [...statusListeners]) listener(status);
}

function setConnectionState(next: ConnectionState) {
  if (connectionState === next) return;
  const wasReconnecting = connectionState === "reconnecting";
  connectionState = next;
  if (next === "reconnecting" && !wasReconnecting) reconnectingSinceMs = Date.now();
  if (next !== "reconnecting") reconnectingSinceMs = null;
  publishStatus();
}

export function subscribeToMultiplexerConnectionStatus(listener: (status: MultiplexerConnectionStatus) => void): () => void {
  statusListeners.add(listener);
  listener({ isReconnecting: connectionState === "reconnecting", reconnectingSinceMs });
  return () => statusListeners.delete(listener);
}

/** The toast's "Retry now": skips the backoff wait and reconnects immediately. */
export function retryMultiplexerConnectionNow() {
  if (connectionState !== "reconnecting") return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  void connect();
}

function newSubscriptionId(): string {
  return `s-${crypto.randomUUID()}`;
}

/**
 * Subscribes to a live stream through the shared connection. `onData` gets
 * exactly the payloads the legacy stream's frames carried; `onError` is
 * called only when THIS subscription fails (bad parameters, the server-side
 * producer failed or ended) — a lost connection is NOT an error: the last
 * values stay on screen, the connection is re-established in the background
 * and every subscription is re-sent. Returns the cleanup function.
 */
export function openMultiplexedStream<TData>(options: {
  kind: MultiplexedStreamKind;
  parameters: Record<string, unknown>;
  onData: (data: TData) => void;
  onError: () => void;
  openLegacy: () => () => void;
}): () => void {
  const subscription: Subscription = {
    subscriptionId: newSubscriptionId(),
    kind: options.kind,
    parameters: options.parameters,
    onData: options.onData as (data: unknown) => void,
    onError: options.onError,
    openLegacy: options.openLegacy,
    closeLegacy: null,
    isSentToServer: false,
  };
  subscriptions.set(subscription.subscriptionId, subscription);

  if (connectionState === "unavailable") {
    subscription.closeLegacy = subscription.openLegacy();
  } else {
    scheduleEvaluation();
    if (connectionState === "ready") sendSubscribe(subscription);
  }

  return () => removeSubscription(subscription);
}

function removeSubscription(subscription: Subscription) {
  if (subscriptions.get(subscription.subscriptionId) !== subscription) return;
  subscriptions.delete(subscription.subscriptionId);
  if (subscription.closeLegacy) {
    subscription.closeLegacy();
    subscription.closeLegacy = null;
  } else if (subscription.isSentToServer && connectionId !== null) {
    const connectionIdAtCall = connectionId;
    const generationAtCall = connectionGeneration;
    enqueueControl(async () => {
      if (generationAtCall !== connectionGeneration) return; // the connection is gone; so is the subscription
      await apiRequest(`/stream/${connectionIdAtCall}/unsubscribe`, {
        method: "POST",
        body: JSON.stringify({ subscriptionId: subscription.subscriptionId }),
      }).catch(() => {
        // Best effort: closing the connection cleans up anyway.
      });
    });
  }
  scheduleEvaluation();
}

function enqueueControl(task: () => Promise<void>) {
  controlQueue = controlQueue.then(task).catch(() => {});
}

function sendSubscribe(subscription: Subscription) {
  if (subscription.isSentToServer || connectionId === null) return;
  subscription.isSentToServer = true;
  const connectionIdAtCall = connectionId;
  const generationAtCall = connectionGeneration;
  enqueueControl(async () => {
    // Stale (connection replaced) or already unsubscribed while queued.
    if (generationAtCall !== connectionGeneration || subscriptions.get(subscription.subscriptionId) !== subscription) return;
    try {
      await apiRequest(`/stream/${connectionIdAtCall}/subscribe`, {
        method: "POST",
        body: JSON.stringify({ subscriptionId: subscription.subscriptionId, kind: subscription.kind, parameters: subscription.parameters }),
      });
    } catch (error) {
      if (generationAtCall !== connectionGeneration) return;
      if (error instanceof ApiError && (error.status === 400 || error.status === 429)) {
        // This subscription itself was refused; the connection is fine.
        if (subscriptions.delete(subscription.subscriptionId)) subscription.onError();
        return;
      }
      // 404 = the server doesn't know this connection (it restarted or evicted it); anything else = the
      // server is unreachable. Either way the connection is no good: start over.
      handleConnectionLost();
    }
  });
}

// Deferred one tick so React StrictMode's mount -> unmount -> mount (dev) and
// bursts of subscribe/unsubscribe settle before a connection is opened or
// closed — the same reason notifications.ts defers its own reconcile.
function scheduleEvaluation() {
  if (isEvaluationScheduled) return;
  isEvaluationScheduled = true;
  setTimeout(evaluateConnectionNeed, 0);
}

function evaluateConnectionNeed() {
  isEvaluationScheduled = false;
  const legacyOnly = connectionState === "unavailable";
  if (subscriptions.size === 0) {
    if (connectionState !== "idle" && !legacyOnly) closeConnection();
    return;
  }
  if (connectionState === "idle") void connect();
}

function closeConnection() {
  connectionGeneration += 1;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  source?.close();
  source = null;
  connectionId = null;
  consecutiveFailures = 0;
  controlQueue = Promise.resolve();
  for (const subscription of subscriptions.values()) subscription.isSentToServer = false;
  setConnectionState("idle");
}

async function connect() {
  if (connectionState === "ready" || connectionState === "unavailable") return;
  if (connectionState !== "reconnecting") setConnectionState("connecting");
  const generationAtStart = connectionGeneration;

  try {
    // A compatibility handshake, made before the stream opens because an
    // EventSource can't read a response body: a 404 means this API predates the
    // multiplexer (fall back for good, retrying would never help), anything
    // else that fails means the server is down or restarting (keep retrying).
    await apiRequest("/stream/status");
    if (generationAtStart !== connectionGeneration) return;
  } catch (error) {
    if (generationAtStart !== connectionGeneration) return;
    if (error instanceof ApiError && error.status === 404) {
      fallBackToLegacyStreams("this API version predates it");
      return;
    }
    handleConnectionLost();
    return;
  }

  if (subscriptions.size === 0) {
    closeConnection();
    return;
  }

  const eventSource = new EventSource(`${apiBaseUrl}/stream`, { withCredentials: true });
  source = eventSource;

  eventSource.onmessage = (message) => {
    if (generationAtStart !== connectionGeneration) return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(message.data);
    } catch {
      return;
    }
    handleServerFrame(frame);
  };

  eventSource.onerror = () => {
    if (generationAtStart !== connectionGeneration) return;
    // CONNECTING: the browser is already retrying a dropped connection. CLOSED: it gave up for good — any
    // non-200 answer does that, e.g. the router's 503 while the dyno restarts — and only we can retry.
    // Either way this connection's server-side state is gone.
    handleConnectionLost(eventSource.readyState === EventSource.CLOSED);
  };
}

function handleServerFrame(frame: ServerFrame) {
  if (frame.type === "hello") {
    connectionId = frame.connectionId;
    consecutiveFailures = 0;
    setConnectionState("ready");
    // Fresh connection id: nothing is subscribed server-side yet.
    for (const subscription of subscriptions.values()) subscription.isSentToServer = false;
    for (const subscription of [...subscriptions.values()]) sendSubscribe(subscription);
    return;
  }

  const subscription = subscriptions.get(frame.subscriptionId);
  if (!subscription) return; // unsubscribed meanwhile
  if (frame.type === "data") {
    try {
      subscription.onData(frame.data);
    } catch {
      // A throwing consumer must not take the shared connection down.
    }
    return;
  }
  // "error" (the producer failed) or "end" (it stopped on its own — the
  // legacy streams only ever do that on failure): same outcome the legacy
  // stream gave, a failed subscription.
  subscriptions.delete(subscription.subscriptionId);
  subscription.onError();
}

/**
 * The connection (or the server) is gone. `mustRetryOurselves` is true when
 * the EventSource is CLOSED for good; when it is merely CONNECTING the
 * browser retries and we pick up again at the next hello frame.
 */
function handleConnectionLost(mustRetryOurselves = true) {
  connectionId = null;
  controlQueue = Promise.resolve();
  for (const subscription of subscriptions.values()) subscription.isSentToServer = false;
  setConnectionState("reconnecting");
  if (!mustRetryOurselves) return;

  connectionGeneration += 1;
  source?.close();
  source = null;
  if (subscriptions.size === 0) {
    closeConnection();
    return;
  }
  if (reconnectTimer !== null) return;
  const baseDelayMs = reconnectDelaysMs[Math.min(consecutiveFailures, reconnectDelaysMs.length - 1)] ?? 30_000;
  consecutiveFailures += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, baseDelayMs * (0.75 + Math.random() * 0.5));
}

function fallBackToLegacyStreams(reason: string) {
  console.warn(`Stream multiplexer unavailable (${reason}); using the per-stream connections instead.`);
  connectionGeneration += 1;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  source?.close();
  source = null;
  connectionId = null;
  setConnectionState("unavailable");
  for (const subscription of subscriptions.values()) {
    if (!subscription.closeLegacy) subscription.closeLegacy = subscription.openLegacy();
  }
}
