import { apiRequest } from "./client";
import type { PlutoSettings } from "./pluto";
import type { TradingSettingsInput } from "./riskLimits";

// Backtesting (local only: the API mounts these routes only where BACKTEST_DATA_DIR is set). Types mirror the API's
// src/backtest/backtestTypes.ts; figures are defined in the API's docs/backtesting/FORMULAS.md. Ratios are fractions
// (0.418 = +41.8%).

export type BacktestJobKind = "download" | "backtest";
export type BacktestJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
/** What the screen shows: a running job with a heartbeat older than 60 s is "stopped". */
export type BacktestJobDisplayStatus = BacktestJobStatus | "stopped";
export type BacktestTablesMode = "walk_forward" | "current";

/** Settings frozen with a session. `trading` leaves out the commission estimator (the flat commission applies). */
export interface BacktestSettings {
  pluto: PlutoSettings;
  trading: TradingSettingsInput;
  /** Share of full Kelly used to size (Pluto's fixed constant is 0.25). */
  kellyFraction: number;
}

export interface BacktestSettingsOverrides {
  pluto?: Partial<PlutoSettings>;
  trading?: Partial<TradingSettingsInput>;
  kellyFraction?: number;
}

export interface BacktestJobView {
  id: string;
  kind: BacktestJobKind;
  symbol: string;
  sessionId: string | null;
  sessionName: string | null;
  status: BacktestJobStatus;
  displayStatus: BacktestJobDisplayStatus;
  progressDone: number;
  progressTotal: number;
  progressLabel: string | null;
  /** Seconds left at the recent pace; null until it can be estimated. */
  etaSeconds: number | null;
  /** Total run time so far (a resumed download adds its earlier runs; a resumed backtest starts again); null if it never ran. */
  runSeconds: number | null;
  heartbeatAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** A split the engine found by comparing the options' closing parity price with IBKR's split-adjusted close. */
export interface BacktestDetectedSplit {
  /** The last file day on the old scale. */
  lastDayBefore: string;
  /** The first file day on the new scale. */
  firstDayAfter: string;
  /** New shares per old share: 10 = a 10-for-1 split, 0.1 = a 1-for-10 reverse split. */
  ratio: number;
}

export interface BacktestDataFileSummary {
  symbol: string;
  /** Splits found in the file's period; null until the file has been analysed (after a download or a session run). */
  detectedSplits: BacktestDetectedSplit[] | null;
  firstDate: string | null;
  lastDate: string | null;
  /** Days stored with data. */
  completeDays: number;
  /** Weekdays between firstDate and lastDate with no row at all (a gap to fill). */
  missingWeekdays: number;
  sizeBytes: number;
  /** IBKR daily bars in the local DB for the symbol (the forecast and settlement prices). */
  barsFirstDate: string | null;
  barsLastDate: string | null;
}

/** The headline figures (FORMULAS.md). Ratios are fractions (0.418 = +41.8%). */
export interface BacktestMetrics {
  startValue: number;
  endValue: number;
  totalReturn: number;
  cagr: number;
  sortino: number | null;
  maxDrawdown: number;
  worstMonth: number | null;
  tradeCount: number;
  winRate: number | null;
  averageWinDollars: number | null;
  averageLossDollars: number | null;
  edgeCapture: number | null;
  capitalInUse: number;
  returnOnCapitalInUse: number | null;
  inTheMoneyAtExpiryShare: number | null;
  interestDollars: number;
}

export interface BacktestSessionListItem {
  id: string;
  name: string;
  symbol: string;
  startDate: string;
  endDate: string;
  startingValue: number;
  tablesMode: BacktestTablesMode;
  status: BacktestJobStatus;
  overrideCount: number;
  metrics: BacktestMetrics | null;
  createdAt: string;
}

export interface BacktestOverview {
  dataDirectory: string;
  files: BacktestDataFileSummary[];
  jobs: BacktestJobView[];
  sessions: BacktestSessionListItem[];
}

export type BacktestSettingGroup = "Capital and sizing" | "Candidate quality" | "Model";
export type BacktestSettingUnit = "percent" | "number" | "integer" | "dollars" | "grade" | "days";

/** One row of the New session settings table. `path` addresses the value inside BacktestSettings, e.g. "pluto.minEdgeYieldPct". */
export interface BacktestSettingRow {
  path: string;
  group: BacktestSettingGroup;
  label: string;
  unit: BacktestSettingUnit;
  now: number | string;
  editable: boolean;
  note: string | null;
}

export interface BacktestSettingsTemplate {
  settings: BacktestSettings;
  rows: BacktestSettingRow[];
  /** Pluto behaviour a session does not replay, for the note under the table. */
  notReplayed: string[];
}

export interface CreateBacktestSessionRequest {
  name: string;
  symbol: string;
  startDate: string;
  endDate: string;
  startingValue: number;
  tablesMode: BacktestTablesMode;
  overrides: BacktestSettingsOverrides;
}

export interface BacktestSessionDay {
  tradingDate: string;
  accountValue: number;
  cash: number;
  exposureDollars: number;
  interestDollars: number;
  dailyReturn: number | null;
  baselineValue: number;
  baselineDailyReturn: number | null;
  /** Fall from the previous peak, ≤ 0. */
  drawdown: number;
  decisionSummary: string | null;
}

export interface BacktestTrade {
  id: number;
  openedOn: string;
  strategyKey: "cash_secured_put" | "covered_call";
  expiry: string;
  strike: number;
  optionRight: "C" | "P";
  contracts: number;
  bid: number;
  ask: number;
  fillPrice: number;
  commissionDollars: number;
  spotAtOpen: number;
  sharePriceAtOpen: number | null;
  exposureDollars: number;
  dte: number;
  delta: number | null;
  grade: string;
  edgeMargin: number;
  expectedPnlDollars: number;
  calibratedExpectedPnlDollars: number;
  edgeYield: number | null;
  histYield: number | null;
  kellyContracts: number | null;
  stressContracts: number | null;
  settledOn: string | null;
  settlementClose: number | null;
  inTheMoneyAtExpiry: boolean | null;
  pnlDollars: number | null;
}

export interface BacktestMonthlyReturn {
  /** YYYY-MM */
  month: string;
  sessionReturn: number;
  baselineReturn: number;
}

/** Model accuracy: trades grouped by the edge margin at the open (bands of 10 points), predicted vs realized. */
export interface BacktestAccuracyBand {
  label: string;
  tradeCount: number;
  predictedPnlDollars: number;
  calibratedPnlDollars: number;
  realizedPnlDollars: number;
}

export interface BacktestSessionDetail {
  session: BacktestSessionListItem & {
    settingsSnapshot: BacktestSettings;
    overrides: BacktestSettingsOverrides;
    baselineMetrics: BacktestMetrics | null;
    /** Splits inside the session's period (prices were put on each day's traded scale); null before the run analysed them. */
    detectedSplits: BacktestDetectedSplit[] | null;
    dataLastDate: string | null;
    error: string | null;
    finishedAt: string | null;
  };
  job: BacktestJobView | null;
  days: BacktestSessionDay[];
  trades: BacktestTrade[];
  monthlyReturns: BacktestMonthlyReturn[];
  accuracyByMarginBand: BacktestAccuracyBand[];
}

export type BacktestCompareSession = BacktestSessionListItem & { overrides: BacktestSettingsOverrides; baselineMetrics: BacktestMetrics | null };

export interface BacktestCompareCurve {
  key: string;
  label: string;
  points: { tradingDate: string; value: number }[];
}

export interface BacktestCompareResponse {
  sessions: BacktestCompareSession[];
  /** Account value per day for each session id, plus "baseline:<sessionId>" curves for buy and hold. */
  curves: BacktestCompareCurve[];
}

export function fetchBacktestOverview(): Promise<BacktestOverview> {
  return apiRequest<BacktestOverview>("/backtest/overview");
}

/** Queues a download for the symbol from startDate (the API's default start without it) to the last finished session: only days not in the file are fetched. */
export async function startBacktestDownload(request: { symbol: string; startDate?: string }): Promise<void> {
  await apiRequest<unknown>("/backtest/downloads", { method: "POST", body: JSON.stringify(request) });
}

export async function cancelBacktestJob(jobId: string): Promise<void> {
  await apiRequest<unknown>(`/backtest/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function resumeBacktestJob(jobId: string): Promise<void> {
  await apiRequest<unknown>(`/backtest/jobs/${encodeURIComponent(jobId)}/resume`, { method: "POST" });
}

export function fetchBacktestSettingsTemplate(): Promise<BacktestSettingsTemplate> {
  return apiRequest<BacktestSettingsTemplate>("/backtest/settings-template");
}

export function createBacktestSession(request: CreateBacktestSessionRequest): Promise<{ session: BacktestSessionListItem; job: BacktestJobView }> {
  return apiRequest<{ session: BacktestSessionListItem; job: BacktestJobView }>("/backtest/sessions", { method: "POST", body: JSON.stringify(request) });
}

export function fetchBacktestSession(sessionId: string): Promise<BacktestSessionDetail> {
  return apiRequest<BacktestSessionDetail>(`/backtest/sessions/${encodeURIComponent(sessionId)}`);
}

export function fetchBacktestComparison(sessionIds: string[]): Promise<BacktestCompareResponse> {
  return apiRequest<BacktestCompareResponse>(`/backtest/compare?ids=${sessionIds.map(encodeURIComponent).join(",")}`);
}

export async function deleteBacktestSession(sessionId: string): Promise<void> {
  await apiRequest<unknown>(`/backtest/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
