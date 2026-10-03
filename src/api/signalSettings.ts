import { apiRequest } from "./client";

export interface SignalSettings {
  id: string;
  maxDeltaDriftPct: string;
  minAnnualizedYieldPct: string;
  maxNetDelta: string;
  maxPositionPctOfPortfolio: string;
  maxConcentrationPerTickerPct: string;
  minCashReservePct: string;
  commissionWarnSharePctOfPremium: string;
  updatedAt: string;
  updatedByDisplayName: string | null;
}

// Backend columns are snake_case; mapped here rather than server-side —
// same convention as riskLimits.ts's mapSettingsRow.
function mapSettingsRow(row: Record<string, unknown>): SignalSettings {
  return {
    id: row.id as string,
    maxDeltaDriftPct: row.max_delta_drift_pct as string,
    minAnnualizedYieldPct: row.min_annualized_yield_pct as string,
    maxNetDelta: row.max_net_delta as string,
    maxPositionPctOfPortfolio: row.max_position_pct_of_portfolio as string,
    maxConcentrationPerTickerPct: row.max_concentration_per_ticker_pct as string,
    minCashReservePct: row.min_cash_reserve_pct as string,
    commissionWarnSharePctOfPremium: row.commission_warn_share_of_premium_pct as string,
    updatedAt: row.updated_at as string,
    updatedByDisplayName: (row.updated_by_display_name as string | null) ?? null,
  };
}

export async function fetchSignalSettings(): Promise<SignalSettings | null> {
  const row = await apiRequest<Record<string, unknown> | null>("/signal-settings");
  return row ? mapSettingsRow(row) : null;
}

export interface SignalSettingsInput {
  maxDeltaDriftPct: number;
  minAnnualizedYieldPct: number;
  maxNetDelta: number;
  maxPositionPctOfPortfolio: number;
  maxConcentrationPerTickerPct: number;
  minCashReservePct: number;
  commissionWarnSharePctOfPremium: number;
}

export interface SignalOrderLimitsCheckParams {
  symbol: string;
  strategyKey: "covered_call" | "cash_secured_put";
  quantity: number;
  strike: number;
  /** The modal's own live spot, when known — avoids an extra IBKR round trip on the backend. */
  spotPrice?: number | null;
  /** Roll Signals: the strike of the leg being closed; only the strike difference adds notional. */
  rollFromStrike?: number;
}

export interface SignalOrderLimitsResult {
  blocked: boolean;
  reasons: string[];
}

// Single shared evaluation of the three Signals-tab blocking limits (max position %, max
// concentration per ticker %, min cash reserve %) -- same function the backend also runs at
// order-confirm time and in the order's live quote stream (approved 2026-09-24).
export async function checkSignalOrderLimits(params: SignalOrderLimitsCheckParams): Promise<SignalOrderLimitsResult> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    strategyKey: params.strategyKey,
    quantity: String(params.quantity),
    strike: String(params.strike),
  });
  if (params.spotPrice) query.set("spotPrice", String(params.spotPrice));
  if (params.rollFromStrike !== undefined) query.set("rollFromStrike", String(params.rollFromStrike));
  return apiRequest<SignalOrderLimitsResult>(`/signal-settings/order-limits-check?${query.toString()}`);
}

export async function updateSignalSettings(input: SignalSettingsInput): Promise<SignalSettings> {
  const row = await apiRequest<Record<string, unknown>>("/signal-settings", {
    method: "PUT",
    body: JSON.stringify({
      max_delta_drift_pct: input.maxDeltaDriftPct,
      min_annualized_yield_pct: input.minAnnualizedYieldPct,
      max_net_delta: input.maxNetDelta,
      max_position_pct_of_portfolio: input.maxPositionPctOfPortfolio,
      max_concentration_per_ticker_pct: input.maxConcentrationPerTickerPct,
      min_cash_reserve_pct: input.minCashReservePct,
      commission_warn_share_of_premium_pct: input.commissionWarnSharePctOfPremium,
    }),
  });
  return mapSettingsRow(row);
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
  return apiRequest<OrderCommissionPreview>("/signal-settings/commission-preview", { method: "POST", body: JSON.stringify({ legs }) });
}
