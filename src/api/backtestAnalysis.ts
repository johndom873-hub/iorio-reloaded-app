import { apiRequest } from "./client";
import type { BacktestDetectedSplit, BacktestMetrics, BacktestSettingsTemplate, BacktestTickerProfile, BacktestTickerSuitability } from "./backtest";

// The Analyse window (Backtesting → Data files) and the lab settings it reads. Mirrors the API's src/backtest/analysis/
// (analysisFigures.ts, analysisStore.ts, analysisBacktest.ts, analysisSummary.ts, analysisSessions.ts) and
// labSettingsStore.ts; keep them in step. Ratios are fractions (0.418 = 41.8%).

export type AnalysisStep = "bars" | "chains" | "earnings_correlation" | "saving" | "backtest" | "summary";
export const analysisSteps: readonly AnalysisStep[] = ["bars", "chains", "earnings_correlation", "saving", "backtest", "summary"];
export const analysisStepLabels: Record<AnalysisStep, string> = {
  bars: "Reading the daily bars",
  chains: "Scanning the chains",
  earnings_correlation: "Earnings and correlations",
  saving: "Saving the figures",
  backtest: "Running the backtest",
  summary: "Writing the summary",
};

export type AnalysisReason = "manual" | "ticker_settings" | "global_settings" | "trial";
export type AnalysisRunStatus = "queued" | "running" | "stopped" | "succeeded" | "failed" | "cancelled";
export type AnalysisDteRange = "1-7" | "8-14" | "15-30" | "31-45";
export const analysisDteRanges: readonly AnalysisDteRange[] = ["1-7", "8-14", "15-30", "31-45"];
export type AnalysisChainView = "C" | "P" | "Pcap";
/** Every contract, or only those inside the shared |delta| range. */
export type AnalysisDeltaFilter = "any" | "band";
type AnalysisChainGrid = Record<AnalysisChainView, Record<string, Record<AnalysisDteRange, AnalysisGridCell>>>;
export type AnalysisPriceRange = "All" | "10Y" | "5Y" | "2Y" | "1Y";

/** Run with these values: the settings panel's values over the ticker's lab values. ladderShockPct null = the shock rule. */
export interface AnalysisTrialValues {
  potDollars?: number;
  ladderSharesPct?: number;
  ladderRungs?: number;
  ladderShockPct?: number | null;
  minAbsDelta?: number;
  maxAbsDelta?: number;
  minDte?: number;
  maxDte?: number;
  maxSpreadPctOfMid?: number;
}

/** The baseline values the analysis reads (a subset of the API's BacktestBaselineSettings). */
export interface AnalysisBaselineValues {
  minAbsDelta: number;
  maxAbsDelta: number;
  minDte: number;
  maxDte: number;
  maxSpreadPctOfMid: number;
  ladderSharesPct: number;
  ladderRungs: number;
  ladderShock: "history" | "fixed";
  ladderShockPct: number;
  ladderShockMinPct: number;
  ladderShockMaxPct: number;
  ladderShockNoHistoryPct: number;
  ladderShockLookbackYears: number;
  [key: string]: unknown;
}

export interface BacktestLabTickerOverrides {
  symbol: string;
  potDollars: number | null;
  ladderSharesPct: number | null;
  ladderRungs: number | null;
  /** A fixed shock instead of the global shock rule. */
  ladderShockPct: number | null;
  minAbsDelta: number | null;
  maxAbsDelta: number | null;
  updatedAt: string;
}

export type BacktestLabTickerField = Exclude<keyof BacktestLabTickerOverrides, "symbol" | "updatedAt">;

export interface AnalysisLabValues {
  settings: { baseline?: AnalysisBaselineValues; trading: { spreadCostChargedPct: number } & Record<string, unknown> } & Record<string, unknown>;
  defaultPotDollars: number;
  tickerOverrides: Omit<BacktestLabTickerOverrides, "updatedAt"> | null;
  trial: AnalysisTrialValues | null;
  effective: { potDollars: number; baseline: AnalysisBaselineValues; spreadShareCharged: number };
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
  summaryStatus: "pending" | "written" | "not_configured" | "usage_limit" | "failed" | "skipped";
  summaryError: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AnalysisGridCell {
  days: number;
  daysWithPassing: number;
  medianPassingPerDay: number;
  medianBestYield: number | null;
  pooledMedianYield: number | null;
}

export interface AnalysisMonthRow {
  month: string;
  days: number;
  callsMedian: number;
  putsMedian: number;
  cappedPutsMedian: number;
  totalMedian: number;
  cappedTotalMedian: number;
}

export interface AnalysisChainMapContract {
  right: "C" | "P";
  expiry: string;
  strike: number;
  dte: number;
  bid: number;
  ask: number;
  previousVolume: number;
  delta: number | null;
  yieldAtMid: number | null;
}

/** The Options volume and Open interest tiles: every contract in the file; "capped Puts" are those at or under the day's first-rung cap. */
export interface AnalysisOptionActivity {
  volume: { sessions: number; fromDate: string; toDate: string; averagePerDay: number; callShare: number | null; cappedPutsAveragePerDay: number | null; yearSessions: number; yearAveragePerDay: number } | null;
  openInterest: { date: string; total: number; callShare: number | null; cappedPuts: number | null } | null;
}

export interface AnalysisCappedPut {
  strike: number;
  expiry: string;
  dte: number;
  premiumYield: number;
  delta: number;
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

export interface AnalysisTooLargeYear {
  saleDays: number;
  callDaysOverOneStrike: number;
  putDaysOverOneStrike: number;
  medianYieldGivenUp: number | null;
  callDaysPartlyUnsold: number;
  putDaysPartlyUnsold: number;
}

export interface AnalysisBacktestFigures {
  sessionId: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  metrics: BacktestMetrics | null;
  buyAndHoldMetrics: BacktestMetrics | null;
  orderCount: number;
  saleDays: number;
  ordersOverOneStrike: number;
  ordersPartlyUnsold: number;
  byYear: Record<string, AnalysisTooLargeYear>;
  /** [date, right, yield given up (null when one strike), contracts unsold]. */
  tooLargeDays: [string, "C" | "P", number | null, number][];
  /** [date, the pot the ladder sizes from: max(account at the open cycle's start, last night's account)]. Absent before formulas version 5. */
  potPath?: [string, number][];
  /**
   * Each day the cycle held shares (the day's first look, before its orders), split-adjusted: [date, the next ladder Put's
   * cap (null: none fits), the floor, why no ladder Put could be sold (null: one could)]. Absent before formulas version 6.
   */
  ladderLevels?: [string, number | null, number | null, AnalysisLadderPutBlock | null][];
  /**
   * Each rung sold, split-adjusted: [date, its highest strike, its fills [strike, expiry, contracts], the rung it reaches
   * [its number, the ticker's rungs, the reserve's slices it fills up to, the reserve committed before it in dollars] (null
   * when its sale recorded no reserve; absent in figures stored before it)]. Absent before formulas version 6.
   */
  ladderRungsSold?: [string, number, [number, string, number][], ([number, number, number, number] | null)?][];
  /** The whole account's free cash each day at its 10:00 marks: [date, free cash, cash locked in open puts, account value]; read from the session when the analysis opens. */
  cashAvailable?: [string, number, number, number][];
}

/**
 * A session's "Price and Max drawdown" chart: the symbol's IBKR daily bars over the session's period (split-adjusted), the
 * Max drawdown of each range in it, and that session's ladder levels, rungs sold and orders over one strike.
 */
export interface BacktestSessionPriceChart {
  symbol: string;
  bars: AnalysisFigures["bars"];
  maxDrawdown: AnalysisFigures["maxDrawdown"];
  /** One per bar, worked out over the whole data file, so the session's first day has its look-back. */
  barIndicators: AnalysisBarIndicators;
  ladderLevels: NonNullable<AnalysisBacktestFigures["ladderLevels"]>;
  ladderRungsSold: NonNullable<AnalysisBacktestFigures["ladderRungsSold"]>;
  tooLargeDays: AnalysisBacktestFigures["tooLargeDays"];
  /** The whole account's free cash each day at its 10:00 marks (every symbol's in a session of several). */
  cashAvailable: NonNullable<AnalysisBacktestFigures["cashAvailable"]>;
  /** The symbol's splits in the session's period: the bars before one are its traded prices ÷ the ratio. */
  splits: BacktestDetectedSplit[];
}

/** The price chart's indicators for each bar (approved 2026-10-26), aligned with the bars. */
export interface AnalysisBarIndicators {
  /** [share, bars at or below, bars with an IV]: of the last 252 bars, those whose IV was at or below the bar's ÷ those with one; null without an IV or under 20 in the window. */
  ivPercentile: ([number, number, number] | null)[];
  /** The average of the last 50 / 200 closes, the bar's own included; null until that many closes. */
  movingAverage50: (number | null)[];
  movingAverage200: (number | null)[];
}

/** Why no ladder Put could be sold at a day's first look. */
export type AnalysisLadderPutBlock = "ladder_puts_off" | "every_lot_has_a_call" | "a_put_is_open" | "no_cap";

/** The formulas version whose figures carry each day's largest-pot contracts and the backtest's pot path. */
export const analysisEveryDayPotFormulasVersion = 5;

/** The formulas version whose analysis backtests carry the ladder's daily cap and floor and the rungs sold. */
export const analysisLadderLevelsFormulasVersion = 6;

/** [date, price, shock, the ladder Put's volume limit, its strike, the entry Call's volume limit, the ladder Put's previous-session volume (since 2026-10-19)]. */
export type AnalysisFitDayRow = [string, number, number, (number | null)?, (number | null)?, (number | null)?, (number | null)?];

export interface AnalysisFigures {
  formulasVersion: number;
  symbol: string;
  optionLastDate: string;
  barsLastDate: string | null;
  /** [date, open, high, low, close, implied volatility]. */
  bars: [string, number, number, number, number, number | null][];
  yangZhang21: (number | null)[];
  /** Added when the figures are read; absent from an API older than 2026-10-26. */
  barIndicators?: AnalysisBarIndicators;
  volatility: {
    impliedNow: number | null;
    yangZhang21Now: number | null;
    yangZhang63Now: number | null;
    impliedVersusRealised: { all: AnalysisIvPremiumStats; lastYear: AnalysisIvPremiumStats; byYear: Record<string, AnalysisIvPremiumStats> };
  };
  maxDrawdown: Record<AnalysisPriceRange, AnalysisMaxDrawdown | null>;
  shock: { startDate: string; windowFrom: string; closes: number; maxDrawdown: number | null; shock: number; rule: "history" | "fixed" };
  chains: {
    /** At the lab's |delta| rules. */
    grid: AnalysisChainGrid;
    /** Absent on analyses computed before 2026-10-19. */
    gridByDelta?: Record<AnalysisDeltaFilter, AnalysisChainGrid>;
    years: Record<string, { from: string; to: string }>;
    monthly: AnalysisMonthRow[];
    daysWithoutPrice: number;
    daysWithNothingPassing: string[];
    spreadShareUnder25: number | null;
    spreadShareUnder25ByDelta?: Record<AnalysisDeltaFilter, number | null>;
    lastDay: { date: string; spot: number | null; shock: number; cap: number | null; bestCappedPut: AnalysisCappedPut | null; /** Absent on analyses computed before 2026-10-19. */ bestEntryCall?: AnalysisCappedPut | null; passingCalls: number; passingPuts: number; passingCappedPuts: number } | null;
    chainMap: AnalysisChainMapContract[];
    scanSeconds: number;
  };
  /**
   * [date, the 10:00 price as traded, that day's shock, the best capped Put's volume limit, its strike, the best entry
   * Call's volume limit] (null when no contract passed; the last three absent before formulas version 5).
   */
  fitDays: AnalysisFitDayRow[];
  /** The largest pot's contracts were chosen without the lab's volatility-edge filter or Edge Yield ranking. */
  largestPotWithoutModel?: boolean;
  /** Options volume and open interest; absent on analyses computed before 2026-10-19, null when the file couldn't be read. */
  optionActivity?: AnalysisOptionActivity | null;
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
  profile: { all: AnalysisProfile | null; twoYear: AnalysisProfile | null };
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
    schemaVersion: string | null;
    maxDte: string | null;
    barsFetchedAt: string | null;
    bars: { count: number; firstDate: string | null; lastDate: string | null; source: "file" | "database" | null };
    impliedVolatility: { count: number; firstDate: string | null };
    tenOclockBars: number | null;
    splits: { fromDateIso: string; toDateIso: string; factor: number }[] | null;
    barChecks: { bigMoves: [string, number][]; gaps: [string, string][]; flatRuns: [string, string, number][] };
    sizeBytes: number;
    scannedDays: number;
    daysWithoutPrice: number;
    daysWithNothingPassing: string[];
  };
  analysisBacktest: AnalysisBacktestFigures | { error: string } | null;
}

/** The figures the data file gives on its own, without the chain scan or the analysis backtest: the window before a ticker's first analysis. */
export type AnalysisFileFigures = Omit<AnalysisFigures, "chains" | "fitDays" | "largestPotWithoutModel" | "analysisBacktest" | "dataQuality"> & { dataQuality: Omit<AnalysisFigures["dataQuality"], "scannedDays" | "daysWithoutPrice" | "daysWithNothingPassing"> };

export type AnalysisRecommendationKey = "potDollars" | "ladderSharesPct" | "ladderRungs" | "ladderShockPct" | "minAbsDelta" | "maxAbsDelta" | "minDte" | "maxDte" | "maxSpreadPctOfMid";

export interface AnalysisSummary {
  headline: string;
  paragraphs: string[];
  caveats: string[];
  recommendation: {
    verdict: "qualifies" | "borderline" | "does_not_qualify";
    verdictReason: string;
    values: { key: AnalysisRecommendationKey; value: number | null; reason: string }[];
  };
}

export type StoredAnalysis = AnalysisRunView & { figures: AnalysisFigures | null; summary: AnalysisSummary | null };

export interface TickerAnalysisView {
  symbol: string;
  stored: StoredAnalysis | null;
  trial: StoredAnalysis | null;
  active: AnalysisRunView[];
  latestProblem: AnalysisRunView | null;
  currentHash: string;
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
  symbols: string[];
  sharesPct: number | null;
  rungs: number | null;
  ladder: boolean;
  cagr: number;
  maxDrawdown: number;
  totalReturn: number;
  buyAndHoldCagr: number | null;
  buyAndHoldMaxDrawdown: number | null;
  excessCalmar: number | null;
  createdAt: string;
  isAnalysis: boolean;
}

export interface AnalysisFileStatus {
  status: AnalysisRunStatus;
  finishedAt: string | null;
  optionLastDate: string | null;
  labValuesHash: string;
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

/** A change a global save would make: the analysed tickers it re-runs and the tickers whose own value keeps it from them. */
export interface BacktestLabChangePreview extends BacktestLabChange {
  reruns: string[];
  keptOverrides: string[];
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

const encoded = (symbol: string) => encodeURIComponent(symbol);

export function fetchTickerAnalysis(symbol: string): Promise<TickerAnalysisView> {
  return apiRequest<TickerAnalysisView>(`/backtest/analyses/${encoded(symbol)}`);
}

export function fetchAnalysisFileFigures(symbol: string): Promise<AnalysisFileFigures> {
  return apiRequest<AnalysisFileFigures>(`/backtest/analyses/${encoded(symbol)}/file-figures`);
}

export function fetchAnalysisFileStatuses(): Promise<Record<string, AnalysisFileStatus>> {
  return apiRequest<Record<string, AnalysisFileStatus>>("/backtest/analyses");
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

export function saveBacktestLabSettings(body: { overrides?: unknown; defaultPotDollars?: number }): Promise<{ settings: BacktestLabSettingsView; changes: BacktestLabChange[]; analyses: AnalysisRerunOutcome }> {
  return apiRequest(`/backtest/lab-settings`, { method: "PUT", body: JSON.stringify(body) });
}

/** The save's confirmation: the same body as the save, nothing written. */
export function previewBacktestLabSettings(body: { overrides?: unknown; defaultPotDollars?: number }): Promise<{ changes: BacktestLabChangePreview[]; reruns: string[] }> {
  return apiRequest(`/backtest/lab-settings/preview`, { method: "POST", body: JSON.stringify(body) });
}

/** The global values' history (the lab's own changes), newest first. */
export function fetchBacktestLabGlobalAudit(): Promise<BacktestLabAuditRow[]> {
  return apiRequest<BacktestLabAuditRow[]>("/backtest/lab-settings/audit?symbol=");
}

export function fetchAllLabTickerOverrides(): Promise<BacktestLabTickerOverrides[]> {
  return apiRequest<BacktestLabTickerOverrides[]>("/backtest/lab-ticker-overrides");
}

export function fetchLabTickerOverrides(symbol: string): Promise<{ symbol: string; overrides: BacktestLabTickerOverrides | null }> {
  return apiRequest(`/backtest/lab-ticker-overrides/${encoded(symbol)}`);
}

/** Each field a number, or null for the global value again. */
export function saveLabTickerOverrides(symbol: string, values: Partial<Record<BacktestLabTickerField, number | null>>): Promise<{ overrides: BacktestLabTickerOverrides | null; changes: BacktestLabChange[]; analyses: AnalysisRerunOutcome }> {
  return apiRequest(`/backtest/lab-ticker-overrides/${encoded(symbol)}`, { method: "PUT", body: JSON.stringify(values) });
}
