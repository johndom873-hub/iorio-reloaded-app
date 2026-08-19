import { apiRequest } from "./client";
import type { StrategyKey } from "./screener";

export type TradeAlertStatus = "pending" | "approved" | "rejected" | "modified" | "expired";

export interface SuggestedStructure {
  expiry: string; // YYYY-MM-DD
  strike: number;
  right: "call" | "put";
  delta: number;
  premium: number;
  dte: number;
  annualizedYield: number;
  spotPrice: number;
}

export interface TradeAlert {
  id: string;
  strategyKey: StrategyKey;
  alertType: string;
  relatedPositionId: string | null;
  suggestedStructure: SuggestedStructure;
  rationale: string | null;
  status: TradeAlertStatus;
  reviewedAt: string | null;
  resultingPositionId: string | null;
  createdAt: string;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
}

export interface TradeAlertFilters {
  status?: TradeAlertStatus;
  strategyKey?: StrategyKey;
}

export function fetchTradeAlerts(filters: TradeAlertFilters = {}): Promise<TradeAlert[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  const query = params.toString();
  return apiRequest<TradeAlert[]>(`/trade-alerts${query ? `?${query}` : ""}`);
}

export function rejectTradeAlert(id: string): Promise<TradeAlert> {
  return apiRequest<TradeAlert>(`/trade-alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
}
