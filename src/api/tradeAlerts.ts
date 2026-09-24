import { apiRequest, apiBaseUrl, apiStreamedRequest } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";
import type { StrategyKey } from "./strategy";

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
  /** (today's IV − 1yr low) / (1yr high − 1yr low) × 100. Null with under 2 days of IV history. */
  ivRank: number | null;
  /** % of the last 1yr of trading days whose IV closed below today's. Null with under 20 days of IV history. */
  ivPercentile: number | null;
  /** (ask − bid) / premium × 100, on a 0-100 scale (see formatPercentageValue). Null when bid/ask aren't both available. */
  bidAskSpreadPct: number | null;
  /** Ticker-level daily-MA trend context (spot vs MA25 vs MA99). Null with under 99 days of daily bar history. */
  trendLabel: "uptrend" | "downtrend" | "mixed" | null;
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
  // Credit collected by this specific roll (replacement.premium minus the
  // close leg's current price) versus the real cost of executing it
  // (commission + both legs' bid/ask spread) — approved 2026-08-31. A
  // suggested roll is only ever generated when netCredit clears
  // requiredMinimumCredit, so this pair exists mainly to show Juan the
  // margin, not to gate anything client-side.
  netCredit: number;
  requiredMinimumCredit: number;
  // Only present after a refresh (see refreshTradeAlert) — false means the
  // position no longer meets either roll trigger as of the refreshed data.
  stillTriggered?: boolean;
  // Only present after a refresh — false means the roll has drifted into a
  // net debit (after commission/spread) as of the refreshed data.
  stillNetCredit?: boolean;
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
  /** Ranks purely by annualized yield instead of the default per-ticker grouping — for Iorio Pulse's "Top Alerts" panel. */
  sort?: "yield";
  limit?: number;
}

export function fetchTradeAlerts(filters: TradeAlertFilters = {}): Promise<TradeAlert[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return apiRequest<TradeAlert[]>(`/trade-alerts${query ? `?${query}` : ""}`);
}

/** Rejects a pending alert (no order is ever placed for it) — backs the Reject button next to Review (2026-09-24). */
export function rejectTradeAlert(id: string): Promise<void> {
  return apiRequest<void>(`/trade-alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
}

export function refreshTradeAlert(id: string): Promise<TradeAlert> {
  return apiStreamedRequest<TradeAlert>(`/trade-alerts/${id}/refresh`, { method: "POST" });
}

// Live current price next to each ticker's name on the Trade Alerts page —
// added per Juan's 2026-09-17 ask. Same SSE mechanics as
// openPricePerformanceStream (see that function's comment), but scoped to
// exactly the symbols currently grouped on screen rather than the whole
// shortlist, since Trade Alerts can also show roll-alert tickers that have
// since left the shortlist.
export function openTradeAlertCurrentPricesStream(
  symbols: string[],
  onUpdate: (result: Record<string, number | null>) => void,
  onError?: () => void,
): () => void {
  const openLegacy = () => openLegacyTradeAlertCurrentPricesStream(symbols, onUpdate, onError);
  if (symbols.length === 0) return openLegacy();
  return openMultiplexedStream<Record<string, number | null>>({
    kind: "tradeAlertPrices",
    parameters: { symbols },
    onData: onUpdate,
    onError: () => onError?.(),
    openLegacy,
  });
}

function openLegacyTradeAlertCurrentPricesStream(
  symbols: string[],
  onUpdate: (result: Record<string, number | null>) => void,
  onError?: () => void,
): () => void {
  const query = encodeURIComponent(symbols.join(","));
  const source = new EventSource(`${apiBaseUrl}/trade-alerts/current-prices/stream?symbols=${query}`, { withCredentials: true });

  source.onmessage = (message) => {
    try {
      onUpdate(JSON.parse(message.data));
    } catch {
      // Malformed/heartbeat frame — ignore.
    }
  };

  source.onerror = () => {
    source.close();
    onError?.();
  };

  return () => source.close();
}

// Rescans one ticker's new_trade alerts for both strategies against live
// IBKR data — backs the Trade Alerts page's per-ticker "Refresh" button and
// the Ticker Detail modal's "Scan for Alerts"/"Refresh" button (same
// endpoint either way, see refreshTickerTradeAlerts.ts on the backend).
// Roll alerts are untouched by this call. Returns void — callers re-fetch
// via fetchTradeAlerts afterward rather than relying on this response body.
export function refreshTickerAlerts(symbol: string): Promise<void> {
  return apiStreamedRequest<void>(`/trade-alerts/refresh-ticker`, { method: "POST", body: JSON.stringify({ symbol }) });
}

// Mirrors the backend's TradeAlertGenerationEvent (runTradeAlertGeneration.ts)
// plus the two stream-lifecycle events the route itself sends (done/streamError).
