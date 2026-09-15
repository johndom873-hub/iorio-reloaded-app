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

// One long-lived connection for the whole app session (BackgroundJobsContext
// opens it once, at provider mount) — replaces the old per-order 2s client
// poll. Pushed by the backend's notificationBroadcaster.ts whenever an
// order_requests row changes (regardless of which process changed it: this
// browser's own confirm/cancel, the worker on an IBKR fill, or an order
// placed entirely outside this browser via Genosuke chat) or a position
// closes on expiry/assignment.
export function openNotificationStream(onNotification: (notification: AppNotification) => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/notifications/stream`, { withCredentials: true });

  source.onmessage = (message) => {
    try {
      onNotification(JSON.parse(message.data));
    } catch {
      // Malformed/heartbeat frame — ignore.
    }
  };

  // EventSource auto-reconnects on its own after a drop; nothing further to
  // do here beyond letting it retry.
  source.onerror = () => {};

  return () => source.close();
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
