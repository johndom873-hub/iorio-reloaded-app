import type { BookKey, BookSelection } from "./books";
import { apiRequest } from "./client";
import type { CycleBucketKey } from "./positions";

// The P&L Analyser (API lib/pnlAnalysis.ts, formulas approved by Marcelo 2026-11-13): every book's figures over a range of
// nights, from the nightly attribution. A range runs from its baseline night (the last close before its first day) to its
// last night; Pluto's and Manual's start no earlier than the books' first night.

export type AnalysisBook = BookSelection;
export type CashComponent = "dividends" | "interest" | "fees" | "otherCash";

/** A figure held back until it has enough history: value null with how much it has and needs. */
export interface GatedFigure {
  value: number | null;
  have: number;
  need: number;
  unit: "calendar days" | "daily returns";
}

export interface GatedTradeFigure {
  value: number | null;
  have: number;
  need: number;
}

export interface DrawdownFigure {
  percent: number;
  dollars: number;
  peakNight: string | null;
  troughNight: string | null;
  recoveryNight: string | null;
  lengthDays: number;
}

export interface RiskSeriesPoint {
  night: string;
  pnl: number;
  cumulativePnl: number;
  growthIndex: number;
  drawdownPercent: number;
}

export interface BookRiskFigures {
  baselineNight: string;
  lastNight: string;
  calendarDays: number;
  dailyReturnCount: number;
  pnl: number;
  returnPercent: number | null;
  cagrPercent: GatedFigure;
  maxDrawdown: DrawdownFigure;
  currentDrawdownPercent: number;
  volatilityPercent: GatedFigure;
  sharpe: GatedFigure;
  sortino: GatedFigure;
  excessCalmar: GatedFigure;
  treasuryBillPercent: number | null;
  bestDay: { night: string; returnPercent: number } | null;
  worstDay: { night: string; returnPercent: number } | null;
  positiveDaysPercent: number | null;
  series: RiskSeriesPoint[];
}

export interface TradeStats {
  closedCount: number;
  winRatePercent: GatedTradeFigure;
  profitFactor: GatedTradeFigure;
  premiumCapturePercent: GatedTradeFigure;
  assignmentRatePercent: GatedTradeFigure | null;
  calledAwayRatePercent: GatedTradeFigure | null;
  averageDaysHeld: GatedTradeFigure;
}

export interface BucketChange {
  premiumGross: number;
  stockGross: number;
  commissions: number;
  total: number;
  unrealizedChange: number;
  capitalDays: number;
  flaggedChange: number;
}

export interface NightFigures {
  night: string;
  bookPnl: number | null;
  /** Null when the night's attribution was not computed. */
  buckets: Record<CycleBucketKey, BucketChange> | null;
  cash: Record<CashComponent, number>;
  ibkrValuationDifference: number | null;
  unexplained: number | null;
}

export interface TickerRangeRow extends BucketChange {
  tickerId: string;
  symbol: string;
  book: BookKey;
  bucket: CycleBucketKey;
  flagReasons: string[];
}

export interface TickerCashRow {
  symbol: string;
  book: BookKey | null;
  component: CashComponent;
  amount: number;
}

export interface BookAnalysis {
  risk: BookRiskFigures | null;
  tradeStats: { csp: TradeStats; cc: TradeStats; both: TradeStats } | null;
  nights: NightFigures[];
  tickers: TickerRangeRow[];
  tickerCash: TickerCashRow[];
  missingAttributionNights: string[];
}

export interface PnlAnalysis {
  firstNight: string | null;
  lastNight: string | null;
  booksFirstNight: string | null;
  range: { baselineNight: string; lastNight: string } | null;
  books: Record<AnalysisBook, BookAnalysis>;
  cyclesBySymbol: Record<string, { inRange: number; hasOpenCycle: boolean }>;
}

export interface TickerCycleRow extends BucketChange {
  cycleStartedAt: string;
  cycleEndedAt: string | null;
  status: "open" | "closed";
  book: BookKey;
  bucket: CycleBucketKey;
  flagReasons: string[];
}

export interface TickerCycleAnalysis {
  symbol: string;
  range: { baselineNight: string; lastNight: string } | null;
  rows: TickerCycleRow[];
}

/** A range's first and last day (YYYY-MM-DD, inclusive); null = from the first night, or to the last. */
export interface AnalysisDays {
  from: string | null;
  to: string | null;
}

function rangeQuery(days: AnalysisDays): string {
  const parameters = new URLSearchParams();
  if (days.from) parameters.set("from", days.from);
  if (days.to) parameters.set("to", days.to);
  return parameters.toString();
}

export function fetchPnlAnalysis(days: AnalysisDays): Promise<PnlAnalysis> {
  const query = rangeQuery(days);
  return apiRequest<PnlAnalysis>(`/pnl-analysis${query ? `?${query}` : ""}`);
}

export function fetchTickerCycles(symbol: string, book: AnalysisBook, days: AnalysisDays): Promise<TickerCycleAnalysis> {
  const parameters = new URLSearchParams(rangeQuery(days));
  parameters.set("symbol", symbol);
  parameters.set("book", book);
  return apiRequest<TickerCycleAnalysis>(`/pnl-analysis/ticker-cycles?${parameters.toString()}`);
}
