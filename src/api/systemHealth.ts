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

export function fetchDbHealth(): Promise<DbHealth> {
  return apiRequest<DbHealth>("/system-health/db");
}

export interface GenosukeHealth {
  messagesToday: string;
  activeSessions: string;
  llm: { model: string | null; callsPerMinute: number; avgLatencyMs: number | null };
}

export function fetchGenosukeHealth(): Promise<GenosukeHealth> {
  return apiRequest<GenosukeHealth>("/system-health/genosuke");
}

export interface WebDynoHealth {
  requestsPerMinute: number;
  uptimeSeconds: number;
  processStartedAt: string;
  notificationStreamConnections: number;
}

export function fetchWebDynoHealth(): Promise<WebDynoHealth> {
  return apiRequest<WebDynoHealth>("/system-health/web-dyno");
}

export interface GatewayHealth {
  connected: boolean;
  staleOrMissing: boolean;
  uptimeMs?: number | null;
  totalReconnects?: number;
  lastSystemStatusCode?: number | null;
  clientId?: number | null;
  updatedAt?: string;
  inFlightOrderCount: number;
  marketDataLineCount?: number;
  reservedLineCount?: number;
}

export function fetchGatewayHealth(): Promise<GatewayHealth> {
  return apiRequest<GatewayHealth>("/system-health/gateway");
}
