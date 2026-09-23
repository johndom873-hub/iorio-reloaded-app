import { apiRequest } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";

// Signals screen (backend: routes/signals.ts, streams/signalsProducers.ts;
// mockup approved 2026-09-22). Types mirror the API's signalsTypes.ts /
// signalCandidates.ts / signalsRoadmap.ts shapes.

export type SignalStrategyKey = "covered_call" | "cash_secured_put";
export type SignalGrade = "strong" | "good" | "marginal" | "avoid";
export type SignalFlag = "spans_earnings" | "outside_fitted_range" | "wide_spread" | "no_shares" | "insufficient_cash";
export type SignalsUnscoredReason = "no_snapshot" | "no_surface_fit" | "no_forecast" | "suspected_split";
export type SignalsPriceSource = "live" | "frozen" | "snapshot";

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
  quoteSource: "live" | "snapshot";
  flags: SignalFlag[];
  executable: boolean;
  grade: SignalGrade;
}

export interface ElevatedVolatilityFlag {
  ratio: number;
  threshold: number;
  thresholdSource: "own_p90" | "fixed_fallback";
  elevated: boolean;
}

export type RoadmapStatus = "waiting_on_data" | "waiting_on_sign_off" | "waiting_on_decision" | "waiting_on_later_phase" | "waiting_on_build";
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
  fittedSliceCount: number;
  totalSliceCount: number;
  momentum: number | null;
  skew: { skew: number; daysToExpiry: number } | null;
  elevatedVolatility: ElevatedVolatilityFlag | null;
  nextEarningsDateIso: string | null;
  atmImpliedVolatility: number | null;
  forecast: { volatility: number; windowDays: number } | null;
  dailyBarCount: number;
  dividendCadenceUnknown: boolean;
  caveats: RoadmapItem[];
  freeShares: number;
  freeCash: number;
  unscoredReason: SignalsUnscoredReason | null;
}

export type SignalsScreenRow = Omit<TickerSignals, "candidates">;

export interface SignalsScreenFrame {
  type: "signalsScreen";
  at: string;
  rows: SignalsScreenRow[];
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

export function fetchTickerSignals(symbol: string): Promise<TickerSignals> {
  return apiRequest<TickerSignals>(`/signals/${encodeURIComponent(symbol)}`);
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

/** Live screen rows, at most one frame per second. There is no legacy per-stream route: an API without the multiplexer has no Signals either. */
export function openSignalsScreenStream(onFrame: (frame: SignalsScreenFrame) => void, onError: () => void): () => void {
  return openMultiplexedStream<SignalsScreenFrame>({
    kind: "signalsScreen",
    parameters: {},
    onData: onFrame,
    onError,
    openLegacy: () => {
      onError();
      return () => {};
    },
  });
}
