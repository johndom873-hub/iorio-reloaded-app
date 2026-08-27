import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { openTradeAlertRunStream, type TradeAlertRunStreamEvent } from "../api/tradeAlerts";
import { fetchOrder, type OrderRequest } from "../api/positions";

export type BackgroundJobKind = "trade-alert-scan" | "order";
export type BackgroundJobStatus = "running" | "done" | "error";

interface BackgroundJobBase {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  message: string;
  dismissed: boolean;
}

export interface TradeAlertScanJob extends BackgroundJobBase {
  kind: "trade-alert-scan";
}

export interface OrderJob extends BackgroundJobBase {
  kind: "order";
  order: OrderRequest;
}

export type BackgroundJob = TradeAlertScanJob | OrderJob;

const tradeAlertScanJobId = "trade-alert-scan";
const orderPollIntervalMs = 2_000;
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
  startTradeAlertScan: () => void;
  startOrderJob: (order: OrderRequest) => void;
  subscribeToJobEvents: (jobId: string, listener: (event: TradeAlertRunStreamEvent) => void) => () => void;
}

const BackgroundJobsContext = createContext<BackgroundJobsContextValue | undefined>(undefined);

export function BackgroundJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const tradeAlertScanRunningRef = useRef(false);
  const orderPollTimersRef = useRef<Map<string, number>>(new Map());
  const jobEventListenersRef = useRef<Map<string, Set<(event: TradeAlertRunStreamEvent) => void>>>(new Map());

  useEffect(() => {
    const timers = orderPollTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

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

  const emitJobEvent = useCallback((jobId: string, event: TradeAlertRunStreamEvent) => {
    jobEventListenersRef.current.get(jobId)?.forEach((listener) => listener(event));
  }, []);

  const subscribeToJobEvents = useCallback((jobId: string, listener: (event: TradeAlertRunStreamEvent) => void) => {
    let listeners = jobEventListenersRef.current.get(jobId);
    if (!listeners) {
      listeners = new Set();
      jobEventListenersRef.current.set(jobId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
    };
  }, []);

  const startTradeAlertScan = useCallback(() => {
    if (tradeAlertScanRunningRef.current) return;
    tradeAlertScanRunningRef.current = true;

    upsertJob({
      id: tradeAlertScanJobId,
      kind: "trade-alert-scan",
      label: "Trade Alert Scan",
      status: "running",
      message: "Starting scan...",
      dismissed: false,
    });

    openTradeAlertRunStream((event) => {
      emitJobEvent(tradeAlertScanJobId, event);

      if (event.type === "strategyStart") {
        const label = event.strategyKey === "covered_call" ? "Covered Calls" : "Cash-Secured Puts";
        upsertJob({
          id: tradeAlertScanJobId,
          kind: "trade-alert-scan",
          label: "Trade Alert Scan",
          status: "running",
          message: `Scanning ${event.tickerCount} shortlisted ticker(s) for ${label}...`,
          dismissed: false,
        });
      } else if (event.type === "ticker") {
        upsertJob({
          id: tradeAlertScanJobId,
          kind: "trade-alert-scan",
          label: "Trade Alert Scan",
          status: "running",
          message: `${event.symbol}: ${event.candidateCount} candidate(s) found.`,
          dismissed: false,
        });
      } else if (event.type === "tickerError") {
        upsertJob({
          id: tradeAlertScanJobId,
          kind: "trade-alert-scan",
          label: "Trade Alert Scan",
          status: "running",
          message: `${event.symbol}: scan failed — ${event.message}`,
          dismissed: false,
        });
      } else if (event.type === "streamError") {
        tradeAlertScanRunningRef.current = false;
        upsertJob({
          id: tradeAlertScanJobId,
          kind: "trade-alert-scan",
          label: "Trade Alert Scan",
          status: "error",
          message: event.message,
          dismissed: false,
        });
      } else if (event.type === "done") {
        tradeAlertScanRunningRef.current = false;
        upsertJob({
          id: tradeAlertScanJobId,
          kind: "trade-alert-scan",
          label: "Trade Alert Scan",
          status: "done",
          message: "Scan complete.",
          dismissed: false,
        });
      }
    });
  }, [upsertJob, emitJobEvent]);

  const pollOrder = useCallback(
    (orderId: string) => {
      const existingTimer = orderPollTimersRef.current.get(orderId);
      if (existingTimer) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(async () => {
        try {
          const updated = await fetchOrder(orderId);
          upsertJob({
            id: updated.id,
            kind: "order",
            label: orderJobLabel(updated),
            status: orderJobStatus(updated),
            message: orderStatusMessage(updated),
            dismissed: false,
            order: updated,
          });
          if (!terminalOrderStatuses.has(updated.status)) {
            pollOrder(orderId);
          } else {
            orderPollTimersRef.current.delete(orderId);
          }
        } catch {
          pollOrder(orderId);
        }
      }, orderPollIntervalMs);

      orderPollTimersRef.current.set(orderId, timer);
    },
    [upsertJob],
  );

  const startOrderJob = useCallback(
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
      if (!terminalOrderStatuses.has(order.status) && !orderPollTimersRef.current.has(order.id)) {
        pollOrder(order.id);
      }
    },
    [upsertJob, pollOrder],
  );

  return (
    <BackgroundJobsContext.Provider value={{ jobs, dismissJob, startTradeAlertScan, startOrderJob, subscribeToJobEvents }}>
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
export function useJobEvents(jobId: string, handler: (event: TradeAlertRunStreamEvent) => void): void {
  const { subscribeToJobEvents } = useBackgroundJobs();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribeToJobEvents(jobId, (event) => handlerRef.current(event));
  }, [jobId, subscribeToJobEvents]);
}
