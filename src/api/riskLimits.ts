import { apiRequest } from "./client";
import type { StrategyKey } from "./screener";

export interface StrategySettings {
  id: string;
  strategyKey: StrategyKey;
  deltaTargetMin: string;
  deltaTargetMax: string;
  dteTargetMin: number;
  dteTargetMax: number;
  maxPositionPctOfPortfolio: string;
  maxAggregateCollateralPct: string;
  maxConcentrationPerTickerPct: string;
  maxConcentrationPerSectorPct: string;
  minCashReservePct: string;
  updatedAt: string;
}

// Backend columns are snake_case; this app's convention elsewhere is
// server-side camelCase mapping (see screener.ts's raw SELECT aliases), but
// this route returns the row as-is from Knex, so map here instead.
function mapSettingsRow(row: Record<string, unknown>): StrategySettings {
  return {
    id: row.id as string,
    strategyKey: row.strategy_key as StrategyKey,
    deltaTargetMin: row.delta_target_min as string,
    deltaTargetMax: row.delta_target_max as string,
    dteTargetMin: row.dte_target_min as number,
    dteTargetMax: row.dte_target_max as number,
    maxPositionPctOfPortfolio: row.max_position_pct_of_portfolio as string,
    maxAggregateCollateralPct: row.max_aggregate_collateral_pct as string,
    maxConcentrationPerTickerPct: row.max_concentration_per_ticker_pct as string,
    maxConcentrationPerSectorPct: row.max_concentration_per_sector_pct as string,
    minCashReservePct: row.min_cash_reserve_pct as string,
    updatedAt: row.updated_at as string,
  };
}

export async function fetchStrategySettings(): Promise<StrategySettings[]> {
  const rows = await apiRequest<Record<string, unknown>[]>("/risk-limits/settings");
  return rows.map(mapSettingsRow);
}

export interface StrategySettingsInput {
  deltaTargetMin: number;
  deltaTargetMax: number;
  dteTargetMin: number;
  dteTargetMax: number;
  maxPositionPctOfPortfolio: number;
  maxAggregateCollateralPct: number;
  maxConcentrationPerTickerPct: number;
  maxConcentrationPerSectorPct: number;
  minCashReservePct: number;
}

export async function updateStrategySettings(
  strategyKey: StrategyKey,
  input: StrategySettingsInput,
): Promise<StrategySettings> {
  const row = await apiRequest<Record<string, unknown>>(`/risk-limits/settings/${strategyKey}`, {
    method: "PUT",
    body: JSON.stringify({
      delta_target_min: input.deltaTargetMin,
      delta_target_max: input.deltaTargetMax,
      dte_target_min: input.dteTargetMin,
      dte_target_max: input.dteTargetMax,
      max_position_pct_of_portfolio: input.maxPositionPctOfPortfolio,
      max_aggregate_collateral_pct: input.maxAggregateCollateralPct,
      max_concentration_per_ticker_pct: input.maxConcentrationPerTickerPct,
      max_concentration_per_sector_pct: input.maxConcentrationPerSectorPct,
      min_cash_reserve_pct: input.minCashReservePct,
    }),
  });
  return mapSettingsRow(row);
}

export interface AccountSummary {
  netLiquidationValue: number | null;
  buyingPower: number | null;
  totalCashValue: number | null;
  grossPositionValue: number | null;
}

export interface ConcentrationRow {
  symbol?: string;
  sector?: string;
  notionalValue: string;
}

export interface ExposureData {
  account: AccountSummary | null;
  accountDataError: string | null;
  concentrationByTicker: ConcentrationRow[];
  concentrationBySector: ConcentrationRow[];
}

export function fetchExposure(): Promise<ExposureData> {
  return apiRequest<ExposureData>("/risk-limits/exposure");
}
