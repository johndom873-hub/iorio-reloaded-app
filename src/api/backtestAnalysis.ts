import { apiRequest } from "./client";
import type { BacktestDetectedSplit, BacktestMetrics, BacktestSettingsTemplate, BacktestTickerProfile, BacktestTickerSuitability } from "./backtest";

// The Analyse window (Backtesting → Data files) and the lab settings it reads. Mirrors the API's src/backtest/analysis/
// (analysisFigures.ts, analysisStore.ts, analysisBacktest.ts, analysisSuitabilityRule.ts, analysisSessions.ts) and
// labSettingsStore.ts; keep them in step. Since Vol Farmer v4 (Marcelo 2026-11-01) the window judges a ticker for v4
// alone. Ratios are fractions (0.418 = 41.8%).

export type AnalysisStep = "bars" | "calls" | "earnings_correlation" | "saving" | "backtest";
export const analysisSteps: readonly AnalysisStep[] = ["bars", "calls", "earnings_correlation", "saving", "backtest"];
export const analysisStepLabels: Record<AnalysisStep, string> = {
  bars: "Reading the daily bars",
  calls: "Scanning the expiry days' Calls",
  earnings_correlation: "Earnings and correlations",
  saving: "Saving the figures",
  backtest: "Running the Vol Farmer v4 backtest",
};

export type AnalysisReason = "manual" | "ticker_settings" | "global_settings" | "trial";
export type AnalysisRunStatus = "queued" | "running" | "stopped" | "succeeded" | "failed" | "cancelled";
export type AnalysisPriceRange = "All" | "10Y" | "5Y" | "2Y" | "1Y";

/** Run a trial: the analysis backtest at another starting account; nothing is saved as the ticker's analysis. */
export interface AnalysisTrialValues {
  accountDollars: number;
}

/** Vol Farmer v4's values the analysis reads (a subset of the API's BacktestVolFarmerV4Settings). */
export interface AnalysisVolFarmerV4Values {
  callMinAbsDelta: number;
  callMaxAbsDelta: number;
  maxSpreadPctOfMid: number;
  firstPositionPct: number;
  excessAllowancePct: number;
  rebalanceBandPct: number;
  putsStartCallYieldPct: number;
  [key: string]: unknown;
}

export interface AnalysisLabValues {
  settings: { volFarmerV4?: AnalysisVolFarmerV4Values; trading: { spreadCostChargedPct: number } & Record<string, unknown> } & Record<string, unknown>;
  defaultPotDollars: number;
  trial: AnalysisTrialValues | null;
  effective: { accountDollars: number; potDollars: number; potShareOfAccount: number; firstPositionShare: number; v4: AnalysisVolFarmerV4Values; spreadShareCharged: number };
}

export interface AnalysisRunView {
  id: string;
  symbol: string;
  reason: AnalysisReason;
  status: AnalysisRunStatus;
  step: AnalysisStep | null;
  progressDone: number;
  progressTotal: number;
  jobId: string | null;
  sessionId: string | null;
  formulasVersion: number;
  labValues: AnalysisLabValues;
  labValuesHash: string;
  optionLastDate: string | null;
  barsLastDate: string | null;
  figuresSeconds: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Options volume and open interest from the file. */
export interface AnalysisOptionActivity {
  volume: { sessions: number; fromDate: string; toDate: string; averagePerDay: number; callShare: number | null; cappedPutsAveragePerDay: number | null; yearSessions: number; yearAveragePerDay: number } | null;
  openInterest: { date: string; total: number; callShare: number | null; cappedPuts: number | null } | null;
}

export interface AnalysisIvPremiumStats {
  days: number;
  medianPremium: number | null;
  shareAbove: number | null;
  medianImplied: number | null;
  medianForwardRealised: number | null;
}

export interface AnalysisMaxDrawdown {
  /** A positive fraction (0.902 = −90.2%). */
  depth: number;
  peakDate: string;
  peak: number;
  troughDate: string;
  trough: number;
  recoveredOn: string | null;
}

export interface AnalysisProfile {
  from: string;
  to: string;
  closes: number;
  cagr: number;
  r2: number;
  swings: number;
  swingsPerYear: number;
  medianSwing: number | null;
  jumps: number;
  jumpsPerYear: number;
  largestJump: { date: string; move: number; logMove: number } | null;
  jumpsOnReports: number;
  varianceRatio: number | null;
  standardError: number | null;
  label: "trending" | "range-bound" | "neither" | null;
}

export interface AnalysisReport {
  date: string;
  move: number | null;
  impliedMove: number | null;
  straddle: { quoteDate: string; expiry: string; strike: number; callMid: number; putMid: number; price: number } | null;
}

export interface AnalysisCorrelationRow {
  symbol: string;
  window: 252 | 504;
  n: number;
  correlation: number | null;
  beta: number | null;
}

/** [date, open, high, low, close, implied volatility]: IBKR's daily bars, split-adjusted. */
export type AnalysisBarRow = [string, number, number, number, number, number | null];
/** Why no ladder Put could be sold at a day's first look. */
export type AnalysisLadderPutBlock = "ladder_puts_off" | "every_lot_has_a_call" | "a_put_is_open" | "no_cap";
/** A CC + Put Ladder session's day: [date, the next ladder Put's cap (null: none fits), the floor, why no ladder Put could be sold]. */
export type SessionLadderLevel = [string, number | null, number | null, AnalysisLadderPutBlock | null];
/** A CC + Put Ladder session's rung: [date, its highest strike, its fills [strike, expiry, contracts], the rung it reaches [number, rungs, slices, reserve committed before it]]. */
export type SessionRungSold = [string, number, [number, string, number][], ([number, number, number, number] | null)?];
/** [date, right, yield given up (null when one strike), contracts unsold]. */
export type SessionTooLargeDay = [string, "C" | "P", number | null, number];
/** The whole account's free cash each day at its 10:00 marks: [date, free cash, cash locked in open puts, account value]. */
export type CashAvailableRow = [string, number, number, number];

/**
 * A session's "Price and Max drawdown" chart: the symbol's IBKR daily bars over the session's period (split-adjusted), the
 * Max drawdown of each range in it, and that session's ladder levels, rungs sold and orders over one strike.
 */
export interface BacktestSessionPriceChart {
  symbol: string;
  bars: AnalysisBarRow[];
  maxDrawdown: Record<AnalysisPriceRange, AnalysisMaxDrawdown | null>;
  /** One per bar, worked out over the whole data file, so the session's first day has its look-back. */
  barIndicators: AnalysisBarIndicators;
  ladderLevels: SessionLadderLevel[];
  ladderRungsSold: SessionRungSold[];
  tooLargeDays: SessionTooLargeDay[];
  /** The whole account's free cash each day at its 10:00 marks (every symbol's in a session of several). */
  cashAvailable: CashAvailableRow[];
  /** The symbol's splits in the session's period: the bars before one are its traded prices ÷ the ratio. */
  splits: BacktestDetectedSplit[];
  /** Vol Farmer v2 and v4: [date, B-E, B-E2] after each 10:00 look, split-adjusted; null while that position holds no shares. Empty for other sessions. */
  breakEvenLevels: [string, number | null, number | null][];
  /** Vol Farmer v2 and v4: their LEAPS Calls bought, sold and expired, as traded. */
  leapsEvents: SessionLeapsEvent[];
}

/** A LEAPS Call bought, sold or expired (at its expiry: worthless, or at its intrinsic value), as traded; price per share. */
export interface SessionLeapsEvent {
  date: string;
  kind: "bought" | "sold" | "expired";
  contracts: number;
  strike: number;
  expiry: string;
  price: number;
}

/** The price chart's indicators for each bar (approved 2026-10-26), aligned with the bars. */
export interface AnalysisBarIndicators {
  /** [share, bars at or below, bars with an IV]: of the last 252 bars, those whose IV was at or below the bar's ÷ those with one; null without an IV or under 20 in the window. */
  ivPercentile: ([number, number, number] | null)[];
}

export type SuitabilityCheck = "options_income" | "expiry_days_sold" | "weeks_with_expiry" | "lot_fits";
export const suitabilityChecks: readonly SuitabilityCheck[] = ["options_income", "expiry_days_sold", "weeks_with_expiry", "lot_fits"];

/** One of the rule's windows (S1–S4 over the analysis backtest's last 12, 6 or 3 months). */
export interface SuitabilityWindow {
  months: 12 | 6 | 3;
  /** The window runs from the day after startDate to endDate. */
  startDate: string;
  endDate: string;
  covered: boolean;
  startMarkDate: string | null;
  optionsIncome: { pnlDollars: number; accountAtStartDollars: number | null; calendarDays: number; yearlyShare: number | null; passes: boolean };
  expiryDaysSold: { expiryDays: number; daysSold: number; share: number | null; passes: boolean };
  weeksWithExpiry: { wholeWeeks: number; weeksWithExpiryDay: number; share: number | null; passes: boolean };
  lotFits: { date: string | null; priceAsTraded: number | null; lotDollars: number | null; shareOfTarget: number | null; passes: boolean };
}

export interface SuitabilityVerdict {
  suits: boolean;
  failedChecks: SuitabilityCheck[];
  uncoveredWindows: number[];
}

/** A Call v4 could sell on an expiry day (F5). */
export interface AnalysisSameDayCall {
  strike: number;
  bid: number;
  ask: number;
  fillPrice: number;
  delta: number;
  impliedVolatility: number;
  premiumYield: number;
  volumeCap: number;
}

export interface AnalysisPnlSource {
  pnlDollars: number;
  cagrPart: number | null;
  daysHeldShare: number;
}

export interface AnalysisPnlSources {
  shares: AnalysisPnlSource | null;
  coveredCalls: (AnalysisPnlSource & { quotedYieldMedian: number | null; quotedCount: number }) | null;
  hedge: (AnalysisPnlSource & { quotedCostMedian: number | null; quotedCount: number }) | null;
  cashSecuredPuts: (AnalysisPnlSource & { quotedYieldMedian: number | null; quotedCount: number }) | null;
  leaps: AnalysisPnlSource | null;
}

export interface AnalysisYearRow {
  year: string;
  fromDate: string | null;
  toDate: string;
  startValue: number;
  endValue: number;
  v4Return: number;
  holdReturn: number | null;
  spyReturn: number | null;
  treasuryBillReturn: number | null;
  v4MaxDrawdown: number;
  holdMaxDrawdown: number | null;
  sources: { calls: number; puts: number; leaps: number; interest: number; shares: number };
  parts: { calls: number; puts: number; leaps: number; interest: number; shares: number };
  callsSold: number;
  callYieldMedian: number | null;
  callImpliedVolatility: number | null;
  expiryDays: number;
  expiryDaysSold: number;
  wholeWeeks: number;
  weeksWithExpiryDay: number;
  calledAway: number;
  putsSold: number;
  putsAssigned: number;
  topUps: number;
  trims: number;
}

export interface AccountDuringFall {
  fromDate: string;
  toDate: string;
  startValue: number;
  lowestValue: number;
  lowestOn: string;
  fall: number;
  backOn: string | null;
  topUps: number;
  topUpDollars: number;
}

/** The analysis's own backtest: the ticker alone under Vol Farmer v4 at the lab's values. */
export interface AnalysisBacktestFigures {
  sessionId: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  startingValue: number;
  startingPotDollars: number;
  metrics: BacktestMetrics | null;
  buyAndHoldMetrics: BacktestMetrics | null;
  spyMetrics: BacktestMetrics | null;
  excessCalmar: { v4: number | null; hold: number | null; spy: number | null };
  treasuryBillCagr: number | null;
  maxDrawdownDates: { peak: string; trough: string; back: string | null } | null;
  rule: { windows: SuitabilityWindow[]; verdict: SuitabilityVerdict };
  sources: AnalysisPnlSources | null;
  /** The T-bill interest credited, and its part of the CAGR as the sources' (CAGR × its P&L ÷ the account's P&L). */
  interest: { pnlDollars: number; cagrPart: number | null } | null;
  daysWithNoOptions: { dayCount: number; tradingDayCount: number; share: number; longestRun: { days: number; from: string; to: string } | null } | null;
  averages: { sharesShare: number | null; cashShare: number | null; freeCashShare: number | null };
  upsideGivenUp: { dollars: number; callAways: number; callAwaysWithUpside: number };
  topUps: { count: number; lots: number; dollars: number };
  trims: { count: number; lots: number; dollars: number };
  years: AnalysisYearRow[];
  allYears: Pick<AnalysisYearRow, "callsSold" | "callYieldMedian" | "callImpliedVolatility" | "expiryDays" | "expiryDaysSold" | "wholeWeeks" | "weeksWithExpiryDay" | "calledAway" | "putsSold" | "putsAssigned" | "topUps" | "trims">;
  /** [month, v4's return, the stock held's, SPY's]. */
  monthly: [string, number, number, number | null][];
  /** [date, account, stock held, SPY held, drawdown, free cash ÷ account, shares' value ÷ the pot]. */
  days: [string, number, number, number | null, number, number | null, number][];
  /** [date, strike as traded, contracts, fill, its IV at the sale, premium yield]. */
  callSales: [string, number, number, number, number | null, number | null][];
  events: { topUps: [string, number | null, number | null, number][]; trims: [string, number | null, number | null, number][]; calledAway: [string, number, number][] };
  expiryDaysWithoutCall: [string, string | null][];
  /** [number, open, opened, closed, days, P&L, return, the stock's change, Calls sold, premium, shares' P&L]. */
  cycles: [number, boolean, string, string | null, number, number, number | null, number | null, number, number, number][];
  /** F11, by the fall's peak date. */
  falls: Record<string, AccountDuringFall>;
  putsSold: number;
  leapsBought: number;
}

export interface AnalysisFallOfAStep {
  peakDate: string;
  peakClose: number;
  lowDate: string;
  lowClose: number;
  backDate: string | null;
  depth: number;
  yardstick: number;
  yardstickFrom: "implied" | "realised" | "median";
  steps: number;
  daysDown: number;
  daysBack: number | null;
}

export interface AnalysisMarketFit {
  days: number;
  beta: number | null;
  correlation: number | null;
}

export interface AnalysisFigures {
  formulasVersion: number;
  symbol: string;
  optionFirstDate: string;
  optionLastDate: string;
  barsLastDate: string | null;
  bars: AnalysisBarRow[];
  yangZhang21: (number | null)[];
  /** F9's stand-in, one per bar: the 63-day Yang-Zhang on a bar without an IV; null on bars with one (the IV pane's dashed line). */
  realisedStandIn: (number | null)[];
  /** Added when the figures are read. */
  barIndicators?: AnalysisBarIndicators;
  volatility: {
    impliedNow: number | null;
    yangZhang21Now: number | null;
    yangZhang63Now: number | null;
    impliedVersusRealised: { all: AnalysisIvPremiumStats; lastYear: AnalysisIvPremiumStats; byYear: Record<string, AnalysisIvPremiumStats> };
  };
  maxDrawdown: Record<AnalysisPriceRange, AnalysisMaxDrawdown | null>;
  expiryWeeks: {
    expiryDays: number;
    wholeWeeks: number;
    weeksWithExpiryDay: number;
    byYear: Record<string, { expiryDays: number; wholeWeeks: number; weeksWithExpiryDay: number }>;
    steadyWeekliesFrom: string | null;
    backtestStartDate: string;
  };
  sameDayCalls: {
    expiryDays: number;
    daysWithCall: number;
    byYear: Record<string, { expiryDays: number; daysWithCall: number }>;
    daysWithoutPrice: number;
    daysWithNoCall: string[];
    lastTwelveMonths: { fromDate: string; expiryDays: number; daysWithCall: number; largestPotDollars: number | null };
    scanSeconds: number;
  };
  size: {
    fromDate: string;
    toDate: string;
    highestPriceAsTraded: number | null;
    highestOn: string | null;
    smallestPotDollars: number | null;
    smallestAccountDollars: number | null;
    accountDollars: number;
    potDollars: number;
    targetReached: { medianShareOfTarget: number | null; sharesDollarsLow: number | null; sharesDollarsHigh: number | null };
    largestPotByCallVolume: { potDollars: number | null; expiryDays: number };
  };
  today: {
    date: string;
    isExpiryDay: boolean;
    priceAsTraded: number | null;
    accountDollars: number;
    potDollars: number;
    lots: number;
    sharesDollars: number;
    targetDollars: number;
    shareOfTarget: number | null;
    call: AnalysisSameDayCall | null;
    firstBreakEven: number | null;
    band: { floorDollars: number; topDollars: number; oneMoreLotDollars: number } | null;
    putsNow: boolean;
    putsStartCallYieldPct: number;
    step: { stepPct: number; impliedVolatility: number; ivDate: string } | null;
    putStrikeCap: number | null;
  };
  falls: AnalysisFallOfAStep[];
  stockProfile: {
    steps: { median: number | null; tenth: number | null; ninetieth: number | null; barsWithStep: number; barsFromRealised: number; now: { step: number; volatility: number; source: "implied" | "realised"; date: string } | null };
    falls: { count: number; perYear: number | null; reachedTwoSteps: number; backWithinAYear: number; medianDaysDown: number | null; medianDaysBack: number | null };
    trend: { days: number; uptrend: number; downtrend: number; neither: number };
    market: { all: AnalysisMarketFit; sinceBacktest: AnalysisMarketFit | null; spyDownDays: AnalysisMarketFit; spyUpDays: AnalysisMarketFit } | null;
    gaps: { gaps: number; up: number; down: number; perYear: number | null; firstMeasuredOn: string | null; largest: { date: string; move: number } | null };
    weeklySkew: { weeks: number; skew: number | null; worstWeek: { endDate: string; move: number } | null };
    ivRange: { days: number; firstDate: string | null; median: number | null; tenth: number | null; ninetieth: number | null };
    ivNow: { date: string; impliedVolatility: number; percentile: number | null } | null;
  };
  profile: { all: AnalysisProfile | null; twoYear: AnalysisProfile | null };
  optionActivity: AnalysisOptionActivity | null;
  earnings: {
    reports: AnalysisReport[];
    medianAbsMove: number | null;
    largest: { date: string; move: number } | null;
    medianImpliedMove: number | null;
    beyondImplied: number;
    withImplied: number;
    next: { date: string; afterClose: boolean | null } | null;
    exDividendDates: string[];
    hasTickerRow: boolean;
  };
  correlation: { rows: AnalysisCorrelationRow[]; skipped: Record<string, string>; spySource: "file" | "database" | null };
  dataQuality: {
    completeDays: number;
    firstDate: string | null;
    lastDate: string | null;
    weekdays: number;
    holidays: number;
    missingWeekdays: number;
    daysWithIssues: number;
    unavailableDays: number;
    intradayDays: number | null;
    quoteRowsPerDay: { min: number | null; max: number | null; lastDay: number | null };
    daysWithEveryQuoteAtZero: number;
    schemaVersion: string | null;
    maxDte: string | null;
    barsFetchedAt: string | null;
    bars: { count: number; firstDate: string | null; lastDate: string | null; source: "file" | "database" | null };
    impliedVolatility: { count: number; firstDate: string | null };
    tenOclockBars: number | null;
    splits: { fromDateIso: string; toDateIso: string; factor: number }[] | null;
    barChecks: { bigMoves: [string, number][]; gaps: [string, string][]; flatRuns: [string, string, number][] };
    sizeBytes: number;
  };
  analysisBacktest: AnalysisBacktestFigures | { error: string } | null;
}

/** The figures the data file gives on its own, without the expiry days' scan or the backtest: the window before a ticker's first analysis. */
export type AnalysisFileFigures = Omit<AnalysisFigures, "sameDayCalls" | "size" | "today" | "analysisBacktest">;

export type StoredAnalysis = AnalysisRunView & { figures: AnalysisFigures | null };

export interface TickerAnalysisView {
  symbol: string;
  stored: StoredAnalysis | null;
  trial: StoredAnalysis | null;
  active: AnalysisRunView[];
  latestProblem: AnalysisRunView | null;
  currentHash: string;
  /** The stored analysis was computed with other lab values, or older formulas. */
  outOfDate: boolean;
  labSavedAt: string;
  fileLastDate: string | null;
  currentFormulasVersion: number;
  /** The header's name and classification; null when nothing is stored for the ticker. */
  profile: BacktestTickerProfile | null;
  /** As on the Data files table; null: Pending. */
  suitability: BacktestTickerSuitability | null;
  /** The symbol's splits over its daily bars, for the price chart's split lines; null before its file was analysed. */
  detectedSplits: BacktestDetectedSplit[] | null;
}

export interface AnalysisSessionRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  decisionMaker: string;
  startingValue: number;
  cagr: number;
  maxDrawdown: number;
  totalReturn: number;
  buyAndHoldCagr: number | null;
  buyAndHoldMaxDrawdown: number | null;
  excessCalmar: number | null;
  createdAt: string;
  isAnalysis: boolean;
}

/** The Data files table's figures of a ticker's latest succeeded analysis. */
export interface AnalysisTableFigures {
  verdict: "suits" | "doesnt_suit";
  failedChecks: SuitabilityCheck[];
  uncoveredWindows: number[];
  optionsIncomeTwelveMonths: number | null;
  v4Cagr: number | null;
  holdCagr: number | null;
  v4ExcessCalmar: number | null;
  holdExcessCalmar: number | null;
  smallestPotDollars: number | null;
}

export interface AnalysisTableRow {
  status: AnalysisRunStatus;
  finishedAt: string | null;
  optionLastDate: string | null;
  formulasVersion: number;
  outOfDate: boolean;
  tableFigures: AnalysisTableFigures | null;
  figuresFinishedAt: string | null;
}

export interface AnalysesForTable {
  labSavedAt: string;
  /** The tickers Re-run out of date would run. */
  outOfDate: string[];
  bySymbol: Record<string, AnalysisTableRow>;
}

export interface BacktestLabSettingsView extends BacktestSettingsTemplate {
  defaultPotDollars: number;
  updatedAt: string;
}

export interface BacktestLabChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** A change a global save would make: the analysed tickers whose stored analysis it puts out of date. */
export interface BacktestLabChangePreview extends BacktestLabChange {
  outOfDate: string[];
}

export interface BacktestLabAuditRow {
  id: number;
  changedAt: string;
  userDisplayName: string | null;
  /** Null for a global value. */
  symbol: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  /** How many stored analyses the save re-ran; null for ticker saves and older rows. */
  analysesRerun: number | null;
}

export interface AnalysisRerunOutcome {
  started: string[];
  skipped: { symbol: string; reason: string }[];
}

/** What a save of the lab did to the stored analyses: none re-run, those reading a changed value out of date. */
export interface AnalysisLabSaveOutcome {
  markedOutOfDate: string[];
}

const encoded = (symbol: string) => encodeURIComponent(symbol);

export function fetchTickerAnalysis(symbol: string): Promise<TickerAnalysisView> {
  return apiRequest<TickerAnalysisView>(`/backtest/analyses/${encoded(symbol)}`);
}

export function fetchAnalysisFileFigures(symbol: string): Promise<AnalysisFileFigures> {
  return apiRequest<AnalysisFileFigures>(`/backtest/analyses/${encoded(symbol)}/file-figures`);
}

export function fetchAnalysesForTable(): Promise<AnalysesForTable> {
  return apiRequest<AnalysesForTable>("/backtest/analyses");
}

/** Starts a saved analysis of every ticker whose stored one is out of date. */
export function rerunOutOfDateAnalyses(): Promise<AnalysisRerunOutcome> {
  return apiRequest<AnalysisRerunOutcome>("/backtest/analyses/rerun-out-of-date", { method: "POST" });
}

export function startTickerAnalysis(symbol: string, values?: AnalysisTrialValues): Promise<AnalysisRunView> {
  return apiRequest<AnalysisRunView>(`/backtest/analyses/${encoded(symbol)}`, { method: "POST", body: JSON.stringify(values === undefined ? {} : { values }) });
}

export function cancelTickerAnalysis(analysisId: string): Promise<AnalysisRunView> {
  return apiRequest<AnalysisRunView>(`/backtest/analyses/runs/${encoded(analysisId)}/cancel`, { method: "POST" });
}

export function fetchBacktestSessionPriceChart(sessionId: string, symbol: string): Promise<BacktestSessionPriceChart> {
  return apiRequest<BacktestSessionPriceChart>(`/backtest/sessions/${encodeURIComponent(sessionId)}/price-chart?symbol=${encoded(symbol)}`);
}

export function fetchAnalysisSessions(symbol: string): Promise<AnalysisSessionRow[]> {
  return apiRequest<AnalysisSessionRow[]>(`/backtest/analyses/${encoded(symbol)}/sessions`);
}

export function fetchAnalysisEarnings(symbol: string): Promise<{ written: number; run: AnalysisRunView }> {
  return apiRequest<{ written: number; run: AnalysisRunView }>(`/backtest/analyses/${encoded(symbol)}/fetch-earnings`, { method: "POST" });
}

export function fetchBacktestLabSettings(): Promise<BacktestLabSettingsView> {
  return apiRequest<BacktestLabSettingsView>("/backtest/lab-settings");
}

export function saveBacktestLabSettings(body: { overrides?: unknown; defaultPotDollars?: number }): Promise<{ settings: BacktestLabSettingsView; changes: BacktestLabChange[]; analyses: AnalysisLabSaveOutcome }> {
  return apiRequest(`/backtest/lab-settings`, { method: "PUT", body: JSON.stringify(body) });
}

/** The save's confirmation: the same body as the save, nothing written. */
export function previewBacktestLabSettings(body: { overrides?: unknown; defaultPotDollars?: number }): Promise<{ changes: BacktestLabChangePreview[]; outOfDate: string[] }> {
  return apiRequest(`/backtest/lab-settings/preview`, { method: "POST", body: JSON.stringify(body) });
}

/** The global values' history (the lab's own changes), newest first. */
export function fetchBacktestLabGlobalAudit(): Promise<BacktestLabAuditRow[]> {
  return apiRequest<BacktestLabAuditRow[]>("/backtest/lab-settings/audit?symbol=");
}
