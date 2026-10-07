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
  /** Instants (ISO) of today's window and close, for countdowns in the viewer's clock. */
  windowStartAt: string;
  windowEndAt: string;
  closeAt: string;
}

/** One of Pluto's orders IBKR may still be working (or still on its way there). */
export interface PlutoWorkingOrder {
  actionId: string;
  orderRequestId: string;
  symbol: string;
  kind: PlutoActionKind;
  contract: PlutoActionContract | null;
  quantity: number | null;
  limitPrice: number | null;
  status: string;
  createdAt: string;
}

export interface PlutoOrdersToday {
  sent: number;
  filled: number;
  working: number;
  blocked: number;
}

/** The pluto_state row as the mutation routes (mode, pause, resume, breaker reset) return it. */
export interface PlutoStateCore {
  mode: PlutoMode;
  paused: boolean;
  /** "manual" | "deploy" | "crash_loop" | "readiness" | "breaker:<name>" */
  pauseReason: string | null;
  pausedByUserId: string | null;
  pausedByDisplayName: string | null;
  pausedAt: string | null;
  lastSeenRelease: string | null;
  breakers: Record<string, PlutoBreakerTrip>;
  lastPassAt: string | null;
  /** Eastern date on which the SPY stress check is overridden ("allow opens under stress today"), else null. */
  stressOverrideDate: string | null;
  stressOverrideByDisplayName: string | null;
  /** The latest pre-open readiness run (6:00 ET, re-run every 10 min while failing, final at 9:20 ET). */
  readiness: PlutoReadinessRecord | null;
  updatedAt: string;
}

export interface PlutoReadinessResult {
  name: "IBKR" | "API sign-in" | "OpenRouter" | "Pluto running";
  ok: boolean;
  detail: string;
}

export interface PlutoReadinessRecord {
  dateIso: string;
  lastRunAt: string;
  lastRunKind: "first" | "recheck" | "final";
  /** Failing tests' names joined, "" when all passed. */
  signature: string;
  finalDone: boolean;
  results: PlutoReadinessResult[];
}

/** GET /pluto/state: the row plus everything the screen's header and tiles need. */
export interface PlutoState extends PlutoStateCore {
  blockReason: string | null;
  /** The latest switch on/off: who and when (from the event log). */
  modeChangedAt: string | null;
  modeChangedBy: string | null;
  orders: { working: number; pending: number };
  ordersToday: PlutoOrdersToday;
  workingOrders: PlutoWorkingOrder[];
  /** The platform's unfilled-order sweep cancels an order resting this long at IBKR (0 = never). */
  unfilledCancelMinutes: number;
  counters: { actionsToday: number; modelCallsToday: number; costTodayUsd: number; maxActionsPerSession: number; dailyCostCeilingUsd: number };
  enabledTickers: { count: number; max: number };
  session: PlutoSession;
  /** The newest analysis's pre-model checks: what holds Pluto back between analyses (worker offline, SPY stress…). */
  lastChecks: { passId: string; startedAt: string; checks: Record<string, PlutoSystemCheck> } | null;
  book: {
    committedDollars: number;
    openPositionCount: number;
    openSymbols: string[];
    workingOrderSymbols: string[];
    openPositionsBySymbol: Record<string, number>;
    workingOrdersBySymbol: Record<string, number>;
    netLiquidationValue: number | null;
    netLiquidationValueAsOf: string | null;
    capitalBudgetPct: number;
    orderSizePctOfBudget: number;
    maxOpenPositions: number;
  };
  agent: { connected: boolean; heartbeatAgeSeconds: number; gitSha: string | null; appEnvironment: string | null } | null;
}

export type PlutoReasoningEffort = "low" | "medium" | "high";
export type PlutoTelegramVerbosity = "actions" | "off";

export interface PlutoSettings {
  capitalBudgetPct: number;
  maxTickerExposurePct: number;
  maxSectorExposurePct: number;
  maxOpenPositions: number;
  maxActionsPerSession: number;
  orderSizePctOfBudget: number;
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
  maxDayMoveMultiple: number;
  windowStartEt: string;
  windowEndEt: string;
  dailyLossBreakerPct: number;
  spyStressBreakerPct: number;
  maxEdgeDriftVp: number;
  tickerCooldownMinutes: number;
  maxFillSlippagePct: number;
  modelId: string;
  reasoningEffort: PlutoReasoningEffort;
  callTimeoutSeconds: number;
  dailyCostCeilingUsd: number;
  confidenceFloor: number;
  consecutiveModelFailuresBreaker: number;
  promptVersion: string;
  daySignalsPollSeconds: number;
  burstLines: number;
  burstSettleSeconds: number;
  perTickerModelCooldownMinutes: number;
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
export type PlutoActionOutcome = "validated" | "blocked" | "order_built" | "confirmed" | "filled" | "partially_filled" | "cancelled" | "cancelled_partially_filled" | "rejected" | "error" | "no_trade";

/** What an action trades: an open's contract, a roll's replacement (plus the held leg it replaces), a close's leg or shares. */
export interface PlutoActionContract {
  strategyKey?: string;
  expiry?: string;
  strike?: number;
  right?: "C" | "P";
  legId?: string;
  /** Rolls: the held leg being replaced. */
  fromStrike?: number;
  fromExpiry?: string;
  positionId?: string;
  legIds?: string[];
}

export interface PlutoAction {
  id: string;
  passId: string;
  kind: PlutoActionKind;
  symbol: string;
  tickerId: string | null;
  contract: PlutoActionContract | null;
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
  /** IBKR's reported average fill of the chosen option (for a two-part order, its own split of the net). */
  fillPrice: number | null;
  /** Two-part orders only: the option's price implied by the net fill, with the other part at the price Pluto set. */
  impliedFillPrice: number | null;
  /** EXP $ the order adds (negative when a close releases exposure), as Positions counts it; null without an order. */
  exposureDollars: number | null;
  /** Contracts (shares for a share sale) the order's trades filled so far; null before any fill or without an order. */
  filledQuantity: number | null;
  /** Derived at read time from the legs this action opened (or closed, when a human opened them); null while none has closed. */
  realizedPnl: number | null;
  closedLegCount: number;
  openLegCount: number;
  evaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The model's parsed answer, stored as the schema names it (snake_case). */
export interface PlutoDecisionOutput {
  decision: "trade" | "no_trade" | "abstain_system_concern" | "abstain";
  action_kind?: string | null;
  candidate_id?: string | null;
  confidence?: number;
  reasons?: string[];
  risks_acknowledged?: string[];
  /** One per data problem: a ticker of the round, or null for the whole message (prompt v3.3; older decisions arrive as null). */
  system_concerns?: { symbol: string | null; concern: string }[];
}

export interface PlutoPassDecision {
  callIndex: number;
  servedModelId: string | null;
  /** OpenRouter service tier that served the call (default / flex / priority). */
  serviceTier: string | null;
  parsedOutput: PlutoDecisionOutput | null;
  schemaValid: boolean;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  error: string | null;
  /** Only on GET /pluto/passes/:id: what the model was shown. */
  inputPayload?: PlutoModelInput;
}

/** One option as the model saw it (the prompt's compact candidate; every field optional because the payload drops nulls). */
export interface PlutoModelInputContract {
  id: string;
  kind: string;
  expiry?: string;
  dte?: number;
  strike?: number;
  delta?: number;
  bid?: number;
  ask?: number;
  spread_pct?: number;
  surface_iv?: number;
  mid_iv?: number;
  edge_vp?: number;
  net_edge_vp?: number;
  edge_dollars?: number;
  ann_yield_pct?: number;
  dollar_risk?: number;
  oi?: number;
  vol?: number;
  grade?: string;
  quote_source?: string;
  quote_age_min?: number;
  flags?: string[];
}

export interface PlutoModelInputRoll {
  id: string;
  quantity?: number;
  net_roll_edge_vp?: number;
  net_roll_edge_dollars?: number;
  net_credit_per_share?: number;
  delta_change?: number;
  grade?: string;
  flags?: string[];
  replacement: PlutoModelInputContract;
}

/** A close offer (Formulas P1/P2): close_leg carries the buyback figures, close_shares the share figures. */
export interface PlutoModelInputCloseAction {
  id: string;
  kind: "close_leg" | "close_shares";
  description: string;
  cycle_pnl?: number;
  dte?: number;
  ask?: number;
  entry_credit?: number;
  hold_edge_dollars?: number;
  close_cost_dollars?: number;
  pnl_at_ask?: number;
  shares?: number;
  entry_price?: number;
  cycle_pnl_pct_of_capital?: number | null;
  odd_lot?: boolean;
}

export interface PlutoModelInputTicker {
  symbol: string;
  sector?: string;
  spot?: number;
  day_change_pct?: number;
  atm_iv?: number;
  forecast_rv?: number;
  momentum_12_1?: number;
  skew_vp?: number;
  elevated_vol?: boolean;
  next_earnings?: string;
  macro_events?: { date: string; title: string }[];
  open_positions?: string[];
  move_context?: { day_move_sigmas?: number; expected_daily_move_pct?: number; change_1w_pct?: number; change_1m_pct?: number; change_3m_pct?: number; realized_vol_21d?: number; realized_vol_126d?: number; iv_rank?: number };
  candidates?: PlutoModelInputContract[];
  rolls?: PlutoModelInputRoll[];
  close_actions?: PlutoModelInputCloseAction[];
}

/** The user message of one model call: exactly what the model was shown (pluto/prompt.ts on the API). */
export interface PlutoModelInput {
  as_of: string;
  session?: { date: string; minutes_to_window_end: number };
  trigger?: { kind: string; detail: Record<string, unknown> };
  market?: { spy_day_change_pct?: number };
  account?: { nlv?: number; free_cash?: number; pluto_budget_pct?: number; pluto_budget_used_pct?: number; open_pluto_positions?: number; managed_positions?: number; max_open_positions?: number; actions_today?: number; max_actions_per_session?: number };
  parameters?: { min_grade?: string; max_abs_delta?: number; dte_range?: [number, number]; max_ticker_exposure_pct?: number; order_size_pct_of_budget?: number; confidence_floor?: number; spread_cost_share_pct?: number };
  tickers?: PlutoModelInputTicker[];
  recent_decisions?: { at: string; verdict: string; candidate_id?: string; outcome?: string; outcome_detail?: string; reason?: string }[];
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
  promptVersion: string | null;
  decisions: PlutoPassDecision[];
  actions: PlutoAction[];
}

export type PlutoEventCategory = "system" | "config" | "safety" | "analysis" | "trading" | "info";

export interface PlutoEvent {
  id: number;
  occurredAt: string;
  type: string;
  category: PlutoEventCategory;
  /** Names no ticker and belongs to no pass (settings, pauses, breakers): part of every ticker's trace. */
  appliesToAllTickers?: boolean;
  payload: Record<string, unknown>;
}

/** What the Event log narrows by; an empty `categories` list matches nothing, `ticker` / `session` empty match everything. */
export interface PlutoEventFilters {
  categories: PlutoEventCategory[];
  ticker: string;
  /** An Eastern trading day, "YYYY-MM-DD", or "" for every day. */
  session: string;
}

export interface PlutoEventsPage {
  events: PlutoEvent[];
  /** Every event matching the filters, not only this page. */
  total: number;
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

/** Whether Day Signals is watching a Pluto-enabled ticker today, and when it looks again (API daySignalsWatchStatus.ts). */
export interface DaySignalsWatchStatus {
  kind: "watched" | "not_watched" | "no_surface" | "waiting_for_capture" | "market_closed";
  pooledExpiries: string[];
  lastLookAt: string | null;
  lastLookKind: "price" | "timed" | null;
  nextTimedCheckAt: string | null;
  triggerLowPrice: number | null;
  triggerHighPrice: number | null;
}

export interface DaySignalsWatch {
  tradingDateIso: string;
  sessionOpen: boolean;
  tickers: Record<string, DaySignalsWatchStatus>;
}

export function fetchDaySignalsWatch(): Promise<DaySignalsWatch> {
  return apiRequest<DaySignalsWatch>("/pluto/day-signals-watch");
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

export function updatePlutoStressOverride(enabled: boolean): Promise<PlutoStateCore> {
  return apiRequest<PlutoStateCore>("/pluto/stress-override", { method: "PUT", body: JSON.stringify({ enabled }) });
}

export interface PlutoScoreboard {
  since: string | null;
  passes: number;
  modelCalls: number;
  costUsd: number;
  outcomes: Record<string, number>;
  realizedPnl: number;
  closedActions: number;
  winningActions: number;
  openActions: number;
  /** noTrade includes the abstentions (the model distrusted the data). */
  modelVsTopPick: { agree: number; disagree: number; noTrade: number; abstained: number };
}

export function fetchPlutoScoreboard(): Promise<PlutoScoreboard> {
  return apiRequest<PlutoScoreboard>("/pluto/scoreboard");
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

/** The newest passes that asked the model (the only ones the Model decisions list shows), so skipped passes cannot crowd them out of the limit. */
export function fetchPlutoPasses(limit = 30): Promise<PlutoPass[]> {
  return apiRequest<PlutoPass[]>(`/pluto/passes?modelCalled=true&limit=${limit}`);
}

/** The newest pass that asked the model, however many skipped passes came after it (the Live tab's latest decision). */
export function fetchPlutoLatestModelPass(): Promise<PlutoPass[]> {
  return apiRequest<PlutoPass[]>("/pluto/passes?modelCalled=true&limit=1");
}

export function fetchPlutoActions(limit = 100): Promise<PlutoAction[]> {
  return apiRequest<PlutoAction[]>(`/pluto/actions?limit=${limit}`);
}

/** One pass with its model calls' full inputs (the Event log's "What the model saw"). */
export function fetchPlutoPass(passId: string): Promise<PlutoPass> {
  return apiRequest<PlutoPass>(`/pluto/passes/${encodeURIComponent(passId)}`);
}

/** One page of the Event log, newest first, with the total number of events matching the filters. */
export function fetchPlutoEventsPage(filters: PlutoEventFilters, limit: number, offset: number): Promise<PlutoEventsPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset), categories: filters.categories.join(",") });
  if (filters.ticker.trim() !== "") query.set("ticker", filters.ticker.trim());
  if (filters.session !== "") query.set("session", filters.session);
  return apiRequest<PlutoEventsPage>(`/pluto/events?${query}`);
}

/** The newest events with the given types left out in the query, so routine ones cannot crowd the rest out of the limit. */
export function fetchPlutoEventsExcludingTypes(excludedTypes: string[], limit: number): Promise<PlutoEvent[]> {
  return apiRequest<PlutoEventsPage>(`/pluto/events?limit=${limit}&excludeTypes=${encodeURIComponent(excludedTypes.join(","))}`).then((page) => page.events);
}

/** The newest events of just the given types, however many other events came after them. */
export function fetchPlutoEventsOfTypes(types: string[], limit: number): Promise<PlutoEvent[]> {
  return apiRequest<PlutoEventsPage>(`/pluto/events?limit=${limit}&types=${encodeURIComponent(types.join(","))}`).then((page) => page.events);
}

export function fetchPlutoTickers(): Promise<{ max: number; tickers: PlutoTicker[] }> {
  return apiRequest<{ max: number; tickers: PlutoTicker[] }>("/pluto/tickers");
}

export function updateShortlistBotEnabled(entryId: string, enabled: boolean): Promise<{ botEnabled: boolean }> {
  return apiRequest<{ botEnabled: boolean }>(`/shortlist/${entryId}/bot-enabled`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
