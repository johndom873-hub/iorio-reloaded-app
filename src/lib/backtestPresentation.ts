import {
  defaultBacktestPolicySettings,
  type BacktestAccuracyBand,
  type BacktestAction,
  type BacktestActionKind,
  type BacktestCycle,
  type BacktestDecisionMaker,
  type BacktestDetectedSplit,
  type BacktestFill,
  type BacktestJobDisplayStatus,
  type BacktestJobKind,
  type BacktestJobView,
  type BacktestMetrics,
  type BacktestMonthlyReturn,
  type BacktestPnlBasis,
  type BacktestPosition,
  type BacktestPositionLeg,
  type BacktestSettingChoice,
  type BacktestSettingRow,
  type BacktestSettings,
  type BacktestSettingsOverrides,
  type BacktestSettingUnit,
  type BacktestTablesMode,
  type BacktestTrade,
  type BacktestTradeEnding,
  type BacktestWheelCycleSummary,
  type EffectiveBacktestSettings,
  type LlmSessionEstimate,
} from "../api/backtest";
import type { SignalGrade } from "../api/signals";
import {
  daysToExpiry,
  easternIsoDate,
  formatCompactDollarsTrimmed,
  formatCurrency,
  formatCurrencyTrimmed,
  formatEasternTime,
  formatDayMonth,
  formatDayMonthYear,
  formatInputNumber,
  formatNumber,
  formatOptionContractLabel,
  formatOrderSize,
  formatPercentage,
  formatQuotePrice,
  formatRatio,
  formatSecondsInWords,
  formatSignedPercentage,
  formatSignedPnl,
  formatYearMonth,
  pluralizeCount,
  pnlTextClass,
} from "./formatters";
import { plutoParameterLabelByField } from "./plutoParameters";
import { positionCloseReasonLabel } from "./positionPnl";
import { gateLabel, humanizeKey } from "./plutoPresentation";
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

/** "612 of 1,701 trading days" (a download) or "980 of 1,690 days" (a backtest). With no total yet: "waiting" in the queue, "starting" while it runs, "never started" once it ended. */
export function describeJobProgress(job: BacktestJobView): string {
  if (job.progressTotal <= 0) return job.displayStatus === "queued" ? "waiting" : job.displayStatus === "running" ? "starting" : "never started";
  return `${formatNumber(job.progressDone)} of ${formatNumber(job.progressTotal)} ${job.kind === "download" ? "trading days" : "days"}`;
}

/** Total run time: "running 1 h 5 min" while it runs, "ran 1 h 12 min" once it ended, "ran 40 min so far" for a resumed download still queued. */
export function describeJobRunTime(status: BacktestJobDisplayStatus, runSeconds: number): string {
  const duration = formatSecondsInWords(runSeconds);
  if (status === "running") return `running ${duration}`;
  if (status === "queued" || status === "stopped") return `ran ${duration} so far`;
  return `ran ${duration}`;
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

/** A file downloaded before intraday quotes existed has none until it is updated. */
export const intradayDaysMissingExplanation = "added by the next Update";

export const sessionSplitsNotePrefix = "Prices put on each day's traded scale:";

/** The session header note's splits, ["SMCI 10-for-1 on 2024-10-01"], or null when the period has none (no note). Each split
 *  names its own symbol; a session saved before splits carried one falls back to the session's. */
export function describeSessionSplits(sessionSymbol: string, splits: (BacktestDetectedSplit & { symbol?: string })[] | null | undefined): string[] | null {
  if (!splits || splits.length === 0) return null;
  return splits.map((split) => `${split.symbol ?? sessionSymbol} ${describeSplitRatio(split.ratio)} on ${split.firstDayAfter}`);
}

// ---- Sessions ----

export const tablesModeLabel: Record<BacktestTablesMode, string> = { walk_forward: "walk-forward history", current: "current tables" };

export function describeOverrideCount(count: number): string {
  return count === 0 ? "none" : pluralizeCount(count, "setting");
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
  inTheMoneyAtExpiry: "Contracts in the money at expiry = expired contracts with the strike crossed ÷ all expired contracts. An option in the money by $0.01 or more at its expiry day's close is assigned.",
  winRate: "Win rate = trades with P&L > 0 ÷ all closed trades.",
  returnOnCapitalInUse: "Return on capital in use = Σ trade P&L ÷ Σ (EXP $ × calendar days held) × 365, the same basis as Edge Yield.",
  interest: "Interest on idle cash: each day the cash balance earns the 3-month Treasury bill rate (FRED DTB3) × calendar days since the previous trading day ÷ 365.",
  buyAndHold: "Buy and hold: on the first day at 10:00, buy as many whole shares as the starting value allows at the 10:00 stock price; the rest stays in cash and earns the same interest. No dividends in version 1.",
  symbolsBuyAndHold: "Buy and hold of the session's symbols, for comparison only: the starting value in equal parts, one per symbol, each buying whole shares at its symbol's first 10:00 price and never rebalanced; the rest stays in cash at the same interest. Marked at 10:00 every session day and measured with the session's formulas. No dividends.",
  spyBuyAndHold: "Buy and hold of SPY, for comparison only: the starting value buys whole SPY shares at SPY's 10:00 price on the session's first day; the rest stays in cash at the same interest. Marked at 10:00 every session day and measured with the session's formulas. No dividends.",
} as const;

/** The same figures measured on the wheel cycle's P&L (BacktestPnlBasis "wheel_cycle"), FORMULAS.md "Trades and wheel cycles". */
export const backtestCycleMetricExplanation = {
  cyclePnl:
    "Wheel cycle P&L, as the platform's Wheel cycle view computes it: a cycle runs from the first position opened on a flat symbol until the symbol is flat again; its total is premiums in − buybacks − commissions + what the shares made, plus what an open cycle still holds at the session's last marks. Summed over every cycle of every symbol. Interest on idle cash is not in it (it is in the account's total return).",
  cycles: "Wheel cycles of the session, closed and open. A cycle closes only when the symbol is flat again, and Pluto's rules only close it in profit, so the closed cycles' win rate is 100% by construction: the open cycles are where a loss would be, so their count and P&L show beside it.",
  winRate: "Win rate = closed cycles with a total above 0 ÷ closed cycles. Pluto's rules only close a cycle in profit, so this is 100% by construction; read it with the open cycles beside it.",
  averageWinLoss: "Average win / average loss: the mean total of the closed cycles above 0 / below 0, in dollars.",
  edgeCapture:
    "Edge capture = Σ closed cycles' totals ÷ Σ Edge $ the model predicted for the options sold in those cycles (1.0 = the model was exactly right on average). A cycle's total includes what its shares made while held after a put was assigned or under a covered call, on purpose: those share gains are part of the wheel's result. The model predicts only the options, so capture above 1.0 can come from the shares rather than from the options' edge.",
  capitalInUse: "Capital in use = mean over days of (Σ EXP $ of open positions ÷ account value). EXP $ is net of premium: a put's (strike − premium) × 100 × contracts. Return on capital in use = Σ every cycle's total ÷ Σ over the session days of (EXP $ held that day × calendar days to the next session day) × 365.",
  optionsSold: "Options sold: opening puts and calls and the new leg of each roll.",
  inTheMoneyAtExpiry: "Contracts in the money at expiry = options sold that expired with the strike crossed ÷ options sold that expired. An option in the money by $0.01 or more at its expiry day's close is assigned.",
} as const;

/** Edge capture on a screen that lists sessions of either basis (Sessions, Compare). */
export const edgeCaptureEitherBasisExplanation = `${backtestCycleMetricExplanation.edgeCapture} On a session measured per option: Σ trade P&L ÷ Σ Edge $ predicted for those trades.`;

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

export type MonthlyReturnSeries = "session" | "baseline" | "spy";

/** A month's return in a series; null where the series has none (SPY on a session run before it was kept). */
function monthlyReturnOf(entry: BacktestMonthlyReturn, series: MonthlyReturnSeries): number | null {
  if (series === "session") return entry.sessionReturn;
  if (series === "baseline") return entry.baselineReturn;
  return entry.spyBaselineReturn;
}

export function hasSpyMonthlyReturns(monthlyReturns: BacktestMonthlyReturn[]): boolean {
  return monthlyReturns.some((entry) => entry.spyBaselineReturn !== null);
}

export function buildMonthlyReturnYears(monthlyReturns: BacktestMonthlyReturn[], series: MonthlyReturnSeries): MonthlyReturnYear[] {
  const byYear = new Map<number, MonthlyReturnYear>();
  for (const entry of monthlyReturns) {
    const year = Number(entry.month.slice(0, 4));
    const monthIndex = Number(entry.month.slice(5, 7)) - 1;
    const value = monthlyReturnOf(entry, series);
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

/** The bands added up. Cycles add up only on a cycle-P&L session; an option-basis session has none (null). */
export function sumAccuracyBands(bands: BacktestAccuracyBand[]): BacktestAccuracyBand {
  return bands.reduce<BacktestAccuracyBand>(
    (total, band) => ({
      label: "All",
      tradeCount: total.tradeCount + band.tradeCount,
      cycleCount: band.cycleCount === null ? total.cycleCount : (total.cycleCount ?? 0) + band.cycleCount,
      predictedPnlDollars: total.predictedPnlDollars + band.predictedPnlDollars,
      calibratedPnlDollars: total.calibratedPnlDollars + band.calibratedPnlDollars,
      realizedPnlDollars: total.realizedPnlDollars + band.realizedPnlDollars,
    }),
    { label: "All", tradeCount: 0, cycleCount: null, predictedPnlDollars: 0, calibratedPnlDollars: 0, realizedPnlDollars: 0 },
  );
}

// ---- Trades ----

/** "AAOI Sell $41 Put · 26 Sep (5DTE)": the platform's contract label with the sale, DTE counted from the day it opened. The
 *  trade names its symbol; a session saved before trades carried one falls back to the session's. */
export function describeBacktestTradeContract(sessionSymbol: string, trade: BacktestTrade): string {
  return `${trade.symbol ?? sessionSymbol} Sell ${formatOptionContractLabel({ strike: trade.strike, right: trade.optionRight, expiry: trade.expiry, dte: trade.dte })}`;
}

export function tradeGradeLabel(grade: string): string {
  return gradeLabel[grade as SignalGrade] ?? grade;
}

export function tradeGradeBadgeClass(grade: string): string {
  return gradeBadgeClass[grade as SignalGrade] ?? "bg-secondary";
}

/** What the contract settled at: "open" while it runs, "expired" when it ended out of the money at expiry, the expiry close when
 *  it was assigned, "—" when it ended before expiry (bought back or rolled). */
export function describeTradeSettlement(trade: BacktestTrade): string {
  if (trade.settledOn === null) return "open";
  if (trade.inTheMoneyAtExpiry === false) return "expired";
  return formatCurrencyTrimmed(trade.settlementClose);
}

export type BacktestTradeEndingKey = BacktestTradeEnding | "open";

export const tradeEndingLabel: Record<BacktestTradeEndingKey, string> = {
  expired_worthless: "Expired",
  assigned: "Assigned",
  bought_back: "Bought back",
  rolled: "Rolled",
  open: "Open",
};

/** How an option sold ended. A session run before the wheel was simulated has no `endedBy`: its trades all reached expiry. */
export function tradeEnding(trade: Pick<BacktestTrade, "endedBy" | "settledOn" | "inTheMoneyAtExpiry">): BacktestTradeEndingKey {
  if (trade.endedBy) return trade.endedBy;
  if (trade.settledOn === null) return "open";
  return trade.inTheMoneyAtExpiry ? "assigned" : "expired_worthless";
}

/** The day it ended, when that is not its expiry: the day it was bought back or rolled. */
export function tradeEndedEarlyOn(trade: Pick<BacktestTrade, "endedBy" | "settledOn">): string | null {
  return trade.endedBy === "bought_back" || trade.endedBy === "rolled" ? trade.settledOn : null;
}

// ---- Settings ----

export function formatBacktestSettingValue(unit: BacktestSettingUnit, value: number | string | null | undefined, choices?: BacktestSettingChoice[]): string {
  if (value === null || value === undefined) return "—";
  if (unit === "grade") return tradeGradeLabel(String(value));
  if (unit === "choice") return choices?.find((choice) => choice.value === value)?.label ?? String(value);
  if (unit === "time") return `${value} ET`;
  if (typeof value !== "number") return String(value);
  switch (unit) {
    case "percent":
      return `${formatInputNumber(value, 4)}%`;
    case "dollars":
      return formatCurrencyTrimmed(value);
    case "days":
      return pluralizeCount(value, "day");
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
  return unit !== "grade" && unit !== "choice" && unit !== "time";
}

/** A choice row's value as its row shows it. */
export function formatSettingRowValue(row: BacktestSettingRow, value: number | string | null | undefined): string {
  return formatBacktestSettingValue(row.unit, value, row.choices);
}

/** "The AI model: off (not built yet)" for each choice of the row that cannot be picked yet, so what is off shows without opening the list. */
export function describeUnavailableChoices(row: BacktestSettingRow): string[] {
  return (row.choices ?? []).filter((choice) => choice.unavailableReason).map((choice) => `${choice.label}: off (${choice.unavailableReason})`);
}

/** Why an edited value cannot be sent, or null when it is fine. */
export function settingValueProblem(row: BacktestSettingRow, text: string): string | null {
  if (row.unit === "choice") {
    const unavailableReason = row.choices?.find((choice) => choice.value === text)?.unavailableReason;
    return unavailableReason ? `${row.label}: ${formatSettingRowValue(row, text)} is ${unavailableReason}.` : null;
  }
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

/** Every path an overrides object sets: "pluto.minEdgeYieldPct", "trading.spreadCostChargedPct", "policy.roll", "kellyFraction", "decisionMaker". */
export function overridePaths(overrides: BacktestSettingsOverrides): string[] {
  const paths: string[] = [];
  for (const [root, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object") for (const field of Object.keys(value)) paths.push(`${root}.${field}`);
    else paths.push(root);
  }
  return paths;
}

const fallbackRootSettingLabel: Record<string, string> = { kellyFraction: "Kelly fraction", decisionMaker: "Decision maker" };

function fallbackSettingLabel(path: string): string {
  const [root, field] = pathParts(path);
  if (field === null) return fallbackRootSettingLabel[root] ?? root;
  return (root === "pluto" ? plutoParameterLabelByField[field] : undefined) ?? field;
}

/** What a session started from at a path: its frozen snapshot, or the decision defaults on a snapshot saved before they existed. */
function snapshotValueAtPath(snapshot: BacktestSettings, path: string): number | string | undefined {
  const defaults: Pick<EffectiveBacktestSettings, "policy" | "decisionMaker"> = { policy: defaultBacktestPolicySettings, decisionMaker: "rules" };
  return valueAtSettingsPath(snapshot, path) ?? valueAtSettingsPath(defaults as BacktestSettingsOverrides, path);
}

/** "Min Edge Yield 15% → 20%" per setting a session changed, or "Roll or hold: Never roll" for a choice (its labels are
 *  sentences, so only the new one is named); labelled from the settings template when it is loaded. */
export function describeOverrideChanges(overrides: BacktestSettingsOverrides, snapshot: BacktestSettings | null, rows: BacktestSettingRow[] | null): string[] {
  return overridePaths(overrides).flatMap((path) => {
    const row = rows?.find((candidate) => candidate.path === path);
    const to = valueAtSettingsPath(overrides, path);
    const from = snapshot ? snapshotValueAtPath(snapshot, path) : undefined;
    if (to === undefined || to === from) return [];
    const label = row?.label ?? fallbackSettingLabel(path);
    const format = (value: number | string | undefined) => (row ? formatSettingRowValue(row, value) : value === undefined ? "—" : String(value));
    if (row?.unit === "choice" || (!row && pathParts(path)[0] !== "pluto" && typeof to === "string")) return [`${label}: ${format(to)}`];
    return [from === undefined ? `${label} ${format(to)}` : `${label} ${format(from)} → ${format(to)}`];
  });
}

// ---- Compare ----

/** What a Compare row reads: a column's headline figures and, for a session measured per cycle, its wheel cycles. */
export interface CompareSubject {
  metrics: BacktestMetrics;
  wheelCycles: BacktestWheelCycleSummary | null;
}

export interface CompareMetricRow {
  key: string;
  label: string;
  explanation: string;
  value: (subject: CompareSubject) => number | null;
  format: (value: number | null) => string;
  /** Whether the highest or the lowest value is best; null where no value is better (shaded none). */
  better: "higher" | "lower" | null;
  /** Signed figures read green/red. */
  signed: boolean;
  /** Meaningless for buy and hold (no trades). */
  tradesOnly: boolean;
  /** A short line under the value, e.g. the open cycles beside a cycle win rate. */
  note?: (subject: CompareSubject) => string | null;
}

/** "1 open: +$42,060" (the open cycles' count and P&L at the last marks), "0 open". Beside every cycle win rate: a cycle only
 *  closes in profit, so a loss would sit in the open ones. */
export function describeOpenCyclesShort(wheelCycles: Pick<BacktestWheelCycleSummary, "openCycleCount" | "openCyclePnlDollars">): string {
  if (wheelCycles.openCycleCount === 0) return "0 open";
  return `${formatNumber(wheelCycles.openCycleCount)} open: ${formatSignedPnl(wheelCycles.openCyclePnlDollars, 0)}`;
}

const compareWinRateExplanation = `${backtestCycleMetricExplanation.winRate} On a session measured per option (run before cycles carried the P&L): trades with P&L > 0 ÷ all closed trades.`;

export const compareMetricRows: CompareMetricRow[] = [
  {
    key: "cyclePnl",
    label: "Wheel cycle P&L",
    explanation: `${backtestCycleMetricExplanation.cyclePnl} "—" on a session measured per option.`,
    value: (s) => s.wheelCycles?.totalPnlDollars ?? null,
    format: (v) => formatSignedPnl(v, 0),
    note: (s) => (s.wheelCycles ? describeOpenCyclesShort(s.wheelCycles) : null),
    better: "higher",
    signed: true,
    tradesOnly: true,
  },
  { key: "totalReturn", label: "Total return", explanation: backtestMetricExplanation.totalReturn, value: (s) => s.metrics.totalReturn, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "cagr", label: "CAGR", explanation: backtestMetricExplanation.cagr, value: (s) => s.metrics.cagr, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "sortino", label: "Sortino", explanation: backtestMetricExplanation.sortino, value: (s) => s.metrics.sortino, format: (v) => formatRatio(v, 2), better: "higher", signed: false, tradesOnly: false },
  { key: "maxDrawdown", label: "Max drawdown", explanation: backtestMetricExplanation.maxDrawdown, value: (s) => s.metrics.maxDrawdown, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "worstMonth", label: "Worst month", explanation: backtestMetricExplanation.worstMonth, value: (s) => s.metrics.worstMonth, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
  { key: "trades", label: "Options sold", explanation: backtestCycleMetricExplanation.optionsSold, value: (s) => s.metrics.tradeCount, format: (v) => formatNumber(v), better: null, signed: false, tradesOnly: true },
  {
    key: "cycles",
    label: "Wheel cycles",
    explanation: `${backtestCycleMetricExplanation.cycles} "—" on a session measured per option.`,
    value: (s) => s.wheelCycles?.cycleCount ?? null,
    format: (v) => formatNumber(v),
    note: (s) => (s.wheelCycles ? `${formatNumber(s.wheelCycles.closedCycleCount)} closed` : null),
    better: null,
    signed: false,
    tradesOnly: true,
  },
  {
    key: "winRate",
    label: "Win rate",
    explanation: compareWinRateExplanation,
    value: (s) => s.metrics.winRate,
    format: (v) => formatPercentage(v, 0),
    note: (s) => (s.wheelCycles ? describeOpenCyclesShort(s.wheelCycles) : null),
    better: null,
    signed: false,
    tradesOnly: true,
  },
  {
    key: "edgeCapture",
    label: "Edge capture",
    explanation: edgeCaptureEitherBasisExplanation,
    value: (s) => s.metrics.edgeCapture,
    format: (v) => formatRatio(v, 2),
    better: "higher",
    signed: false,
    tradesOnly: true,
  },
  { key: "capitalInUse", label: "Capital in use", explanation: backtestMetricExplanation.capitalInUse, value: (s) => s.metrics.capitalInUse, format: (v) => formatPercentage(v, 0), better: null, signed: false, tradesOnly: false },
  { key: "returnOnCapitalInUse", label: "Return on capital in use", explanation: backtestMetricExplanation.returnOnCapitalInUse, value: (s) => s.metrics.returnOnCapitalInUse, format: (v) => signedPercentDisplay(v, 1).text, better: "higher", signed: true, tradesOnly: false },
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

/** Buy and hold of SPY, the second reference line: a darker grey (lighter on dark) and dotted, so it never reads as the symbols' line. */
export const spyBuyAndHoldColorByTheme = { light: "#1f2937", dark: "#e5e7eb" } as const;
export const spyBuyAndHoldDashArray = 2;

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

// ---- Wheel cycles (FORMULAS.md "Trades and wheel cycles": the platform's cycle P&L on the simulated book) ----

/** Whether a session's win rate, averages, edge capture and accuracy are measured on the wheel cycle (else per option, on
 *  sessions run before cycles carried the P&L). */
export function isCycleBasis(pnlBasis: BacktestPnlBasis): boolean {
  return pnlBasis === "wheel_cycle";
}

export interface CycleTotals {
  closedCount: number;
  closedDollars: number;
  openCount: number;
  /** What the open cycles hold at the session's last marks. */
  openDollars: number;
}

export function summarizeCycleTotals(cycles: Pick<BacktestCycle, "status" | "totalDollars">[]): CycleTotals {
  const totals: CycleTotals = { closedCount: 0, closedDollars: 0, openCount: 0, openDollars: 0 };
  for (const cycle of cycles) {
    if (cycle.status === "open") {
      totals.openCount += 1;
      totals.openDollars += cycle.totalDollars;
    } else {
      totals.closedCount += 1;
      totals.closedDollars += cycle.totalDollars;
    }
  }
  return totals;
}

/** "1 open cycle: +$42,060 at the last marks", or "no open cycle". Shown wherever a cycle win rate is, because a cycle only
 *  closes in profit: a losing cycle is an open one. */
export function describeOpenCycles(openCount: number, openDollars: number): string {
  if (openCount === 0) return "no open cycle";
  return `${pluralizeCount(openCount, "open cycle")}: ${formatSignedPnl(openDollars, 0)} at the last marks`;
}

/** "HOOD #12", the label trades carry (BacktestTrade.cycleLabel). */
export function backtestCycleLabel(cycle: Pick<BacktestCycle, "symbol" | "cycleNumber">): string {
  return `${cycle.symbol} #${cycle.cycleNumber}`;
}

/** The platform's bucket order (the Profit & Loss scoreboard). */
export const cycleBucketOrder = ["csp", "unstructured", "cc", "hedge"] as const;

/** What the shares made in a cycle, as the platform's Wheel cycle card sums it. */
export function cycleStockDollars(cycle: Pick<BacktestCycle, "buckets">): number {
  return cycle.buckets.csp.stock + cycle.buckets.unstructured.stock + cycle.buckets.cc.stock;
}

/** The Wheel cycle card's break-even: "Free" once the premium has paid for the shares, "—" with no shares. */
export function describeBreakEven(breakEvenPerShare: number | null): string {
  if (breakEvenPerShare === null) return "—";
  return breakEvenPerShare <= 0 ? "Free" : formatCurrency(breakEvenPerShare, 2);
}

// ---- Positions (the simulated book, as the platform's position rows would read) ----

/** How a position ended, in the platform's close-reason labels ("Expired", "Assigned", "Shares rolled into a covered call"), or "Open". */
export function describePositionEnding(position: Pick<BacktestPosition, "status" | "closeReason">): string {
  if (position.status === "open") return "Open";
  return positionCloseReasonLabel(position.closeReason);
}

const unstructuredReasonLabel: Record<string, string> = {
  cc_expired_leftover_stock: "a covered call expired and the shares stayed",
  csp_assigned_stock: "a cash-secured put was assigned",
  unknown: "cause unclear",
};

/** Why shares sit in a position with no strategy (N/S), or null for any other position. */
export function describeUnstructuredReason(position: Pick<BacktestPosition, "strategyKey" | "unstructuredReason">): string | null {
  if (position.strategyKey !== "unstructured" || position.unstructuredReason === null) return null;
  return unstructuredReasonLabel[position.unstructuredReason] ?? humanizeKey(position.unstructuredReason);
}

/** The position's P&L as Positions shows it: realized (premium and stock parts, after commissions) plus, while open, what it
 *  holds at the session's last marks. */
export function positionTotalPnl(position: Pick<BacktestPosition, "realizedPnlDollars" | "unrealizedPnlDollars">): number {
  return position.realizedPnlDollars + (position.unrealizedPnlDollars ?? 0);
}

/** A leg in the contract label standard, without the symbol (the table has its own): "$47 Call · 30 Oct (25DTE) · 6× @ 1.80",
 *  or "600 shares @ 42.89". Figures are on the cycle's price scale, as stored (see legScaleNote). */
export function describePositionLeg(leg: BacktestPositionLeg): string {
  if (leg.legType === "stock") return `${formatNumber(leg.quantity)} shares @ ${formatQuotePrice(leg.entryPrice)}`;
  if (leg.strike === null || leg.expiry === null || leg.optionType === null) return `Option${formatOrderSize(leg.quantity, leg.entryPrice)}`;
  const label = formatOptionContractLabel({ strike: leg.strike, right: leg.optionType === "call" ? "C" : "P", expiry: leg.expiry, dte: leg.dteAtEntry });
  return `${leg.side === "long" ? "Long " : ""}${label}${formatOrderSize(leg.quantity, leg.entryPrice)}`;
}

/** How a leg ended: "open", "expired worthless", "assigned at the 334.50 close", "closed @ 0.58 on 2021-10-05". */
export function describeLegExit(leg: BacktestPositionLeg): string {
  if (leg.exitAt === null) return "open";
  if (leg.settledAs === "worthless") return "expired worthless";
  if (leg.settledAs === "assigned") return leg.expiryClose === null ? "assigned" : `assigned at the ${formatQuotePrice(leg.expiryClose)} close`;
  return `closed @ ${formatQuotePrice(leg.exitPrice)} on ${easternIsoDate(leg.exitAt)}`;
}

/** Said when a leg or fill sits on a cycle whose prices a split rescaled: its prices ÷ the scale are the prices as traded. */
export function priceScaleNote(priceScale: number): string | null {
  return priceScale === 1 ? null : `on the cycle's price scale: ÷ ${formatInputNumber(priceScale, 4)} for the prices as traded`;
}

/** "2023-07-26 · 10:00 ET": a book instant as its Eastern trading date and look time. */
export function formatBookInstant(isoInstant: string): string {
  return `${easternIsoDate(isoInstant)} · ${formatEasternTime(isoInstant)}`;
}

// ---- Actions (what Pluto did or tried at each look) ----

export const actionKindLabel: Record<BacktestActionKind, string> = {
  open_cash_secured_put: "Open put",
  open_covered_call: "Open covered call",
  roll: "Roll",
  close_shares: "Sell shares",
  close_leg: "Buy back",
  close_position: "Close position",
};

export function failedGateOf(action: Pick<BacktestAction, "gateResults">): BacktestAction["gateResults"][number] | null {
  return action.gateResults.find((gate) => !gate.ok) ?? null;
}

/** The gates column: the gate that refused a blocked action ("Sizing"), or "11 of 11 passed". */
export function describeGateSummary(action: Pick<BacktestAction, "gateResults">): string {
  const failed = failedGateOf(action);
  if (failed) return gateLabel(failed.gate);
  return action.gateResults.length === 0 ? "none ran" : `${action.gateResults.length} of ${action.gateResults.length} passed`;
}

/** "10:30 ET", with the pass when a look made several: "10:30 ET · pass 2". */
export function describeActionLook(action: Pick<BacktestAction, "lookTimeEt" | "passNumber">): string {
  return action.passNumber > 1 ? `${action.lookTimeEt} ET · pass ${action.passNumber}` : `${action.lookTimeEt} ET`;
}

// ---- Fills ----

/** The Actions log's and Fills' filters (each empty string = no filter). */
export interface BacktestBookFilterValues {
  symbol: string;
  from: string;
  to: string;
}

export const emptyBookFilters: BacktestBookFilterValues = { symbol: "", from: "", to: "" };

/** Price × quantity × multiplier: what the fill traded, before its commission (scale-free: a split moves price and quantity). */
export function fillDollars(fill: Pick<BacktestFill, "price" | "quantity" | "multiplier">): number {
  return fill.price * fill.quantity * fill.multiplier;
}

/** What a fill traded: "Shares", or its option leg's contract label ("$47 Call · 30 Oct (25DTE)"); the leg comes from the
 *  session's positions, since a fill names only its leg. */
export function describeFillInstrument(fill: Pick<BacktestFill, "instrument">, leg: BacktestPositionLeg | undefined): string {
  if (fill.instrument === "stock") return "Shares";
  if (!leg || leg.strike === null || leg.expiry === null || leg.optionType === null) return "Option";
  return formatOptionContractLabel({ strike: leg.strike, right: leg.optionType === "call" ? "C" : "P", expiry: leg.expiry, dte: leg.dteAtEntry });
}

/** The figures Pluto had on an action's candidate or offer, flattened to "model.edgeMargin: 0.2565" lines for the action's
 *  details (numbers to at most 4 decimals, lists joined). */
export function flattenCandidateScores(scores: Record<string, unknown> | null): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  const visit = (value: unknown, path: string) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) visit(inner, path ? `${path}.${key}` : key);
      return;
    }
    const text = Array.isArray(value) ? value.map((entry) => (typeof entry === "object" ? JSON.stringify(entry) : String(entry))).join(", ") : typeof value === "number" ? formatInputNumber(value, 4) : String(value);
    lines.push({ label: path, value: text });
  };
  if (scores) visit(scores, "");
  return lines;
}

/** A value axis with round ticks that fits the data, at most `maxTicks` intervals: steps of 1, 2, 2.5 or 5 × a power of ten.
 *  ApexCharts' own "nice" scale keeps the tick count fixed and doubles the step instead, so a line peaking at $16M got an axis to
 *  $30M and a drawdown of −84% an axis to −200%. */
export function roundValueAxis(low: number, high: number, maxTicks: number): { min: number; max: number; tickAmount: number } {
  if (!(high > low)) return { min: low, max: low === 0 ? 1 : low + Math.abs(low) * 0.1, tickAmount: 1 };
  const rawStep = (high - low) / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rawStep)!;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  return { min, max, tickAmount: Math.max(1, Math.round((max - min) / step)) };
}

// ---- Decision maker (the stand-in rules, or the AI model through the Claude subscription) ----

export const decisionMakerLabel: Record<BacktestDecisionMaker, string> = { rules: "Rules", llm: "The AI model" };

/** Who decided a session's choices: its override, else its frozen settings; "rules" on sessions saved before the choice existed. */
export function sessionDecisionMaker(session: { overrides: BacktestSettingsOverrides; settingsSnapshot: BacktestSettings }): BacktestDecisionMaker {
  return session.overrides.decisionMaker ?? session.settingsSnapshot.decisionMaker ?? "rules";
}

/** "1,234 decisions asked of the model, 456 of them answered from the cache". */
export function describeLlmCalls(calls: { asked: number; fromCache: number }): string {
  return `${pluralizeCount(calls.asked, "decision")} asked of the model, ${formatNumber(calls.fromCache)} of them answered from the cache`;
}

/** "About 2,604–5,208 model calls, 5.8–11.6 h of model time". */
export function describeLlmEstimate(estimate: LlmSessionEstimate): string {
  return `About ${formatNumber(estimate.callsLow)}–${formatNumber(estimate.callsHigh)} model calls, ${formatNumber(estimate.modelHoursLow, 1)}–${formatNumber(estimate.modelHoursHigh, 1)} h of model time`;
}

/** The plain note beside the estimate, before a session with the AI model deciding starts. */
export const llmSessionNote =
  "Runs Claude Sonnet on your Claude subscription (not billed per call). Symbols and dates are masked from the model. If the plan's usage limit is reached the session stops; Resume continues it, and answered calls are reused.";

/** The account value chart's value axis: linear, or logarithmic (equal % moves take equal heights, so a session's line is not
 *  flattened by a buy and hold that grew 6×). Chosen per browser (useBacktestValueScale). */
export type BacktestValueScale = "linear" | "log";

/** A logarithmic dollar axis whose ticks double: from the largest 1-2-5 round number at or below the lowest value ($500k under
 *  $600k) up to the first doubling at or above the highest ($500k → $1M → … → $16M). */
export function doublingLogValueAxis(low: number, high: number): { min: number; max: number; tickAmount: number; logarithmic: true; logBase: number } {
  const positiveLow = Math.max(low, 1);
  const magnitude = 10 ** Math.floor(Math.log10(positiveLow));
  const anchor = [5, 2, 1].map((factor) => factor * magnitude).find((candidate) => candidate <= positiveLow)!;
  const doublings = Math.max(1, Math.ceil(Math.log2(Math.max(high, positiveLow) / anchor) - 1e-9));
  return { min: anchor, max: anchor * 2 ** doublings, tickAmount: doublings, logarithmic: true, logBase: 2 };
}

// ---- New session: the period in whole years, or custom dates ----

export type BacktestPeriodMode = "years" | "custom";

/** A period of calendar dates, "YYYY-MM-DD", both ends included. */
export interface BacktestDatePeriod {
  firstDate: string;
  lastDate: string;
}

function yearOfDate(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** Every calendar year that overlaps the period, in order. */
export function yearsInPeriod(period: BacktestDatePeriod): number[] {
  const years: number[] = [];
  for (let year = yearOfDate(period.firstDate); year <= yearOfDate(period.lastDate); year++) years.push(year);
  return years;
}

/** A whole-years choice as dates: 1 Jan of From (or the period's first date, if later) to 31 Dec of To (or its last, if earlier). */
export function wholeYearsDates(fromYear: number, toYear: number, period: BacktestDatePeriod): { startDate: string; endDate: string } {
  const yearStart = `${fromYear}-01-01`;
  const yearEnd = `${toYear}-12-31`;
  return { startDate: yearStart > period.firstDate ? yearStart : period.firstDate, endDate: yearEnd < period.lastDate ? yearEnd : period.lastDate };
}

/** Calendar days a year may lack at either end and still read as whole (Marcelo 2026-10-12): New Year's Day and a weekend. */
const wholeYearEdgeToleranceDays = 4;

/** A year option: "2023", or the part the period holds at its edges: "2021 · from 4 Aug", "2026 · to 9 Oct", "2024 · 4 Aug to 9 Oct". */
export function describeYearOption(year: number, period: BacktestDatePeriod): string {
  const startsLate = year === yearOfDate(period.firstDate) && daysToExpiry(period.firstDate, `${year}-01-01`) > wholeYearEdgeToleranceDays;
  const endsEarly = year === yearOfDate(period.lastDate) && daysToExpiry(`${year}-12-31`, period.lastDate) > wholeYearEdgeToleranceDays;
  if (startsLate && endsEarly) return `${year} · ${formatDayMonth(period.firstDate)} to ${formatDayMonth(period.lastDate)}`;
  if (startsLate) return `${year} · from ${formatDayMonth(period.firstDate)}`;
  if (endsEarly) return `${year} · to ${formatDayMonth(period.lastDate)}`;
  return String(year);
}

/** The From and To years whose whole-years dates are exactly these, or null when no pair gives them (they open as custom dates). */
export function wholeYearsMatching(startDate: string, endDate: string, period: BacktestDatePeriod): { fromYear: number; toYear: number } | null {
  const fromYear = yearOfDate(startDate);
  const toYear = yearOfDate(endDate);
  if (fromYear > toYear || startDate < period.firstDate || endDate > period.lastDate) return null;
  const derived = wholeYearsDates(fromYear, toYear, period);
  return derived.startDate === startDate && derived.endDate === endDate ? { fromYear, toYear } : null;
}

/** The years holding these dates, clamped to the period; the whole period's years when the dates are empty. */
export function wholeYearsContaining(startDate: string, endDate: string, period: BacktestDatePeriod): { fromYear: number; toYear: number } {
  const clamp = (date: string) => (date < period.firstDate ? period.firstDate : date > period.lastDate ? period.lastDate : date);
  const fromYear = yearOfDate(startDate ? clamp(startDate) : period.firstDate);
  const toYear = yearOfDate(endDate ? clamp(endDate) : period.lastDate);
  return { fromYear, toYear: Math.max(fromYear, toYear) };
}
