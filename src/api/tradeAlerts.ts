import { apiRequest, apiBaseUrl } from "./client";
import type { StrategyKey } from "./screener";

export type TradeAlertStatus = "pending" | "approved" | "rejected" | "modified" | "expired";

export interface NewTradeCandidate {
  expiry: string; // YYYY-MM-DD
  strike: number;
  right: "call" | "put";
  delta: number;
  premium: number;
  dte: number;
  annualizedYield: number;
  spotPrice: number;
  /** Black-Scholes N(d2) estimate, breakeven-adjusted — pending a manual validation pass against IBKR's own TWS-displayed POP. Null if the quote had no usable IV. */
  probabilityOfProfit: number | null;
}

// Kept as an alias — most existing call sites refer to "SuggestedStructure"
// meaning a new_trade candidate specifically.
export type SuggestedStructure = NewTradeCandidate;

export interface RollStructure {
  closeLeg: {
    legId: string;
    strike: number;
    expiry: string; // YYYY-MM-DD
    right: "call" | "put";
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    multiplier: number;
  };
  trigger: "decay" | "dte";
  dte: number;
  replacement: NewTradeCandidate;
  // Only present after a refresh (see refreshTradeAlert) — false means the
  // position no longer meets either roll trigger as of the refreshed data.
  stillTriggered?: boolean;
}

export type TradeAlertType = "new_trade" | "roll";

export interface TradeAlert {
  id: string;
  strategyKey: StrategyKey;
  alertType: TradeAlertType;
  relatedPositionId: string | null;
  suggestedStructure: NewTradeCandidate | RollStructure;
  rationale: string | null;
  status: TradeAlertStatus;
  reviewedAt: string | null;
  reviewedByDisplayName: string | null;
  resultingPositionId: string | null;
  createdAt: string;
  lastRefreshedAt: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
}

export function isRollAlert(alert: TradeAlert): alert is TradeAlert & { suggestedStructure: RollStructure } {
  return alert.alertType === "roll";
}

export interface TradeAlertFilters {
  status?: TradeAlertStatus;
  strategyKey?: StrategyKey;
  symbol?: string;
}

export function fetchTradeAlerts(filters: TradeAlertFilters = {}): Promise<TradeAlert[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  if (filters.symbol) params.set("symbol", filters.symbol);
  const query = params.toString();
  return apiRequest<TradeAlert[]>(`/trade-alerts${query ? `?${query}` : ""}`);
}

export function refreshTradeAlert(id: string): Promise<TradeAlert> {
  return apiRequest<TradeAlert>(`/trade-alerts/${id}/refresh`, { method: "POST" });
}

// Rescans one ticker's new_trade alerts for both strategies against live
// IBKR data — backs the Trade Alerts page's per-ticker "Refresh" button and
// the Ticker Detail modal's "Scan for Alerts"/"Refresh" button (same
// endpoint either way, see refreshTickerTradeAlerts.ts on the backend).
// Roll alerts are untouched by this call. Returns void — callers re-fetch
// via fetchTradeAlerts afterward rather than relying on this response body.
export function refreshTickerAlerts(symbol: string): Promise<void> {
  return apiRequest<void>(`/trade-alerts/refresh-ticker`, { method: "POST", body: JSON.stringify({ symbol }) });
}

// Mirrors the backend's TradeAlertGenerationEvent (runTradeAlertGeneration.ts)
// plus the two stream-lifecycle events the route itself sends (done/streamError).
export type TradeAlertRunStreamEvent =
  | { type: "strategyStart"; strategyKey: StrategyKey; tickerCount: number }
  | { type: "ticker"; strategyKey: StrategyKey; symbol: string; candidateCount: number }
  | { type: "tickerError"; strategyKey: StrategyKey; symbol: string; message: string }
  | { type: "rollBatchReady"; lines: string[] }
  | { type: "rollScanStart"; positionCount: number }
  | { type: "rollCandidate"; symbol: string; triggered: boolean }
  | { type: "rollError"; symbol: string; message: string }
  | { type: "tickerAlertsReady"; symbol: string; lines: string[] }
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
