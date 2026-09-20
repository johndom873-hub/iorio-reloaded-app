import { apiBaseUrl, apiRequest } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";
import type { OrderLeg, OrderRequestStatus } from "./positions";

export type AppNotification =
  | { type: "order_status"; orderId: string }
  | { type: "position_closed"; positionId: string; symbol: string; message: string }
  | { type: "position_opened"; positionId: string; symbol: string }
  // Iorio Pulse — see notificationChannel.ts on the backend.
  | { type: "job_completed"; jobName: string; status: "success" | "failure" }
  | { type: "alert_generated"; strategyKey: string; symbol: string; annualizedYield: number }
  | { type: "genosuke_reply"; preview: string }
  | { type: "presence"; onlineUserIds: string[] }
  // Animation-only signal for Pulse's topology lines; only sent to the /pulse tab.
  | { type: "pulse"; edgeId: "ibkr-gateway" | "heroku-browser" | "heroku-db" | "genosuke-db" | "genosuke-llm" };

// One long-lived connection per browser tab, shared by every caller —
// replaces the old per-order 2s client poll. Pushed by the backend's
// notificationBroadcaster.ts whenever an order_requests row changes
// (regardless of which process changed it: this browser's own
// confirm/cancel, the worker on an IBKR fill, or an order placed entirely
// outside this browser via Genosuke chat) or a position closes on
// expiry/assignment.
//
// Shared on purpose: BackgroundJobsContext, PositionsPage, PulsePage and
// TickerDetailModal all subscribe, and each opening its own EventSource
// burned 2-3 of Chrome's 6 HTTP/1.1 connections per host (shared across ALL
// tabs) on nothing but duplicate copies of the same events — enough for two
// tabs to starve every later stream, so prices never arrived. The stream is
// opened for the first subscriber and closed when the last one unsubscribes.
// The backend sends no snapshot on connect (only live changes), so a
// subscriber joining an already-open stream misses nothing it would have got.
interface NotificationListener {
  callback: (notification: AppNotification) => void;
  wantsPulses: boolean;
}

interface SharedNotificationConnection {
  // Replaced by a fresh EventSource each time the browser gives up on the old
  // one (see scheduleSharedNotificationReconnect).
  source: EventSource;
  includesPulses: boolean;
  // Only the connection currently delivering forwards frames to listeners —
  // see promoteSharedNotificationConnection for why.
  isDelivering: boolean;
  consecutiveFailures: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// Pause before recreating a connection the browser gave up on, by number of
// consecutive failures; the last value repeats forever. Retrying indefinitely
// is safe here (unlike the per-data streams, which deliberately never retry
// because each retry used to open an IBKR connection): a retry only asks the
// backend for this cheap stream, and ±25% jitter keeps every open tab from
// hitting a recovering dyno in the same instant.
const sharedNotificationReconnectDelaysMs = [1_000, 2_000, 5_000, 10_000, 30_000];

const notificationListeners = new Set<NotificationListener>();
// Oldest first. Normally one entry; two while a pulses on/off switch is
// still waiting for its replacement connection to open.
let sharedNotificationConnections: SharedNotificationConnection[] = [];
let isReconcileScheduled = false;

// Copy first so a listener that unsubscribes mid-dispatch doesn't skip its
// neighbour; one listener throwing must not starve the others.
function deliverToListeners(notification: AppNotification, listeners: Set<NotificationListener>) {
  for (const listener of [...listeners]) {
    // Pulse frames are only for listeners that asked for them (Pulse page).
    if (notification.type === "pulse" && !listener.wantsPulses) continue;
    try {
      listener.callback(notification);
    } catch {
      // Same swallow-and-continue the single-listener version had.
    }
  }
}

function dispatchNotification(message: MessageEvent) {
  let notification: AppNotification;
  try {
    notification = JSON.parse(message.data);
  } catch {
    // Malformed/heartbeat frame — ignore.
    return;
  }
  deliverToListeners(notification, notificationListeners);
}

function openSharedNotificationConnection(includePulses: boolean, isDelivering: boolean): SharedNotificationConnection {
  // ?pulses=1 asks the backend for the high-frequency topology pulse frames,
  // which only the Pulse page renders — every other tab skips them (see the
  // backend route). It is fixed for the life of a connection, so a tab that
  // navigates to/from Pulse has to open a replacement connection (see
  // reconcileSharedNotificationConnections).
  const connection: SharedNotificationConnection = {
    source: createSharedNotificationSource(includePulses),
    includesPulses: includePulses,
    isDelivering,
    consecutiveFailures: 0,
    reconnectTimer: null,
  };
  attachSharedNotificationHandlers(connection);
  return connection;
}

function createSharedNotificationSource(includePulses: boolean): EventSource {
  return new EventSource(`${apiBaseUrl}/notifications/stream${includePulses ? "?pulses=1" : ""}`, { withCredentials: true });
}

function attachSharedNotificationHandlers(connection: SharedNotificationConnection) {
  const { source } = connection;
  source.onmessage = (message) => {
    if (connection.isDelivering) dispatchNotification(message);
  };
  source.onopen = () => {
    connection.consecutiveFailures = 0;
    promoteSharedNotificationConnection(connection);
  };
  source.onerror = () => {
    // CONNECTING: the browser is already retrying a dropped connection itself.
    // CLOSED: the browser gave up for good — verified 2026-09-19 that any
    // non-200 answer does this, e.g. the Heroku router's 503 while the dyno
    // restarts (it is not a network drop, so it is never retried) — and only
    // recreating the EventSource brings the stream back.
    if (source.readyState === EventSource.CLOSED) scheduleSharedNotificationReconnect(connection);
  };
}

function scheduleSharedNotificationReconnect(connection: SharedNotificationConnection) {
  if (connection.reconnectTimer !== null) return;
  const delays = sharedNotificationReconnectDelaysMs;
  const baseDelayMs = delays[Math.min(connection.consecutiveFailures, delays.length - 1)];
  connection.consecutiveFailures += 1;
  const jitteredDelayMs = baseDelayMs * (0.75 + Math.random() * 0.5);
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    // Retired (replaced, or every listener left) while waiting.
    if (!sharedNotificationConnections.includes(connection)) return;
    connection.source = createSharedNotificationSource(connection.includesPulses);
    attachSharedNotificationHandlers(connection);
  }, jitteredDelayMs);
}

function closeSharedNotificationConnection(connection: SharedNotificationConnection) {
  connection.isDelivering = false;
  if (connection.reconnectTimer !== null) clearTimeout(connection.reconnectTimer);
  connection.reconnectTimer = null;
  connection.source.close();
}

// A replacement connection takes over delivery the moment it opens and every
// OLDER connection is retired in the same synchronous block, so a frame is
// never lost (the old one delivered right up to that point) and message
// events can't interleave with the hand-over. Being open before the old one
// closes also keeps the user "online" throughout (the backend derives
// presence from open streams). Also runs on every auto-reconnect of the
// current connection, where it is a no-op.
function promoteSharedNotificationConnection(connection: SharedNotificationConnection) {
  const position = sharedNotificationConnections.indexOf(connection);
  if (position === -1) return;
  connection.isDelivering = true;
  for (const older of sharedNotificationConnections.slice(0, position)) closeSharedNotificationConnection(older);
  sharedNotificationConnections = sharedNotificationConnections.slice(position);
}

function reconcileSharedNotificationConnections() {
  isReconcileScheduled = false;

  if (notificationListeners.size === 0) {
    for (const connection of sharedNotificationConnections) closeSharedNotificationConnection(connection);
    sharedNotificationConnections = [];
    return;
  }

  const wantsPulses = [...notificationListeners].some((listener) => listener.wantsPulses);
  const newestConnection = sharedNotificationConnections[sharedNotificationConnections.length - 1];
  if (!newestConnection) {
    sharedNotificationConnections = [openSharedNotificationConnection(wantsPulses, true)];
    return;
  }
  if (newestConnection.includesPulses === wantsPulses) return;
  sharedNotificationConnections.push(openSharedNotificationConnection(wantsPulses, false));
}

// Deferred one tick so React StrictMode's mount → unmount → mount (dev) and
// a burst of subscribe/unsubscribe calls settle before anything is opened or
// closed — otherwise each pair would close and reopen the stream, and every
// (re)connect is a presence change plus a database write on the backend.
function scheduleReconcile() {
  if (isReconcileScheduled) return;
  isReconcileScheduled = true;
  setTimeout(reconcileSharedNotificationConnections, 0);
}

function openLegacyNotificationStream(
  onNotification: (notification: AppNotification) => void,
  options?: { wantsPulses?: boolean },
): () => void {
  // Fresh object per subscription so the same callback subscribed twice is
  // two independent subscriptions, not one Set entry.
  const listener: NotificationListener = { callback: (notification) => onNotification(notification), wantsPulses: Boolean(options?.wantsPulses) };
  notificationListeners.add(listener);
  scheduleReconcile();

  return () => {
    notificationListeners.delete(listener);
    scheduleReconcile();
  };
}

// --- Multiplexed transport (see streamMultiplexer.ts) ---
// The tab's listeners are served by two subscriptions on the tab's single
// multiplexed connection: "notifications" (everything except pulses) while
// any listener exists, and "pulses" only while a listener wants them (the
// Pulse page) — which is what makes the pulses-on/off switch a
// subscribe/unsubscribe rather than a replacement connection. The legacy
// shared EventSource above is only the fallback for an API that predates the
// multiplexer: each subscription then becomes a listener on it, filtered so
// nothing is delivered twice.
const multiplexedListeners = new Set<NotificationListener>();
let closeMultiplexedNotifications: (() => void) | null = null;
let closeMultiplexedPulses: (() => void) | null = null;
let isMultiplexedReconcileScheduled = false;
// A refused/failed subscription is retried after this pause, not immediately,
// so a persistent server-side failure can't spin.
const multiplexedResubscribeDelayMs = 5_000;

function reconcileMultiplexedNotificationSubscriptions() {
  isMultiplexedReconcileScheduled = false;
  const hasListeners = multiplexedListeners.size > 0;
  const wantsPulses = [...multiplexedListeners].some((listener) => listener.wantsPulses);

  if (hasListeners && closeMultiplexedNotifications === null) {
    closeMultiplexedNotifications = openMultiplexedStream<AppNotification>({
      kind: "notifications",
      parameters: {},
      onData: (notification) => deliverToListeners(notification, multiplexedListeners),
      onError: () => {
        closeMultiplexedNotifications = null;
        setTimeout(scheduleMultiplexedReconcile, multiplexedResubscribeDelayMs);
      },
      openLegacy: () =>
        openLegacyNotificationStream((notification) => {
          if (notification.type !== "pulse") deliverToListeners(notification, multiplexedListeners);
        }),
    });
  } else if (!hasListeners && closeMultiplexedNotifications !== null) {
    closeMultiplexedNotifications();
    closeMultiplexedNotifications = null;
  }

  if (wantsPulses && closeMultiplexedPulses === null) {
    closeMultiplexedPulses = openMultiplexedStream<AppNotification>({
      kind: "pulses",
      parameters: {},
      onData: (notification) => deliverToListeners(notification, multiplexedListeners),
      onError: () => {
        closeMultiplexedPulses = null;
        setTimeout(scheduleMultiplexedReconcile, multiplexedResubscribeDelayMs);
      },
      openLegacy: () =>
        openLegacyNotificationStream(
          (notification) => {
            if (notification.type === "pulse") deliverToListeners(notification, multiplexedListeners);
          },
          { wantsPulses: true },
        ),
    });
  } else if (!wantsPulses && closeMultiplexedPulses !== null) {
    closeMultiplexedPulses();
    closeMultiplexedPulses = null;
  }
}

// Deferred one tick for the same StrictMode/burst reason as scheduleReconcile.
function scheduleMultiplexedReconcile() {
  if (isMultiplexedReconcileScheduled) return;
  isMultiplexedReconcileScheduled = true;
  setTimeout(reconcileMultiplexedNotificationSubscriptions, 0);
}

function openMultiplexedNotificationStream(
  onNotification: (notification: AppNotification) => void,
  options?: { wantsPulses?: boolean },
): () => void {
  const listener: NotificationListener = { callback: (notification) => onNotification(notification), wantsPulses: Boolean(options?.wantsPulses) };
  multiplexedListeners.add(listener);
  scheduleMultiplexedReconcile();
  return () => {
    multiplexedListeners.delete(listener);
    scheduleMultiplexedReconcile();
  };
}

export function openNotificationStream(
  onNotification: (notification: AppNotification) => void,
  options?: { wantsPulses?: boolean },
): () => void {
  return openMultiplexedNotificationStream(onNotification, options);
}

export interface RecentNotificationEvent {
  notification: AppNotification;
  occurredAt: string;
  /**
   * Only on order_status events: that order's status and payload, resolved
   * server-side so the Latest Events backfill needs no per-order request
   * (null when the order no longer exists).
   */
  order?: { status: OrderRequestStatus; payload: { symbol: string; legs: OrderLeg[] } } | null;
}

// Backs the Pulse dashboard's Latest Events panel on mount, since the SSE
// stream above only ever carries events from the moment a tab connects.
export function fetchRecentNotifications(): Promise<{ events: RecentNotificationEvent[] }> {
  return apiRequest("/notifications/recent");
}
