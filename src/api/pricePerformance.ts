import { apiRequest } from "./client";

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
}

export function fetchPricePerformance(): Promise<PricePerformanceRow[]> {
  return apiRequest<{ tickers: PricePerformanceRow[] }>("/price-performance").then((data) => data.tickers);
}

// Live snapshot price per symbol, fetched separately from fetchPricePerformance
// so the table itself keeps loading instantly from stored daily bars — see
// the backend route's comment. null per symbol when unavailable (outside
// market hours, IBKR pacing, Gateway unreachable).
export function fetchCurrentPrices(): Promise<Record<string, number | null>> {
  return apiRequest<Record<string, number | null>>("/price-performance/current-prices");
}
