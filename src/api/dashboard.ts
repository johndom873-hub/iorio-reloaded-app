import { bookQuery, type BookSelection } from "./books";
import { apiRequest } from "./client";

export interface DashboardPeriods {
  day: string | null;
  week: string | null;
  month: string | null;
  year: string | null;
}

export interface DashboardSummary {
  asOf: string | null;
  netLiquidationValue: string | null;
  dayPnlPercent: number | null;
  periods: DashboardPeriods;
}

export function fetchDashboardSummary(book: BookSelection = "all"): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>(`/dashboard/summary${bookQuery(book)}`);
}

export interface Portfolio {
  coveredCalls: number;
  cashSecuredPuts: number;
  unstructured: number;
  hedge: number;
  leaps: number;
  availableCash: number | null;
}

export function fetchPortfolio(book: BookSelection = "all"): Promise<Portfolio> {
  return apiRequest<Portfolio>(`/dashboard/portfolio${bookQuery(book)}`);
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
  /** Long stock closed at its entry price with no closing trade: the shares moved to another position, never sold. */
  sharesHandedOn?: boolean;
  /** IBKR's opening fills of the leg: quantity, average price, and commission (null until reported for every fill). */
  openingFill?: { quantity: number; averagePrice: number; commission: number | null } | null;
}

/** A position on the other end of a share hand-over. */
export interface ShareHandOverPosition {
  positionId: string;
  strategyKey: string;
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
  /** The positions this one's shares moved to when it closed (see sharesHandedOn). */
  sharesMovedToPositions?: ShareHandOverPosition[];
  legs: PositionEventLeg[];
}

export function fetchDashboardEvents(limit = 40, book: BookSelection = "all"): Promise<PositionEvent[]> {
  return apiRequest<PositionEvent[]>(`/dashboard/events?limit=${limit}${bookQuery(book, "&")}`);
}

export interface AccountValue {
  netLiquidationValue: number | null;
  asOf: string | null;
}

// Last night's snapshot, not live. For "what is the account worth now"
// use fetchCurrentAccountValue below.
export function fetchAccountValue(): Promise<AccountValue> {
  return apiRequest<AccountValue>("/dashboard/account-value");
}

export interface AvailableCash {
  totalCashValue: number | null;
  cashLockedInCsps: number;
  availableCashToTrade: number | null;
  // Live IBKR net liquidation value, from the same account-summary call.
  netLiquidationValue: number | null;
}

// Live IBKR round trip (see the route's own comment) -- used by Order Review
// (can this specific order be afforded right now) and the Dashboard.
export function fetchAvailableCash(): Promise<AvailableCash> {
  return apiRequest<AvailableCash>("/dashboard/available-cash");
}

// The account value Pulse and the Dashboard show: live from IBKR, else last
// night's snapshot when the live call fails. For one-shot loads (EXP% bases);
// pages that already fetch available cash read its netLiquidationValue instead.
export async function fetchCurrentAccountValue(): Promise<number | null> {
  const [live, snapshot] = await Promise.allSettled([fetchAvailableCash(), fetchAccountValue()]);
  if (live.status === "fulfilled" && live.value.netLiquidationValue !== null) return live.value.netLiquidationValue;
  if (snapshot.status === "fulfilled" && snapshot.value.netLiquidationValue !== null) return Number(snapshot.value.netLiquidationValue);
  return null;
}

export interface PerformancePeriod {
  percent: number;
  profitDollars: number;
}

export interface PerformanceMonth extends PerformancePeriod {
  year: number;
  month: number;
}

export interface PerformanceYear extends PerformancePeriod {
  year: number;
}

export interface PerformanceSummary {
  trackingSince: string | null;
  asOf: string | null;
  trackingSpanDays: number | null;
  monthToDate: PerformancePeriod | null;
  months: PerformanceMonth[];
  years: PerformanceYear[];
  sinceInceptionPercent: number | null;
  compoundAnnualGrowthRatePercent: number | null;
}

export function fetchPerformance(book: BookSelection = "all"): Promise<PerformanceSummary> {
  return apiRequest<PerformanceSummary>(`/dashboard/performance${bookQuery(book)}`);
}
