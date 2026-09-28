import type { OpenCycleMarks } from "../api/positions";

/**
 * Live wheel-cycle P&L for a Positions row (approved 2026-09-28):
 *   live = total + sharesHeld x (rowPrice - markPrice) + sum over open option positions (liveUnrealizedPremiumPnl - optionMarks[position])
 * i.e. the cycle re-derived with the row's own stock price and each option position's live unrealized premium P&L.
 * A mark that isn't available (`rowPrice` null, or a position missing from `liveUnrealizedPremiumByPositionId`) leaves
 * that part at the stored value (last daily close / nightly snapshot).
 */
export function liveCyclePnl(
  marks: OpenCycleMarks,
  rowPrice: number | null,
  liveUnrealizedPremiumByPositionId: Record<string, number>,
): number {
  let total = marks.total;
  if (rowPrice !== null && marks.markPrice !== null) total += marks.sharesHeld * (rowPrice - marks.markPrice);
  for (const [positionId, storedMark] of Object.entries(marks.optionMarks)) {
    const livePremium = liveUnrealizedPremiumByPositionId[positionId];
    if (livePremium !== undefined) total += livePremium - storedMark;
  }
  return total;
}
