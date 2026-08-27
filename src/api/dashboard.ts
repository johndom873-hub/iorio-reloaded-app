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

export interface AccountValue {
  netLiquidationValue: number | null;
  asOf: string | null;
}

// Last night's snapshot, not live — see the route's own comment for why
// (IBKR pacing makes a live call unsuitable for call sites that fetch
// this often, e.g. every Positions table load or order-form keystroke).
export function fetchAccountValue(): Promise<AccountValue> {
  return apiRequest<AccountValue>("/dashboard/account-value");
}

export interface AvailableCash {
  totalCashValue: number | null;
  cashLockedInCsps: number;
  availableCashToTrade: number | null;
}

// Live IBKR round trip (see the route's own comment) -- used by Order Review
// (can this specific order be afforded right now) and the Dashboard.
export function fetchAvailableCash(): Promise<AvailableCash> {
  return apiRequest<AvailableCash>("/dashboard/available-cash");
}
