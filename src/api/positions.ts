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
