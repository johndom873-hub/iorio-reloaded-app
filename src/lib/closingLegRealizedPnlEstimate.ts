import type { LegSide } from "../api/positions";

/** A leg as a close or a roll would close it: its entry price, the quantity and the limit it closes at, and that trade's commission. */
export interface ClosingLegRealizedPnlInput {
  legType: "stock" | "option";
  side: LegSide;
  /** Contracts for an option, shares for stock. */
  quantityToClose: number;
  /** Shares per contract for an option (ignored for stock). */
  multiplier: number;
  /** The leg's entry price per share, as IBKR reports it: already net of the opening commission. */
  entryPrice: number;
  limitPrice: number;
  /** The closing trade's commission in dollars, positive. */
  closingCommissionDollars: number;
}

/**
 * Realised P&L if a leg closes at its limit (approved 2026-11-13), the formula the books apply once it has
 * (the API's legRealizedPnl):
 *   (limit − entry price) × quantity × (multiplier for an option, 1 for stock) × (−1 short / +1 long) − closing commission
 * The opening commission is already inside the entry price, so it is not subtracted again.
 * Example: 5 Calls sold at $1.20 with $3.40 commission (entry $1.1932), bought back at $0.35 with $3.40:
 * (0.35 − 1.1932) × 5 × 100 × −1 − 3.40 = +$418.20.
 */
export function estimateClosingLegRealizedPnl(leg: ClosingLegRealizedPnlInput): number {
  const unitsPerQuantity = leg.legType === "option" ? leg.multiplier : 1;
  const direction = leg.side === "short" ? -1 : 1;
  return (leg.limitPrice - leg.entryPrice) * leg.quantityToClose * unitsPerQuantity * direction - leg.closingCommissionDollars;
}
