import type {
  BacktestAccuracyBand,
  BacktestDetectedSplit,
  BacktestJobDisplayStatus,
  BacktestJobKind,
  BacktestJobView,
  BacktestMetrics,
  BacktestMonthlyReturn,
  BacktestSettingRow,
  BacktestSettings,
  BacktestSettingsOverrides,
  BacktestSettingUnit,
  BacktestTablesMode,
  BacktestTrade,
} from "../api/backtest";
import type { SignalGrade } from "../api/signals";
import {
  formatCompactDollarsTrimmed,
  formatCurrencyTrimmed,
  formatDayMonthYear,
  formatInputNumber,
  formatNumber,
  formatOptionContractLabel,
  formatPercentage,
  formatRatio,
  formatSignedPercentage,
  formatSignedPnl,
  formatYearMonth,
  pluralize,
  pnlTextClass,
} from "./formatters";
import { plutoParameterLabelByField } from "./plutoParameters";
import { gradeBadgeClass, gradeLabel } from "./signalsPresentation";

// Labels, badge classes, explanations and small derivations for the Backtesting screens (mockup approved 2026-10-12,
// figures defined in the API's docs/backtesting/FORMULAS.md). Every explanation uses the formula sheet's wording.

// ---- Jobs ----

export const jobKindLabel: Record<BacktestJobKind, string> = { download: "Download", backtest: "Backtest" };
export const jobKindBadgeClass: Record<BacktestJobKind, string> = { download: "backtest-kind-download", backtest: "backtest-kind-run" };

export const jobStatusLabel: Record<BacktestJobDisplayStatus, string> = {
  queued: "Queued",
  running: "Running",
  stopped: "Stopped",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const jobStatusBadgeClass: Record<BacktestJobDisplayStatus, string> = {
  queued: "bg-secondary",
  running: "bg-azure",
  stopped: "bg-warning",
  succeeded: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-secondary",
};

export const jobProgressBarClass: Record<BacktestJobDisplayStatus, string> = {
  queued: "bg-secondary",
  running: "bg-primary",
  stopped: "bg-warning",
  succeeded: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-secondary",
};

/** A stopped job seen within this long may still come back (its process was slow, the Mac woke up), so the screen keeps polling fast. */
const stoppedJobFastPollWindowMs = 10 * 60_000;
export const fastPollIntervalMs = 2_000;
export const idlePollIntervalMs = 15_000;

/** Queued, running, or stopped with a heartbeat in the last 10 minutes: its progress can still move. */
export function isBacktestJobActive(job: BacktestJobView, now: Date): boolean {
  if (job.displayStatus === "queued" || job.displayStatus === "running") return true;
  if (job.displayStatus !== "stopped") return false;
  const lastSign = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  return now.getTime() - new Date(lastSign).getTime() < stoppedJobFastPollWindowMs;
}

export function jobProgressFraction(job: BacktestJobView): number {
  if (job.status === "succeeded") return 1;
  return job.progressTotal > 0 ? Math.min(1, job.progressDone / job.progressTotal) : 0;
}

/** "612 of 1,701 trading days" (a download) or "980 of 1,690 days" (a backtest); "waiting" before a total is known. */
export function describeJobProgress(job: BacktestJobView): string {
  if (job.progressTotal <= 0) return job.displayStatus === "queued" ? "waiting" : "starting";
  return `${formatNumber(job.progressDone)} of ${formatNumber(job.progressTotal)} ${job.kind === "download" ? "trading days" : "days"}`;
}

/** The job's title: the symbol for a download, "SMCI · Edge Yield 20%" for a backtest. */
export function describeJobTitle(job: BacktestJobView): string {
  return job.kind === "backtest" && job.sessionName ? `${job.symbol} · ${job.sessionName}` : job.symbol;
}

// ---- Splits (the engine infers them: IBKR bars are split-adjusted, ThetaData options are as traded) ----

const largestSplitDenominator = 20;

/** New shares per old share in words: 10 → "10-for-1", 1.5 → "3-for-2", 0.1 → "1-for-10" (a reverse split). */
export function describeSplitRatio(ratio: number): string {
  if (!(ratio > 0)) return "—";
  const flipped = ratio < 1 ? 1 / ratio : ratio;
  for (let denominator = 1; denominator <= largestSplitDenominator; denominator++) {
    const numerator = Math.round(flipped * denominator);
    if (Math.abs(numerator / denominator - flipped) < 0.001) return ratio < 1 ? `${denominator}-for-${numerator}` : `${numerator}-for-${denominator}`;
  }
  return ratio < 1 ? `1-for-${formatInputNumber(flipped, 3)}` : `${formatInputNumber(ratio, 3)}-for-1`;
}

/** The Data files Splits cell: "none", "10-for-1 · 2024-10-01" (several joined), or "—" before the file has been analysed. */
export function describeDetectedSplits(splits: BacktestDetectedSplit[] | null | undefined): string {
  if (!splits) return "—";
  if (splits.length === 0) return "none";
  return splits.map((split) => `${describeSplitRatio(split.ratio)} · ${split.firstDayAfter}`).join(", ");
}

export const splitsNotAnalysedExplanation = "found after the next download or session run";

export const sessionSplitsNotePrefix = "Prices put on each day's traded scale:";

/** The session header note's splits, ["SMCI 10-for-1 on 2024-10-01"], or null when the period has none (no note). */
export function describeSessionSplits(symbol: string, splits: BacktestDetectedSplit[] | null | undefined): string[] | null {
  if (!splits || splits.length === 0) return null;
  return splits.map((split) => `${symbol} ${describeSplitRatio(split.ratio)} on ${split.firstDayAfter}`);
}

// ---- Sessions ----

export const tablesModeLabel: Record<BacktestTablesMode, string> = { walk_forward: "walk-forward history", current: "current tables" };

export function describeOverrideCount(count: number): string {
  return count === 0 ? "none" : pluralize(count, "setting");
}

// ---- Figures (FORMULAS.md wording) ----

export const backtestMetricExplanation = {
  totalReturn: "Total return = end value ÷ start value − 1: the account's growth over the period, after costs. The account is marked to market every trading day at 10:00 ET.",
  cagr: "CAGR = (end value ÷ start value) ^ (365 ÷ calendar days from start to end) − 1: the total return as a yearly rate on calendar time.",
  sortino: "Sortino = mean(daily return) × 252 ÷ (downside deviation × √252), with downside deviation = √(mean of min(daily return, 0)²) over all days. 252: a year holds about 252 trading days.",
  maxDrawdown: "Max drawdown: the largest fall from a previous peak of account value, as a % of that peak.",
  worstMonth: "Worst month: the lowest monthly return. A month's return is its daily returns compounded: Π (1 + daily return) − 1.",
  trades: "Trades opened in the period. Win rate = trades with P&L > 0 ÷ all closed trades.",
  averageWinLoss: "Average win / average loss: the mean P&L of the winning / losing trades, in dollars.",
  edgeCapture: "Edge capture = Σ trade P&L ÷ Σ Edge $ the model predicted for those trades at entry (1.0 = the model was exactly right on average).",
  capitalInUse: "Capital in use = mean over days of (Σ EXP $ of open positions ÷ account value). EXP $ is net of premium: a put's (strike − premium) × 100 × contracts. Return on capital in use = Σ trade P&L ÷ Σ (EXP $ × calendar days held) × 365, the same basis as Edge Yield.",
  inTheMoneyAtExpiry: "Contracts in the money at expiry = expired contracts with the strike crossed ÷ all expired contracts. Held to expiry and settled at that day's close.",
  winRate: "Win rate = trades with P&L > 0 ÷ all closed trades.",
  returnOnCapitalInUse: "Return on capital in use = Σ trade P&L ÷ Σ (EXP $ × calendar days held) × 365, the same basis as Edge Yield.",
  interest: "Interest on idle cash: each day the cash balance earns the 3-month Treasury bill rate (FRED DTB3) × calendar days since the previous trading day ÷ 365.",
  buyAndHold: "Buy and hold: on the first day at 10:00, buy as many whole shares as the starting value allows at the 10:00 stock price; the rest stays in cash and earns the same interest. No dividends in version 1.",
} as const;

/** Lowest value of a series and the date it was reached, e.g. the deepest drawdown; null for an empty series. */
export function lowestPoint<TRow>(rows: TRow[], value: (row: TRow) => number, date: (row: TRow) => string): { value: number; date: string } | null {
  let lowest: { value: number; date: string } | null = null;
  for (const row of rows) if (lowest === null || value(row) < lowest.value) lowest = { value: value(row), date: date(row) };
  return lowest;
}

/** Each day's fall from the highest value so far, ≤ 0 (FORMULAS.md max drawdown basis). */
export function drawdownsOf(values: number[]): number[] {
  let peak = -Infinity;
  return values.map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? value / peak - 1 : 0;
  });
}

/** The trades that closed (have a P&L): Σ P&L made and Σ Edge $ predicted, the two terms of edge capture. */
export function closedTradeTotals(trades: BacktestTrade[]): { madeDollars: number; predictedDollars: number } {
  const closed = trades.filter((trade) => trade.pnlDollars !== null);
  return {
    madeDollars: closed.reduce((sum, trade) => sum + (trade.pnlDollars ?? 0), 0),
    predictedDollars: closed.reduce((sum, trade) => sum + trade.expectedPnlDollars, 0),
  };
}

export function describeEdgeCaptureTotals(totals: { madeDollars: number; predictedDollars: number }): string {
  if (totals.madeDollars === 0 && totals.predictedDollars === 0) return "no closed trades";
  return `made ${formatCompactDollarsTrimmed(totals.madeDollars)} of ${formatCompactDollarsTrimmed(totals.predictedDollars)} predicted`;
}

export function describeAverageWinLoss(metrics: BacktestMetrics): string {
  return `${formatSignedPnl(metrics.averageWinDollars, 0)} / ${formatSignedPnl(metrics.averageLossDollars, 0)}`;
}

// ---- Monthly returns ----

export const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthlyReturnYear {
  year: number;
  /** Twelve cells, null where the session has no result for the month. */
  months: (number | null)[];
  /** The year's months compounded: Π (1 + monthly return) − 1. */
  yearReturn: number;
}

export function buildMonthlyReturnYears(monthlyReturns: BacktestMonthlyReturn[], series: "session" | "baseline"): MonthlyReturnYear[] {
  const byYear = new Map<number, MonthlyReturnYear>();
  for (const entry of monthlyReturns) {
    const year = Number(entry.month.slice(0, 4));
    const monthIndex = Number(entry.month.slice(5, 7)) - 1;
    const value = series === "session" ? entry.sessionReturn : entry.baselineReturn;
    const row = byYear.get(year) ?? { year, months: Array<number | null>(12).fill(null), yearReturn: 0 };
    row.months[monthIndex] = value;
    byYear.set(year, row);
  }
  return [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map((row) => ({ ...row, yearReturn: row.months.reduce<number>((product, value) => product * (1 + (value ?? 0)), 1) - 1 }));
}

/** A fraction rounded to what a percentage with `decimalPlaces` shows, so a -0.0004 month reads and colours as 0.0, not -0.0. */
export function roundToShownPercent(fraction: number, decimalPlaces = 1): number {
  const scale = 10 ** (decimalPlaces + 2);
  const rounded = Math.round(fraction * scale) / scale;
  return rounded === 0 ? 0 : rounded;
}

export function monthlyReturnCellClass(value: number | null): string {
  if (value === null) return "";
  const shown = roundToShownPercent(value);
  if (shown > 0) return "backtest-month-gain";
  if (shown < 0) return "backtest-month-loss";
  return "";
}

export function worstMonthOf(monthlyReturns: BacktestMonthlyReturn[]): string | null {
  const worst = lowestPoint(monthlyReturns, (entry) => entry.sessionReturn, (entry) => entry.month);
  return worst ? formatYearMonth(worst.date) : null;
}

// ---- Model accuracy ----

/** Made ÷ predicted Edge $ for a band (edge capture's formula); null when nothing positive was predicted. */
export function accuracyCapture(band: Pick<BacktestAccuracyBand, "realizedPnlDollars" | "predictedPnlDollars">): number | null {
  return band.predictedPnlDollars > 0 ? band.realizedPnlDollars / band.predictedPnlDollars : null;
}

export function sumAccuracyBands(bands: BacktestAccuracyBand[]): BacktestAccuracyBand {
  return bands.reduce<BacktestAccuracyBand>(
    (total, band) => ({
      label: "All",
      tradeCount: total.tradeCount + band.tradeCount,
      predictedPnlDollars: total.predictedPnlDollars + band.predictedPnlDollars,
      calibratedPnlDollars: total.calibratedPnlDollars + band.calibratedPnlDollars,
      realizedPnlDollars: total.realizedPnlDollars + band.realizedPnlDollars,
    }),
    { label: "All", tradeCount: 0, predictedPnlDollars: 0, calibratedPnlDollars: 0, realizedPnlDollars: 0 },
  );
}

// ---- Trades ----

/** "AAOI Sell $41 Put · 26 Sep (5DTE)": the platform's contract label with the sale, DTE counted from the day it opened. */
export function describeBacktestTradeContract(symbol: string, trade: BacktestTrade): string {
  return `${symbol} Sell ${formatOptionContractLabel({ strike: trade.strike, right: trade.optionRight, expiry: trade.expiry, dte: trade.dte })}`;
}

export function tradeGradeLabel(grade: string): string {
  return gradeLabel[grade as SignalGrade] ?? grade;
}

export function tradeGradeBadgeClass(grade: string): string {
  return gradeBadgeClass[grade as SignalGrade] ?? "bg-secondary";
}

/** What a held-to-expiry contract settled at: "expired" when it ended out of the money, else the closing price. */
export function describeTradeSettlement(trade: BacktestTrade): string {
  if (trade.settledOn === null) return "open";
  if (trade.inTheMoneyAtExpiry === false) return "expired";
  return formatCurrencyTrimmed(trade.settlementClose);
}

// ---- Settings ----

export function formatBacktestSettingValue(unit: BacktestSettingUnit, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (unit === "grade") return tradeGradeLabel(String(value));
  if (typeof value !== "number") return String(value);
  switch (unit) {
    case "percent":
      return `${formatInputNumber(value, 4)}%`;
    case "dollars":
      return formatCurrencyTrimmed(value);
    case "days":
      return pluralize(value, "day");
    case "integer":
      return formatNumber(value);
    default:
      return formatInputNumber(value, 4);
  }
}

/** What an input shows for a value: the bare number (no %, $ or separators) or the grade's key. */
export function settingInputText(value: number | string): string {
  return typeof value === "number" ? formatInputNumber(value, 6) : value;
}

export const settingUnitSuffix: Partial<Record<BacktestSettingUnit, string>> = { percent: "%", days: "days" };

export const gradeOptions: SignalGrade[] = ["strong", "good", "weak"];

function isNumericUnit(unit: BacktestSettingUnit): boolean {
  return unit !== "grade";
}

/** Why an edited value cannot be sent, or null when it is fine. */
export function settingValueProblem(row: BacktestSettingRow, text: string): string | null {
  if (!isNumericUnit(row.unit)) return null;
  const trimmed = text.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return `${row.label} needs a number.`;
  if ((row.unit === "integer" || row.unit === "days") && !Number.isInteger(Number(trimmed))) return `${row.label} needs a whole number.`;
  return null;
}

export function isSettingChanged(row: BacktestSettingRow, text: string): boolean {
  if (!isNumericUnit(row.unit) || typeof row.now !== "number") return text !== String(row.now);
  const trimmed = text.trim();
  return trimmed === "" || Number(trimmed) !== row.now;
}

function pathParts(path: string): [string, string | null] {
  const dot = path.indexOf(".");
  return dot === -1 ? [path, null] : [path.slice(0, dot), path.slice(dot + 1)];
}

/** The value at a settings path ("pluto.minEdgeYieldPct", "kellyFraction") in a settings or overrides object. */
export function valueAtSettingsPath(settings: BacktestSettings | BacktestSettingsOverrides, path: string): number | string | undefined {
  const [root, field] = pathParts(path);
  const container = (settings as Record<string, unknown>)[root];
  if (field === null) return container as number | string | undefined;
  return (container as Record<string, number | string> | undefined)?.[field];
}

/** The overrides a session sends: every editable row whose value differs from Pluto's, at its path. */
export function buildBacktestOverrides(rows: BacktestSettingRow[], valueByPath: Record<string, string>): BacktestSettingsOverrides {
  const overrides: Record<string, unknown> = {};
  for (const row of rows) {
    const text = valueByPath[row.path];
    if (!row.editable || text === undefined || !isSettingChanged(row, text)) continue;
    const value = isNumericUnit(row.unit) ? Number(text.trim()) : text;
    const [root, field] = pathParts(row.path);
    if (field === null) overrides[root] = value;
    else overrides[root] = { ...(overrides[root] as Record<string, unknown> | undefined), [field]: value };
  }
  return overrides as BacktestSettingsOverrides;
}

/** Every path an overrides object sets: "pluto.minEdgeYieldPct", "trading.spreadCostChargedPct", "kellyFraction". */
export function overridePaths(overrides: BacktestSettingsOverrides): string[] {
  const paths: string[] = [];
  for (const [root, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object") for (const field of Object.keys(value)) paths.push(`${root}.${field}`);
    else paths.push(root);
  }
  return paths;
}

function fallbackSettingLabel(path: string): string {
  const [root, field] = pathParts(path);
  if (field === null) return root === "kellyFraction" ? "Kelly fraction" : root;
  return (root === "pluto" ? plutoParameterLabelByField[field] : undefined) ?? field;
}

/** "Min Edge Yield 15% → 20%" per setting a session changed, labelled from the settings template when it is loaded. */
export function describeOverrideChanges(overrides: BacktestSettingsOverrides, snapshot: BacktestSettings | null, rows: BacktestSettingRow[] | null): string[] {
  return overridePaths(overrides).flatMap((path) => {
    const row = rows?.find((candidate) => candidate.path === path);
    const to = valueAtSettingsPath(overrides, path);
    const from = snapshot ? valueAtSettingsPath(snapshot, path) : undefined;
    if (to === undefined || to === from) return [];
    const label = row?.label ?? fallbackSettingLabel(path);
    const format = (value: number | string | undefined) => (row ? formatBacktestSettingValue(row.unit, value) : value === undefined ? "—" : String(value));
    return [from === undefined ? `${label} ${format(to)}` : `${label} ${format(from)} → ${format(to)}`];
  });
}

// ---- Compare ----

export interface CompareMetricRow {
  key: string;
  label: string;
  explanation: string;
  value: (metrics: BacktestMetrics) => number | null;
  format: (value: number | null) => string;
  /** Whether the highest or the lowest value is best; null where no value is better (shaded none). */
  better: "higher" | "lower" | null;
  /** Signed figures read green/red. */
  signed: boolean;
  /** Meaningless for buy and hold (no trades). */
  tradesOnly: boolean;
}

export const compareMetricRows: CompareMetricRow[] = [
  { key: "totalReturn", label: "Total return", explanation: backtestMetricExplanation.totalReturn, value: (m) => m.totalReturn, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "cagr", label: "CAGR", explanation: backtestMetricExplanation.cagr, value: (m) => m.cagr, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "sortino", label: "Sortino", explanation: backtestMetricExplanation.sortino, value: (m) => m.sortino, format: (v) => formatRatio(v, 2), better: "higher", signed: false, tradesOnly: false },
  { key: "maxDrawdown", label: "Max drawdown", explanation: backtestMetricExplanation.maxDrawdown, value: (m) => m.maxDrawdown, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "worstMonth", label: "Worst month", explanation: backtestMetricExplanation.worstMonth, value: (m) => m.worstMonth, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "trades", label: "Trades", explanation: backtestMetricExplanation.trades, value: (m) => m.tradeCount, format: (v) => formatNumber(v), better: null, signed: false, tradesOnly: true },
  { key: "winRate", label: "Win rate", explanation: backtestMetricExplanation.winRate, value: (m) => m.winRate, format: (v) => formatPercentage(v, 0), better: "higher", signed: false, tradesOnly: true },
  { key: "edgeCapture", label: "Edge capture", explanation: backtestMetricExplanation.edgeCapture, value: (m) => m.edgeCapture, format: (v) => formatRatio(v, 2), better: "higher", signed: false, tradesOnly: true },
  { key: "capitalInUse", label: "Capital in use", explanation: backtestMetricExplanation.capitalInUse, value: (m) => m.capitalInUse, format: (v) => formatPercentage(v, 0), better: null, signed: false, tradesOnly: false },
  { key: "returnOnCapitalInUse", label: "Return on capital in use", explanation: backtestMetricExplanation.returnOnCapitalInUse, value: (m) => m.returnOnCapitalInUse, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
];

/** Index of the best value in a row (ties: the first), or -1 when the row has no "best" or fewer than two values. */
export function bestValueIndex(values: (number | null)[], better: "higher" | "lower" | null): number {
  if (better === null || values.filter((value) => value !== null).length < 2) return -1;
  let bestIndex = -1;
  values.forEach((value, index) => {
    if (value === null) return;
    const best = bestIndex === -1 ? null : values[bestIndex]!;
    if (best === null || (better === "higher" ? value > best : value < best)) bestIndex = index;
  });
  return bestIndex;
}

// ---- Charts ----

/** The app's categorical chart order (the Dashboard allocation palette, validated in both themes); sessions take slots in order. */
export const backtestSeriesColorsByTheme = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

/** Buy and hold is the reference line: grey and dashed, never a categorical slot. */
export const buyAndHoldColorByTheme = { light: "#6b7280", dark: "#a3acb9" } as const;
export const buyAndHoldDashArray = 5;

/** A YYYY-MM-DD trading date as the chart's x value (UTC midnight; the axes format in UTC so the day never shifts). */
export function tradingDateToChartTime(tradingDate: string): number {
  return Date.parse(`${tradingDate}T00:00:00Z`);
}

export function formatChartDollars(value: number): string {
  return formatCompactDollarsTrimmed(value);
}

/** The value axis's dollar labels: compact ("$1.4M") when the lines span 10% or more, else whole dollars, because a short or
 *  flat session would label every tick "$1M". */
export function dollarAxisFor(values: number[]): { formatter: (value: number) => string; labelWidth: number } {
  const finite = values.filter((value) => Number.isFinite(value));
  const highest = Math.max(...finite.map(Math.abs), 0);
  const span = finite.length > 0 ? Math.max(...finite) - Math.min(...finite) : 0;
  return span >= highest * 0.1 ? { formatter: formatChartDollars, labelWidth: 64 } : { formatter: (value: number) => formatCurrencyTrimmed(Math.round(value)), labelWidth: 88 };
}

/** Signed percentage text and its green/red class, rounded to what is shown first so +0.0% is never coloured. */
export function signedPercentDisplay(fraction: number | null | undefined, decimalPlaces = 1): { text: string; className: string } {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return { text: "—", className: "" };
  const shown = roundToShownPercent(fraction, decimalPlaces);
  return { text: formatSignedPercentage(shown, decimalPlaces), className: pnlTextClass(shown) };
}

export function describeDeepestDrawdown(days: { tradingDate: string; drawdown: number }[]): string | null {
  const deepest = lowestPoint(days, (day) => day.drawdown, (day) => day.tradingDate);
  return deepest && deepest.value < 0 ? `deepest on ${formatDayMonthYear(deepest.date)}` : null;
}
