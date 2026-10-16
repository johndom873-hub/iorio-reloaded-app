import type { PlutoLadderTickerSettings } from "../api/pluto";

// The CC + Put Ladder's fit checks on the Pluto screen (formulas approved 2026-10-15, the same as the Analyse window's):
// at the last close P, the pot, the share level p, the rungs n and the shock S, whether the shares' budget buys a lot
// (pot × p ≥ 100 × P) and a Put at the first rung's cap fits a rung (pot × (1 − p) ÷ n ≥ 100 × P × (1 − S ÷ n)), and what
// would make a failing check pass.

export interface LadderFitInput {
  /** The last close. */
  price: number;
  pot: number;
  /** Share level, percent. */
  sharesPct: number;
  rungs: number;
  /** Shock, percent. */
  shockPct: number;
}

export interface LadderFit {
  lotFits: boolean;
  putFits: boolean;
  /** The first rung's cap: P × (1 − S ÷ n). */
  firstCap: number;
  /** max(100 × P ÷ p, 100 × P × (n − S) ÷ (1 − p)). */
  smallestPot: number;
  /** The share levels (percent) at which both checks pass, from 100 × P ÷ pot to 1 − 100 × P × (n − S) ÷ pot; null when none. */
  sharesRangePct: [number, number] | null;
  /** floor(reserve ÷ (100 × P) + S): the most rungs at which a Put fits; 0 when none. */
  mostRungs: number;
  /** n − pot × (1 − p) ÷ (100 × P), percent (approved 2026-10-15): the smallest shock at which a Put fits a rung. */
  smallestShockPct: number;
}

export function ladderFit({ price, pot, sharesPct, rungs, shockPct }: LadderFitInput): LadderFit {
  const share = sharesPct / 100;
  const shock = shockPct / 100;
  const lot = 100 * price;
  const reserve = pot * (1 - share);
  const firstCap = price * (1 - shock / rungs);
  const low = lot / pot;
  const high = 1 - (lot * (rungs - shock)) / pot;
  return {
    lotFits: pot * share >= lot,
    putFits: reserve / rungs >= firstCap * 100,
    firstCap,
    smallestPot: Math.max(lot / share, (lot * (rungs - shock)) / (1 - share)),
    sharesRangePct: high > low ? [low * 100, high * 100] : null,
    mostRungs: Math.max(0, Math.floor(reserve / lot + shock)),
    smallestShockPct: (rungs - reserve / lot) * 100,
  };
}

/** The shock the rule gives at these limits: the Max drawdown kept within them, or the new-listing value under 250 closes. */
export function recommendedShockAt(source: PlutoLadderTickerSettings["recommendedShockSource"], limits: { minPct: number; maxPct: number; noHistoryPct: number }): number | null {
  if (source === null) return null;
  if (source.maxDrawdownPct === null) return limits.noHistoryPct;
  return Math.min(limits.maxPct, Math.max(limits.minPct, source.maxDrawdownPct));
}

/**
 * Each enabled ticker's allocation, % of Pluto's capital budget (formula approved 2026-10-15, the API's
 * effectiveAllocationPctBySymbol): a set allocation as is; every ticker without one gets (100 − the set allocations) ÷
 * the number of tickers without one, never below 0.
 */
export function effectiveAllocationPct(tickers: readonly { symbol: string; setPct: number | null }[]): Map<string, number> {
  const setTotal = tickers.reduce((sum, ticker) => sum + (ticker.setPct ?? 0), 0);
  const unset = tickers.filter((ticker) => ticker.setPct === null).length;
  const equalShare = unset === 0 ? 0 : Math.max(0, (100 - setTotal) / unset);
  return new Map(tickers.map((ticker) => [ticker.symbol, ticker.setPct ?? equalShare]));
}

/** The prices above which a check fails (approved 2026-10-15): lot = pot × p ÷ 100; ladder Put = pot × (1 − p) ÷ (100 × (n − S)). */
export function ladderPriceCeilings({ pot, sharesPct, rungs, shockPct }: Omit<LadderFitInput, "price">): { lot: number; put: number } {
  const share = sharesPct / 100;
  return { lot: (pot * share) / 100, put: (pot * (1 - share)) / (100 * (rungs - shockPct / 100)) };
}

/** A ticker setting's name, in the window and its history. */
export const tickerFieldLabel: Record<string, string> = {
  allocationPct: "Allocation",
  ladderSharesPct: "Share level",
  ladderShockOverridePct: "Shock",
  ladderRungs: "Rungs",
  ladderMinAbsDelta: "Calls' |delta| lower limit",
  ladderMaxAbsDelta: "Calls' |delta| upper limit",
};
