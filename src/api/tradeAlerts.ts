import { apiRequest, apiBaseUrl } from "./client";
import type { StrategyKey } from "./screener";

export type TradeAlertStatus = "pending" | "approved" | "rejected" | "modified" | "expired";

export interface SuggestedStructure {
  expiry: string; // YYYY-MM-DD
  strike: number;
  right: "call" | "put";
  delta: number;
  premium: number;
  dte: number;
  annualizedYield: number;
  spotPrice: number;
}

export interface TradeAlert {
  id: string;
  strategyKey: StrategyKey;
  alertType: string;
  relatedPositionId: string | null;
  suggestedStructure: SuggestedStructure;
  rationale: string | null;
  status: TradeAlertStatus;
  reviewedAt: string | null;
  resultingPositionId: string | null;
  createdAt: string;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
}

export interface TradeAlertFilters {
  status?: TradeAlertStatus;
  strategyKey?: StrategyKey;
}

export function fetchTradeAlerts(filters: TradeAlertFilters = {}): Promise<TradeAlert[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  const query = params.toString();
  return apiRequest<TradeAlert[]>(`/trade-alerts${query ? `?${query}` : ""}`);
}

export function rejectTradeAlert(id: string): Promise<TradeAlert> {
  return apiRequest<TradeAlert>(`/trade-alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
}

// Mirrors the backend's TradeAlertGenerationEvent (runTradeAlertGeneration.ts)
// plus the two stream-lifecycle events the route itself sends (done/streamError).
export type TradeAlertRunStreamEvent =
  | { type: "strategyStart"; strategyKey: StrategyKey; tickerCount: number }
  | { type: "ticker"; strategyKey: StrategyKey; symbol: string; candidateCount: number }
  | { type: "tickerError"; strategyKey: StrategyKey; symbol: string; message: string }
  | { type: "streamError"; message: string }
  | { type: "done" };

/**
 * Opens the manual trade-alert scan's SSE stream — same shape as
 * openTickerDetailStream: the scan can take well past Heroku's request
 * timeout across a full shortlist, so progress arrives per-ticker instead
 * of the caller blocking on one response. Closes itself on the terminal
 * done/streamError events rather than EventSource's default auto-reconnect.
 */
export function openTradeAlertRunStream(onEvent: (event: TradeAlertRunStreamEvent) => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/trade-alerts/run-stream`, { withCredentials: true });

  source.onmessage = (message) => {
    let event: TradeAlertRunStreamEvent;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === "done" || event.type === "streamError") source.close();
  };

  source.onerror = () => {
    onEvent({ type: "streamError", message: "Connection to the server was lost." });
    source.close();
  };

  return () => source.close();
}
