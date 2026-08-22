import type { Position } from "../api/positions";

// Total P&L for a position: realized-only for closed positions (no live
// call needed, computed server-side from stored exit prices); realized (any
// already-rolled-away leg) + live-priced unrealized for open ones. Returns
// "loading" while the on-demand unrealized fetch for open positions hasn't
// resolved yet, or null if a live price genuinely couldn't be fetched (e.g.
// outside market hours) — see fetchUnrealizedPnl. Shared by PositionsPage's
// table and PositionDetailModal's header so both agree on the same number.
export function positionTotalPnl(
  position: Position,
  unrealizedByPositionId: Record<string, number | null>,
): number | null | "loading" {
  const realized = Number(position.realizedPnl);
  if (position.status === "closed") return realized;
  if (!(position.id in unrealizedByPositionId)) return "loading";
  const unrealized = unrealizedByPositionId[position.id];
  if (unrealized === null) return null;
  return realized + unrealized;
}

export function positionTotalPnlPercent(position: Position, pnl: number | null): number | null {
  const capitalAtRisk = position.capitalAtRisk === null ? null : Number(position.capitalAtRisk);
  if (pnl === null || capitalAtRisk === null || capitalAtRisk === 0) return null;
  return (pnl / capitalAtRisk) * 100;
}
