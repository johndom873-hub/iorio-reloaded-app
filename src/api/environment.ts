import { apiRequest } from "./client";

export type AppEnvironment = "development" | "staging" | "production";
export type TradingMode = "paper" | "live";
export type TradingState = "ok" | "blocked" | "offline" | "halted";

/** Public (works before login): only the environment name and trading mode. */
export interface PublicEnvironment {
  environment: AppEnvironment;
  tradingMode: TradingMode;
}

export interface MarketDataFeedRefusal {
  code: number;
  message: string;
  /** ISO time of the first refusal. */
  since: string;
}

/** A ticker nobody trades until its stock split's records are rewritten and it is unfrozen (npm run ticker:unfreeze). */
export interface FrozenTicker {
  symbol: string;
  /** "2-for-1 stock split effective 2026-12-01". */
  reason: string;
  /** ISO time it was frozen. */
  frozenAt: string;
}

export interface EnvironmentDetails extends PublicEnvironment {
  trading: { state: TradingState; reason: string | null };
  /** The operator kill switch (Risk & Limits → Trading halt). `trading.state` is "halted" while it is on. */
  tradingHalt: { enabled: boolean; reason: string | null; setByDisplayName: string | null; setAt: string | null };
  /** False when IBKR_MARKET_DATA_LINES_ENABLED=false (typically dev) — the top bar's "Real-time data disabled" state. */
  marketDataLinesEnabled: boolean;
  /** Non-null while IBKR refuses live market data (code 10197: usually a stale Gateway session, sometimes a live login elsewhere) — the top bar's "Live prices stopped". */
  marketDataFeedRefusal: MarketDataFeedRefusal | null;
  /** Frozen tickers (a stock split until their records are rewritten): the top bar's pill and every screen's Frozen badge. */
  frozenTickers: FrozenTicker[];
  worker: {
    gitSha: string | null;
    accountId: string | null;
    detectedTradingMode: string | null;
    bindingStatus: string | null;
    heartbeatAgeSeconds: number;
  } | null;
}

export function fetchPublicEnvironment(): Promise<PublicEnvironment> {
  return apiRequest<PublicEnvironment>("/environment");
}

export function fetchEnvironmentDetails(): Promise<EnvironmentDetails> {
  return apiRequest<EnvironmentDetails>("/environment/details");
}
