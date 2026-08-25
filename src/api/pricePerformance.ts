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
