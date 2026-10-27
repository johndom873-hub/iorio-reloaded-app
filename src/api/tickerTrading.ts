import { apiRequest } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";
import type { MacroEvent } from "./calendarEvents";

// The Ticker modal's data (API src/routes/tickerTrading.ts and the `optionQuotes` stream): what its order forms need,
// the option chain's structure, and live quotes for the contracts on screen.

export type OptionStrategyKey = "covered_call" | "cash_secured_put";

/** An open short option leg on a covered-call or cash-secured-put position. */
export interface OpenShortLeg {
  legId: string;
  positionId: string;
  strategyKey: OptionStrategyKey;
  expiry: string; // ISO date
  strike: number;
  right: "C" | "P";
  quantity: number;
  /** Credit collected per share when the leg was opened. */
  entryPrice: number;
  entryAtIso: string;
}

export interface TickerTradingContext {
  symbol: string;
  companyName: string | null;
  freeShares: number;
  /** Null when the account summary could not be read. */
  freeCash: number | null;
  heldLegs: OpenShortLeg[];
  /** λ (0..1), the Risk & Limits spread cost share. */
  spreadShareCharged: number;
  macroEvents: MacroEvent[];
  nextEarningsDateIso: string | null;
}

/** What the LEAPS P&L-over-time chart values a Call with (API GET /tickers/:symbol/valuation-inputs). */
export interface TickerValuationInputs {
  symbol: string;
  /** IBKR's expected dividends per share over the next 12 months; null when IBKR sent none. */
  nextTwelveMonthsDividends: number | null;
  nextDividendDate: string | null;
  /** FRED rate as a decimal; null when unavailable. */
  riskFreeRate: number | null;
}

export function fetchTickerValuationInputs(symbol: string): Promise<TickerValuationInputs> {
  return apiRequest<TickerValuationInputs>(`/tickers/${encodeURIComponent(symbol)}/valuation-inputs`);
}

export function fetchTickerTradingContext(symbol: string): Promise<TickerTradingContext> {
  return apiRequest<TickerTradingContext>(`/tickers/${encodeURIComponent(symbol)}/trading-context`);
}

export interface TickerOptionChain {
  symbol: string;
  spotPrice: number | null;
  expiries: { expiry: string; dte: number }[];
  selectedExpiry: string | null;
  strikes: number[];
  /** "live": looked up at IBKR (outside the stored structure). */
  strikesSource: "stored" | "live" | null;
}

export function fetchTickerOptionChain(symbol: string, expiry: string | null): Promise<TickerOptionChain> {
  return apiRequest<TickerOptionChain>(`/tickers/${encodeURIComponent(symbol)}/option-chain${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`);
}

/** "2026-10-16|110|C": one contract across the chain and the order pane. */
export function optionContractKey(contract: { expiry: string; strike: number; right: "C" | "P" }): string {
  return `${contract.expiry}|${contract.strike}|${contract.right}`;
}

export interface LiveContractQuote {
  bid: number | null;
  ask: number | null;
  /** The contract's own delta from its mid (the platform's delta), else IBKR's. */
  delta: number | null;
  /** Implied volatility from the mid (0.35 = 35%). */
  impliedVolatility: number | null;
}

export interface OptionQuotesFrame {
  type: "optionQuotes";
  at: string;
  spotPrice: number | null;
  quotes: Record<string, LiveContractQuote>;
}

export const optionQuotesMaxContracts = 64;

export function openOptionQuotesStream(symbol: string, contractKeys: string[], onFrame: (frame: OptionQuotesFrame) => void, onError: () => void): () => void {
  return openMultiplexedStream<OptionQuotesFrame>({
    kind: "optionQuotes",
    parameters: { symbol, contracts: contractKeys.slice(0, optionQuotesMaxContracts) },
    onData: onFrame,
    onError,
    openLegacy: () => {
      onError();
      return () => {};
    },
  });
}
