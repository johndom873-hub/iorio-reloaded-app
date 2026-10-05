import { apiRequest } from "./client";

export interface ScreenerScanRow {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  bestRank: number;
  matchedScanCodes: string[];
  lastPrice: string | null;
  avgShareVolume: string | null;
  avgOptionVolume: string | null;
  callOpenInterest: string | null;
  putOpenInterest: string | null;
  bidAskSpreadPct: string | null;
  impliedVolatility: string | null;
  firstSeenAt: string;
  lastMatchedAt: string | null;
  lastRefreshedAt: string;
  isShortlisted: boolean;
}

export type ScreenerBestRankBucket = "1-10" | "11-20" | "21-30" | "31-40" | "41-50" | "unmatched";

export interface ScreenerFilters {
  search?: string;
  sector?: string[];
  minIv?: number;
  minOpenInterest?: number;
  bestRankBucket?: ScreenerBestRankBucket;
  matchedScanCodes?: string[];
}

export function fetchScreenerResults(filters: ScreenerFilters): Promise<ScreenerScanRow[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  return apiRequest<ScreenerScanRow[]>(`/screener${query ? `?${query}` : ""}`);
}

export function fetchScreenerSectors(): Promise<string[]> {
  return apiRequest<string[]>("/screener/sectors");
}

export function addScreenerResultToShortlist(symbol: string, notes?: string): Promise<void> {
  return apiRequest<void>(`/screener/${symbol}/shortlist`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}
