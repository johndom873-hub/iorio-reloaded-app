import { apiRequest, apiBaseUrl } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";
import type { StrategyKey } from "./strategy";

/**
 * The one set of trading limits (backend table trading_settings). The three limits that block an order, the
 * delta band, the Recovery Path expiry window, the Signals minimum yield and the commission warning threshold.
 * Percentages are 0-100; deltas are absolute values between 0 and 1; expiry window is whole days.
 */
export interface TradingSettings {
  maxPositionPctOfPortfolio: number;
  maxConcentrationPerTickerPct: number;
  minCashReservePct: number;
  deltaTargetMin: number;
  deltaTargetMax: number;
  recoveryDteMin: number;
  recoveryDteMax: number;
  minAnnualizedYieldPct: number;
  commissionWarnSharePctOfPremium: number;
  priceCheckMaxDeviationPct: number;
  priceCheckMinToleranceDollars: number;
  /** Signals friction: the percentage of the half-spread charged (0 = always the mid, 100 = always the bid). */
  spreadCostChargedPct: number;
  updatedAt: string;
  updatedByDisplayName: string | null;
}

export type TradingSettingsInput = Omit<TradingSettings, "updatedAt" | "updatedByDisplayName">;

export function fetchTradingSettings(): Promise<TradingSettings> {
  return apiRequest<TradingSettings>("/risk-limits/settings");
}

export function updateTradingSettings(input: TradingSettingsInput): Promise<TradingSettings> {
  return apiRequest<TradingSettings>("/risk-limits/settings", { method: "PUT", body: JSON.stringify(input) });
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

// The trading halt (kill switch, 2026-09-28): stops every order origin at confirm and in the worker.
export interface TradingHalt {
  enabled: boolean;
  reason: string | null;
  setByDisplayName: string | null;
  setAt: string | null;
}

export function fetchTradingHalt(): Promise<TradingHalt> {
  return apiRequest<TradingHalt>("/risk-limits/trading-halt");
}

/** A reason is required when halting; optional when lifting the halt. */
export function updateTradingHalt(input: { enabled: boolean; reason: string | null }): Promise<TradingHalt> {
  return apiRequest<TradingHalt>("/risk-limits/trading-halt", { method: "PUT", body: JSON.stringify(input) });
}
