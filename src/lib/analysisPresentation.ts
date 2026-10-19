import type { AnalysisFigures } from "../api/backtestAnalysis";
import { formatCurrency } from "./formatters";

// The Analyse window's formulas the browser recomputes as values change (approved 2026-10-15; the API computes the same
// in src/backtest/analysis/analysisPotSizing.ts) and its shared presentation: the settings panel's values, their
// descriptions, the liquidity colours and the backtest's name.

/** The engine's fixed rules (not settings): the minimum bid, the volume share and the option fee. */
export const analysisFixedRulesText = "bid at least $0.05 · up to 20% of the previous complete session's volume · $0.68 fee per contract";

/** The settings panel's values, as numbers. ladderShockPct null = the shock rule (from the stock's Max drawdown). */
export interface AnalysisPanelValues {
  potDollars: number;
  ladderSharesPct: number;
  ladderRungs: number;
  ladderShockPct: number | null;
  minAbsDelta: number;
  maxAbsDelta: number;
  minDte: number;
  maxDte: number;
  maxSpreadPctOfMid: number;
}

export type AnalysisPanelKey = keyof AnalysisPanelValues;
export const analysisPanelKeys: readonly AnalysisPanelKey[] = ["potDollars", "ladderSharesPct", "ladderRungs", "ladderShockPct", "minAbsDelta", "maxAbsDelta", "minDte", "maxDte", "maxSpreadPctOfMid"];
/** The values a ticker can save as its own; the rest are the lab's global values only. */
export const analysisTickerKeys: readonly AnalysisPanelKey[] = ["potDollars", "ladderSharesPct", "ladderRungs", "ladderShockPct", "minAbsDelta", "maxAbsDelta"];

/** Ratios at or above 80% of days are good, 50–80% fair, under 50% poor (liquidity cells, fit history). */
export type AnalysisLevel = "good" | "fair" | "poor";
export function liquidityLevel(shareOfDays: number): AnalysisLevel {
  if (shareOfDays >= 0.8) return "good";
  if (shareOfDays >= 0.5) return "fair";
  return "poor";
}

/** The first rung's cap: the 10:00 price × (1 − S ÷ rungs). */
export const firstRungCap = (price: number, shock: number, rungs: number) => price * (1 - shock / rungs);

/** A lot fits while the price is at most pot × p ÷ 100. */
export const lotPriceCeiling = (values: AnalysisPanelValues) => (values.potDollars * values.ladderSharesPct) / 100 / 100;

/** A Put at the first cap fits a rung while the price is at most pot × (1 − p) ÷ (100 × (n − S)). */
export const rungPriceCeiling = (values: AnalysisPanelValues, shock: number) => (values.potDollars * (1 - values.ladderSharesPct / 100)) / (100 * (values.ladderRungs - shock));

/** The day's smallest pot: max(100 × P ÷ p, 100 × P × (n − S) ÷ (1 − p)). */
export function smallestPotOfDay(price: number, shock: number, values: Pick<AnalysisPanelValues, "ladderSharesPct" | "ladderRungs">): number {
  const share = values.ladderSharesPct / 100;
  return Math.max((100 * price) / share, (100 * price * (values.ladderRungs - shock)) / (1 - share));
}

/** The shock a day uses at these values: the entered one, else the rule's for that day. */
export const shockFor = (values: Pick<AnalysisPanelValues, "ladderShockPct">, ruleShock: number) => (values.ladderShockPct === null ? ruleShock : values.ladderShockPct / 100);

export interface AnalysisFitYear {
  days: number;
  lotFails: number;
  rungFails: number;
}

/**
 * The pot on a day from the analysis backtest's pot path (approved 2026-10-15): that day's value, else the latest before it
 * (carried forward past the backtest's last day); the first value before its first day. Null without a path.
 */
export function potOnDayFrom(path: readonly [string, number][] | null | undefined): ((date: string) => number) | null {
  if (!path || path.length === 0) return null;
  const byDate = new Map(path);
  return (date) => {
    const exact = byDate.get(date);
    if (exact !== undefined) return exact;
    let value = path[0]![1];
    for (const [pathDate, pot] of path) {
      if (pathDate > date) break;
      value = pot;
    }
    return value;
  };
}

/** Whether that day's pot bought a lot and a Put at the first cap fit a rung. */
function dayFits(price: number, shock: number, pot: number, values: AnalysisPanelValues): { lot: boolean; rung: boolean } {
  const share = values.ladderSharesPct / 100;
  return { lot: pot * share >= price * 100, rung: (pot * (1 - share)) / values.ladderRungs >= firstRungCap(price, shock, values.ladderRungs) * 100 };
}

/** Fit over the history: each day at that day's 10:00 price as traded and shock, against that day's pot. */
export function fitHistoryByYear(fitDays: AnalysisFigures["fitDays"], values: AnalysisPanelValues, potOnDay: (date: string) => number): Record<string, AnalysisFitYear> {
  const byYear: Record<string, AnalysisFitYear> = {};
  for (const [date, price, ruleShock] of fitDays) {
    const fits = dayFits(price, shockFor(values, ruleShock), potOnDay(date), values);
    const year = (byYear[date.slice(0, 4)] ??= { days: 0, lotFails: 0, rungFails: 0 });
    year.days++;
    if (!fits.lot) year.lotFails++;
    if (!fits.rung) year.rungFails++;
  }
  return byYear;
}

/** The days a lot or a rung did not fit that day's pot: the price chart's "pot too small" shading. */
export function tooSmallDates(fitDays: AnalysisFigures["fitDays"], values: AnalysisPanelValues, potOnDay: (date: string) => number): string[] {
  return fitDays
    .filter(([date, price, ruleShock]) => {
      const fits = dayFits(price, shockFor(values, ruleShock), potOnDay(date), values);
      return !fits.lot || !fits.rung;
    })
    .map(([date]) => date);
}

/** Consecutive dates (in `allDates`' order) joined into [from, to] ranges. */
export function dateRuns(dates: readonly string[], allDates: readonly string[]): [string, string][] {
  const wanted = new Set(dates);
  const runs: [string, string][] = [];
  let start: string | null = null;
  let previous: string | null = null;
  for (const date of allDates) {
    if (wanted.has(date)) {
      start ??= date;
      previous = date;
    } else if (start !== null) {
      runs.push([start, previous!]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, previous!]);
  return runs;
}

/**
 * The day's largest pot (approved 2026-10-15): the smaller of the Put side, limit × strike × 100 × n ÷ (1 − p), from the best
 * Put under the first rung's cap, and the Call side, limit × 100 × P ÷ p, from the best Call for a new Covered Call entry.
 * Null when a side has no qualifying contract: the day is left out and counted apart (Marcelo 2026-10-15).
 */
export function largestPotOfDay(day: AnalysisFigures["fitDays"][number], values: Pick<AnalysisPanelValues, "ladderSharesPct" | "ladderRungs">): { pot: number; right: "C" | "P" } | null {
  const [, price, , putVolumeCap, putStrike, callVolumeCap] = day;
  const share = values.ladderSharesPct / 100;
  const putSide = putVolumeCap != null && putStrike != null ? (putVolumeCap * putStrike * 100 * values.ladderRungs) / (1 - share) : null;
  const callSide = callVolumeCap != null ? (callVolumeCap * 100 * price) / share : null;
  if (putSide === null || callSide === null) return null;
  return putSide <= callSide ? { pot: putSide, right: "P" } : { pot: callSide, right: "C" };
}

const pointFromBelow = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
};
const pointFromAbove = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
};

export const oneYearBefore = (dateIso: string) => `${Number(dateIso.slice(0, 4)) - 1}${dateIso.slice(4)}`;

export interface AnalysisPotRange {
  smallest: number | null;
  largest: number | null;
  /** A range exists: smallest ≤ largest. */
  suits: boolean;
  days: number;
  /** Days counted in the largest pot's point. */
  largestDays: number;
  /** Days left out of the largest pot's point: no qualifying Put, no qualifying Call (a day can lack both). */
  daysWithoutPut: number;
  daysWithoutCall: number;
  /** Days whose largest pot the Call side set. */
  callBinding: number;
  /** The year whose median day allowed the smallest largest pot: [year, median pot]. */
  thinnestYear: [string, number] | null;
  /** The window's first day (exclusive); null for all history. */
  from: string | null;
}

/**
 * The pot that fits on at least `percent`% of days: smallest = the point of the daily smallest pots from below, largest =
 * the point of the daily largest pots from above, days with no qualifying Put or Call left out. Without `everyDayLargest`
 * (figures before the every-day largest pot) `largest` is null.
 */
export function potRange(input: { fitDays: AnalysisFigures["fitDays"]; values: AnalysisPanelValues; percent: number; window: "12m" | "all"; lastDate: string; everyDayLargest: boolean }): AnalysisPotRange {
  const from = input.window === "12m" ? oneYearBefore(input.lastDate) : null;
  const days = input.fitDays.filter(([date]) => from === null || date > from);
  const smallestPots = days.map(([, price, ruleShock]) => smallestPotOfDay(price, shockFor(input.values, ruleShock), input.values));
  const largestDays = input.everyDayLargest ? days : [];
  const largestByDay = largestDays.map((day) => ({ date: day[0], largest: largestPotOfDay(day, input.values) }));
  const counted = largestByDay.flatMap((row) => (row.largest === null ? [] : [{ date: row.date, ...row.largest }]));
  const fraction = input.percent / 100;
  const smallest = smallestPots.length > 0 ? pointFromBelow(smallestPots, fraction) : null;
  const largest = counted.length > 0 ? pointFromAbove(counted.map((day) => day.pot), fraction) : null;
  const byYear = new Map<string, number[]>();
  for (const day of counted) (byYear.get(day.date.slice(0, 4)) ?? byYear.set(day.date.slice(0, 4), []).get(day.date.slice(0, 4))!).push(day.pot);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const thinnestYear = [...byYear.entries()].map(([year, pots]) => [year, median(pots)] as [string, number]).sort((a, b) => a[1] - b[1])[0] ?? null;
  return {
    smallest,
    largest,
    suits: smallest !== null && largest !== null && smallest <= largest,
    days: smallestPots.length,
    largestDays: counted.length,
    daysWithoutPut: largestDays.filter((day) => day[3] == null).length,
    daysWithoutCall: largestDays.filter((day) => day[5] == null).length,
    callBinding: counted.filter((day) => day.right === "C").length,
    thinnestYear,
    from,
  };
}

/** Pots shown to the nearest $100. */
export const roundPot = (dollars: number) => Math.round(dollars / 100) * 100;

const groups: AnalysisPanelKey[][] = [["potDollars"], ["ladderSharesPct"], ["ladderRungs"], ["ladderShockPct"], ["minAbsDelta", "maxAbsDelta"], ["minDte", "maxDte"], ["maxSpreadPctOfMid"]];

function groupText(key: AnalysisPanelKey, values: AnalysisPanelValues, ruleShock: number, compact: boolean): string {
  switch (key) {
    case "potDollars":
      return compact ? `$${Math.round(values.potDollars / 1000)}k pot` : `pot ${formatCurrency(values.potDollars, 0)}`;
    case "ladderSharesPct":
      return compact ? `${values.ladderSharesPct}% shares` : `shares ${values.ladderSharesPct}%`;
    case "ladderRungs":
      return `${values.ladderRungs} rung${values.ladderRungs === 1 ? "" : "s"}`;
    case "ladderShockPct":
      return values.ladderShockPct === null ? `shock ${Math.round(ruleShock * 100)}%${compact ? "" : " (the rule's)"}` : `shock ${values.ladderShockPct}%`;
    case "minAbsDelta":
    case "maxAbsDelta":
      return `|delta| ${values.minAbsDelta.toFixed(2)}–${values.maxAbsDelta.toFixed(2)}`;
    case "minDte":
    case "maxDte":
      return compact ? `${values.minDte}–${values.maxDte} DTE` : `${values.minDte}–${values.maxDte} days to expiry`;
    case "maxSpreadPctOfMid":
      return compact ? `spread ≤ ${values.maxSpreadPctOfMid}%` : `spread limit ${values.maxSpreadPctOfMid}% of the mid`;
  }
}

/** "shares 30%, 4 rungs": the groups any of `keys` belongs to, in the panel's order. */
export function describeAnalysisValues(values: AnalysisPanelValues, keys: readonly AnalysisPanelKey[], ruleShock: number, compact = false): string {
  const wanted = new Set(keys);
  return groups.filter((group) => group.some((key) => wanted.has(key))).map((group) => groupText(group[0]!, values, ruleShock, compact)).join(", ");
}

/** Every group, each marked when one of its keys is in `changed`. */
export function describeAllAnalysisValues(values: AnalysisPanelValues, changed: readonly AnalysisPanelKey[], ruleShock: number): { text: string; changed: boolean }[] {
  const set = new Set(changed);
  return groups.map((group) => ({ text: groupText(group[0]!, values, ruleShock, false), changed: group.some((key) => set.has(key)) }));
}

/** The keys whose values differ. */
export function differingAnalysisKeys(a: AnalysisPanelValues, b: AnalysisPanelValues): AnalysisPanelKey[] {
  return analysisPanelKeys.filter((key) => a[key] !== b[key]);
}

/** "Analyse · HOOD · 30% shares · 5 rungs · |delta| 0.05–0.30 · $200k" (≤ 120 characters), with the shock, days to expiry or spread when they differ from the ticker's. */
export function analysisBacktestName(symbol: string, values: AnalysisPanelValues, changed: readonly AnalysisPanelKey[], ruleShock: number): string {
  const extra = changed.filter((key) => key === "ladderShockPct" || key === "minDte" || key === "maxDte" || key === "maxSpreadPctOfMid");
  const parts = [`${values.ladderSharesPct}% shares`, `${values.ladderRungs} rung${values.ladderRungs === 1 ? "" : "s"}`, `|delta| ${values.minAbsDelta.toFixed(2)}–${values.maxAbsDelta.toFixed(2)}`];
  const more = extra.length > 0 ? describeAnalysisValues(values, extra, ruleShock, true) : "";
  return `Analyse · ${symbol} · ${parts.join(" · ")}${more ? ` · ${more}` : ""} · $${Math.round(values.potDollars / 1000)}k`.slice(0, 120);
}

/** The window's chart colours per theme (mockup approved 2026-10-15, contrast checked in both). */
export const analysisChartColors = {
  light: { series1: "#2a78d6", series2: "#eb6834", candleUp: "#2fb344", candleDown: "#d63939", drawdown: "#d63939", shadeSmall: "#f59f00", shadeStrike: "#6f42c1", surface: "#ffffff", border: "#dadfe5", text: "#1d273b", secondary: "#49566c" },
  dark: { series1: "#3987e5", series2: "#d95926", candleUp: "#2fb344", candleDown: "#d63939", drawdown: "#d63939", shadeSmall: "#f5b458", shadeStrike: "#b18cf0", surface: "#2a3648", border: "#45566e", text: "#f9fafb", secondary: "#9ba9be" },
} as const;

/** A signed figure's ink in the window: green above zero, red below (Tabler's dark .text-danger fails on the card). */
export function analysisSignedClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "analysis-ink-good" : "analysis-ink-poor";
}

// ---- The window's header (Marcelo 2026-10-19) ----

type AnalysisBar = AnalysisFigures["bars"][number];

/** The last daily close and its change from the one before (a fraction); null without bars. */
export function lastCloseWithChange(bars: readonly AnalysisBar[]): { date: string; close: number; change: number | null } | null {
  const last = bars.at(-1);
  if (!last) return null;
  const previous = bars.at(-2);
  return { date: last[0], close: last[4], change: previous && previous[4] > 0 ? last[4] / previous[4] - 1 : null };
}

/** The 52-week range: the lowest low and highest high of the last 252 sessions, and where the last close sits in it (0 = the low, 1 = the high). */
export function fiftyTwoWeekRange(bars: readonly AnalysisBar[]): { low: number; high: number; position: number | null } | null {
  const window = bars.slice(-252);
  if (window.length === 0) return null;
  const low = Math.min(...window.map((bar) => bar[3]));
  const high = Math.max(...window.map((bar) => bar[2]));
  return { low, high, position: high > low ? (window.at(-1)![4] - low) / (high - low) : null };
}

/**
 * IV percentile (approved 2026-10-19): the share of the last 252 sessions with an implied volatility whose IV is at or below
 * the last session's. Null when the last session has none.
 */
export function impliedVolatilityPercentile(bars: readonly AnalysisBar[]): { impliedVolatility: number; percentile: number; sessions: number } | null {
  const window = bars.slice(-252).flatMap((bar) => (bar[5] === null ? [] : [bar[5]]));
  const today = bars.at(-1)?.[5] ?? null;
  if (today === null || window.length === 0) return null;
  return { impliedVolatility: today, percentile: window.filter((value) => value <= today).length / window.length, sessions: window.length };
}

const tickerKindLabel = { stock: "Stock", adr: "ADR", etf: "ETF", other: "Other" } as const;

/** The header's category chips: "Stock", "Finance", "Investment Banks/Brokers"; an ETF is "ETF" alone (its sector only says "Miscellaneous"). */
export function tickerCategoryLabels(profile: { kind: keyof typeof tickerKindLabel | null; sector: string | null; industry: string | null }): string[] {
  if (profile.kind === "etf") return ["ETF"];
  return [profile.kind ? tickerKindLabel[profile.kind] : null, profile.sector, profile.industry].filter((label): label is string => !!label);
}
