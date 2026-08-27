import { apiRequest, apiBaseUrl } from "./client";
import type { StrategyKey } from "./screener";

export type PositionStatus = "open" | "closed";
export type LegType = "stock" | "option";
export type LegSide = "long" | "short";
export type OptionType = "call" | "put";

export interface PositionLeg {
  id: string;
  legType: LegType;
  side: LegSide;
  quantity: number;
  optionType: OptionType | null;
  strikePrice: string | null;
  expiryDate: string | null;
  multiplier: number;
  ibkrContractId: string | null;
  entryPrice: string;
  entryAt: string;
  exitPrice: string | null;
  exitAt: string | null;
}

// A synced-from-IBKR position that doesn't cleanly pair into a known
// strategy shape (e.g. a short call with no matching long stock) is
// surfaced as "unstructured" rather than hidden — see worker.ts's
// reconcilePositionsFromIbkr and PROGRESS.md's "IBKR is the source of
// truth" decision, 2026-08-24.
export type PositionStrategyKey = StrategyKey | "unstructured";

export interface Position {
  id: string;
  strategyKey: PositionStrategyKey;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  priceTarget: string | null;
  closeTriggerNotes: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  legs: PositionLeg[];
  /** Sum of already-exited legs' locked-in gain — nonzero on an open position that's been rolled. */
  realizedPnl: string;
  /** Entry-time capital committed: stock cost for covered calls, strike collateral for CSPs. Null if unavailable. */
  capitalAtRisk: string | null;
}

export interface PositionFilters {
  status: PositionStatus;
  strategyKey?: StrategyKey;
}

export function fetchPositions(filters: PositionFilters): Promise<Position[]> {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  return apiRequest<Position[]>(`/positions?${params.toString()}`);
}

export function fetchPosition(id: string): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}`);
}

// Since 2026-08-24, iorio places real orders with IBKR instead of manually
// recording fills — see PROGRESS.md's "IBKR is the source of truth"
// decision. Every mutation below builds an OrderRequest (a preview of
// exactly what will be sent to IBKR) rather than writing a position
// directly; nothing transmits until confirmOrder() is called separately.
// Positions/legs/trades themselves are only ever written by the worker
// process, from IBKR's own fill data — these functions never return a
// Position directly anymore.

export type OrderRequestStatus =
  | "pending_confirmation"
  | "confirmed"
  | "submitted"
  | "cancel_requested"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "error";

export interface OrderLeg {
  role: "stock" | "option";
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  unitPrice: number;
  strike?: number;
  expiry?: string;
  right?: "C" | "P";
}

export interface OrderRequest {
  id: string;
  requestType: string;
  payload: { symbol: string; strategyKey: string; legs: OrderLeg[] };
  relatedPositionId: string | null;
  sourceAlertId: string | null;
  status: OrderRequestStatus;
  ibkrOrderId: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenOrderInput {
  symbol: string;
  strategyKey: StrategyKey;
  stock?: { quantity: number; limitPrice: number };
  option: { quantity: number; limitPrice: number; strikePrice: number; expiryDate: string };
  notes?: string;
  priceTarget?: number;
  /** Links this order back to the Trade Alert it was created from, if any — see tradeAlerts.ts. */
  sourceAlertId?: string;
}

export function buildOpenOrder(input: OpenOrderInput): Promise<OrderRequest> {
  return apiRequest<OrderRequest>("/positions/orders", { method: "POST", body: JSON.stringify(input) });
}

export interface PositionPatch {
  notes?: string | null;
  priceTarget?: number | null;
  closeTriggerNotes?: string | null;
}

export function updatePosition(id: string, patch: PositionPatch): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export interface LegCloseInput {
  legId: string;
  limitPrice: number;
}

export function buildCloseOrder(positionId: string, legs: LegCloseInput[], contractsToClose?: number): Promise<OrderRequest> {
  return apiRequest<OrderRequest>(`/positions/${positionId}/close`, {
    method: "POST",
    body: JSON.stringify(contractsToClose === undefined ? { legs } : { legs, contractsToClose }),
  });
}

export interface RollLegInput {
  strikePrice: number;
  expiryDate: string;
  quantity: number;
  limitPrice: number;
}

export interface RollOrderInput {
  sourceAlertId: string;
  closeLegId: string;
  closeLimitPrice: number;
  newLeg: RollLegInput;
}

export function buildRollOrder(positionId: string, input: RollOrderInput): Promise<OrderRequest> {
  return apiRequest<OrderRequest>(`/positions/${positionId}/roll`, { method: "POST", body: JSON.stringify(input) });
}

export function confirmOrder(orderId: string): Promise<OrderRequest> {
  return apiRequest<OrderRequest>(`/positions/orders/${orderId}/confirm`, { method: "POST" });
}

export function cancelOrder(orderId: string): Promise<OrderRequest> {
  return apiRequest<OrderRequest>(`/positions/orders/${orderId}/cancel`, { method: "POST" });
}

export function fetchOrder(orderId: string): Promise<OrderRequest> {
  return apiRequest<OrderRequest>(`/positions/orders/${orderId}`);
}

export interface OrderLegQuoteCompliance {
  compliant: boolean;
  reason: string | null;
}

export interface OrderLegQuote {
  expiry: string;
  strike: number;
  right: "C" | "P";
  bid: number | null;
  ask: number | null;
  last: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  // Non-null only for opening orders (see streamOrderLegQuote.ts on the
  // backend) -- Close/Roll orders get a live quote but no compliance gate.
  compliance: OrderLegQuoteCompliance | null;
}

export type OrderLegQuoteStreamEvent =
  | { type: "quote"; data: OrderLegQuote }
  | { type: "streamError"; message: string }
  | { type: "done" };

/**
 * Order Review panel's live bid/ask/Greeks/compliance for a not-yet-confirmed
 * order's option leg (approved 2026-08-27, replacing a one-shot fetch — see
 * PROGRESS.md). Same EventSource/close-on-terminal-event shape as
 * openTickerDetailStream/openPositionQuoteStream in api/tickerDetail.ts: no
 * auto-reconnect on drop, a lost connection surfaces as a streamError instead
 * of silently retrying, so the panel can fail closed rather than showing
 * stale data as if it were still live.
 */
export function openOrderLegQuoteStream(orderId: string, onEvent: (event: OrderLegQuoteStreamEvent) => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/positions/orders/${orderId}/quote/stream`, { withCredentials: true });

  source.onmessage = (message) => {
    let event: OrderLegQuoteStreamEvent;
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

/**
 * Same live quote as openOrderLegQuoteStream, but for a contract that has no
 * order_requests row yet — used by RollPositionModal, which needs live
 * pricing for both legs of a proposed roll (the closing leg and the
 * replacement) before the roll order is built. Never carries a compliance
 * verdict (always null) — rolling isn't gated the way an opening order is.
 */
export function openContractQuoteStream(
  symbol: string,
  expiry: string,
  strike: number,
  right: "C" | "P",
  onEvent: (event: OrderLegQuoteStreamEvent) => void,
): () => void {
  const params = new URLSearchParams({ symbol, expiry, strike: String(strike), right });
  const source = new EventSource(`${apiBaseUrl}/positions/quote/stream?${params.toString()}`, { withCredentials: true });

  source.onmessage = (message) => {
    let event: OrderLegQuoteStreamEvent;
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

export interface Greeks {
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
}

export function fetchGreeks(legIds: string[]): Promise<Record<string, Greeks>> {
  if (legIds.length === 0) return Promise.resolve({});
  return apiRequest<Record<string, Greeks>>(`/positions/greeks?legIds=${legIds.join(",")}`);
}

export interface UnrealizedPnlResult {
  unrealizedPnl: number | null;
  // Set only when unrealizedPnl came from the last nightly snapshot instead
  // of a live IBKR quote (outside market hours) — the date that snapshot
  // was captured. null when unrealizedPnl is live, or when neither a live
  // price nor a snapshot is available.
  asOfDate: string | null;
}

// Unrealized P&L for open positions only, live-priced on demand — mirrors
// fetchGreeks's shape. Falls back to the most recent daily P&L snapshot
// (asOfDate set) when a live price couldn't be fetched for at least one leg
// (e.g. outside market hours); unrealizedPnl is null when neither is
// available (e.g. a position opened after that night's snapshot job ran).
export function fetchUnrealizedPnl(positionIds: string[]): Promise<Record<string, UnrealizedPnlResult>> {
  if (positionIds.length === 0) return Promise.resolve({});
  return apiRequest<Record<string, UnrealizedPnlResult>>(`/positions/pnl?positionIds=${positionIds.join(",")}`);
}
