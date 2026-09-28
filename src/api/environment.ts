import { apiRequest } from "./client";

export type AppEnvironment = "development" | "staging" | "production";
export type TradingMode = "paper" | "live";
export type TradingState = "ok" | "blocked" | "offline" | "halted";

/** Public (works before login): only the environment name and trading mode. */
export interface PublicEnvironment {
  environment: AppEnvironment;
  tradingMode: TradingMode;
}

export interface EnvironmentDetails extends PublicEnvironment {
  trading: { state: TradingState; reason: string | null };
  /** The operator kill switch (Risk & Limits → Trading halt). `trading.state` is "halted" while it is on. */
  tradingHalt: { enabled: boolean; reason: string | null; setByDisplayName: string | null; setAt: string | null };
  /** Non-null while a scheduled scan (the 10:00 ET chain capture or the trade-alert scan) holds its priority market-data lines (the top bar's "Live data restricted"). */
  marketDataRestriction: { priorityLines: number; holders: string[] } | null;
  /** False when IBKR_MARKET_DATA_LINES_ENABLED=false (typically dev) — the top bar's "Real-time data disabled" state. */
  marketDataLinesEnabled: boolean;
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
