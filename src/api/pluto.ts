import { apiRequest } from "./client";

// Pluto — the autonomous trading agent. Routes live in the API's routes/pluto.ts; every shape here
// mirrors that file's serializers.

export type PlutoMode = "off" | "on";

export interface PlutoBreakerTrip {
  trippedAt: string;
  detail: string;
}

export interface PlutoSession {
  dateIso: string;
  isOpen: boolean;
  closeTimeEt: string;
  closeSource: "ibkr_liquid_hours" | "fallback_list" | "regular";
  closeReadAt: string | null;
  windowStartEt: string;
  windowEndEt: string;
  cancelByEt: string;
}

/** The pluto_state row as the mutation routes (mode, pause, resume, breaker reset) return it. */
export interface PlutoStateCore {
  mode: PlutoMode;
  paused: boolean;
  /** "manual" | "deploy" | "crash_loop" | "breaker:<name>" */
  pauseReason: string | null;
  pausedByUserId: string | null;
  pausedByDisplayName: string | null;
  pausedAt: string | null;
  lastSeenRelease: string | null;
  breakers: Record<string, PlutoBreakerTrip>;
  lastPassAt: string | null;
  updatedAt: string;
}

/** GET /pluto/state: the row plus everything the screen's header and tiles need. */
export interface PlutoState extends PlutoStateCore {
  blockReason: string | null;
  orders: { working: number; unsent: number };
  counters: { actionsToday: number; modelCallsToday: number; costTodayUsd: number; maxActionsPerSession: number; maxModelCallsPerSession: number; dailyCostCeilingUsd: number };
  enabledTickers: { count: number; max: number };
  session: PlutoSession;
  book: {
    committedDollars: number;
    openPositionCount: number;
    openSymbols: string[];
    workingOrderSymbols: string[];
    netLiquidationValue: number | null;
    netLiquidationValueAsOf: string | null;
    capitalBudgetPct: number;
    maxOpenPositions: number;
  };
  agent: { connected: boolean; heartbeatAgeSeconds: number; gitSha: string | null; appEnvironment: string | null } | null;
}

export type PlutoReasoningEffort = "low" | "medium" | "high";
export type PlutoTelegramVerbosity = "actions" | "all" | "off";

export interface PlutoSettings {
  capitalBudgetPct: number;
  maxTickerExposurePct: number;
  maxSectorExposurePct: number;
  maxOpenPositions: number;
  maxActionsPerSession: number;
  maxOrderNotionalPct: number;
  minCashReservePct: number;
  minGrade: "strong" | "good" | "weak";
  minEdgeDollars: number;
  maxAbsDelta: number;
  minDte: number;
  maxDte: number;
  minAnnualizedYieldPct: number;
  maxSpreadPct: number;
  minOpenInterest: number;
  minSessionVolume: number;
  maxQuoteAgeMinutes: number;
  maxContractsVolumeSharePct: number;
  maxSliceRmseVp: number;
  minSlicePointCount: number;
  maxMidVsSurfaceIvVp: number;
  maxIvShiftVp: number;
  maxAbsDayChangePct: number;
  windowStartEt: string;
  windowEndEt: string;
  dailyLossBreakerPct: number;
  spyStressBreakerPct: number;
  unfilledCancelMinutes: number;
  maxEdgeDriftVp: number;
  tickerCooldownSessions: number;
  modelId: string;
  reasoningEffort: PlutoReasoningEffort;
  callTimeoutSeconds: number;
  dailyCostCeilingUsd: number;
  confidenceFloor: number;
  maxModelCallsPerSession: number;
  consecutiveModelFailuresBreaker: number;
  promptVersion: string;
  spotMoveTriggerPct: number;
  burstLines: number;
  burstSettleSeconds: number;
  coalescingWindowSeconds: number;
  perTickerModelCooldownMinutes: number;
  globalMinCallIntervalSeconds: number;
  maxEnabledTickers: number;
  messageRateLimitPerSecond: number;
  crashLoopRestartsPerHour: number;
  telegramVerbosity: PlutoTelegramVerbosity;
  unstructuredCloseMinPct: number;
  unstructuredCloseMinDollars: number;
  buybackMinDte: number;
  updatedAt: string;
  updatedByUserId: string | null;
}

export type PlutoSettingsField = Exclude<keyof PlutoSettings, "updatedAt" | "updatedByUserId">;
export type PlutoSettingsInput = Partial<Record<PlutoSettingsField, string | number>>;

export interface PlutoSettingsAuditRow {
  id: number;
  changedAt: string;
  userId: string | null;
  userDisplayName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface PlutoSystemCheck {
  ok: boolean;
  detail: string;
}

export interface PlutoGateResult {
  gate: string;
  ok: boolean;
  detail: string;
}

export type PlutoActionKind = "open_covered_call" | "open_cash_secured_put" | "roll" | "close_shares" | "close_leg" | "no_trade";
export type PlutoActionOutcome = "validated" | "blocked" | "order_built" | "confirmed" | "filled" | "partially_filled" | "cancelled" | "rejected" | "error" | "no_trade";

export interface PlutoAction {
  id: string;
  passId: string;
  kind: PlutoActionKind;
  symbol: string;
  tickerId: string | null;
  contract: { strategyKey?: string; expiry?: string; strike?: number; legId?: string; positionId?: string; legIds?: string[] } | null;
  candidateScores: Record<string, unknown> | null;
  deterministicTopPick: { id: string; edgeDollars: number; netEdge: number; grade: string } | null;
  gateResults: PlutoGateResult[];
  sizeTier: "full" | "half" | null;
  quantity: number | null;
  limitPrice: number | null;
  outcome: PlutoActionOutcome;
  blockReason: string | null;
  orderRequestId: string | null;
  referenceBid: number | null;
  referenceMid: number | null;
  fillPrice: number | null;
  pessimisticPnl: number | null;
  realizedPnl: number | null;
  evaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlutoDecisionOutput {
  decision: "trade" | "no_trade" | "abstain";
  actionKind?: string | null;
  candidateId?: string | null;
  sizeTier?: "full" | "half" | null;
  confidence?: number;
  reasons?: string[];
  risksAcknowledged?: string[];
  systemConcerns?: string[];
}

export interface PlutoPassDecision {
  callIndex: number;
  servedModelId: string | null;
  parsedOutput: PlutoDecisionOutput | null;
  schemaValid: boolean;
  latencyMs: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface PlutoPass {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  triggerDetail: Record<string, unknown>;
  inputHash: string | null;
  candidateCount: number | null;
  systemChecks: Record<string, PlutoSystemCheck> | null;
  modelCalled: boolean;
  skippedReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  servedModelIds: string[];
  decisions: PlutoPassDecision[];
  actions: PlutoAction[];
}

export interface PlutoEvent {
  id: number;
  occurredAt: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface PlutoTicker {
  entryId: string;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  botEnabled: boolean;
  botEnabledChangedAt: string | null;
  botEnabledChangedBy: string | null;
}

export function fetchPlutoState(): Promise<PlutoState> {
  return apiRequest<PlutoState>("/pluto/state");
}

export function updatePlutoMode(mode: PlutoMode): Promise<PlutoStateCore> {
  return apiRequest<PlutoStateCore>("/pluto/mode", { method: "PUT", body: JSON.stringify({ mode }) });
}

export function pausePluto(cancelWorkingOrders: boolean): Promise<PlutoStateCore> {
  return apiRequest<PlutoStateCore>("/pluto/pause", { method: "POST", body: JSON.stringify({ cancelWorkingOrders }) });
}

export function resumePluto(): Promise<PlutoStateCore> {
  return apiRequest<PlutoStateCore>("/pluto/resume", { method: "POST", body: JSON.stringify({}) });
}

export function resetPlutoBreaker(name: string): Promise<PlutoStateCore> {
  return apiRequest<PlutoStateCore>(`/pluto/breakers/${encodeURIComponent(name)}/reset`, { method: "POST", body: JSON.stringify({}) });
}

export function fetchPlutoSettings(): Promise<PlutoSettings> {
  return apiRequest<PlutoSettings>("/pluto/settings");
}

export function updatePlutoSettings(input: PlutoSettingsInput): Promise<PlutoSettings> {
  return apiRequest<PlutoSettings>("/pluto/settings", { method: "PUT", body: JSON.stringify(input) });
}

export function fetchPlutoSettingsAudit(limit = 20): Promise<PlutoSettingsAuditRow[]> {
  return apiRequest<PlutoSettingsAuditRow[]>(`/pluto/settings/audit?limit=${limit}`);
}

export function fetchPlutoPasses(limit = 30): Promise<PlutoPass[]> {
  return apiRequest<PlutoPass[]>(`/pluto/passes?limit=${limit}`);
}

export function fetchPlutoActions(limit = 100): Promise<PlutoAction[]> {
  return apiRequest<PlutoAction[]>(`/pluto/actions?limit=${limit}`);
}

export function fetchPlutoEvents(limit = 200): Promise<PlutoEvent[]> {
  return apiRequest<PlutoEvent[]>(`/pluto/events?limit=${limit}`);
}

export function fetchPlutoTickers(): Promise<{ max: number; tickers: PlutoTicker[] }> {
  return apiRequest<{ max: number; tickers: PlutoTicker[] }>("/pluto/tickers");
}

export function updateShortlistBotEnabled(entryId: string, enabled: boolean): Promise<{ botEnabled: boolean }> {
  return apiRequest<{ botEnabled: boolean }>(`/shortlist/${entryId}/bot-enabled`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
