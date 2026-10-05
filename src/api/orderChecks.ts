import { apiRequest } from "./client";

export interface OrderLimitsCheckParams {
  symbol: string;
  strategyKey: "covered_call" | "cash_secured_put";
  quantity: number;
  strike: number;
  /** The modal's own live spot, when known — avoids an extra IBKR round trip on the backend. */
  spotPrice?: number | null;
  /** Rolls: the strike of the leg being closed; only the strike difference adds notional. */
  rollFromStrike?: number;
}

export interface OrderLimitsResult {
  blocked: boolean;
  reasons: string[];
}

// Single shared evaluation of the blocking limits (max position %, max exposure per ticker %, min cash
// reserve %, delta band) for any opening or rolling order -- the same function the backend also runs at
// order-confirm time and in the order's live quote stream.
export async function checkOrderLimits(params: OrderLimitsCheckParams): Promise<OrderLimitsResult> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    strategyKey: params.strategyKey,
    quantity: String(params.quantity),
    strike: String(params.strike),
  });
  if (params.spotPrice) query.set("spotPrice", String(params.spotPrice));
  if (params.rollFromStrike !== undefined) query.set("rollFromStrike", String(params.rollFromStrike));
  return apiRequest<OrderLimitsResult>(`/order-checks/limits?${query.toString()}`);
}

/** One leg of the order whose commission is previewed. Expiry is IBKR's YYYYMMDD; unitPrice is the leg's limit price per share. */
export interface CommissionPreviewLeg {
  role: "stock" | "option";
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  unitPrice: number;
  strike?: number;
  expiry?: string;
  right?: "C" | "P";
}

export interface OrderCommissionPreview {
  /** The figure the totals and the warning use: IBKR's maximum for the order (worst case), or the estimate. */
  commissionDollars: number;
  /** IBKR's minimum for the order; null for an estimate. */
  commissionMinDollars: number | null;
  /** "ibkr_what_if" is IBKR's min-max range for this order; "estimate" is the trailing-fills estimate used when IBKR could not answer. */
  source: "ibkr_what_if" | "estimate";
  estimateReason: string | null;
  /** The estimate prices the option legs only. */
  estimateExcludesStockLeg: boolean;
  warnThresholdPct: number;
}

// Commission for an order about to be set up (approved 2026-10-02): one IBKR what-if per call, so callers
// fire it once per setup form and again only when the order's size changes -- never per Signals row.
export async function previewOrderCommission(legs: CommissionPreviewLeg[]): Promise<OrderCommissionPreview> {
  return apiRequest<OrderCommissionPreview>("/order-checks/commission-preview", { method: "POST", body: JSON.stringify({ legs }) });
}
