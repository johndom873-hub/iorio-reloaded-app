import { apiRequest, apiStreamedRequest } from "./client";

export type JobRunStatus = "running" | "success" | "failure";

export interface JobRun {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobRunStatus;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
}

export function fetchJobRuns(limit = 50): Promise<JobRun[]> {
  return apiRequest<JobRun[]>(`/system-health/jobs?limit=${limit}`);
}

export function fetchJobStatuses(): Promise<JobRun[]> {
  return apiRequest<JobRun[]>("/system-health/status");
}

export function triggerIbkrHealthCheck(): Promise<JobRun | null> {
  return apiStreamedRequest<JobRun | null>("/system-health/check-ibkr", { method: "POST" });
}

// --- Iorio Pulse node stats (2026-09-13) ---

export interface PresenceUser {
  id: string;
  displayName: string;
  online: boolean;
  /** ISO time of the user's last open tab (connect or disconnect). Null only for an online user who connected before last-seen tracking existed. */
  lastSeenAt: string | null;
}

/** Up to 3 users: online first, then most recently active. */
export function fetchPresence(): Promise<{ users: PresenceUser[] }> {
  return apiRequest<{ users: PresenceUser[] }>("/system-health/presence");
}

export type MarketSessionState = "pre-market" | "open" | "after-hours" | "closed";

export interface MarketStatus {
  exchanges: string[];
  state: MarketSessionState;
  label: string;
  /** ISO instant the countdown in `label` runs to; the top-bar badge ticks it down between polls. */
  nextChangeAt: string;
}

export function fetchMarketStatus(): Promise<MarketStatus> {
  return apiRequest<MarketStatus>("/system-health/market-status");
}

export interface DbHealth {
  totalConnections: string;
  maxConnections: number;
  databaseSizeBytes: string;
  maxDatabaseSizeBytes: string;
  /** Rolling 5-minute query latency of the web dyno's own queries; null when no queries ran in the window. */
  responseTime: { averageMs: number | null; slowestMs: number | null };
}

export interface GenosukeHealth {
  messagesToday: string;
  activeSessions: string;
  llm: { model: string | null; callsPerMinute: number; avgLatencyMs: number | null };
}

export interface WebDynoHealth {
  requestsPerMinute: number;
  uptimeSeconds: number;
  processStartedAt: string;
  notificationStreamConnections: number;
}

export interface GatewayHealth {
  connected: boolean;
  staleOrMissing: boolean;
  uptimeMs?: number | null;
  totalReconnects?: number;
  /** Connection drops in the last 24 hours, excluding the Gateway's planned daily restart; null when the worker predates the reading. */
  unplannedDropsLast24h?: number | null;
  lastSystemStatusCode?: number | null;
  clientId?: number | null;
  updatedAt?: string;
  inFlightOrderCount: number;
  /** IBKR market-data lines in use across every process sharing the login, by use (screens, chain capture, Day Signals, snapshots). */
  marketDataLines?: { inUse: number; budget: number; byUse: { label: string; lines: number }[] };
  /** The operator kill switch (platform_controls.trading_halt). */
  tradingHalted?: boolean;
}

/** The Pulse page's five readings in one request; a reading the server failed to load is null. */
export interface SystemHealthSummary {
  db: DbHealth | null;
  genosuke: GenosukeHealth | null;
  webDyno: WebDynoHealth | null;
  gateway: GatewayHealth | null;
  presence: { users: PresenceUser[] } | null;
}

export function fetchSystemHealthSummary(): Promise<SystemHealthSummary> {
  return apiRequest<SystemHealthSummary>("/system-health/summary");
}
