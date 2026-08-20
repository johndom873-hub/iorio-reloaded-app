import { apiRequest } from "./client";
import type { StrategyKey } from "./screener";

export interface DashboardPeriods {
  day: string | null;
  week: string | null;
  month: string | null;
  year: string | null;
}

export interface StrategyPnlBreakdown {
  strategyKey: StrategyKey;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  marketValue: string | null;
}

export interface DashboardSummary {
  asOf: string | null;
  netLiquidationValue: string | null;
  cumulativeRealizedPnl: string | null;
  cumulativeUnrealizedPnl: string | null;
  periods: DashboardPeriods;
  strategyBreakdown: StrategyPnlBreakdown[];
}

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>("/dashboard/summary");
}

export interface PnlHistoryPoint {
  snapshotDate: string;
  dailyPnl: string | null;
  netLiquidationValue: string | null;
}

export function fetchPnlHistory(days = 90): Promise<PnlHistoryPoint[]> {
  return apiRequest<PnlHistoryPoint[]>(`/dashboard/history?days=${days}`);
}
