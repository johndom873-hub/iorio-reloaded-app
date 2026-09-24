import { apiRequest } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";

// Signals screen (backend: routes/signals.ts, streams/signalsProducers.ts;
// mockup approved 2026-09-22). Types mirror the API's signalsTypes.ts /
// signalCandidates.ts / signalsRoadmap.ts shapes.

export type SignalStrategyKey = "covered_call" | "cash_secured_put";
export type SignalGrade = "strong" | "good" | "weak" | "avoid";
export type SignalFlag = "earnings_calendar_unresolved" | "outside_fitted_range" | "wide_spread" | "insufficient_cash" | "macro_event_before_expiry";

/** A major US macro release (FOMC, CPI, jobs report, PCE, GDP) the macro_event_before_expiry flag was judged against. */
export interface MacroEvent {
  dateIso: string;
  title: string;
}
export type SignalsUnscoredReason = "no_snapshot" | "no_surface_fit" | "no_forecast" | "suspected_split";
export type SignalsPriceSource = "live" | "frozen" | "snapshot";
/** live = a pooled IBKR line (modal / screen best line), day = the Day Signals refresh loop, snapshot = the 10:00 ET capture. */
export type SignalQuoteSource = "live" | "day" | "snapshot";

export interface SignalCandidate {
  strategyKey: SignalStrategyKey;
  expiry: string;
  strike: number;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  spreadPercent: number;
  surfaceImpliedVolatility: number;
  midImpliedVolatility: number | null;
  forecastVolatility: number;
  edge: number;
  frictionVolatility: number;
  netEdge: number;
  edgeDollars: number;
  vega: number;
  netEdgeAtMid: number;
  edgeDollarsAtMid: number;
  dollarRisk: number;
  riskAdjustedRatio: number;
  riskAdjustedRatioAtMid: number;
  annualizedYield: number;
  uncompensatedSharePercent: number | null;
  quoteSource: SignalQuoteSource;
  /** When the quote behind bid/ask was received (day/live); null for the snapshot. */
  quotedAt: string | null;
  flags: SignalFlag[];
  executable: boolean;
  grade: SignalGrade;
}

// Roll Signals (Formula 3j, approved 2026-09-24): every open short option leg scored as a contract to keep,
// and every (held leg, replacement) pair that passes the lower-delta and credit filters.
export type RollSignalFlag = "near_expiry" | "assignment_risk" | "decayed";
export type HeldLegUnscoredReason = "no_slice" | "no_quote" | "no_forecast";

export interface HeldLegScore {
  legId: string;
  positionId: string;
  strategyKey: SignalStrategyKey;
  expiry: string;
  strike: number;
  right: "C" | "P";
  quantity: number;
  entryPrice: number;
  entryAtIso: string;
  dte: number | null;
  delta: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  surfaceImpliedVolatility: number | null;
  midImpliedVolatility: number | null;
  /** Surface IV minus the forecast: what holding still offers, in annualised volatility. */
  edge: number | null;
  /** Cost of buying the leg back (half-spread + commission over vega), in annualised volatility. */
  frictionVolatility: number | null;
  vega: number | null;
  holdEdgeDollars: number | null;
  closeCostDollars: number | null;
  dollarRisk: number | null;
  quoteSource: SignalQuoteSource | null;
  quotedAt: string | null;
  flags: RollSignalFlag[];
  unscoredReason: HeldLegUnscoredReason | null;
}

export interface RollSignalCandidate {
  legId: string;
  positionId: string;
  strategyKey: SignalStrategyKey;
  quantity: number;
  replacement: SignalCandidate;
  /** netEdge(B) − edge(A) − friction(A), a fraction (0.056 = 5.6 vp). */
  netRollEdge: number;
  netRollEdgeDollarsPerContract: number;
  /** × quantity. */
  netRollEdgeDollars: number;
  /** mid(B) − mid(A), per share; always > 0 (credit rolls only). */
  netCreditPerShare: number;
  /** |delta(B)| − |delta(A)|; never positive (lower-delta filter). */
  deltaChange: number;
  dollarRiskChange: number;
  flags: RollSignalFlag[];
  grade: SignalGrade;
}

export interface ElevatedVolatilityFlag {
  ratio: number;
  threshold: number;
  thresholdSource: "own_p90" | "fixed_fallback";
  elevated: boolean;
}

export type RoadmapStatus = "waiting_on_data" | "waiting_on_sign_off" | "waiting_on_decision" | "waiting_on_later_phase" | "waiting_on_build" | "waiting_on_next_run";
export interface RoadmapProgress {
  have: number;
  need: number;
  unit: string;
}
export type RoadmapEta = { kind: "date"; dateIso: string; progress: RoadmapProgress } | { kind: "text"; text: string; progress?: RoadmapProgress };
export interface RoadmapItem {
  id: string;
  title: string;
  summary: string;
  needs: string;
  status: RoadmapStatus;
  eta: RoadmapEta;
}

export interface TickerSignals {
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  snapshotDateIso: string | null;
  snapshotCapturedAt: string | null;
  spotPrice: number | null;
  priceSource: SignalsPriceSource;
  previousClose: { close: number; dateIso: string } | null;
  dayChangePercent: number | null;
  candidates: SignalCandidate[];
  best: SignalCandidate | null;
  gradeCounts: Record<SignalGrade, number>;
  heldLegs: HeldLegScore[];
  rolls: RollSignalCandidate[];
  bestRoll: RollSignalCandidate | null;
  /** Held legs with at least one roll graded above Avoid: what the screen badge counts. */
  rollCount: number;
  fittedSliceCount: number;
  totalSliceCount: number;
  momentum: number | null;
  skew: { skew: number; daysToExpiry: number } | null;
  elevatedVolatility: ElevatedVolatilityFlag | null;
  nextEarningsDateIso: string | null;
  macroEvents: MacroEvent[];
  atmImpliedVolatility: number | null;
  forecast: { volatility: number; windowDays: number } | null;
  dailyBarCount: number;
  dividendCadenceUnknown: boolean;
  caveats: RoadmapItem[];
  freeShares: number;
  freeCash: number;
  /** Age range of the Day Signals quotes merged into this ticker's scoring. */
  dayQuotesAsOf: { oldest: string; newest: string; count: number } | null;
  /** Formula 3h per expiry: the parallel IV shift applied (volatility points) and the fresh quotes it came from. */
  ivShiftByExpiry: Record<string, { shiftVolatilityPoints: number; quoteCount: number }>;
  quoteSourceCounts: Record<SignalQuoteSource, number>;
  unscoredReason: SignalsUnscoredReason | null;
}

export type SignalsScreenRow = Omit<TickerSignals, "candidates" | "rolls">;

export interface DaySignalsLoopStatus {
  state: "disabled" | "idle" | "running";
  reason: string;
  stateSince: string;
  tradingDateIso: string | null;
  cycleNumber: number;
  cycleStartedAt: string | null;
  lastCycleDurationMs: number | null;
  contractsInPool: number;
  lastError: string | null;
}

export interface DayQuotesStatus {
  tradingDateIso: string | null;
  quoteCount: number;
  oldestQuotedAt: string | null;
  newestQuotedAt: string | null;
  expiryCount: number;
  tickerCount: number;
}

export interface DayQuotesFrameStatus {
  /** null when the API process is not running the loop (DAY_SIGNALS_LOOP_ENABLED=false). */
  loop: DaySignalsLoopStatus | null;
  status: DayQuotesStatus;
}

export type SviSliceStatus = "ok" | "insufficient_points" | "fit_failed" | "poor_fit" | "butterfly_arbitrage";

/** Raw SVI: w(k) = a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2)); w is total variance (IV^2 * yearsToExpiry). */
export interface RawSviParameters {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SignalSurfaceSliceDroppedCounts {
  inTheMoney: number;
  noTwoSidedQuote: number;
  spreadTooWide: number;
  noImpliedVolatility: number;
}

export interface SignalSurfaceSlice {
  expiry: string;
  status: SviSliceStatus;
  parameters: RawSviParameters | null;
  kMin: number | null;
  kMax: number | null;
  yearsToExpiry: number;
  forwardPrice: number;
  pointCount: number;
  rmseVolatility: number | null;
  minButterflyDensity: number | null;
  droppedCounts: SignalSurfaceSliceDroppedCounts;
  calendarChecks: number;
  calendarViolations: number;
}

/** Single-ticker REST payload only (GET /signals/:symbol) — adds the raw fitted-surface slices for the
 * volatility-surface modal. Not present on SignalsScreenRow: the whole-screen list endpoint doesn't carry
 * every ticker's per-expiry SVI parameters. */
export interface TickerSignalsDetail extends TickerSignals {
  slices: SignalSurfaceSlice[];
}

export interface SignalsScreenFrame {
  type: "signalsScreen";
  at: string;
  rows: SignalsScreenRow[];
  dayQuotes: DayQuotesFrameStatus;
}

export interface SignalsTickerFrame {
  type: "signalsTicker";
  at: string;
  signals: TickerSignals;
  /** Contract keys (expiry|strike|right) with a live IBKR quote subscription for this stream's life. */
  liveQuoteContracts: string[];
  uncompensatedAsOf: { spotPrice: number; at: string } | null;
}

export interface SignalsRoadmap {
  asOfDateIso: string;
  items: RoadmapItem[];
}

export function fetchSignalsScreen(): Promise<SignalsScreenRow[]> {
  return apiRequest<SignalsScreenRow[]>("/signals");
}

export function fetchTickerSignals(symbol: string): Promise<TickerSignalsDetail> {
  return apiRequest<TickerSignalsDetail>(`/signals/${encodeURIComponent(symbol)}`);
}

export function fetchSignalsRoadmap(): Promise<SignalsRoadmap> {
  return apiRequest<SignalsRoadmap>("/signals/roadmap");
}

/** One ticker's live graded list (+ live quotes for the selected expiry's contracts), at most one frame per second. Re-open to change the expiry. */
export function openSignalsTickerStream(symbol: string, expiry: string | null, onFrame: (frame: SignalsTickerFrame) => void, onError: () => void): () => void {
  return openMultiplexedStream<SignalsTickerFrame>({
    kind: "signalsTicker",
    parameters: expiry ? { symbol, expiry } : { symbol },
    onData: onFrame,
    onError,
    openLegacy: () => {
      onError();
      return () => {};
    },
  });
}

/**
 * Live screen rows, at most one frame per second. `bestContractLines: false` while the Signals modal is open —
 * the modal holds its own live lines, so the screen's one-per-ticker best-contract lines are released meanwhile.
 * There is no legacy per-stream route: an API without the multiplexer has no Signals either.
 */
export function openSignalsScreenStream(onFrame: (frame: SignalsScreenFrame) => void, onError: () => void, options: { bestContractLines: boolean }): () => void {
  return openMultiplexedStream<SignalsScreenFrame>({
    kind: "signalsScreen",
    parameters: options.bestContractLines ? {} : { bestContractLines: false },
    onData: onFrame,
    onError,
    openLegacy: () => {
      onError();
      return () => {};
    },
  });
}
