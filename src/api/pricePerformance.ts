import { apiRequest, apiBaseUrl } from "./client";

export interface PricePerformanceRow {
  symbol: string;
  companyName: string | null;
  latestDate: string;
  latestClose: string;
  dailyLow: string;
  dailyHigh: string;
  weeklyLow: string;
  weeklyHigh: string;
  monthlyLow: string;
  monthlyHigh: string;
  change24h: number | null;
  change48h: number | null;
  change72h: number | null;
  change1w: number | null;
  change1m: number | null;
  impliedVolatility: string | null;
  avgOptionVolume: string | null;
  ivRank: number | null;
  ivPercentile: number | null;
  ivWindowDays: number;
}

export function fetchPricePerformance(): Promise<PricePerformanceRow[]> {
  return apiRequest<{ tickers: PricePerformanceRow[] }>("/price-performance").then((data) => data.tickers);
}

export type MacdSignal = "Bullish" | "Bearish" | "Neutral";
export type MaTrend = "uptrend" | "downtrend" | "mixed";
export interface PricePerformanceTrend {
  macdTrend: MacdSignal | null;
  maTrend: MaTrend | null;
}

// Loaded separately from fetchPricePerformance, same instant-table-then-
// fill-in-async pattern as fetchCurrentPrices below -- these can fall
// through to a live IBKR historical-data call on a cold cache, and the main
// endpoint is meant to stay an instant DB-only load.
export function fetchPricePerformanceTrends(): Promise<Record<string, PricePerformanceTrend>> {
  return apiRequest<Record<string, PricePerformanceTrend>>("/price-performance/trends");
}

export interface PricePerformanceLiveRow {
  currentPrice: number | null;
  change24h: number | null;
  change48h: number | null;
  change72h: number | null;
  change1w: number | null;
  change1m: number | null;
}

// Live current price + the 24hr/48hr/72hr/1W/1M % change columns,
// recomputed against the streaming price (not the static daily-bar figures
// fetchPricePerformance returns) -- approved 2026-09-11 so Current's
// red/green and these badges always agree instead of the badges lagging a
// full day behind. Same FROZEN-then-REALTIME SSE mechanics and
// stay-open-until-closed lifetime as Positions' openUnrealizedPnlStream —
// see that function's matching comment for why this closes on error instead
// of letting EventSource auto-reconnect.
export function openPricePerformanceStream(onUpdate: (result: Record<string, PricePerformanceLiveRow>) => void, onError?: () => void): () => void {
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
