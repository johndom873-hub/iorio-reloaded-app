import type { Position, UnrealizedPnlResult } from "../api/positions";

// Total P&L for a position: realized-only for closed positions (no live
// call needed, computed server-side from stored exit prices); realized (any
// already-rolled-away leg) + unrealized for open ones. Returns "loading"
// while the on-demand unrealized fetch for open positions hasn't resolved
// yet, or null if neither a live price nor a fallback snapshot was
// available (see fetchUnrealizedPnl). Shared by PositionsPage's table and
// PositionDetailModal's header so both agree on the same number.
export function positionTotalPnl(
  position: Position,
  unrealizedByPositionId: Record<string, UnrealizedPnlResult>,
): number | null | "loading" {
  const realized = Number(position.realizedPnl);
  if (position.status === "closed") return realized;
  if (!(position.id in unrealizedByPositionId)) return "loading";
  const unrealized = unrealizedByPositionId[position.id].unrealizedPnl;
  if (unrealized === null) return null;
  return realized + unrealized;
}

// asOfDate of the unrealized-P&L fallback used for a position, or null if
// the figure is live (or unavailable). Used to label a stale P&L badge.
export function positionPnlAsOfDate(position: Position, unrealizedByPositionId: Record<string, UnrealizedPnlResult>): string | null {
  return unrealizedByPositionId[position.id]?.asOfDate ?? null;
}

export function positionTotalPnlPercent(position: Position, pnl: number | null): number | null {
  const capitalAtRisk = position.capitalAtRisk === null ? null : Number(position.capitalAtRisk);
  if (pnl === null || capitalAtRisk === null || capitalAtRisk === 0) return null;
  return (pnl / capitalAtRisk) * 100;
}
