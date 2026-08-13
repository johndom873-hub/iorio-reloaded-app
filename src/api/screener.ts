import { apiRequest } from "./client";

export type StrategyKey = "covered_call" | "cash_secured_put";

export interface ScreenerRow {
  id: string;
  strategyKey: StrategyKey;
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
}

export function fetchScreener(strategyKey: StrategyKey): Promise<ScreenerRow[]> {
  return apiRequest<ScreenerRow[]>(`/screener?strategy=${strategyKey}`);
}

export function addToScreener(symbol: string, strategyKey: StrategyKey, notes?: string): Promise<ScreenerRow> {
  return apiRequest<ScreenerRow>("/screener", {
    method: "POST",
    body: JSON.stringify({ symbol, strategyKey, notes }),
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
