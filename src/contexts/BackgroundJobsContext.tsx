import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchOrder, type OrderRequest } from "../api/positions";
import { openNotificationStream } from "../api/notifications";
import { describeRollSignalUpgrade, describeSignalUpgrade } from "../lib/signalsPresentation";
import { useAuth } from "./AuthContext";

export type BackgroundJobKind = "order" | "position-closed" | "signal-upgraded";
export type BackgroundJobStatus = "running" | "done" | "error";

interface BackgroundJobBase {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  message: string;
  dismissed: boolean;
  /** Optional in-app destination rendered as a link in the toast. */
  link?: { to: string; label: string };
}

export interface OrderJob extends BackgroundJobBase {
  kind: "order";
  order: OrderRequest;
}

// Fed by the SSE notification stream's "position_closed" event (an option
// expiring or being assigned — see ibkrGatewayWorker.ts's
// notifyPositionExpired) rather than anything this browser itself did, so
// unlike OrderJob there's no local order/poll state behind it — it's a
// one-shot toast, done the instant it arrives.
export interface PositionClosedJob extends BackgroundJobBase {
  kind: "position-closed";
}

// Fed by the Day Signals loop's "signal_upgraded" event: a pooled contract's grade went up. One-shot, like PositionClosedJob.
export interface SignalUpgradedJob extends BackgroundJobBase {
  kind: "signal-upgraded";
}

export type BackgroundJob = OrderJob | PositionClosedJob | SignalUpgradedJob;

const terminalOrderStatuses = new Set(["filled", "partially_filled", "cancelled", "rejected", "error"]);

function orderJobLabel(order: OrderRequest): string {
  const action = order.requestType.startsWith("open_") ? "Open" : order.requestType.startsWith("roll") ? "Roll" : "Close";
  return `${order.payload.symbol} — ${action} Order`;
}

function orderJobStatus(order: OrderRequest): BackgroundJobStatus {
  if (!terminalOrderStatuses.has(order.status)) return "running";
  return order.status === "rejected" || order.status === "error" ? "error" : "done";
}

function orderStatusMessage(order: OrderRequest): string {
  switch (order.status) {
    case "pending_confirmation":
      return "Awaiting your confirmation";
    case "confirmed":
      return "Confirmed — sending to IBKR...";
    case "submitted":
      return "Submitted to IBKR — awaiting fill";
    case "cancel_requested":
      return "Cancelling — awaiting IBKR confirmation";
    case "filled":
      return "Filled";
    case "partially_filled":
      return "Partially filled";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return order.errorMessage ?? "Rejected by IBKR";
    case "error":
      return order.errorMessage ?? "Order errored";
  }
}

interface BackgroundJobsContextValue {
  jobs: BackgroundJob[];
  dismissJob: (id: string) => void;
  startOrderJob: (order: OrderRequest) => void;
}

const BackgroundJobsContext = createContext<BackgroundJobsContextValue | undefined>(undefined);

export function BackgroundJobsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);

  // Callers always pass dismissed: false to mean "this is a fresh update" —
  // whether that actually reopens a closed toast depends on whether
  // anything the user would care about changed. A poll tick that comes back
  // with the same status/message as last time (e.g. still "submitted",
  // still waiting for a fill) must not reopen a toast the user just closed;
  // an actual status/message change ("filled", a new ticker result) does.
  const upsertJob = useCallback((job: BackgroundJob) => {
    setJobs((prev) => {
      const index = prev.findIndex((existing) => existing.id === job.id);
      if (index === -1) return [...prev, job];
      const existing = prev[index];
      const hasNews = existing.status !== job.status || existing.message !== job.message;
      const next = [...prev];
      next[index] = { ...job, dismissed: hasNews ? false : existing.dismissed };
      return next;
    });
  }, []);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, dismissed: true } : job)));
  }, []);

  const upsertOrderJob = useCallback(
    (order: OrderRequest) => {
      upsertJob({
        id: order.id,
        kind: "order",
        label: orderJobLabel(order),
        status: orderJobStatus(order),
        message: orderStatusMessage(order),
        dismissed: false,
        order,
      });
    },
    [upsertJob],
  );

  // Seeds the toast immediately with the object OrderReviewPanel already has
  // in hand (Confirm/Cancel's own response) rather than waiting on a round
  // trip through the SSE stream — the stream then keeps it updated from here
  // (see the notification-stream effect below), including after this panel
  // closes or the user navigates away.
  const startOrderJob = useCallback(
    (order: OrderRequest) => {
      upsertOrderJob(order);
    },
    [upsertOrderJob],
  );

  // One SSE connection for as long as the user is logged in (not tied to
  // any page or panel) — see api/notifications.ts. Gated on currentUser
  // rather than opened unconditionally at mount: /notifications/stream
  // requires a session, and EventSource treats any non-200 response (a 401
  // from connecting before login) as fatal — it does not retry the way it
  // does for a plain network drop — so opening it before auth is confirmed
  // permanently kills notifications for the rest of the tab's life. Closes
  // and reopens on logout/login so a shared machine's next user gets their
  // own stream. Replaces the old per-order 2s client poll: that only ever
  // tracked orders this browser itself started via startOrderJob, so an
  // order placed outside this browser (Genosuke chat) or a position closed
  // purely by IBKR (an option expiring) never surfaced anywhere in the UI.
  // Every order_status event re-fetches the full order (the notification
  // payload only carries its id) and reuses the same upsertOrderJob path
  // startOrderJob does, so an order this browser never explicitly started
  // still gets its own toast the first time an event mentions it.
  useEffect(() => {
    if (!currentUser) return;
    return openNotificationStream((notification) => {
      if (notification.type === "order_status") {
        fetchOrder(notification.orderId).then(upsertOrderJob).catch(() => {});
      } else if (notification.type === "position_closed") {
        upsertJob({
          id: `position-closed-${notification.positionId}-${Date.now()}`,
          kind: "position-closed",
          label: `${notification.symbol} — Position Closed`,
          status: "done",
          message: notification.message,
          dismissed: false,
        });
      } else if (notification.type === "roll_signal_upgraded") {
        upsertJob({
          id: `roll-signal-upgraded-${notification.legId}-${notification.expiry}-${notification.strike}-${Date.now()}`,
          kind: "signal-upgraded",
          label: `Roll signal upgraded — ${notification.symbol}`,
          status: "done",
          message: describeRollSignalUpgrade(notification).replace(`${notification.symbol} `, ""),
          dismissed: false,
          link: { to: `/signals?signal=${encodeURIComponent(notification.symbol)}&roll=${encodeURIComponent(notification.legId)}`, label: "Open in Signals" },
        });
      } else if (notification.type === "signal_upgraded") {
        upsertJob({
          id: `signal-upgraded-${notification.symbol}-${notification.expiry}-${notification.strike}-${Date.now()}`,
          kind: "signal-upgraded",
          label: `Signal upgraded — ${notification.symbol}`,
          status: "done",
          message: describeSignalUpgrade(notification).replace(`${notification.symbol} `, ""),
          dismissed: false,
          link: { to: `/signals?signal=${encodeURIComponent(notification.symbol)}`, label: "Open in Signals" },
        });
      }
    });
  }, [currentUser, upsertJob, upsertOrderJob]);

  return (
    <BackgroundJobsContext.Provider value={{ jobs, dismissJob, startOrderJob }}>
      {children}
    </BackgroundJobsContext.Provider>
  );
}

export function useBackgroundJobs(): BackgroundJobsContextValue {
  const context = useContext(BackgroundJobsContext);
  if (!context) throw new Error("useBackgroundJobs must be used within a BackgroundJobsProvider");
  return context;
}

// Subscribes to one job's raw event stream for as long as the calling
// component stays mounted — e.g. TradeAlertsPage using this to refetch its
// list the instant a ticker/roll result lands, without waiting for the scan
// (which lives in BackgroundJobsContext, not this component) to finish.
// handlerRef avoids re-subscribing whenever the caller passes a new inline
// handler function.
