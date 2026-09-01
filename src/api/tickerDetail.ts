import { apiRequest, apiBaseUrl } from "./client";

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "All";

export interface TickerPricing {
  last: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
}

export interface OptionQuote {
  expiry: string; // YYYYMMDD
  strike: number;
  right: "C" | "P";
  bid: number | null;
  ask: number | null;
  last: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
}

export interface TickerOverview {
  companyName: string | null;
  sector: string | null;
  pricing: TickerPricing;
}

export interface PriceBar {
  time: number; // Unix epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TickerDetailSection = "overview" | "chart" | "optionChain" | "technicals";

export interface MovingAverages {
  ma7: number | null;
  ma25: number | null;
  ma99: number | null;
}

export type MacdSignal = "Bullish" | "Bearish" | "Neutral";

export interface SupportResistanceZone {
  price: number;
  qualityPct: number;
  touches: number;
  atr: number;
}

export interface SupportResistanceResult {
  support: SupportResistanceZone | null;
  resistance: SupportResistanceZone | null;
}

export interface TickerTechnicals {
  movingAverages: MovingAverages;
  rsi: number;
  macdSignal: MacdSignal;
  supportResistance: SupportResistanceResult;
}

// Mirrors the backend's TickerDetailStreamEvent (streamTickerDetail.ts) plus
// the two stream-lifecycle events the route itself sends (done/streamError).
export type TickerDetailStreamEvent =
  | { type: "overview"; data: TickerOverview }
  | { type: "chart"; data: PriceBar[] }
  | { type: "optionChain"; data: OptionQuote[] }
  | { type: "technicals"; data: TickerTechnicals }
  | { type: "error"; section: TickerDetailSection; message: string }
  | { type: "streamError"; message: string }
  | { type: "done" };

/**
 * Opens the Ticker Detail SSE stream and forwards each parsed event. See
 * streamTickerDetail.ts on the backend for why this is a stream rather than
 * one blocking request: pricing/chart/optionChain arrive independently
 * instead of the modal blocking on the slowest of the three (the option
 * chain, ~15-25s).
 *
 * Closes itself on "done"/"streamError" (terminal events) rather than
 * relying on EventSource's default auto-reconnect behavior, which would
 * otherwise silently re-open a fresh, expensive IBKR connection after a
 * clean server-side close. Returns a cleanup function for the caller to
 * invoke on unmount/symbol change.
 */
export function openTickerDetailStream(symbol: string, onEvent: (event: TickerDetailStreamEvent) => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/tickers/${encodeURIComponent(symbol)}/detail/stream`, {
    withCredentials: true,
  });

  source.onmessage = (message) => {
    let event: TickerDetailStreamEvent;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === "done" || event.type === "streamError") source.close();
  };

  source.onerror = () => {
    onEvent({ type: "streamError", message: "Connection to the server was lost." });
    source.close();
  };

  return () => source.close();
}

export function fetchTickerChart(symbol: string, range: ChartRange): Promise<PriceBar[]> {
  return apiRequest<PriceBar[]>(`/tickers/${encodeURIComponent(symbol)}/chart?range=${range}`);
}

// Daily-only, unlike ChartRange — IBKR's OPTION_IMPLIED_VOLATILITY history
// is one blended value per day for the underlying, no intraday granularity.
export type IvChartRange = "1Y" | "5Y" | "All";

export interface IvChartPoint {
  time: number; // Unix epoch seconds
  value: number;
}

export function fetchTickerIvChart(symbol: string, range: IvChartRange): Promise<IvChartPoint[]> {
  return apiRequest<IvChartPoint[]>(`/tickers/${encodeURIComponent(symbol)}/iv-chart?range=${range}`);
}

export type PositionQuoteStreamEvent =
  | { type: "overview"; data: { pricing: TickerPricing } }
  | { type: "optionChain"; data: OptionQuote[] }
  | { type: "error"; section: "overview" | "optionChain"; message: string }
  | { type: "streamError"; message: string }
  | { type: "done" };

/**
 * New Position form's live-quote lookup — pricing + option chain only, no
 * chart. See the backend's streamPositionQuote.ts for why this is a
 * separate, lighter stream than openTickerDetailStream rather than that one
 * with the chart event ignored.
 */
export function openPositionQuoteStream(symbol: string, onEvent: (event: PositionQuoteStreamEvent) => void): () => void {
  const source = new EventSource(`${apiBaseUrl}/tickers/${encodeURIComponent(symbol)}/position-quote/stream`, {
    withCredentials: true,
  });

  source.onmessage = (message) => {
    let event: PositionQuoteStreamEvent;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === "done" || event.type === "streamError") source.close();
  };

  source.onerror = () => {
    onEvent({ type: "streamError", message: "Connection to the server was lost." });
    source.close();
  };

  return () => source.close();
}
