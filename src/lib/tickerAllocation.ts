import { formatPercentageValueTrimmed } from "./formatters";

// Tickers sharing one pool (approved 2026-10-28), worked out as the API's src/lib/tickerAllocation.ts does: Pluto's tickers
// share its capital budget, a lab session's tickers its starting value. Each ticker's allocation is a % of the pool, set or
// an equal share of what the set ones leave; its pot is that allocation raised by the excess allowance, so the pots can add
// up to more than the pool, whose cash they share.

/**
 * Each ticker's allocation, % of the pool (formula approved 2026-10-15, the API's effectiveAllocationPctBySymbol): a set
 * allocation as is; every ticker without one gets (100 − the set allocations) ÷ the number of tickers without one, never
 * below 0.
 */
export function effectiveAllocationPct(tickers: readonly { symbol: string; setPct: number | null }[]): Map<string, number> {
  const setTotal = tickers.reduce((sum, ticker) => sum + (ticker.setPct ?? 0), 0);
  const unset = tickers.filter((ticker) => ticker.setPct === null).length;
  const equalShare = unset === 0 ? 0 : Math.max(0, (100 - setTotal) / unset);
  return new Map(tickers.map((ticker) => [ticker.symbol, ticker.setPct ?? equalShare]));
}

/**
 * A ticker's pot in dollars (the API's tickerPotShare): pool × allocation × (1 + excess allowance), worked in whole
 * percentages with one division. 24 tickers on an equal share of $1,900,000 with a 26.3158% allowance:
 * 1,900,000 × 4.1667 × 126.3158 ÷ 10,000 = $100,000.
 */
export function tickerPotDollars(poolDollars: number, allocationPct: number, excessAllowancePct: number): number {
  return (poolDollars * allocationPct * (100 + excessAllowancePct)) / 10_000;
}

/** What an allocation strip shows (both screens, mockup approved 2026-10-28). */
export interface AllocationSummary {
  allocationBySymbol: Map<string, number>;
  /** The tickers with a set allocation, in the order given, and what they come to. */
  set: { symbol: string; pct: number }[];
  setTotalPct: number;
  /** The tickers on an equal share and that share; null when every ticker is set. */
  equalSymbols: string[];
  equalSharePct: number | null;
  /** The allocations' total raised by the allowance: 100% × 1.2 = 120% with a 20% allowance. */
  potsTotalPct: number;
  /** The bar, % of its width: each set allocation (scaled to fit when they come to over 100%), then each equal share. */
  barSegments: { symbol: string; kind: "set" | "equal"; widthPct: number }[];
}

export function summarizeAllocations(tickers: readonly { symbol: string; setPct: number | null }[], excessAllowancePct: number): AllocationSummary {
  const allocationBySymbol = effectiveAllocationPct(tickers);
  const set = tickers.filter((ticker) => ticker.setPct !== null).map((ticker) => ({ symbol: ticker.symbol, pct: ticker.setPct! }));
  const setTotalPct = set.reduce((sum, entry) => sum + entry.pct, 0);
  const equalSymbols = tickers.filter((ticker) => ticker.setPct === null).map((ticker) => ticker.symbol);
  const equalSharePct = equalSymbols.length === 0 ? null : Math.max(0, (100 - setTotalPct) / equalSymbols.length);
  const allocationTotalPct = [...allocationBySymbol.values()].reduce((sum, pct) => sum + pct, 0);
  const scale = setTotalPct > 100 ? 100 / setTotalPct : 1;
  return {
    allocationBySymbol,
    set,
    setTotalPct,
    equalSymbols,
    equalSharePct,
    potsTotalPct: (allocationTotalPct * (100 + excessAllowancePct)) / 100,
    barSegments: [
      ...set.map((entry) => ({ symbol: entry.symbol, kind: "set" as const, widthPct: entry.pct * scale })),
      ...(equalSharePct ? equalSymbols.map((symbol) => ({ symbol, kind: "equal" as const, widthPct: equalSharePct })) : []),
    ],
  };
}

/** An allocation as typed: null when empty (an equal share), NaN when it is not a number. */
export function parseAllocationText(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** Why a typed allocation cannot be used, or null: empty, or a number above 0 and at most 100. */
export function allocationTextProblem(text: string): string | null {
  const value = parseAllocationText(text);
  if (value === null) return null;
  return Number.isFinite(value) && value > 0 && value <= 100 ? null : "a number above 0 and at most 100, or empty for an equal share";
}

/** The excess allowance's range, as both APIs check it. */
export const excessAllowanceMaxPct = 1000;

/** Why a typed excess allowance cannot be used, or null: a number from 0 to 1,000. */
export function excessAllowanceTextProblem(text: string): string | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) && value >= 0 && value <= excessAllowanceMaxPct ? null : "a number from 0 to 1,000";
}

/** The allocations typed for these tickers: each usable one, A→Z; an empty or unusable one is an equal share. */
export function typedAllocationsBySymbol(symbols: readonly string[], textBySymbol: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    [...symbols].sort().flatMap((symbol) => {
      const text = textBySymbol[symbol] ?? "";
      const typed = parseAllocationText(text);
      return typed === null || allocationTextProblem(text) !== null ? [] : [[symbol, typed]];
    }),
  );
}

/** Why typed allocations and an allowance cannot be sent: each unusable allocation, set ones over 100% in all, an
 *  allowance out of range. */
export function typedAllocationProblems(symbols: readonly string[], textBySymbol: Record<string, string>, allowanceText: string): string[] {
  const problems = [...symbols].sort().flatMap((symbol) => {
    const problem = allocationTextProblem(textBySymbol[symbol] ?? "");
    return problem ? [`${symbol}'s allocation: ${problem}.`] : [];
  });
  const setTotal = Object.values(typedAllocationsBySymbol(symbols, textBySymbol)).reduce((sum, pct) => sum + pct, 0);
  if (setTotal > 100 + 1e-9) problems.push(`The set allocations come to ${formatPercentageValueTrimmed(setTotal, 2)}: at most 100% in all.`);
  const allowanceProblem = excessAllowanceTextProblem(allowanceText);
  if (allowanceProblem) problems.push(`Excess allowance: ${allowanceProblem}.`);
  return problems;
}
