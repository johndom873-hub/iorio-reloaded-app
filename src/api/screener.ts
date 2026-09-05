import { apiRequest } from "./client";

export interface ScreenerScanRow {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  scanCodes: string[];
  bestRank: number;
  lastPrice: string | null;
  avgShareVolume: string | null;
  avgOptionVolume: string | null;
  callOpenInterest: string | null;
  putOpenInterest: string | null;
  bidAskSpreadPct: string | null;
  ivVsHistRatio: string | null;
  impliedVolatility: string | null;
  scanDate: string;
  firstSeenDate: string;
  isShortlisted: boolean;
}

export interface ScreenerFilters {
  maxPrice?: number;
  minIvRatio?: number;
  maxIvRatio?: number;
  minAvgOptionVolume?: number;
  minAvgShareVolume?: number;
  maxBidAskSpreadPct?: number;
  sector?: string;
}

export function fetchScreenerResults(filters: ScreenerFilters): Promise<ScreenerScanRow[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return apiRequest<ScreenerScanRow[]>(`/screener${query ? `?${query}` : ""}`);
}

export function addScreenerResultToShortlist(symbol: string, notes?: string): Promise<void> {
  return apiRequest<void>(`/screener/${symbol}/shortlist`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}
