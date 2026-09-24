import { apiRequest, apiBaseUrl } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";
import type { StrategyKey } from "./strategy";

export interface StrategySettings {
  id: string;
  strategyKey: StrategyKey;
  deltaTargetMin: string;
  deltaTargetMax: string;
  // covered_call only — governs delta selection instead of
  // deltaTargetMin/Max when the account already owns enough shares of the
  // ticker to write a real covered call against. Null for cash_secured_put.
  deltaTargetMinExistingPosition: string | null;
  deltaTargetMaxExistingPosition: string | null;
  dteTargetMin: number;
  dteTargetMax: number;
  maxPositionPctOfPortfolio: string;
  maxAggregateCollateralPct: string;
  maxConcentrationPerTickerPct: string;
  maxConcentrationPerSectorPct: string;
  minCashReservePct: string;
  updatedAt: string;
  updatedByDisplayName: string | null;
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
    deltaTargetMinExistingPosition: (row.delta_target_min_existing_position as string | null) ?? null,
    deltaTargetMaxExistingPosition: (row.delta_target_max_existing_position as string | null) ?? null,
    dteTargetMin: row.dte_target_min as number,
    dteTargetMax: row.dte_target_max as number,
    maxPositionPctOfPortfolio: row.max_position_pct_of_portfolio as string,
    maxAggregateCollateralPct: row.max_aggregate_collateral_pct as string,
    maxConcentrationPerTickerPct: row.max_concentration_per_ticker_pct as string,
    maxConcentrationPerSectorPct: row.max_concentration_per_sector_pct as string,
    minCashReservePct: row.min_cash_reserve_pct as string,
    updatedAt: row.updated_at as string,
    updatedByDisplayName: (row.updated_by_display_name as string | null) ?? null,
  };
}

export async function fetchStrategySettings(): Promise<StrategySettings[]> {
  const rows = await apiRequest<Record<string, unknown>[]>("/risk-limits/settings");
  return rows.map(mapSettingsRow);
}

export interface StrategySettingsInput {
  deltaTargetMin: number;
  deltaTargetMax: number;
  // Required for covered_call, omitted for cash_secured_put.
  deltaTargetMinExistingPosition?: number;
  deltaTargetMaxExistingPosition?: number;
  dteTargetMin: number;
  dteTargetMax: number;
  maxPositionPctOfPortfolio: number;
  maxAggregateCollateralPct: number;
  maxConcentrationPerTickerPct: number;
  maxConcentrationPerSectorPct: number;
  minCashReservePct: number;
}

/** Saves both strategies in one transaction (PUT /risk-limits/settings) — the Risk & Limits form's save (2026-09-24). */
export async function updateAllStrategySettings(inputs: Partial<Record<StrategyKey, StrategySettingsInput>>): Promise<StrategySettings[]> {
  const body: Record<string, unknown> = {};
  for (const [strategyKey, input] of Object.entries(inputs)) {
    if (!input) continue;
    body[strategyKey] = toSettingsBody(input);
  }
  const rows = await apiRequest<Record<string, unknown>[]>("/risk-limits/settings", { method: "PUT", body: JSON.stringify(body) });
  return rows.map(mapSettingsRow);
}

function toSettingsBody(input: StrategySettingsInput): Record<string, number> {
  return {
    delta_target_min: input.deltaTargetMin,
    delta_target_max: input.deltaTargetMax,
    ...(input.deltaTargetMinExistingPosition !== undefined && { delta_target_min_existing_position: input.deltaTargetMinExistingPosition }),
    ...(input.deltaTargetMaxExistingPosition !== undefined && { delta_target_max_existing_position: input.deltaTargetMaxExistingPosition }),
    dte_target_min: input.dteTargetMin,
    dte_target_max: input.dteTargetMax,
    max_position_pct_of_portfolio: input.maxPositionPctOfPortfolio,
    max_aggregate_collateral_pct: input.maxAggregateCollateralPct,
    max_concentration_per_ticker_pct: input.maxConcentrationPerTickerPct,
    max_concentration_per_sector_pct: input.maxConcentrationPerSectorPct,
    min_cash_reserve_pct: input.minCashReservePct,
  };
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
      ...(input.deltaTargetMinExistingPosition !== undefined && {
        delta_target_min_existing_position: input.deltaTargetMinExistingPosition,
      }),
      ...(input.deltaTargetMaxExistingPosition !== undefined && {
        delta_target_max_existing_position: input.deltaTargetMaxExistingPosition,
      }),
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
  totalCashValue: number | null;
  grossPositionValue: number | null;
  // Added for Iorio Pulse's IBKR node ("Margin excess") — see
  // fetchAccountSummary.ts on the backend.
  excessLiquidity: number | null;
}

export interface ConcentrationRow {
  symbol?: string;
  sector?: string;
  notionalValue: string;
}

export interface StrategyAllocationRow {
  strategyKey: StrategyKey | "unallocated";
  notionalValue: string;
}

export interface TopPositionRow {
  positionId: string;
  symbol: string;
  strategyKey: StrategyKey;
  notionalValue: string;
}

export interface ExposureData {
  account: AccountSummary | null;
  accountDataError: string | null;
  // Net liquidation value (positions + cash) — the denominator every
  // concentration/allocation % on this page and the Dashboard is computed
  // against, approved 2026-08-25 so an under-deployed account doesn't read
  // as "concentrated" just because whatever's invested happens to cluster.
  totalAccountValue: number | null;
  // Total cash minus cash committed to open cash-secured puts (their
  // collateral never leaves the account balance, so raw cash overstates
  // what's genuinely free) — same figure as Dashboard's available cash.
  availableCash: number | null;
  concentrationByTicker: ConcentrationRow[];
  // Includes a synthetic "Unallocated" row for account value not sitting
  // in any open position, when totalAccountValue is known.
  concentrationBySector: ConcentrationRow[];
  strategyAllocation: StrategyAllocationRow[];
  topPositions: TopPositionRow[];
}

// One-shot snapshot — used by Dashboard, which should not live-update
// (approved 2026-09-24). Can show entry-price fallback values for legs IBKR
// hasn't quoted yet, since there's no "frozen phase complete" signal for a
// plain fetch; that's the tradeoff Dashboard accepts for a load-once view.
// Pulse and Risk & Limits stay on openExposureStream below.
export function fetchExposure(): Promise<ExposureData> {
  return apiRequest<ExposureData>("/risk-limits/exposure");
}

// Live-upgrading replacement for the old one-shot GET /risk-limits/exposure
// (2026-09-19): the backend's /exposure/stream sends a first reading from
// FROZEN prices, then the whole ExposureData again each time a price
// actually changes. The one-shot had to wait on option prices that IBKR
// gives no completion signal for; the stream never waits, it just updates.
// Held open until the returned cleanup fn is called. Close instead of
// letting EventSource auto-reconnect — see openUnrealizedPnlStream's note
// (each retry opens a fresh IBKR connection server-side).
export function openExposureStream(onUpdate: (exposure: ExposureData) => void, onError: () => void): () => void {
  const openLegacy = () => openLegacyExposureStream(onUpdate, onError);
  return openMultiplexedStream<ExposureData>({ kind: "exposure", parameters: {}, onData: onUpdate, onError, openLegacy });
}

function openLegacyExposureStream(onUpdate: (exposure: ExposureData) => void, onError: () => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/risk-limits/exposure/stream`, { withCredentials: true });

  source.onmessage = (message) => {
    try {
      onUpdate(JSON.parse(message.data));
    } catch {
      // Malformed/heartbeat frame — ignore.
    }
  };

  source.onerror = () => {
    source.close();
    onError();
  };

  return () => source.close();
}
