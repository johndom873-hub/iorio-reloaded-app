import { apiRequest } from "./client";

export type AppEnvironment = "development" | "staging" | "production";
export type TradingMode = "paper" | "live";
export type TradingState = "ok" | "blocked" | "offline";

/** Public (works before login): only the environment name and trading mode. */
export interface PublicEnvironment {
  environment: AppEnvironment;
  tradingMode: TradingMode;
}

export interface EnvironmentDetails extends PublicEnvironment {
  trading: { state: TradingState; reason: string | null };
  /** Non-null while the 10:00 ET chain capture holds its priority market-data lines (the top bar's "Live data restricted"). */
  marketDataRestriction: { priorityLines: number; holders: string[] } | null;
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
