import { apiBaseUrl, apiRequest } from "./client";

export type AppNotification =
  | { type: "order_status"; orderId: string }
  | { type: "position_closed"; positionId: string; symbol: string; message: string }
  | { type: "position_opened"; positionId: string; symbol: string }
  // Iorio Pulse — see notificationChannel.ts on the backend.
  | { type: "job_completed"; jobName: string; status: "success" | "failure" }
  | { type: "alert_generated"; strategyKey: string; symbol: string; annualizedYield: number }
  | { type: "genosuke_reply"; preview: string }
  | { type: "presence"; onlineUserIds: string[] };

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
// opened by the first subscriber and closed when the last one unsubscribes.
// The backend sends no snapshot on connect (only live changes), so a
// subscriber joining an already-open stream misses nothing it would have got.
const notificationListeners = new Set<(notification: AppNotification) => void>();
let sharedNotificationSource: EventSource | null = null;

function openSharedNotificationSource(): EventSource {
  const source = new EventSource(`${apiBaseUrl}/notifications/stream`, { withCredentials: true });

  source.onmessage = (message) => {
    let notification: AppNotification;
    try {
      notification = JSON.parse(message.data);
    } catch {
      // Malformed/heartbeat frame — ignore.
      return;
    }
    // Copy first so a listener that unsubscribes mid-dispatch doesn't skip
    // its neighbour; one listener throwing must not starve the others.
    for (const listener of [...notificationListeners]) {
      try {
        listener(notification);
      } catch {
        // Same swallow-and-continue the single-listener version had.
      }
    }
  };

  // EventSource auto-reconnects on its own after a drop; nothing further to
  // do here beyond letting it retry.
  source.onerror = () => {};

  return source;
}

export function openNotificationStream(onNotification: (notification: AppNotification) => void): () => void {
  // Fresh wrapper per subscription so the same callback subscribed twice is
  // two independent subscriptions, not one Set entry.
  const listener = (notification: AppNotification) => onNotification(notification);
  notificationListeners.add(listener);
  if (!sharedNotificationSource) sharedNotificationSource = openSharedNotificationSource();

  return () => {
    notificationListeners.delete(listener);
    if (notificationListeners.size === 0 && sharedNotificationSource) {
      sharedNotificationSource.close();
      sharedNotificationSource = null;
    }
  };
}

export interface RecentNotificationEvent {
  notification: AppNotification;
  occurredAt: string;
}

// Backs the Pulse dashboard's Latest Events panel on mount, since the SSE
// stream above only ever carries events from the moment a tab connects.
export function fetchRecentNotifications(): Promise<{ events: RecentNotificationEvent[] }> {
  return apiRequest("/notifications/recent");
}
