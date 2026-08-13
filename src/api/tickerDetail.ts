import { apiRequest } from "./client";

export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "All";

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

export interface TickerDetail {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  pricing: TickerPricing;
  optionChain: OptionQuote[];
}

export interface PriceBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function fetchTickerDetail(symbol: string): Promise<TickerDetail> {
  return apiRequest<TickerDetail>(`/tickers/${encodeURIComponent(symbol)}/detail`);
}

export function fetchTickerChart(symbol: string, range: ChartRange): Promise<PriceBar[]> {
  return apiRequest<PriceBar[]>(`/tickers/${encodeURIComponent(symbol)}/chart?range=${range}`);
}
