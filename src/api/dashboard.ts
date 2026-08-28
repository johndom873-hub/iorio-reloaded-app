import { apiRequest } from "./client";

export interface DashboardPeriods {
  day: string | null;
  week: string | null;
  month: string | null;
  year: string | null;
}

// Wider than screener.ts's StrategyKey ("covered_call" | "cash_secured_put"
// only, matching that page's v1 scope) — the Dashboard also surfaces
// "unstructured" positions, so this is deliberately string here.
export interface StrategyPnlBreakdown {
  strategyKey: string;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
}

export interface DashboardSummary {
  asOf: string | null;
  netLiquidationValue: string | null;
  cumulativeRealizedPnl: string | null;
  cumulativeUnrealizedPnl: string | null;
  dayPnlPercent: number | null;
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
  coveredCalls: number;
  cashSecuredPuts: number;
  unstructured: number;
  residual: number | null;
}

export function fetchPnlHistory(days = 90): Promise<PnlHistoryPoint[]> {
  return apiRequest<PnlHistoryPoint[]>(`/dashboard/history?days=${days}`);
}

export interface Portfolio {
  coveredCalls: number;
  cashSecuredPuts: number;
  unstructured: number;
  availableCash: number | null;
}

export function fetchPortfolio(): Promise<Portfolio> {
  return apiRequest<Portfolio>("/dashboard/portfolio");
}

export interface StrategyPeriodPnlRow {
  day: number;
  week: number;
  month: number;
  year: number;
}

export interface PeriodPnlByStrategy {
  coveredCalls: StrategyPeriodPnlRow;
  cashSecuredPuts: StrategyPeriodPnlRow;
  unstructured: StrategyPeriodPnlRow;
  residual: StrategyPeriodPnlRow;
  total: StrategyPeriodPnlRow;
}

export function fetchPeriodPnlByStrategy(): Promise<PeriodPnlByStrategy> {
  return apiRequest<PeriodPnlByStrategy>("/dashboard/period-pnl-by-strategy");
}

export interface PositionEventLeg {
  legType: "stock" | "option";
  side: "long" | "short";
  quantity: number;
  optionType: "call" | "put" | null;
  strikePrice: number | null;
  expiryDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
}

export interface PositionEvent {
  positionId: string;
  eventType: "opened" | "closed" | "unstructured";
  eventAt: string;
  openedAt: string;
  symbol: string;
  strategyKey: string;
  closeReason: string | null;
  unstructuredReason: string | null;
  realizedPnl: number | null;
  netCashEffect: number | null;
  fullMarketValue: number | null;
  attributedTo: string | null;
  legs: PositionEventLeg[];
}

export function fetchDashboardEvents(limit = 40): Promise<PositionEvent[]> {
  return apiRequest<PositionEvent[]>(`/dashboard/events?limit=${limit}`);
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
