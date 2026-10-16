import { createContext, useContext } from "react";
import type { OrderRequest } from "../api/positions";

// The context, its hook and the job types live apart from BackgroundJobsProvider so that file exports components only
// (Vite hot-swaps it in place).

export type BackgroundJobKind = "order" | "position-closed" | "signal-upgraded" | "assignment-risk";
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

// Fed by the Day Signals loop's "assignment_risk" event: an open short leg's |delta| crossed the threshold. One-shot.
export interface AssignmentRiskJob extends BackgroundJobBase {
  kind: "assignment-risk";
}

export type BackgroundJob = OrderJob | PositionClosedJob | SignalUpgradedJob | AssignmentRiskJob;

export interface BackgroundJobsContextValue {
  jobs: BackgroundJob[];
  dismissJob: (id: string) => void;
  startOrderJob: (order: OrderRequest) => void;
}

export const BackgroundJobsContext = createContext<BackgroundJobsContextValue | undefined>(undefined);

export function useBackgroundJobs(): BackgroundJobsContextValue {
  const context = useContext(BackgroundJobsContext);
  if (!context) throw new Error("useBackgroundJobs must be used within a BackgroundJobsProvider");
  return context;
}
