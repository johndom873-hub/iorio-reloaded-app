import { apiRequest } from "./client";

export interface ShortlistRow {
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
  ivPercentile: number | null;
  ivWindowDays: number;
}

export function fetchShortlist(): Promise<ShortlistRow[]> {
  return apiRequest<ShortlistRow[]>("/shortlist");
}

export function addToShortlist(symbol: string, notes?: string): Promise<ShortlistRow> {
  return apiRequest<ShortlistRow>("/shortlist", {
    method: "POST",
    body: JSON.stringify({ symbol, notes }),
  });
}

export function removeFromShortlist(entryId: string): Promise<void> {
  return apiRequest<void>(`/shortlist/${entryId}`, { method: "DELETE" });
}

export function updateShortlistNotes(entryId: string, notes: string): Promise<{ notes: string | null }> {
  return apiRequest<{ notes: string | null }>(`/shortlist/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: notes.trim() || null }),
  });
}

export interface TickerSearchResult {
  symbol: string;
  companyName: string | null;
}

export function searchTickers(query: string): Promise<TickerSearchResult[]> {
  return apiRequest<TickerSearchResult[]>(`/shortlist/search?q=${encodeURIComponent(query)}`);
}
