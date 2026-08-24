import { apiRequest } from "./client";
import type { StrategyKey } from "./screener";

export type PositionStatus = "open" | "closed";
export type LegType = "stock" | "option";
export type LegSide = "long" | "short";
export type OptionType = "call" | "put";

export interface PositionLeg {
  id: string;
  legType: LegType;
  side: LegSide;
  quantity: number;
  optionType: OptionType | null;
  strikePrice: string | null;
  expiryDate: string | null;
  multiplier: number;
  ibkrContractId: string | null;
  entryPrice: string;
  entryAt: string;
  exitPrice: string | null;
  exitAt: string | null;
}

export interface Position {
  id: string;
  strategyKey: StrategyKey;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  priceTarget: string | null;
  closeTriggerNotes: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  legs: PositionLeg[];
  /** Sum of already-exited legs' locked-in gain — nonzero on an open position that's been rolled. */
  realizedPnl: string;
  /** Entry-time capital committed: stock cost for covered calls, strike collateral for CSPs. Null if unavailable. */
  capitalAtRisk: string | null;
}

export interface PositionFilters {
  status: PositionStatus;
  strategyKey?: StrategyKey;
}

export function fetchPositions(filters: PositionFilters): Promise<Position[]> {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  return apiRequest<Position[]>(`/positions?${params.toString()}`);
}

export function fetchPosition(id: string): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}`);
}

export interface LegInput {
  legType: LegType;
  side: LegSide;
  quantity: number;
  optionType?: OptionType;
  strikePrice?: number;
  expiryDate?: string;
  multiplier: number;
  entryPrice: number;
  entryAt: string;
}

export interface CreatePositionInput {
  symbol: string;
  strategyKey: StrategyKey;
  notes?: string;
  priceTarget?: number;
  legs: LegInput[];
  /** Links this position back to the Trade Alert it was created from, if any — see tradeAlerts.ts. */
  sourceAlertId?: string;
}

export function createPosition(input: CreatePositionInput): Promise<Position> {
  return apiRequest<Position>("/positions", { method: "POST", body: JSON.stringify(input) });
}

export interface PositionPatch {
  notes?: string | null;
  priceTarget?: number | null;
  closeTriggerNotes?: string | null;
}

export function updatePosition(id: string, patch: PositionPatch): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export interface LegExitInput {
  legId: string;
  exitPrice: number;
  exitAt: string;
}

export function closePosition(id: string, legs: LegExitInput[]): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}/close`, { method: "POST", body: JSON.stringify({ legs }) });
}

export interface RollLegInput {
  strikePrice: number;
  expiryDate: string;
  quantity: number;
  multiplier: number;
  entryPrice: number;
  entryAt: string;
}

export interface RollPositionInput {
  sourceAlertId: string;
  closeLegId: string;
  exitPrice: number;
  exitAt: string;
  newLeg: RollLegInput;
}

export function rollPosition(id: string, input: RollPositionInput): Promise<Position> {
  return apiRequest<Position>(`/positions/${id}/roll`, { method: "POST", body: JSON.stringify(input) });
}

export interface Greeks {
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
}

export function fetchGreeks(legIds: string[]): Promise<Record<string, Greeks>> {
  if (legIds.length === 0) return Promise.resolve({});
  return apiRequest<Record<string, Greeks>>(`/positions/greeks?legIds=${legIds.join(",")}`);
}

export interface UnrealizedPnlResult {
  unrealizedPnl: number | null;
  // Set only when unrealizedPnl came from the last nightly snapshot instead
  // of a live IBKR quote (outside market hours) — the date that snapshot
  // was captured. null when unrealizedPnl is live, or when neither a live
  // price nor a snapshot is available.
  asOfDate: string | null;
}

// Unrealized P&L for open positions only, live-priced on demand — mirrors
// fetchGreeks's shape. Falls back to the most recent daily P&L snapshot
// (asOfDate set) when a live price couldn't be fetched for at least one leg
// (e.g. outside market hours); unrealizedPnl is null when neither is
// available (e.g. a position opened after that night's snapshot job ran).
export function fetchUnrealizedPnl(positionIds: string[]): Promise<Record<string, UnrealizedPnlResult>> {
  if (positionIds.length === 0) return Promise.resolve({});
  return apiRequest<Record<string, UnrealizedPnlResult>>(`/positions/pnl?positionIds=${positionIds.join(",")}`);
}
