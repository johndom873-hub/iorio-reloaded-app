import type { Cycle, CycleTimelineRow, OpenCycleMarks, UnrealizedPnlResult } from "../api/positions";

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

/**
 * The open cycle's "Today" rows at live prices (approved 2026-10-14). Each is the move since the stored mark it follows,
 * so the timeline still adds up to the cycle total:
 *   option row premium = live unrealized premium P&L - the premium P&L the cycle counts the position at (snapshot, else credit)
 *   share row stock    = shares marked in that bucket x (live stock price - the close they are marked at)
 * Only live readings count: a position whose P&L stream answered from the nightly snapshot (asOfDate set) gets no row,
 * and share rows need a live stock price from any of the symbol's open positions.
 */
export function liveCycleTimelineRows(cycle: Cycle, unrealizedPnlByPositionId: Record<string, UnrealizedPnlResult>): CycleTimelineRow[] {
  if (cycle.status !== "open") return [];
  const isLive = (result: UnrealizedPnlResult | undefined): result is UnrealizedPnlResult => result !== undefined && result.asOfDate === null && result.unrealizedPnl !== null;
  const liveStockPrice = Object.values(unrealizedPnlByPositionId).find((result) => isLive(result) && result.underlyingPrice !== null)?.underlyingPrice ?? null;
  const rows: CycleTimelineRow[] = [];
  if (liveStockPrice !== null) {
    for (const markRow of cycle.timeline) {
      if (markRow.at !== null || markRow.instrument !== "stock" || markRow.stockPrice === null) continue;
      rows.push({ ...markRow, label: "Shares marked live", premium: 0, stock: markRow.quantity * (liveStockPrice - markRow.stockPrice), stockPrice: liveStockPrice, stockPriceSource: "live", commission: null, markDate: undefined });
    }
  }
  for (const position of cycle.openOptionPositions) {
    const result = unrealizedPnlByPositionId[position.positionId];
    if (!isLive(result) || result.unrealizedPremiumPnl === null) continue;
    rows.push({
      at: null,
      label: `Open ${position.optionType} marked live`,
      bucket: position.bucket,
      premium: result.unrealizedPremiumPnl - position.premiumPnl,
      stock: 0,
      instrument: "option",
      quantity: position.quantity,
      strike: position.strike,
      expiryDate: position.expiryDate,
      stockPrice: result.underlyingPrice ?? liveStockPrice,
      stockPriceSource: "live",
      commission: null,
    });
  }
  return rows;
}
