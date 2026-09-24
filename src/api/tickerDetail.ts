import { apiRequest, apiBaseUrl, apiStreamedRequest } from "./client";

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
  isShortlisted: boolean;
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
  // Header price: same frozen-then-live, last-trade-only source as the Positions table (see streamTickerDetail.ts).
  | { type: "spot"; data: { last: number } }
  | { type: "chart"; data: PriceBar[] }
  | { type: "optionChain"; data: OptionQuote[] }
  // The chain's expiry tabs with their strikes (before any quote) and which expiry the stream quotes live.
  | { type: "optionChainExpiries"; data: { expiries: OptionChainExpiry[]; activeExpiry: string } }
  | { type: "technicals"; data: TickerTechnicals }
  | { type: "error"; section: TickerDetailSection; message: string }
  | { type: "streamError"; message: string }
  | { type: "done" };

export interface OptionChainExpiry {
  expiry: string; // YYYYMMDD
  strikes: number[];
}

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
export type TickerDetailStreamSection = "overview" | "spot" | "chart" | "optionChain" | "technicals";

export function openTickerDetailStream(
  symbol: string,
  onEvent: (event: TickerDetailStreamEvent) => void,
  options: { sections?: TickerDetailStreamSection[]; expiry?: string } = {},
): () => void {
  // No `sections` = everything. The Signals modal asks for a subset to skip the option chain; Ticker Detail opens the
  // chain as its own stream with `expiry` (only that tab's strikes are quoted — 2026-09-24).
  const params = new URLSearchParams();
  if (options.sections) params.set("sections", options.sections.join(","));
  if (options.expiry) params.set("expiry", options.expiry);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return openDeferredEventSource(`${apiBaseUrl}/tickers/${encodeURIComponent(symbol)}/detail/stream${query}`, onEvent);
}

/**
 * Opens an EventSource one tick later so an effect torn down and re-run in
 * the same tick (React StrictMode's mount → unmount → mount in dev) never
 * opens the stream twice — the same deferral the multiplexer already does.
 * Closes itself on the terminal "done"/"streamError" events.
 */
export function openDeferredEventSource<TEvent extends { type: string }>(url: string, onEvent: (event: TEvent | { type: "streamError"; message: string }) => void): () => void {
  let source: EventSource | null = null;
  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled) return;
    source = new EventSource(url, { withCredentials: true });
    source.onmessage = (message) => {
      let event: TEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      onEvent(event);
      if (event.type === "done" || event.type === "streamError") source?.close();
    };
    source.onerror = () => {
      onEvent({ type: "streamError", message: "Connection to the server was lost." });
      source?.close();
    };
  }, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    source?.close();
  };
}

export function fetchTickerChart(symbol: string, range: ChartRange): Promise<PriceBar[]> {
  return apiStreamedRequest<PriceBar[]>(`/tickers/${encodeURIComponent(symbol)}/chart?range=${range}`);
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

