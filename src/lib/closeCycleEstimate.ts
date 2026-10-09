import type { CloseCommissionRates, LegSide } from "../api/positions";

/** A leg as the Close form would close it: the quantity and limit price typed in, and the live price the cycle P&L marks it at. */
export interface ClosingLegEstimateInput {
  legType: "stock" | "option";
  side: LegSide;
  /** Contracts for an option, shares for stock. */
  quantityToClose: number;
  /** Shares per contract for an option (ignored for stock). */
  multiplier: number;
  limitPrice: number;
  /** What the live cycle P&L marks this leg at: the option's bid/ask mid, the stock's last trade. Null when unavailable. */
  liveMarkPrice: number | null;
}

export interface CloseCycleEstimate {
  estimatedCycleTotal: number;
  /** estimatedCycleTotal − live cycle P&L, commissions included. */
  changeFromLive: number;
  estimatedCommission: number;
}

// Mirrors the API's contractCountBucket (commissionEstimate.ts), which the commission rates are keyed by.
function contractCountBucket(contracts: number): "1" | "2-4" | "5+" {
  if (contracts <= 1) return "1";
  if (contracts <= 4) return "2-4";
  return "5+";
}

/**
 * Wheel-cycle P&L if the close fills at the typed limit prices (approved 2026-10-09):
 *   estimate = live cycle P&L
 *            + Σ (limit − live mark) × quantity × (multiplier for an option, 1 for stock) × (−1 short / +1 long)
 *            − Σ estimated commission
 * Closing a short leg is a buy, a long leg a sell; commission = per-contract rate (side, size bucket) × contracts for
 * an option, per-share rate (side) × shares for stock. The quantity left open keeps its live mark. Null whenever any
 * input is missing, so the form shows "—" rather than a partial figure.
 */
export function estimateCycleAfterClose(
  liveCycleTotal: number | null,
  closingLegs: ClosingLegEstimateInput[],
  commissionRates: CloseCommissionRates | undefined,
): CloseCycleEstimate | null {
  if (liveCycleTotal === null || !commissionRates || closingLegs.length === 0) return null;
  let markAdjustment = 0;
  let estimatedCommission = 0;
  for (const leg of closingLegs) {
    if (leg.liveMarkPrice === null || !Number.isFinite(leg.limitPrice) || !(leg.quantityToClose > 0)) return null;
    const unitsPerQuantity = leg.legType === "option" ? leg.multiplier : 1;
    const direction = leg.side === "short" ? -1 : 1;
    markAdjustment += (leg.limitPrice - leg.liveMarkPrice) * leg.quantityToClose * unitsPerQuantity * direction;
    const orderSide = leg.side === "short" ? "buy" : "sell";
    estimatedCommission +=
      leg.legType === "option"
        ? commissionRates.optionPerContractDollars[orderSide][contractCountBucket(leg.quantityToClose)] * leg.quantityToClose
        : commissionRates.stockPerShareDollars[orderSide] * leg.quantityToClose;
  }
  const changeFromLive = markAdjustment - estimatedCommission;
  return { estimatedCycleTotal: liveCycleTotal + changeFromLive, changeFromLive, estimatedCommission };
}
