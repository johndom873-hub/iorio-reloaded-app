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
    availableCash: exposure.availableCash,
  };
}
