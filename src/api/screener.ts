import { apiRequest } from "./client";

// Used across positions/trade-alerts/risk-limits — not tied to the
// (now strategy-agnostic) screener shortlist itself.
export type StrategyKey = "covered_call" | "cash_secured_put";

export interface ScreenerRow {
  id: string;
  addedAt: string;
  notes: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  snapshotDate: string | null;
  impliedVolatility: string | null;
  avgOptionVolume: string | null;
  capturedAt: string | null;
  ivRank: number | null;
  ivRankWindowDays: number;
}

export function fetchScreener(): Promise<ScreenerRow[]> {
  return apiRequest<ScreenerRow[]>("/screener");
}

export function addToScreener(symbol: string, notes?: string): Promise<ScreenerRow> {
  return apiRequest<ScreenerRow>("/screener", {
    method: "POST",
    body: JSON.stringify({ symbol, notes }),
  });
}

export function removeFromScreener(entryId: string): Promise<void> {
  return apiRequest<void>(`/screener/${entryId}`, { method: "DELETE" });
}

export function updateScreenerNotes(entryId: string, notes: string): Promise<{ notes: string | null }> {
  return apiRequest<{ notes: string | null }>(`/screener/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: notes.trim() || null }),
  });
}

export interface TickerSearchResult {
  symbol: string;
  companyName: string | null;
}

export function searchTickers(query: string): Promise<TickerSearchResult[]> {
  return apiRequest<TickerSearchResult[]>(`/screener/search?q=${encodeURIComponent(query)}`);
}
