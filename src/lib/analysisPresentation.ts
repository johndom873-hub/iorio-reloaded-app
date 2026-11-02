import { tickerOwnValueFields, type AnalysisFigures, type AnalysisLadderPutBlock, type AnalysisMaxDrawdown, type AnalysisVolFarmerV4Values, type BacktestLabAuditRow, type SuitabilityCheck, type SuitabilityVerdict, type TickerFieldValues, type TickerOwnValueField, type TickerOwnValues } from "../api/backtestAnalysis";
import type { BacktestSettingRow } from "../api/backtest";
import { formatSettingRowValue } from "./backtestPresentation";
import { formatCurrency, formatDeltaTrimmed, formatInputNumber, formatPercentageValueTrimmed, formatSignedNumber, joinWithAnd } from "./formatters";

// The Analyse window's shared presentation (Vol Farmer v4, mockup approved 2026-11-01): the session price chart's colours
// and date runs, the header's categories, the bars' Max drawdown, the rule's checks, the sources, and the window's numbers
// and dates as its cards write them.

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

/** The window's chart colours per theme (mockup approved 2026-10-15, contrast checked in both). */
export const analysisChartColors = {
  light: { series1: "#2a78d6", series2: "#eb6834", candleUp: "#2fb344", candleDown: "#d63939", drawdown: "#d63939", shadeSmall: "#f59f00", shadeStrike: "#6f42c1", ladder: "#2a78d6", rungBadge: "#1f6bc4", cashAvailable: "#0f7d6e", breakEven: "#2a78d6", breakEven2: "#6f42c1", leaps: "#ffd43b", leapsText: "#1d2733", surface: "#ffffff", border: "#dadfe5", text: "#1d273b", secondary: "#49566c" },
  dark: { series1: "#3987e5", series2: "#d95926", candleUp: "#2fb344", candleDown: "#d63939", drawdown: "#d63939", shadeSmall: "#f5b458", shadeStrike: "#b18cf0", ladder: "#3987e5", rungBadge: "#1f6bc4", cashAvailable: "#4fc9b8", breakEven: "#3987e5", breakEven2: "#b18cf0", leaps: "#ffd43b", leapsText: "#1d2733", surface: "#2a3648", border: "#45566e", text: "#f9fafb", secondary: "#9ba9be" },
} as const;

/** Why no ladder Put could be sold on a day, as the price chart's tooltip says it. */
export const analysisLadderPutBlockText: Record<AnalysisLadderPutBlock, string> = {
  ladder_puts_off: "ladder Puts are off",
  every_lot_has_a_call: "every lot has a Call",
  a_put_is_open: "a Put is open (one at a time)",
  no_cap: "no Put fits under the cap",
};

/** A signed figure's ink in the window: green above zero, red below (Tabler's dark .text-danger fails on the card). */
export function analysisSignedClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "analysis-ink-good" : "analysis-ink-poor";
}

// ---- The window's header (Marcelo 2026-10-19) ----

const tickerKindLabel = { stock: "Stock", adr: "ADR", etf: "ETF", other: "Other" } as const;

/** The header's category chips: "Stock", "Finance", "Investment Banks/Brokers"; an ETF is "ETF" alone (its sector only says "Miscellaneous"). */
export function tickerCategoryLabels(profile: { kind: keyof typeof tickerKindLabel | null; sector: string | null; industry: string | null }): string[] {
  if (profile.kind === "etf") return ["ETF"];
  return [profile.kind ? tickerKindLabel[profile.kind] : null, profile.sector, profile.industry].filter((label): label is string => !!label);
}

/**
 * Max drawdown of the bars on screen (the API's formula): max over days of (1 − close ÷ the highest close before it), with
 * the first close back at or above the peak looked for in all the bars. Null under two bars.
 */
export function maxDrawdownOfBars(bars: AnalysisFigures["bars"], allBars: AnalysisFigures["bars"] = bars): AnalysisMaxDrawdown | null {
  if (bars.length < 2) return null;
  let peakIndex = 0;
  let best = { depth: 0, peakIndex: 0, troughIndex: 0 };
  bars.forEach((bar, index) => {
    if (bar[4] > bars[peakIndex]![4]) peakIndex = index;
    const depth = 1 - bar[4] / bars[peakIndex]![4];
    if (depth > best.depth) best = { depth, peakIndex, troughIndex: index };
  });
  const peak = bars[best.peakIndex]!;
  const trough = bars[best.troughIndex]!;
  const recovered = allBars.find((bar) => bar[0] > trough[0] && bar[4] >= peak[4]) ?? null;
  return { depth: best.depth, peakDate: peak[0], peak: peak[4], troughDate: trough[0], trough: trough[4], recoveredOn: recovered?.[0] ?? null };
}

// The Vol Farmer v4 Analyse window's shared wording (mockup approved 2026-11-01).

export const suitabilityCheckLabels: Record<SuitabilityCheck, string> = {
  options_income: "Options' income",
  expiry_days_sold: "Expiry days sold",
  weeks_with_expiry: "Weeks with an expiry",
  lot_fits: "A lot fits",
};

/** The checks a verdict failed, and the windows it couldn't measure: "Options' income · Expiry days sold"; "" when none. */
export function describeFailedChecks(verdict: Pick<SuitabilityVerdict, "failedChecks" | "uncoveredWindows">): string {
  const parts = verdict.failedChecks.map((check) => suitabilityCheckLabels[check]);
  if (verdict.uncoveredWindows.length > 0) parts.push(`${verdict.uncoveredWindows.map((months) => `${months} months`).join(" and ")} not covered`);
  return parts.join(" · ");
}

export type AnalysisSourceKey = "calls" | "puts" | "leaps" | "interest" | "shares";
export const analysisSourceKeys: readonly AnalysisSourceKey[] = ["calls", "puts", "leaps", "interest", "shares"];
export const analysisSourceLabels: Record<AnalysisSourceKey, string> = {
  calls: "Covered Calls",
  puts: "Cash-Secured Puts",
  leaps: "LEAPS",
  interest: "T-bill interest",
  shares: "Shares' price moves",
};

/** Expiry days sold tinted as the rule reads them: 70% or more, 50 to 70%, under 50%. */
export function expiryDaysSoldTint(share: number | null): string {
  if (share === null) return "";
  return share >= 0.7 ? "analysis-cell-good" : share >= 0.5 ? "analysis-cell-fair" : "analysis-cell-poor";
}

/** A source's part of the CAGR in percentage points, unsigned: 0.371 → "37.1" (as "37.1 of the 49.7 points"). */
export function formatCagrPoints(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  return (fraction * 100).toFixed(1);
}

/** A source's part of a return in percentage points, signed: 0.433 → "+43.3", −0.102 → "-10.2". */
export function formatSignedCagrPoints(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  return formatSignedNumber(fraction * 100, 1);
}

/** The lab's global values an analysis reads (the API's labSettingsStore.ts analysisReadsLabPath): v4's, the spread's share, the looks' window and the starting account. */
const analysisReadsLabPath = (path: string) => path.startsWith("volFarmerV4.") || ["lab.defaultPotDollars", "trading.spreadCostChargedPct", "pluto.windowStartEt", "pluto.windowEndEt"].includes(path);

/**
 * The out-of-date note's changes: the lab's audit rows since the analysis ran, on values it reads, each field once from its
 * first old value to its last new one: "Calls' |delta| to 0.4 instead of 0.5".
 */
export function describeLabChangesSince(audit: readonly BacktestLabAuditRow[], rows: readonly BacktestSettingRow[], sinceIso: string): string[] {
  const byField = new Map<string, { oldValue: string | null; newValue: string | null }>();
  for (const change of [...audit].filter((entry) => entry.symbol === null && entry.changedAt > sinceIso && analysisReadsLabPath(entry.field)).sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
    const seen = byField.get(change.field);
    byField.set(change.field, { oldValue: seen ? seen.oldValue : change.oldValue, newValue: change.newValue });
  }
  // As the lab settings window shows an audit value.
  const shown = (row: BacktestSettingRow | undefined, field: string, value: string | null) => {
    if (value === null) return "—";
    if (field === "lab.defaultPotDollars") return formatCurrency(Number(value), 0);
    if (!row) return value;
    return formatSettingRowValue(row, row.unit === "choice" || row.unit === "grade" || row.unit === "time" ? value : Number(value));
  };
  return [...byField.entries()]
    .filter(([, change]) => change.oldValue !== change.newValue)
    .map(([field, change]) => {
      const row = rows.find((entry) => entry.path === field);
      const label = field === "lab.defaultPotDollars" ? "Starting account" : (row?.label ?? field);
      return `${label} ${shown(row, field, change.newValue)} instead of ${shown(row, field, change.oldValue)}`;
    });
}

// ---- A ticker's own Vol Farmer v4 values (mockup approved 2026-11-02) ----

export type TickerValueGroup = "calls" | "firstPosition" | "put" | "leaps";

/** The window's four boxes: the Calls' |delta| range is one, from and to. */
export const tickerValueGroups: readonly { group: TickerValueGroup; label: string; fields: readonly TickerOwnValueField[] }[] = [
  { group: "calls", label: "Calls' |delta|", fields: ["callMinAbsDelta", "callMaxAbsDelta"] },
  { group: "firstPosition", label: "First position", fields: ["firstPositionPct"] },
  { group: "put", label: "Put |delta|", fields: ["putMaxAbsDelta"] },
  { group: "leaps", label: "LEAPS cap", fields: ["leapsMaxAccountPct"] },
];

/** Each value's range, as the API checks it. */
export const tickerOwnValueRanges: Record<TickerOwnValueField, { min: number; max: number }> = {
  callMinAbsDelta: { min: 0.01, max: 0.99 },
  callMaxAbsDelta: { min: 0.01, max: 0.99 },
  firstPositionPct: { min: 10, max: 90 },
  putMaxAbsDelta: { min: 0.01, max: 0.99 },
  leapsMaxAccountPct: { min: 0, max: 100 },
};

const isPercentField = (field: TickerOwnValueField) => field === "firstPositionPct" || field === "leapsMaxAccountPct";

/** One of the five as the window writes it: "0.10", "60%". */
export function formatTickerOwnValue(field: TickerOwnValueField, value: number): string {
  return isPercentField(field) ? formatPercentageValueTrimmed(value, 2) : formatDeltaTrimmed(value);
}

/** One of the five as an input's text: "0.10", "60". */
export const tickerOwnValueInputText = (field: TickerOwnValueField, value: number) => (isPercentField(field) ? formatInputNumber(value, 4) : formatDeltaTrimmed(value));

/** The five of a v4 section. */
export function tickerFieldValuesOfVolFarmerV4(volFarmerV4: AnalysisVolFarmerV4Values): TickerFieldValues {
  return Object.fromEntries(tickerOwnValueFields.map((field) => [field, volFarmerV4[field]])) as TickerFieldValues;
}

/** The five a ticker runs: its own where it has one, else the lab's. */
export function mergeTickerOwnValues(lab: TickerFieldValues, own: TickerOwnValues | null | undefined): TickerFieldValues {
  return Object.fromEntries(tickerOwnValueFields.map((field) => [field, own?.[field] ?? lab[field]])) as TickerFieldValues;
}

/** The boxes whose values differ between the two. */
export function tickerValueGroupsDiffering(first: TickerFieldValues, second: TickerFieldValues): TickerValueGroup[] {
  return tickerValueGroups.filter(({ fields }) => fields.some((field) => first[field] !== second[field])).map(({ group }) => group);
}

/** A box's values: "Calls' |delta| 0.10 to 0.40", "First position 60%", "Put |delta| 0.30", "LEAPS cap 10%". */
export function describeTickerValueGroup(group: TickerValueGroup, values: TickerFieldValues): string {
  const { label, fields } = tickerValueGroups.find((entry) => entry.group === group)!;
  return `${label} ${fields.map((field) => formatTickerOwnValue(field, values[field])).join(" to ")}`;
}

/** The given boxes' values, joined: "Calls' |delta| 0.10 to 0.40, First position 60%"; "" when none. */
export function describeTickerValues(values: TickerFieldValues, groups: readonly TickerValueGroup[]): string {
  return groups.map((group) => describeTickerValueGroup(group, values)).join(", ");
}

/** The values that differ from the lab's, described; "" when none. */
export const describeTickerValuesDifferingFromLab = (values: TickerFieldValues, lab: TickerFieldValues) => describeTickerValues(values, tickerValueGroupsDiffering(values, lab));

/** Under a box: the lab's value now, "Lab: 0.05 to 0.50"; the LEAPS cap says what 0 does. */
export function describeTickerValueLabHint(group: TickerValueGroup, lab: TickerFieldValues): string {
  const { fields } = tickerValueGroups.find((entry) => entry.group === group)!;
  const shown = fields.map((field) => formatTickerOwnValue(field, lab[field])).join(" to ");
  return group === "leaps" ? `Lab: ${shown}; 0: no cap` : `Lab: ${shown}`;
}

/** A box's typed text as a number; null when it is not one. */
export function parseTickerOwnValueText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Why a typed value cannot be used: "a number from 10 to 90"; null when it can. */
export function tickerOwnValueProblem(field: TickerOwnValueField, text: string): string | null {
  const value = parseTickerOwnValueText(text);
  const { min, max } = tickerOwnValueRanges[field];
  if (value === null || value < min || value > max) return `A number from ${formatInputNumber(min, 2)} to ${formatInputNumber(max, 2)}`;
  return null;
}

/** The New session note for several tickers: "AAPL and AMD have their own values; a session of several tickers runs the lab's." */
export function describeSeveralTickersWithOwnValues(symbols: readonly string[]): string {
  return `${joinWithAnd(symbols)} ${symbols.length === 1 ? "has its" : "have their"} own values; a session of several tickers runs the lab's.`;
}
