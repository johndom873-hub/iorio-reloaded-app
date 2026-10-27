import { apiRequest } from "./client";

// The Volatility screen and Pulse's Top premiums (API src/routes/volatility.ts).

export interface DeltaBand {
  min: number;
  max: number;
}

export type ExpiryWindowKey = "upTo7" | "from8To21" | "from22To45";

export interface BestCallYield {
  /** Yield a year after costs, as a fraction (1.10 = 110%). */
  yield: number;
  expiry: string;
  daysToExpiry: number;
  strike: number;
  delta: number;
  bid: number;
  ask: number;
  earningsBeforeExpiry: boolean;
  quotedAt: string;
}

export interface VolatilityRow {
  tickerId: string;
  symbol: string;
  companyName: string | null;
  price: number | null;
  priceSource: "live" | "close" | null;
  dayChangePercent: number | null;
  /** IBKR's 30-day implied volatility, as a fraction. */
  atmImpliedVolatility: number | null;
  atmImpliedVolatilitySource: "live" | "close" | null;
  forecast21: number | null;
  forecast63: number | null;
  /** 0-100. */
  ivRank: number | null;
  ivPercentile: number | null;
  ivWindowDays: number;
  dailyBarCount: number;
  nextEarningsDateIso: string | null;
  bestCallYields: Record<ExpiryWindowKey, BestCallYield | null>;
}

export interface VolatilityScreen {
  asOf: string;
  todayIso: string;
  deltaBand: DeltaBand;
  riskLimitsBand: DeltaBand;
  rows: VolatilityRow[];
}

export function fetchVolatilityScreen(band: DeltaBand | null): Promise<VolatilityScreen> {
  return apiRequest<VolatilityScreen>(band ? `/volatility?deltaMin=${band.min}&deltaMax=${band.max}` : "/volatility");
}

export interface TopPremiumRow {
  tickerId: string;
  symbol: string;
  best: BestCallYield;
}

export interface TopPremiums {
  asOf: string;
  deltaBand: DeltaBand;
  tickerCount: number;
  rows: TopPremiumRow[];
}

export function fetchTopPremiums(): Promise<TopPremiums> {
  return apiRequest<TopPremiums>("/volatility/top-premiums");
}

/** One ticker's row (the Ticker modal's strip); 404 for a ticker outside the Shortlist with no open position. */
export function fetchTickerVolatility(symbol: string): Promise<VolatilityRow> {
  return apiRequest<VolatilityRow>(`/volatility/ticker/${encodeURIComponent(symbol)}`);
}
