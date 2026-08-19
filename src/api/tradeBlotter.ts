import { apiRequest } from "./client";
import type { StrategyKey } from "./screener";
import type { LegSide, LegType, OptionType } from "./positions";

export interface Trade {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: string;
  commission: string | null;
  executedAt: string;
  isClosingTrade: boolean;
  pnl: string | null;
  positionId: string;
  strategyKey: StrategyKey;
  legId: string;
  legType: LegType;
  legSide: LegSide;
  optionType: OptionType | null;
  strikePrice: string | null;
  expiryDate: string | null;
  symbol: string;
}

export interface TradeBlotterFilters {
  strategyKey?: StrategyKey;
  symbol?: string;
  from?: string;
  to?: string;
}

export function fetchTrades(filters: TradeBlotterFilters): Promise<Trade[]> {
  const params = new URLSearchParams();
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return apiRequest<Trade[]>(`/trade-blotter${query ? `?${query}` : ""}`);
}
