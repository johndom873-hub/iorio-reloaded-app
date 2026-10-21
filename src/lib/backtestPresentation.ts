import { analysisStepLabels, type AnalysisStep } from "../api/backtestAnalysis";
import {
  backtestCandidateChecks,
  defaultBacktestPolicySettings,
  type BacktestAccuracyBand,
  type BacktestAction,
  type BacktestActionKind,
  type BacktestCandidateCheck,
  type BacktestCycle,
  type BacktestCycleGap,
  type BacktestCycleTimelineRow,
  type BacktestLadderRungRecord,
  type BacktestDataFilePart,
  type BacktestDataFileSummary,
  type BacktestDecisionMaker,
  type BacktestDetectedSplit,
  type BacktestFill,
  type BacktestIdleStretch,
  type BacktestJobDisplayStatus,
  type BacktestJobView,
  type BacktestMetrics,
  type BacktestMonthlyReturn,
  type BacktestNoSaleDays,
  type BacktestPnlBasis,
  type BacktestPosition,
  type BacktestPositionLeg,
  type BacktestSessionDay,
  type BacktestSymbolSettings,
  type BacktestSettingChoice,
  type BacktestSettingRow,
  type BacktestSettings,
  type BacktestSettingsOverrides,
  type BacktestSettingUnit,
  type BacktestTablesMode,
  type BacktestTickerSuitability,
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
  formatDelta,
  formatInputNumber,
  formatNumber,
  formatOptionContractLabel,
  formatOrdinal,
  formatOrderSize,
  formatPercentage,
  formatQuotePrice,
  formatRatio,
  formatRelativeAge,
  formatSecondsInWords,
  formatShortAgeWithSeconds,
  formatSignedPercentage,
  formatSignedPnl,
  formatYearMonth,
  joinWithAnd,
  pluralizeCount,
  pnlTextClass,
} from "./formatters";
import { plutoParameterLabelByField } from "./plutoParameters";
import { positionCloseReasonLabel } from "./positionPnl";
import { gateLabel, humanizeKey } from "./plutoPresentation";
import { gradeBadgeClass, gradeLabel } from "./signalsPresentation";

// Labels, badge classes, explanations and small derivations for the Backtesting screens (mockup approved 2026-10-12,
// figures defined in the API's docs/backtesting/FORMULAS.md). Every explanation uses the formula sheet's wording.

// ---- Data files ----

/** A ticker's suitability for the CC + Put Ladder: "pending" until an admin marks it. */
export type TickerSuitabilityStatus = BacktestTickerSuitability["status"];

export const tickerSuitabilityLabel: Record<TickerSuitabilityStatus, string> = {
  pending: "Pending",
  suitable: "Suitable",
  unsuitable: "Unsuitable",
};

export const tickerSuitabilityBadgeClass: Record<TickerSuitabilityStatus, string> = {
  pending: "bg-secondary",
  suitable: "bg-success",
  unsuitable: "bg-danger",
};

// ---- Jobs ----


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

/** A symbol the backtest downloader takes (the API's normalizeBacktestSymbol): not a class-share symbol like "PBR A". */
export function isBacktestSymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol);
}

/**
 * Why each symbol cannot be queued for download from elsewhere (the Screener): an unfinished download of it ("Queued",
 * "Downloading", "Stopped"), else its data file ("Downloaded"). Symbols absent from the map can be queued.
 */
export function describeBacktestSymbolDownloadStates(files: BacktestDataFileSummary[], jobs: BacktestJobView[]): Map<string, string> {
  const states = new Map<string, string>(files.map((file) => [file.symbol, "Downloaded"]));
  for (const job of jobs) {
    if (job.kind !== "download") continue;
    if (job.displayStatus === "queued") states.set(job.symbol, "Queued");
    else if (job.displayStatus === "running") states.set(job.symbol, "Downloading");
    else if (job.displayStatus === "stopped") states.set(job.symbol, "Stopped");
  }
  return states;
}

/** A job's progress, or a session's latest run's, as a fraction: 1 once it succeeded. */
export function jobProgressFraction(job: Pick<BacktestJobView, "status" | "progressDone" | "progressTotal">): number {
  if (job.status === "succeeded") return 1;
  return job.progressTotal > 0 ? Math.min(1, job.progressDone / job.progressTotal) : 0;
}

/** "612 of 1,701 trading days" (a download) or "980 of 1,690 days" (a backtest). With no total yet: "waiting" in the queue, "starting" while it runs, "never started" once it ended. */
export function describeJobProgress(job: BacktestJobView): string {
  // A ticker analysis reports its step as the label (the chain scan's and the backtest's days as done/total).
  if (job.kind === "analysis") {
    const step = job.progressLabel && job.progressLabel in analysisStepLabels ? analysisStepLabels[job.progressLabel as AnalysisStep] : null;
    if (job.displayStatus !== "running" || step === null) return job.displayStatus === "running" ? "starting" : jobStatusLabel[job.displayStatus].toLowerCase();
    return job.progressTotal > 0 ? `${step}, ${formatNumber(job.progressDone)} of ${formatNumber(job.progressTotal)} days` : step;
  }
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

/** The job's title in two parts: the symbol, which a job row always shows in full, and the session or analysis name after it
 *  (null for a download), which a tight row cuts to fit. */
export function describeJobTitleParts(job: Pick<BacktestJobView, "kind" | "symbol" | "sessionName">): { symbol: string; name: string | null } {
  if (job.kind === "analysis") return { symbol: job.symbol, name: "Analysis" };
  return { symbol: job.symbol, name: job.kind === "backtest" && job.sessionName ? job.sessionName : null };
}

/** The job's title: the symbol for a download, "SMCI · Edge Yield 20%" for a backtest. */
export function describeJobTitle(job: Pick<BacktestJobView, "kind" | "symbol" | "sessionName">): string {
  const { symbol, name } = describeJobTitleParts(job);
  return name ? `${symbol} · ${name}` : symbol;
}

/** A job row's count: "34/322"; for an analysis its step and that step's count, "Scanning the chains 120/1,703" (the count
 *  starts over at each step), and "done" once it succeeded. Null when there is nothing to count (a queued job that never ran). */
export function describeJobRowCount(job: BacktestJobView): string | null {
  const status = job.displayStatus;
  if (job.kind === "analysis") {
    if (status !== "running") return status === "succeeded" ? "done" : null;
    const step = job.progressLabel && job.progressLabel in analysisStepLabels ? analysisStepLabels[job.progressLabel as AnalysisStep] : null;
    if (step === null) return "starting";
    return job.progressTotal > 0 ? `${step} ${formatNumber(job.progressDone)}/${formatNumber(job.progressTotal)}` : step;
  }
  if (job.progressTotal <= 0) return status === "running" ? "starting" : null;
  return `${formatNumber(job.progressDone)}/${formatNumber(job.progressTotal)}`;
}

export interface BacktestJobRowTiming {
  text: string;
  tone: "secondary" | "amber" | "danger";
}

/** A job row's time: "~19 min left (2 min elapsed)" while it runs, "(26 min elapsed)" for a queued download that already ran
 *  part of the way, "finished 3h ago (41 min elapsed)" once it ended; a stopped job's warning (amber) or a failed one's error
 *  (red) in its place. Null when there is nothing to say (a queued job that never ran). */
export function describeJobRowTiming(job: BacktestJobView, now: Date): BacktestJobRowTiming | null {
  const elapsed = job.runSeconds !== null ? `(${formatSecondsInWords(job.runSeconds)} elapsed)` : null;
  const secondary = (...parts: (string | null)[]): BacktestJobRowTiming | null => {
    const text = parts.filter((part): part is string => part !== null).join(" ");
    return text ? { text, tone: "secondary" } : null;
  };
  switch (job.displayStatus) {
    case "running":
      return secondary(job.etaSeconds !== null ? `~${formatSecondsInWords(job.etaSeconds)} left` : null, elapsed);
    case "queued":
      return secondary(elapsed);
    case "stopped": {
      const silence = formatShortAgeWithSeconds(job.heartbeatAt ?? job.startedAt ?? job.createdAt, now) ?? "a while";
      const resume = job.kind === "download" ? "Resume continues from the last saved day" : "Resume runs the session again from the start";
      return { text: `no update for ${silence}; ${resume}`, tone: "amber" };
    }
    case "failed":
      return { text: job.error ?? "failed", tone: "danger" };
    default:
      return secondary(job.finishedAt ? `finished ${formatRelativeAge(job.finishedAt, now)}` : null, elapsed);
  }
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

/** The Data files Splits cell: "none", "10-for-1 · 2024-10-01" (several joined), or "not checked" until the split check has run on the file's current data. */
export function describeDetectedSplits(splits: BacktestDetectedSplit[] | null | undefined): string {
  if (!splits) return "not checked";
  if (splits.length === 0) return "none";
  return splits.map((split) => `${describeSplitRatio(split.ratio)} · ${split.firstDayAfter}`).join(", ");
}

export const splitsNotAnalysedExplanation = "Not checked for this file's current data yet: checked after its next download, analysis or backtest session";

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
  symbolsBuyAndHold: "Buy and hold of the session's symbols, for comparison only: each symbol's pot (with per-ticker pots), else the starting value in equal parts, one per symbol, each buying whole shares at its symbol's first 10:00 price and never rebalanced; the rest stays in cash at the same interest. Marked at 10:00 every session day and measured with the session's formulas. No dividends.",
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
    predictedDollars: closed.reduce((sum, trade) => sum + (trade.expectedPnlDollars ?? 0), 0),
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

/** "—" for a baseline wheel's sale, which has no grade. */
export function tradeGradeLabel(grade: string | null): string {
  if (grade === null) return "—";
  return gradeLabel[grade as SignalGrade] ?? grade;
}

export function tradeGradeBadgeClass(grade: string | null): string {
  if (grade === null) return "";
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

/** Buy and hold of the symbols, the reference line (Marcelo 2026-10-20): solid in the body colour (white on dark, near-black
 *  on light), never a categorical slot. */
export const buyAndHoldColorByTheme = { light: "#1f2937", dark: "#f9fafb" } as const;
/** The dash a second or later buy-and-hold line of the symbols takes (other periods or symbol groups), 3 more each. */
export const buyAndHoldDashArray = 5;

/** Buy and hold of SPY, the second reference line: solid in a mid grey apart from the symbols' white. */
export const spyBuyAndHoldColorByTheme = { light: "#6b7280", dark: "#8b95a7" } as const;
/** The dash a second or later SPY line takes (another period), 2 more each. */
export const spyBuyAndHoldDashArray = 2;

/** A buy-and-hold line's style: the first of its kind on a chart solid, later ones dashed (the symbols') or dotted (SPY). */
export function buyAndHoldLineStyle(kind: "symbols" | "spy", index: number): "solid" | "dashed" | "dotted" {
  return index === 0 ? "solid" : kind === "symbols" ? "dashed" : "dotted";
}

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

/** A span of the session's trading days by number (1 = its first): "7", or "2 → 16"; "—" when a day is not one of them. */
export function describeSessionSpan(first: number | null, last: number | null = first): string {
  if (first === null || last === null) return "—";
  return first === last ? formatNumber(first) : `${formatNumber(first)}→${formatNumber(last)}`;
}

/** The baseline's contract checks in short, for the days each left contracts out ("spread too wide 3 · too little volume 2"). */
const candidateCheckLabels: Record<BacktestCandidateCheck, string> = {
  outsideExpiryRange: "expiry outside the range",
  spansEarnings: "spans earnings",
  belowCost: "strike below the floor",
  aboveCeiling: "strike above the ceiling",
  noUsableQuote: "no usable quote",
  spreadTooWide: "spread too wide",
  tooLittleVolume: "too little volume",
  noImpliedVolatility: "no implied volatility",
  outsideDeltaRange: "delta outside the range",
  alreadyHeld: "already held",
  noTimeValue: "no time value",
  belowMinimumYield: "yield below the minimum",
  noForecast: "no forecast",
  belowVolatilityEdge: "volatility edge too low",
};

/** Why nothing was sold on a stretch's days, reason by reason; the Entry filters name their limit when it is known. */
function noSaleReasons(noSaleDays: BacktestNoSaleDays, entryFilterLimits: BacktestCycleGap["entryFilterLimits"] | null): { reason: string; days: number }[] {
  const reasons: [number, string][] = [
    [noSaleDays.extensionZ, entryFilterLimits?.extensionZ != null ? `extension z ≥ ${entryFilterLimits.extensionZ}` : "the extension z filter"],
    [noSaleDays.ivRank, entryFilterLimits?.ivRank != null ? `IV Rank ≥ ${entryFilterLimits.ivRank}` : "the IV Rank filter"],
    [noSaleDays.ladderPutInstead, "a ladder put sold instead"],
    [noSaleDays.cash, "not enough cash"],
    [noSaleDays.volume, "the volume limit"],
    [noSaleDays.noCandidate, "no candidate"],
    [noSaleDays.unrecorded, "no reason recorded"],
  ];
  return reasons.filter(([days]) => days > 0).map(([days, reason]) => ({ reason, days }));
}

/** An Idle or Stock only row's reason, short ("No entry: extension z ≥ 1", "No option on 1,100 shares: no candidate"). */
export function describeIdleStretchReason(stretch: BacktestIdleStretch, lead: string, entryFilterLimits: BacktestCycleGap["entryFilterLimits"] | null = null): string {
  const reasons = noSaleReasons(stretch.noSaleDays, entryFilterLimits);
  return reasons.length === 0 ? `${lead}: no reason recorded` : `${lead}: ${reasons.map((entry) => entry.reason).join(", ")}`;
}

/**
 * The full rules behind an Idle or Stock only row, for its tooltip: the days each reason was seen (a day counts under
 * every reason seen at any of its looks), and when no contract qualified, the first such day's checks in the order the
 * baseline applies them, each with its rule then and the contracts it left out, and over several days, the days each
 * check left contracts out.
 */
export function describeIdleStretchRules(stretch: BacktestIdleStretch, lead: "No entry" | "No call", entryFilterLimits: BacktestCycleGap["entryFilterLimits"] | null = null): string {
  const lines = [`${lead}, the days each reason was seen (a day counts under every reason seen at any of its looks):`];
  for (const { reason, days } of noSaleReasons(stretch.noSaleDays, entryFilterLimits)) lines.push(`• ${reason}: ${pluralizeCount(days, "day")}`);
  const noCandidate = stretch.noCandidate;
  if (noCandidate) {
    const noun = noCandidate.right === "P" ? "put" : "call";
    const contracts = noCandidate.firstDay.checks.reduce((sum, check) => sum + check.contracts, 0);
    lines.push("", `No candidate on ${noCandidate.firstDay.date} at ${noCandidate.firstDay.lookTimeEt} ET: none of ${pluralizeCount(contracts, noun)} qualified. Each check in order, and the ${noun}s it left out:`);
    for (const check of noCandidate.firstDay.checks) lines.push(`• ${check.rule}: ${formatNumber(check.contracts)}`);
    if (noCandidate.days > 1) {
      const byCheck = backtestCandidateChecks.flatMap((check) => (noCandidate.daysByCheck[check] ? [`${candidateCheckLabels[check]} ${formatNumber(noCandidate.daysByCheck[check]!)}`] : []));
      lines.push("", `On the ${formatNumber(noCandidate.days)} days with no candidate, the days each check left ${noun}s out: ${byCheck.join(" · ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * The account's return over a stretch of session days (Marcelo 2026-10-20): its value at the 10:00 mark of the session
 * after the stretch's last day (the last day's own mark when none follows) ÷ its value at the first day's 10:00 mark − 1.
 * Each mark is before that day's orders, so a cycle's return counts what its closing day did. Null when a date is not one
 * of the session's days.
 */
export function accountReturnOver(days: readonly Pick<BacktestSessionDay, "tradingDate" | "accountValue">[], firstDate: string, lastDate: string | null): number | null {
  const first = days.findIndex((day) => day.tradingDate === firstDate);
  const last = lastDate === null ? days.length - 1 : days.findIndex((day) => day.tradingDate === lastDate);
  if (first === -1 || last === -1 || days[first]!.accountValue <= 0) return null;
  return days[Math.min(last + 1, days.length - 1)]!.accountValue / days[first]!.accountValue - 1;
}

/**
 * Buy and hold over a stretch (Marcelo 2026-10-20), close to close on split-adjusted closes, as the Idle rows' stock move:
 * C(last day) ÷ C(the trading day before the first) − 1. `closes` are [date, adjusted close] in date order; null when a
 * close is missing.
 */
export function closeToCloseReturn(closes: readonly [string, number | null][], firstDate: string, lastDate: string): number | null {
  const first = closes.findIndex(([date]) => date === firstDate);
  const before = first > 0 ? closes[first - 1]![1] : null;
  const last = closes.find(([date]) => date === lastDate)?.[1] ?? null;
  return before === null || last === null || before <= 0 ? null : last / before - 1;
}

/**
 * A ladder put's rung for the Wheel cycles' tooltip (approved by Marcelo 2026-10-21): the decision first (why a rung was
 * sold at that look, the strike limit that bound, the cap or the rung's collateral, which put and why, the stock price),
 * then how the cap K_max = A − (A − F) × (U + Q) ÷ R0 came out, with each term's source.
 */
export function describeLadderRung(rung: BacktestLadderRungRecord, sale: { strike: number | null; contracts: number; stockPrice: number | null }): string {
  const price = (value: number | null) => (value === null ? "—" : value.toFixed(2));
  const dollars = (value: number) => formatCurrency(value, 0);
  const yearly = (yieldFraction: number) => `${formatPercentage(yieldFraction, 1)} a year`;
  const topIsBreakEven = rung.top !== null && rung.breakEven !== null && Math.abs(rung.top - rung.breakEven) < 0.005;
  const fullSlice = Math.abs(rung.rungCollateral - rung.reserve / rung.rungs) < 0.5;
  const strikeText = sale.strike === null ? "the put" : formatCurrencyTrimmed(sale.strike);

  const decision = [`Rung ${rung.rungNumber} of ${rung.rungs} · ${sale.strike === null ? "a put" : `${strikeText} Put`} sold${sale.contracts > 1 ? ` (${formatNumber(sale.contracts)} contracts)` : ""}${rung.saleYield != null ? `, ${yearly(rung.saleYield)}` : ""}`];
  if (rung.callComparison !== undefined)
    decision.push(
      rung.callComparison === null
        ? "• Why a rung now: no call qualified on the free shares."
        : `• Why a rung now: its ${yearly(rung.callComparison.putYield)} beat the best call's ${formatPercentage(rung.callComparison.callYield, 1)}${rung.callComparison.marginPct > 0 ? ` by more than ${rung.callComparison.marginPct}%` : ""}.`,
    );
  if (rung.collateralLeft !== undefined && rung.cap !== null) {
    const byCollateral = rung.collateralLeft / 100;
    const collateralText = rung.collateralLeft < rung.rungCollateral - 0.5 ? `the ${dollars(rung.collateralLeft)} of the rung's collateral its earlier puts left` : `the rung's ${dollars(rung.collateralLeft)} collateral`;
    decision.push(
      byCollateral < rung.cap
        ? `• Strike limit ${formatCurrency(byCollateral)}, set by ${collateralText}: it fits one contract up to that strike. The ladder cap, ${formatCurrency(rung.cap)}, was higher, so it didn't bind.`
        : `• Strike limit ${formatCurrency(rung.cap)}, the ladder cap. ${collateralText.charAt(0).toUpperCase()}${collateralText.slice(1)} would allow up to ${formatCurrency(byCollateral)}.`,
    );
  }
  if (rung.rank != null && rung.eligibleCount != null) {
    const place = `${formatOrdinal(rung.rank)} of the ${formatNumber(rung.eligibleCount)} within the rules`;
    const best = rung.bestStrike != null && rung.bestYield != null ? `the best, the ${formatCurrencyTrimmed(rung.bestStrike)} at ${yearly(rung.bestYield)}` : null;
    if (rung.afterVolumeLimit) decision.push(`• Why ${strikeText}: the next best after the volume limit of the puts above it (${place}).`);
    else if (rung.rank === 1) decision.push(`• Why ${strikeText}: the highest-yielding put within the rules (1st of ${formatNumber(rung.eligibleCount)}).`);
    else {
      const bestNeeded = best && rung.collateralLeft !== undefined && rung.bestStrike! * 100 > rung.collateralLeft + 0.5 ? `; ${best}, needed ${dollars(rung.bestStrike! * 100)}` : best ? `; ${best}, could not be sold (already held, or the cash or its volume)` : "";
      decision.push(`• Why ${strikeText}: the highest-yielding put that fit. It was ${place}${bestNeeded}.`);
    }
  }
  if (sale.stockPrice !== null && sale.strike !== null && sale.stockPrice > 0)
    decision.push(`• Stock at ${formatCurrency(sale.stockPrice)} (10:00): the strike is ${formatPercentage(1 - sale.strike / sale.stockPrice, 0)} below it.`);

  const formula = [
    "How the cap was set",
    "K_max = A − (A − F) × (U + Q) ÷ R0",
    `= ${price(rung.top)} − (${price(rung.top)} − ${price(rung.floor)}) × (${dollars(rung.committed)} + ${dollars(rung.rungCollateral)}) ÷ ${dollars(rung.reserve)} = ${rung.cap === null ? "no cap" : formatCurrency(rung.cap)}`,
    rung.top === null
      ? "• A: no break-even known"
      : topIsBreakEven
        ? `• A, the break-even: ${formatCurrency(rung.top)}`
        : `• A, the top: the lower of the break-even ${formatCurrency(rung.breakEven)} and the price ${formatCurrency(rung.top)}`,
    `• F, the floor: the shares' average cost ${formatCurrency(rung.averageCost)} × (1 − shock ${formatPercentage(rung.shock, 1)}) = ${formatCurrency(rung.floor)}`,
    `• U, the reserve committed before it: ${dollars(rung.committed)}`,
    `• Q, this rung's collateral: ${dollars(rung.rungCollateral)} (${fullSlice ? `R0 ÷ ${rung.rungs}` : "what was left of the reserve"})`,
    `• R0, the reserve: ${dollars(rung.reserve)} (${rung.base > 0 ? `${Math.round((rung.reserve / rung.base) * 100)}% of the ${dollars(rung.base)} base` : "no base"}); the rung reaches ${rung.slices.toFixed(2)} of its ${rung.rungs} slices`,
  ];
  return [...decision, "───", ...formula].join("\n");
}

/**
 * A cycle timeline row as the Wheel cycles table lists it: a short event name ("Sold put", "Put assigned", "Call assigned",
 * "To CC"), what happened ("$59 Put · 10 Jan (7DTE) · 7× @ 0.30 · Δ -0.21 · 61.4% a year": a sale shows the delta and the
 * annualised yield the engine recorded for it; no row shows its commission, which the cycle's P&L already counts), whether it
 * opened an option (its expiry then shows as the row's close), and the stock price that goes with it: the 10:00 price
 * the day's looks saw for a trade, the day's close for an assignment, a hand-over or a mark.
 */
export function describeCycleTimelineEvent(row: BacktestCycleTimelineRow): { name: string; detail: string; opensOption: boolean; priceAt: "tenOclock" | "close" } {
  const shares = pluralizeCount(row.quantity, "share");
  const contractOf = (right: string) => (row.strike !== null && row.expiryDate !== null ? formatOptionContractLabel({ strike: row.strike, right: right === "put" ? "P" : "C", expiry: row.expiryDate, dte: daysToExpiry(row.expiryDate, row.tradingDate) }) : `${right}s`);
  const strike = row.strike === null ? "" : ` the ${formatCurrency(row.strike)} strike`;
  const price = row.stockPrice === null ? "" : formatCurrency(row.stockPrice);
  const contracts = Math.round(row.quantity / 100);
  const opened = /^(Sold|Bought) (put|call) @ (\S+)(.*)$/.exec(row.label);
  if (opened) {
    const saleDelta = opened[1] === "Sold" && row.delta != null ? ` · Δ ${formatDelta(row.delta)}` : "";
    const saleYield = opened[1] === "Sold" ? saleDelta + (row.premiumYield == null ? "" : ` · ${formatPercentage(row.premiumYield, 1)} a year`) : "";
    return { name: `${opened[1]} ${opened[2]}`, detail: `${contractOf(opened[2]!)}${formatOrderSize(contracts, Number(opened[3]))}${opened[4]}${saleYield}`, opensOption: true, priceAt: "tenOclock" };
  }
  const boughtBack = /^Bought back (put|call) @ (\S+)$/.exec(row.label);
  if (boughtBack) return { name: "Bought back", detail: `${contractOf(boughtBack[1]!)}${formatOrderSize(contracts, Number(boughtBack[2]))}`, opensOption: false, priceAt: "tenOclock" };
  if (row.label.startsWith("Put assigned")) {
    const close = row.strike !== null && row.quantity > 0 && row.stockDollars !== 0 ? `, worth ${formatCurrency(row.strike + row.stockDollars / row.quantity)} at the close` : "";
    return { name: "Put assigned", detail: `${shares} bought at${strike}${close}`, opensOption: false, priceAt: "close" };
  }
  if (row.label.startsWith("Call assigned")) return { name: "Call assigned", detail: `${shares} sold at${strike}`, opensOption: false, priceAt: "close" };
  const handed = /^Shares handed to (CC|Unstructured)$/.exec(row.label);
  if (handed) {
    const to = handed[1] === "CC" ? "CC" : "N/S";
    return { name: `To ${to}`, detail: `${shares} handed to ${to} ${row.stockPriceSource === "close" ? `at the ${price} close` : `at their ${price} cost`}`, opensOption: false, priceAt: "close" };
  }
  if (row.label === "Bought shares" || row.label === "Sold shares") return { name: row.label, detail: `${shares} @ ${price}`, opensOption: false, priceAt: "tenOclock" };
  const marked = /^Marked to the (\S+) close$/.exec(row.label);
  if (marked) return { name: "Marked", detail: `${shares} still held, at the ${price} close of ${marked[1]}`, opensOption: false, priceAt: "close" };
  const openMarked = /^Open (put|call) marked to market$/.exec(row.label);
  if (openMarked) return { name: "Marked", detail: `${contractOf(openMarked[1]!)}${formatOrderSize(contracts, null)} still open, marked to market`, opensOption: false, priceAt: "close" };
  return { name: row.label, detail: "", opensOption: false, priceAt: "close" };
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

export const decisionMakerLabel: Record<BacktestDecisionMaker, string> = { rules: "Rules", llm: "The AI model", baseline: "Baseline wheel" };

/** "decided by the rules", in a session's subtitle. */
export const decidedByPhrase: Record<BacktestDecisionMaker, string> = { rules: "the rules", llm: "the AI model", baseline: "the baseline wheel" };

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

// ---- New session: per-ticker pots and values (mockup approved 2026-10-15) ----

// Type-only, so it can sit with the section it serves (appended to this file).
import type { BacktestSymbolSettingSource, BacktestTickerProblem, BacktestTickerValueKey } from "../api/backtest";

/** A dollar amount as typed: "$1,000,000" → 1000000; NaN when blank or not a number. */
export function parseDollarAmountText(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

/** Under the Decision maker select: what the choice makes the form show. */
export const decisionMakerHint: Record<BacktestDecisionMaker, string> = {
  rules: "each pass looks at closes, then rolls, then opens",
  llm: "Claude through the subscription, asked as live Pluto asks it; the estimate shows below the Settings",
  baseline: "each ticker gets its own pot and ladder values (Tickers, below)",
};

/** Where a ticker's value came from, as its badge reads (lowest layer first: the order a reset walks back down). */
export const backtestValueSourceOrder: BacktestSymbolSettingSource[] = ["global", "ticker", "session", "request"];
export const backtestValueSourceLabel: Record<BacktestSymbolSettingSource, string> = { global: "Global", ticker: "Ticker lab", session: "Session", request: "This session" };
export const backtestValueSourceBadgeClass: Record<BacktestSymbolSettingSource, string> = {
  global: "backtest-value-source-global",
  ticker: "backtest-value-source-ticker",
  session: "backtest-value-source-session",
  request: "backtest-value-source-request",
};
/** The badge's tooltip, and the "Back to …" of a Reset. */
export const backtestValueSourceTitle: Record<BacktestSymbolSettingSource, string> = {
  global: "the lab's global value",
  ticker: "the ticker's saved lab value",
  session: "changed for every ticker of this session",
  request: "changed here for this ticker",
};
/** The legend under the Tickers table. */
export const backtestValueSourceLegend: Record<BacktestSymbolSettingSource, string> = {
  global: "the lab's global value",
  ticker: "the ticker's lab value (Per ticker only)",
  session: "changed for every ticker under Settings",
  request: "changed here for this ticker",
};

/** The most specific of some values' sources (a cell showing several values carries one badge); null when none is given. */
export function mostSpecificValueSource(sources: (BacktestSymbolSettingSource | null | undefined)[]): BacktestSymbolSettingSource | null {
  let best: BacktestSymbolSettingSource | null = null;
  for (const source of sources) if (source && (best === null || backtestValueSourceOrder.indexOf(source) > backtestValueSourceOrder.indexOf(best))) best = source;
  return best;
}

/** The Tickers table's value columns: each shows one value, or several read together (the shock, the |delta| range). */
export type BacktestTickerValueGroup = "pot" | "share" | "rungs" | "shock" | "delta";

/** The keys a column shows: the shock's numbers follow its mode (a fixed % or a range from history). */
export function tickerValueGroupKeys(group: BacktestTickerValueGroup, ladderShock: string): BacktestTickerValueKey[] {
  if (group === "pot") return ["potDollars"];
  if (group === "share") return ["ladderSharesPct"];
  if (group === "rungs") return ["ladderRungs"];
  if (group === "shock") return ladderShock === "fixed" ? ["ladderShock", "ladderShockPct"] : ["ladderShock", "ladderShockMinPct", "ladderShockMaxPct"];
  return ["minAbsDelta", "maxAbsDelta"];
}

/** Every key a column's Reset clears (the shock's in both modes). */
export function tickerValueGroupAllKeys(group: BacktestTickerValueGroup): BacktestTickerValueKey[] {
  return group === "shock" ? ["ladderShock", "ladderShockPct", "ladderShockMinPct", "ladderShockMaxPct"] : tickerValueGroupKeys(group, "history");
}

/** One value's name, in a ticker's problems and the phone's labels. */
export const tickerValueLabel: Record<BacktestTickerValueKey, string> = {
  potDollars: "Pot",
  ladderSharesPct: "Share level",
  ladderRungs: "Rungs",
  ladderShock: "Shock",
  ladderShockPct: "Fixed shock",
  ladderShockMinPct: "Shock at least",
  ladderShockMaxPct: "Shock at most",
  minAbsDelta: "|delta| from",
  maxAbsDelta: "|delta| to",
};

/** A |delta| with at least two decimals (0.3 → "0.30", 0.055 → "0.055"). */
export function formatAbsDelta(value: number): string {
  return Number.isInteger(Math.round(value * 1e6) / 1e4) ? value.toFixed(2) : formatInputNumber(value, 6);
}

/** What a ticker value's input shows: the pot with separators, a |delta| with two decimals, the rest as settingInputText. */
export function tickerValueInputText(key: BacktestTickerValueKey, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (key === "potDollars") return formatNumber(value);
  if (key === "minAbsDelta" || key === "maxAbsDelta") return formatAbsDelta(value);
  return settingInputText(value);
}

/** Why a typed ticker value cannot be sent, or null when it can (the API checks the rest once merged). */
export function tickerValueTextProblem(key: BacktestTickerValueKey, text: string): string | null {
  if (key === "ladderShock") return null;
  const value = key === "potDollars" ? parseDollarAmountText(text) : text.trim() === "" ? Number.NaN : Number(text.trim());
  if (!Number.isFinite(value)) return key === "potDollars" ? "Pot needs a dollar amount above 0." : `${tickerValueLabel[key]} needs a number.`;
  if (key === "potDollars" && value <= 0) return "Pot needs a dollar amount above 0.";
  if (key === "ladderRungs" && !Number.isInteger(value)) return "Rungs needs a whole number.";
  return null;
}

/** "History 60–80%" or "Fixed 70%"; `withMode` false gives the numbers only ("Reset to 60–80%"). */
function describeShock(values: Partial<Record<BacktestTickerValueKey, number | string | null>>, withMode: boolean): string {
  const percent = (key: BacktestTickerValueKey) => formatInputNumber(Number(values[key]), 4);
  if (values.ladderShock === "fixed") return `${withMode ? "Fixed " : ""}${percent("ladderShockPct")}%`;
  return `${withMode ? "History " : ""}${percent("ladderShockMinPct")}–${percent("ladderShockMaxPct")}%`;
}

/** A column's values as text: "$150,000", "30%", "5", "History 60–80%", "0.05–0.30"; "—" for a missing pot. */
export function describeTickerValueGroup(group: BacktestTickerValueGroup, values: Partial<Record<BacktestTickerValueKey, number | string | null>>): string {
  if (group === "pot") return typeof values.potDollars === "number" ? formatCurrency(values.potDollars, 0) : "—";
  if (group === "share") return `${formatInputNumber(Number(values.ladderSharesPct), 4)}%`;
  if (group === "rungs") return formatNumber(Number(values.ladderRungs));
  if (group === "shock") return describeShock(values, true);
  return `${formatAbsDelta(Number(values.minAbsDelta))}–${formatAbsDelta(Number(values.maxAbsDelta))}`;
}

/**
 * The values a ticker of a "pots" session ran on, for the session's header: "SPY: $800,000 pot · 65% shares · 3 rungs ·
 * fixed 35% shock · |delta| 0.05–0.30" (a shock from history: "40–80% shock from history").
 */
export function describeSessionTickerValues(symbol: string, settings: Pick<BacktestSymbolSettings, "potDollars" | "baseline">): string {
  const values = { potDollars: settings.potDollars, ...settings.baseline };
  const shock = values.ladderShock === "fixed" ? `fixed ${describeShock(values, false)} shock` : `${describeShock(values, false)} shock from history`;
  return `${symbol}: ${describeTickerValueGroup("pot", values)} pot · ${describeTickerValueGroup("share", values)} shares · ${describeTickerValueGroup("rungs", values)} rungs · ${shock} · |delta| ${describeTickerValueGroup("delta", values)}`;
}

/** Where each of those values came from, one per line ("Fixed shock: the ticker's saved lab value"), for its tooltip. */
export function describeSessionTickerValueSources(settings: Pick<BacktestSymbolSettings, "baseline" | "source">): string {
  const shockKey: BacktestTickerValueKey = settings.baseline.ladderShock === "fixed" ? "ladderShockPct" : "ladderShockMinPct";
  const keys: BacktestTickerValueKey[] = ["potDollars", "ladderSharesPct", "ladderRungs", shockKey, "minAbsDelta"];
  return keys
    .map((key) => {
      const label = key === "minAbsDelta" ? "|delta| range" : key === "ladderShockMinPct" ? "Shock range" : tickerValueLabel[key];
      const source = settings.source[key];
      return `${label}: ${source ? backtestValueSourceTitle[source] : "not recorded"}`;
    })
    .join("\n");
}

/** A session's page title: its name, then its symbols unless the name already names each of them ("Analysis · SPY · …"). */
export function backtestSessionTitle(name: string, symbols: readonly string[], symbolText: string): string {
  const named = symbols.every((symbol) => new RegExp(`(^|[^A-Z0-9.])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Z0-9.])`).test(name));
  return named ? name : `${name} · ${symbolText}`;
}

/** A Reset button's text: "Reset to 30%", "Reset to 60–80%"; "Clear" for a pot with nothing under it. */
export function describeTickerResetTarget(group: BacktestTickerValueGroup, below: Partial<Record<BacktestTickerValueKey, number | string | null>>): string {
  if (group === "pot" && typeof below.potDollars !== "number") return "Clear";
  return `Reset to ${group === "shock" ? describeShock(below, false) : describeTickerValueGroup(group, below)}`;
}

/** A ticker's problem as the page lists it: the pot's sentence names the ticker already; the others get "HOOD: " and the
 *  settings' labels in place of their paths ("baseline.ladderRungs" → "Ladder: rungs"). */
export function describeTickerProblem(symbol: string, problem: BacktestTickerProblem, rows: BacktestSettingRow[]): string {
  if (problem.key === "potDollars") return problem.message;
  const message = problem.message.replace(/\b(baseline\.\w+)/g, (path) => rows.find((row) => row.path === path)?.label ?? path);
  return `${symbol}: ${message}`;
}

/** The Sessions list's link to the sessions created while it was being read: "1 new session", "3 new sessions". */
export function describeNewSessionsLink(count: number, atLeast: boolean): string {
  return `${formatNumber(count)}${atLeast ? "+" : ""} new ${count === 1 && !atLeast ? "session" : "sessions"}`;
}

const dataFilePartLabels: Record<BacktestDataFilePart, string> = {
  quotes: "10:00 quotes",
  intraday_quotes: "30-minute quotes",
  eod: "end-of-day prices",
  open_interest: "open interest",
};
/** "10:00 and 30-minute quotes" when both quote parts are missing, otherwise the parts' labels joined. */
function describeDataFileParts(parts: readonly BacktestDataFilePart[]): string {
  const bothQuotes = parts.includes("quotes") && parts.includes("intraday_quotes");
  const labels = parts.filter((part) => !(bothQuotes && part === "intraday_quotes")).map((part) => (bothQuotes && part === "quotes" ? "10:00 and 30-minute quotes" : dataFilePartLabels[part]));
  return joinWithAnd(labels);
}

/** The Issues tooltip lists at most this many entries; the rest are counted. */
const dataFileIssueLinesShown = 20;

/**
 * The Data files table's Issues tooltip: the file's issue days grouped by kind, one line per day (and expiration), at most
 * 20 lines, e.g. "2021-04-06 · expiry 2023-01-20: 10:00 quotes and 30-minute quotes (ThetaData sent malformed data)".
 * Null when the file has none.
 */
export function describeDataFileIssues(file: Pick<BacktestDataFileSummary, "issueDays" | "issues">): string | null {
  if (file.issueDays === 0) return null;
  const sections: { heading: string; lines: string[] }[] = [
    {
      heading: "Nothing stored yet (Update downloads these):",
      lines: file.issues.notStored.map((run) => (run.weekdays === 1 ? run.firstDate : `${run.firstDate} – ${run.lastDate} (${pluralizeCount(run.weekdays, "weekday")})`)),
    },
    {
      heading: "Stored with parts missing:",
      lines: file.issues.partial.map((entry) => `${entry.tradingDate}${entry.expiry ? ` · expiry ${entry.expiry}` : ""}: ${describeDataFileParts(entry.parts)} (${entry.reason})`),
    },
    {
      heading: "Could not be retrieved (every download tries again):",
      lines: file.issues.unavailable.map((entry) => `${entry.tradingDate}: ${entry.part ? `${dataFilePartLabels[entry.part]} ` : ""}(${entry.reason})`),
    },
  ];
  const blocks: string[] = [pluralizeCount(file.issueDays, "day") + " with issues"];
  let shown = 0;
  let hidden = 0;
  for (const section of sections) {
    if (section.lines.length === 0) continue;
    const room = Math.max(0, dataFileIssueLinesShown - shown);
    const lines = section.lines.slice(0, room);
    hidden += section.lines.length - lines.length;
    shown += lines.length;
    if (lines.length > 0) blocks.push([section.heading, ...lines].join("\n"));
  }
  if (hidden > 0) blocks.push(`… and ${formatNumber(hidden)} more`);
  return blocks.join("\n\n");
}
