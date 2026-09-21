import type { Position, PositionStrategyKey, UnrealizedPnlResult } from "../api/positions";

// A position synced straight from IBKR that doesn't cleanly pair into a
// known strategy shape shows up as "unstructured" (needs review) rather
// than being force-fit into the wrong bucket or hidden — see
// PositionStrategyKey's doc comment in api/positions.ts.
export function strategyLabel(strategyKey: PositionStrategyKey): string {
  if (strategyKey === "covered_call") return "Covered Call";
  if (strategyKey === "cash_secured_put") return "Cash-Secured Put";
  return "Needs Review";
}

// The one short code for each strategy, shown in every badge on the platform.
// N/S = "no strategy": a position that doesn't cleanly pair into CC or CSP.
export function strategyAbbrev(strategyKey: PositionStrategyKey): string {
  if (strategyKey === "covered_call") return "CC";
  if (strategyKey === "cash_secured_put") return "CSP";
  return "N/S";
}

// What a badge's tooltip says, since the code alone is terse.
export function strategyTooltip(strategyKey: PositionStrategyKey): string {
  if (strategyKey === "covered_call") return "Covered Call";
  if (strategyKey === "cash_secured_put") return "Cash-Secured Put";
  return "No strategy (N/S) — a position that doesn't pair into a covered call or cash-secured put; needs review";
}

// THE strategy palette (the Strategy scoreboard's, standardized 2026-09-20):
// CC blue, CSP purple, N/S orange — solid Tabler colours. Every place a
// strategy is shown as a coloured badge, chart series or bar segment uses
// these so a colour always means the same strategy; see StrategyBadge.tsx
// and strategyColors.ts.
export function strategyBadgeClass(strategyKey: PositionStrategyKey): string {
  if (strategyKey === "covered_call") return "bg-blue text-white";
  if (strategyKey === "cash_secured_put") return "bg-purple text-white";
  return "bg-orange text-orange-fg";
}

// Whether Stock P&L is meaningful to show for this position — not just
// "is it a covered call". An unstructured position can be bare stock (e.g.
// leftover shares after a covered call's short call expired) with no
// option leg at all, in which case its *entire* P&L is stock movement and
// hiding that behind strategyKey === "covered_call" would suppress real,
// correctly-computed data (bug found 2026-08-30 testing against live
// data — BMNR/HOOD unstructured positions showed a real loss with Premium
// P&L $0.00 and Stock P&L wrongly hidden as "—"). CSP never has a stock
// leg, so this is false for it either way.
export function positionHasStockLeg(position: Position): boolean {
  return position.legs.some((leg) => leg.legType === "stock");
}

// Same reasoning as positionHasStockLeg, for the premium side — an
// unstructured position can in principle be an orphaned option leg with no
// stock (e.g. a stray short call), in which case only the premium line is
// meaningful.
export function positionHasOptionLeg(position: Position): boolean {
  return position.legs.some((leg) => leg.legType === "option");
}

// An OPEN position holding stock with no live (un-exited) option leg: bare
// stock left after its call expired or was assigned away ("unstructured",
// N/S). It has no premium P&L — any premium from the expired calls belongs
// to the finished cycle — so its whole P&L is stock P&L (approved 2026-09-21).
export function positionIsStockOnly(position: Position): boolean {
  return (
    position.status === "open" &&
    positionHasStockLeg(position) &&
    !position.legs.some((leg) => leg.legType === "option" && !leg.exitAt)
  );
}

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

// Premium P/L: the option leg(s) only (current buy-back cost vs. premium
// collected). Meaningful for both covered calls and CSPs. Returns "loading"/
// null with the same semantics as positionTotalPnl. See "P/L Split & Roll
// Intelligence" proposal (2026-08-30, approved) — final total P/L is
// unchanged, this just exposes one of its two ingredients.
export function positionPremiumPnl(
  position: Position,
  unrealizedByPositionId: Record<string, UnrealizedPnlResult>,
): number | null | "loading" {
  const realized = Number(position.realizedPremiumPnl);
  if (position.status === "closed") return realized;
  if (!(position.id in unrealizedByPositionId)) return "loading";
  const unrealized = unrealizedByPositionId[position.id].unrealizedPremiumPnl;
  if (unrealized === null) return null;
  return realized + unrealized;
}

// Stock-movement P/L: the stock leg only. Only meaningful for covered calls
// — a CSP has no stock leg, so this is always 0 and the caller should hide
// it rather than display a stray "$0.00".
export function positionStockPnl(
  position: Position,
  unrealizedByPositionId: Record<string, UnrealizedPnlResult>,
): number | null | "loading" {
  if (positionIsStockOnly(position)) return positionTotalPnl(position, unrealizedByPositionId);
  const realized = Number(position.realizedStockPnl);
  if (position.status === "closed") return realized;
  if (!(position.id in unrealizedByPositionId)) return "loading";
  const unrealized = unrealizedByPositionId[position.id].unrealizedStockPnl;
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

// The expiry driving this position: the nearest expiry among its still-open
// option legs. A CLOSED position falls back to the nearest among all its
// option legs, so it still shows what it expired/would have expired on. An
// OPEN position with no open option leg (bare stock left after its call
// expired or was assigned away — "unstructured") has no expiry: showing the
// dead call's date made it look like an option position (found 2026-09-19).
// Null for pure-stock or legless positions.
export function positionExpiryDate(position: Position): string | null {
  const openLegs = position.legs.filter((leg) => leg.legType === "option" && leg.expiryDate && !leg.exitAt);
  const candidateLegs =
    openLegs.length > 0 || position.status === "open"
      ? openLegs
      : position.legs.filter((leg) => leg.legType === "option" && leg.expiryDate);
  if (candidateLegs.length === 0) return null;
  return candidateLegs.reduce((earliest, leg) => (leg.expiryDate! < earliest ? leg.expiryDate! : earliest), candidateLegs[0].expiryDate!);
}

export interface PositionTotals {
  /** True while any position's live P&L hasn't arrived yet. */
  isLoading: boolean;
  totalPnl: number;
  premiumPnl: number;
  stockPnl: number;
  exposureDollars: number;
  exposurePercent: number | null;
  /** Total P&L $ / total Exp $ over the positions that have both. */
  pnlPercent: number | null;
  /** Positions left out of the P&L sums because no live price or snapshot exists. */
  positionsWithoutPnl: number;
}

// Approved 2026-09-19: totals are straight sums of the row figures; total
// P&L % is total P&L $ / total Exp $ (never an average of row percentages);
// total EXP % is the straight sum of the rows' EXP % (each is exposure /
// total account value, so the sum equals total exposure / account value).
export function computePositionTotals(
  positions: Position[],
  unrealizedByPositionId: Record<string, UnrealizedPnlResult>,
  totalAccountValue: number | null,
): PositionTotals {
  const totals: PositionTotals = {
    isLoading: false,
    totalPnl: 0,
    premiumPnl: 0,
    stockPnl: 0,
    exposureDollars: 0,
    exposurePercent: null,
    pnlPercent: null,
    positionsWithoutPnl: 0,
  };
  let pnlRowsExposure = 0;
  for (const position of positions) {
    const exposure = position.capitalAtRisk === null ? null : Number(position.capitalAtRisk);
    if (exposure !== null) totals.exposureDollars += exposure;
    const pnl = positionTotalPnl(position, unrealizedByPositionId);
    if (pnl === "loading") {
      totals.isLoading = true;
      continue;
    }
    if (pnl === null) {
      totals.positionsWithoutPnl += 1;
      continue;
    }
    totals.totalPnl += pnl;
    if (exposure !== null) pnlRowsExposure += exposure;
    const premium = positionPremiumPnl(position, unrealizedByPositionId);
    if (typeof premium === "number" && !positionIsStockOnly(position)) totals.premiumPnl += premium;
    if (positionHasStockLeg(position)) {
      const stock = positionStockPnl(position, unrealizedByPositionId);
      if (typeof stock === "number") totals.stockPnl += stock;
    }
  }
  if (pnlRowsExposure > 0) totals.pnlPercent = (totals.totalPnl / pnlRowsExposure) * 100;
  if (totalAccountValue !== null && totalAccountValue > 0) totals.exposurePercent = (totals.exposureDollars / totalAccountValue) * 100;
  return totals;
}
