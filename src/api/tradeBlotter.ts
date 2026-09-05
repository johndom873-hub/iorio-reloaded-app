import { apiRequest } from "./client";
import type { StrategyKey } from "./strategy";
import type { LegSide, LegType, OptionType, OrderRequestStatus } from "./positions";

export interface Trade {
  id: string;
  ibkrOrderId: string | null;
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
  requestedByDisplayName: string | null;
}

// An order_requests row that hasn't (yet, or ever will) produce a real fill
// — still pending confirmation, confirmed and awaiting the worker,
// submitted and awaiting a fill, cancelling, cancelled, rejected, or
// errored. Expanded one row per payload leg, same granularity as Trade
// above, so both can share one table. `status` is the real, current IBKR
// state — never assumed from a stale local read.
export interface PendingOrder {
  id: string;
  status: OrderRequestStatus;
  ibkrOrderId: number | null;
  errorMessage: string | null;
  requestType: string;
  createdAt: string;
  symbol: string;
  strategyKey: StrategyKey;
  legRole: "stock" | "option";
  action: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  strike: number | null;
  expiry: string | null; // YYYY-MM-DD
  optionType: "C" | "P" | null;
  requestedByDisplayName: string | null;
  cancelledByDisplayName: string | null;
}

export interface TradeBlotterFilters {
  strategyKey?: StrategyKey;
  symbol?: string;
  from?: string;
  to?: string;
}

export interface TradeBlotterData {
  trades: Trade[];
  pendingOrders: PendingOrder[];
}

export function fetchTradeBlotter(filters: TradeBlotterFilters): Promise<TradeBlotterData> {
  const params = new URLSearchParams();
  if (filters.strategyKey) params.set("strategy", filters.strategyKey);
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return apiRequest<TradeBlotterData>(`/trade-blotter${query ? `?${query}` : ""}`);
}
