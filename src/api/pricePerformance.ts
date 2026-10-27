import { apiRequest, apiBaseUrl } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";

export type MacdSignal = "Bullish" | "Bearish" | "Neutral";
export type MaTrend = "uptrend" | "downtrend" | "mixed";

export interface ReferenceCloses {
  close1dAgo: number | null;
  close2dAgo: number | null;
  close3dAgo: number | null;
  close1wAgo: number | null;
  close1mAgo: number | null;
  close3mAgo: number | null;
  close1yAgo: number | null;
}

export interface PricePerformanceRow {
  symbol: string;
  companyName: string | null;
  /** Date of the latest COMPLETED daily bar behind every figure on this row. */
  latestDate: string;
  latestClose: string;
  dailyLow: string;
  dailyHigh: string;
  weeklyLow: string;
  weeklyHigh: string;
  monthlyLow: string;
  monthlyHigh: string;
  /** vs. the latest completed close; the page recomputes them against the live price once one arrives. */
  change1d: number | null;
  change2d: number | null;
  change3d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
  change1y: number | null;
  /** The closes those changes are measured against, counted back from the latest completed close. */
  referenceCloses: ReferenceCloses;
  /** The closes a live price is measured against: 1D is the latest close itself; 1W / 1M / 3M / 1Y count back from meta.liveReferenceDate. */
  liveReferenceCloses: ReferenceCloses;
  /** As of the last completed daily close — computed on the server from stored daily bars. */
  macdTrend: MacdSignal | null;
  maTrend: MaTrend | null;
  impliedVolatility: string | null;
  avgOptionVolume: string | null;
  ivRank: number | null;
  ivPercentile: number | null;
  ivWindowDays: number;
  /** This ticker's latest completed bar is older than the session the data should be current to. */
  isBehind: boolean;
}

export interface PricePerformanceMeta {
  /** Newest session a completed bar can exist for right now. */
  completedThroughDate: string;
  expectedSessionDate: string;
  isDataCurrent: boolean;
  behindSymbols: string[];
  /** Today's Eastern date: what the live 1W / 1M / 3M / 1Y reference closes count back from. */
  liveReferenceDate: string;
}

export interface PricePerformanceData {
  tickers: PricePerformanceRow[];
  meta: PricePerformanceMeta;
}

// Everything on the page except the live price, in ONE request served from
// stored daily bars — no IBKR call at all on the server. (The MACD/MA trends
// used to come from a separate slow endpoint that asked IBKR for every ticker
// on every page load.)
export function fetchPricePerformance(): Promise<PricePerformanceData> {
  return apiRequest<PricePerformanceData>("/price-performance");
}

/** Live price per symbol; null = no quote for that ticker right now. */
export type PricePerformanceLivePrices = Record<string, number | null>;

// Live current price for every shortlisted ticker — prices only. The % change
// columns are computed in the browser from these and the reference closes in
// fetchPricePerformance's rows (src/lib/priceChange.ts). Same FROZEN-then-
// REALTIME SSE mechanics and stay-open-until-closed lifetime as Positions'
// openUnrealizedPnlStream — see that function's comment for why a failed
// stream closes instead of letting EventSource auto-reconnect.
export function openPricePerformanceStream(onUpdate: (result: PricePerformanceLivePrices) => void, onError?: () => void): () => void {
  const openLegacy = () => openLegacyPricePerformanceStream(onUpdate, onError);
  return openMultiplexedStream<PricePerformanceLivePrices>({
    kind: "pricePerformancePrices",
    parameters: {},
    onData: onUpdate,
    onError: () => onError?.(),
    openLegacy,
  });
}

function openLegacyPricePerformanceStream(onUpdate: (result: PricePerformanceLivePrices) => void, onError?: () => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/price-performance/current-prices/stream`, { withCredentials: true });

  source.onmessage = (message) => {
    try {
      onUpdate(JSON.parse(message.data));
    } catch {
      // Malformed/heartbeat frame — ignore.
    }
  };

  source.onerror = () => {
    source.close();
    onError?.();
  };

  return () => source.close();
}
