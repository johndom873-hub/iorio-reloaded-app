import type { Portfolio } from "../api/dashboard";
import type { ExposureData } from "../api/riskLimits";

/**
 * Dashboard's Portfolio tiles are the same numbers the exposure reading
 * already carries (both are the per-strategy sum of position exposure, and
 * availableCash is computed identically on the backend), so the Dashboard
 * derives them instead of opening a second stream — each stream is its own
 * IBKR connection server-side.
 */
export function portfolioFromExposure(exposure: ExposureData): Portfolio {
  const valueFor = (strategyKey: string) => Number(exposure.strategyAllocation.find((row) => row.strategyKey === strategyKey)?.notionalValue ?? 0);
  return {
    coveredCalls: valueFor("covered_call"),
    cashSecuredPuts: valueFor("cash_secured_put"),
    unstructured: valueFor("unstructured"),
    hedge: valueFor("hedge"),
    availableCash: exposure.availableCash,
  };
}

/**
 * The Allocation bar's slice widths (Dashboard and Pulse), in %: each of the
 * five Portfolio values over their total (approved 2026-10-21), so the bar
 * always matches the tiles under it. A negative value (cash on margin) draws
 * no slice and is left out of the total; unknown cash counts as 0. All zero
 * when nothing is positive.
 */
export function allocationBarPercents(portfolio: Portfolio): Record<keyof Portfolio, number> {
  const drawnValues: Record<keyof Portfolio, number> = {
    coveredCalls: Math.max(0, portfolio.coveredCalls),
    cashSecuredPuts: Math.max(0, portfolio.cashSecuredPuts),
    unstructured: Math.max(0, portfolio.unstructured),
    hedge: Math.max(0, portfolio.hedge),
    availableCash: Math.max(0, portfolio.availableCash ?? 0),
  };
  const total = Object.values(drawnValues).reduce((sum, value) => sum + value, 0);
  const percentOf = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  return {
    coveredCalls: percentOf(drawnValues.coveredCalls),
    cashSecuredPuts: percentOf(drawnValues.cashSecuredPuts),
    unstructured: percentOf(drawnValues.unstructured),
    hedge: percentOf(drawnValues.hedge),
    availableCash: percentOf(drawnValues.availableCash),
  };
}
