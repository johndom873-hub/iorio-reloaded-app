import { apiBaseUrl, apiRequest } from "./client";
import type { BacktestJobView } from "./backtest";

// The lab's portfolio simulator (API src/routes/backtestPortfolioRoutes.ts): the tickers it can pick, how a book's tickers
// move together, its pots, its projection and suggestions streamed over SSE, the suggestions' library and the saved
// portfolios.

export type PortfolioHorizonYears = 3 | 5;
export type PortfolioDrift = "neutral" | "as_it_happened";

export interface PortfolioBookTicker {
  symbol: string;
  /** Null: an equal share of what the set allocations leave. */
  allocationPct: number | null;
}

export interface PortfolioBook {
  tickers: PortfolioBookTicker[];
  accountDollars: number;
  horizonYears: PortfolioHorizonYears;
}

export interface PortfolioTickerListing {
  symbol: string;
  verdict: string | null;
  sector: string | null;
  analysedAt: string | null;
}

export interface PortfolioPairMatrix {
  symbols: string[];
  values: (number | null)[][];
}

export interface PortfolioWarning {
  code: "doesnt_suit" | "lot_too_large" | "group_too_large" | "short_history" | "no_bear_market_in_backtest" | "allocations_not_100";
  symbols: string[];
  text: string;
}

export interface PortfolioSimulation {
  asOf: string;
  book: { accountDollars: number; excessAllowancePct: number; horizonYears: PortfolioHorizonYears; allocationTotalPct: number; tickers: { symbol: string; allocationPct: number; setAllocation: boolean; potDollars: number }[] };
  riskFree: { nowPct: number; averagePct: number };
  tickers: { symbol: string; verdict: string | null; sector: string | null; analysedAt: string | null; beta: number; ownHistoryYears: number; priceAsTraded: number | null }[];
  correlation: PortfolioPairMatrix;
  worstWeeksTogether: PortfolioPairMatrix;
  groups: { symbols: string[]; share: number }[];
  independentTickers: number | null;
  warnings: PortfolioWarning[];
}

export interface PortfolioTickerPot {
  symbol: string;
  allocationPct: number;
  price: number;
  floorPct: number;
  potDollars: number;
  lotDollars: number;
  targetDollars: number;
  lotsAtTarget: number;
  targetReached: number;
  bandDollars: number;
  bandLots: number;
  bandActs: boolean;
  topUpBelowPrice: number | null;
  trimAbovePrice: number | null;
  smallestOneLotPot: number;
  smallestBandActingPot: number;
}

export interface PortfolioPots {
  asOf: string;
  accountDollars: number;
  excessAllowancePct: number;
  firstPositionPct: number;
  rebalanceBandPct: number;
  maxAllocationPct: number;
  pots: PortfolioTickerPot[];
  suggested: { equalSharePct: number; tooLarge: { symbol: string; floorPct: number }[]; floorsOverFull: boolean; unallocatedPct: number; allocationPct: { symbol: string; allocationPct: number }[] };
}

export interface PortfolioPercentiles {
  p10: number;
  p50: number;
  p90: number;
}

export type PortfolioYearSource = "calls" | "puts" | "leaps" | "interest" | "dividends" | "shares";

/** v4's or a buy and hold's figures over the paths (the book or SPY held from today's prices, never traded). */
export interface PortfolioHeldSummary {
  cagr: PortfolioPercentiles;
  maxDrawdown: PortfolioPercentiles;
  /** The lowest daily value ÷ the starting account − 1 (0 when it never went under). */
  lowestAgainstStart: PortfolioPercentiles;
  lowestAgainstStartAtOdds: { oneIn: number; lowestAgainstStart: number }[];
  yearEnds: { year: number; value: PortfolioPercentiles }[];
}

export interface PortfolioProjectionSummary {
  pathCount: number;
  cagr: PortfolioPercentiles;
  maxDrawdown: PortfolioPercentiles;
  excessCalmar: PortfolioPercentiles;
  drawdownAtOdds: { oneIn: number; maxDrawdown: number }[];
  averageYear: Record<PortfolioYearSource, { dollars: number; share: number }>;
  yearEnds: { year: number; value: PortfolioPercentiles }[];
  tickers: { symbol: string; premiumYear: number; callsSoldYear: number; callAwaysYear: number; daysWithoutSharesShare: number }[];
  bookBeta: { all: number; down: number } | null;
  v4: PortfolioHeldSummary;
  heldBook: PortfolioHeldSummary;
  heldSpy: PortfolioHeldSummary | null;
}

export interface PortfolioProjection {
  asOf: string;
  horizonYears: PortfolioHorizonYears;
  drift: PortfolioDrift;
  accountDollars: number;
  riskFree: { nowPct: number; averagePct: number };
  history: { from: string; to: string; days: number };
  summary: PortfolioProjectionSummary;
  pots: PortfolioTickerPot[];
  tickers: {
    symbol: string;
    allocationPct: number;
    price: number;
    strikeSpacing: number;
    expiryWeekdays: number[];
    beta: number;
    ownHistoryFrom: string | null;
    /** The ticker whose real moves fill the days before its own, × their volatility ratio. */
    standIn: { symbol: string; volatilityRatio: number } | null;
    /** Today's 30-day IV ÷ its 4-year median; null without today's IV. */
    ivNowAgainstNormal: number | null;
    ivHalfLifeSessions: number;
    eventFactors: { macro: number; earningsReaction: number };
    tenOclockFrom: string | null;
    chainDays: number;
    businessChange: { symbol: string; currentBusinessFrom: string; before: string } | null;
    dividendYield: number | null;
    ownDrawdownAtOdds: { oneIn: number; maxDrawdown: number }[] | null;
  }[];
  ownDrawdowns: { libraryAsOf: string; staleSymbols: string[] } | null;
  replays: { name: string; from: string; to: string; days: number; bookReturn: number; maxDrawdown: number; spyReturn: number }[];
  pathFigures: { cagr: number[]; maxDrawdown: number[] };
  savedAt: string | null;
}

export interface PortfolioChangeWithPlusMinus {
  change: number;
  plusMinus: number;
}

export interface PortfolioBookFigures {
  cagr: number;
  maxDrawdown: number;
  excessCalmar: number;
}

export interface PortfolioScoredChange {
  score: PortfolioChangeWithPlusMinus;
  cagr: PortfolioChangeWithPlusMinus;
  maxDrawdown: PortfolioChangeWithPlusMinus;
  withinNoise: boolean;
}

export interface PortfolioSuggestion extends PortfolioScoredChange {
  kind: "drop" | "add" | "halve" | "double";
  symbol: string;
  allocationsPct: Record<string, number>;
  figures: PortfolioBookFigures;
  exact: (PortfolioScoredChange & { figures: PortfolioBookFigures }) | null;
}

export interface PortfolioSuggestions {
  library: { asOf: string; builtAt: string; staleReasons: string[] };
  book: PortfolioBookFigures;
  bookExact: PortfolioBookFigures | null;
  suggestions: PortfolioSuggestion[];
}

export interface PortfolioLibraryStatus {
  built: { asOf: string; builtAt: string; tickers: number; failed: Record<string, string> } | null;
  current: boolean | null;
  updatedSince: string[];
  rebuild: BacktestJobView | null;
}

export interface SavedPortfolio {
  id: string;
  name: string;
  tickers: PortfolioBookTicker[];
  accountDollars: number;
  createdAt: string;
  updatedAt: string;
}

export type SavedPortfolioInput = Pick<SavedPortfolio, "name" | "tickers" | "accountDollars">;

export async function fetchPortfolioTickers(): Promise<PortfolioTickerListing[]> {
  return (await apiRequest<{ tickers: PortfolioTickerListing[] }>("/backtest/portfolio/tickers")).tickers;
}

export function simulatePortfolio(book: PortfolioBook): Promise<PortfolioSimulation> {
  return apiRequest("/backtest/portfolio/simulate", { method: "POST", body: JSON.stringify(book) });
}

export function fetchPortfolioPots(book: PortfolioBook): Promise<PortfolioPots> {
  return apiRequest("/backtest/portfolio/pots", { method: "POST", body: JSON.stringify(book) });
}

export function fetchPortfolioLibraryStatus(): Promise<PortfolioLibraryStatus> {
  return apiRequest("/backtest/portfolio/library");
}

export function rebuildPortfolioLibrary(): Promise<{ jobId: string }> {
  return apiRequest("/backtest/portfolio/library/rebuild", { method: "POST" });
}

export async function fetchSavedPortfolios(): Promise<SavedPortfolio[]> {
  return (await apiRequest<{ portfolios: SavedPortfolio[] }>("/backtest/portfolio/portfolios")).portfolios;
}

export function createSavedPortfolio(input: SavedPortfolioInput): Promise<SavedPortfolio> {
  return apiRequest("/backtest/portfolio/portfolios", { method: "POST", body: JSON.stringify(input) });
}

export function updateSavedPortfolio(id: string, input: SavedPortfolioInput): Promise<SavedPortfolio> {
  return apiRequest(`/backtest/portfolio/portfolios/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteSavedPortfolio(id: string): Promise<void> {
  return apiRequest(`/backtest/portfolio/portfolios/${id}`, { method: "DELETE" });
}

export interface PortfolioStreamHandlers<Result> {
  onProgress: (done: number, total: number, label?: string) => void;
  onResult: (result: Result) => void;
  onFailure: (message: string) => void;
  /** Suggestions so far (the suggestions stream only). */
  onSuggestions?: (suggestions: PortfolioSuggestions) => void;
}

/** Opens one of the simulator's event streams with the book as JSON in ?book=; the returned function stops it. */
function openPortfolioStream<Result>(path: string, book: unknown, handlers: PortfolioStreamHandlers<Result>): () => void {
  let source: EventSource | null = null;
  let finished = false;
  // One tick later, so StrictMode's mount → unmount → mount never opens it twice.
  const timer = setTimeout(() => {
    source = new EventSource(`${apiBaseUrl}${path}?book=${encodeURIComponent(JSON.stringify(book))}`, { withCredentials: true });
    const parse = (event: Event) => JSON.parse((event as MessageEvent<string>).data) as unknown;
    source.addEventListener("progress", (event) => {
      const progress = parse(event) as { done: number; total: number; label?: string };
      handlers.onProgress(progress.done, progress.total, progress.label);
    });
    source.addEventListener("suggestions", (event) => handlers.onSuggestions?.(parse(event) as PortfolioSuggestions));
    source.addEventListener("result", (event) => {
      finished = true;
      source?.close();
      handlers.onResult(parse(event) as Result);
    });
    source.addEventListener("failure", (event) => {
      finished = true;
      source?.close();
      handlers.onFailure((parse(event) as { error: string }).error);
    });
    source.onerror = () => {
      if (finished) return;
      finished = true;
      source?.close();
      handlers.onFailure("The connection to the API was lost: run it again.");
    };
  }, 0);
  return () => {
    finished = true;
    clearTimeout(timer);
    source?.close();
  };
}

export function openPortfolioProjectionStream(request: PortfolioBook & { drift: PortfolioDrift; pathCount: number }, handlers: PortfolioStreamHandlers<PortfolioProjection>): () => void {
  return openPortfolioStream("/backtest/portfolio/projection/stream", request, handlers);
}

export function openPortfolioSuggestionsStream(book: PortfolioBook, handlers: PortfolioStreamHandlers<PortfolioSuggestions>): () => void {
  return openPortfolioStream("/backtest/portfolio/suggestions/stream", book, handlers);
}
