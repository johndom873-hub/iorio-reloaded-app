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
  /** The test passed. */
  ok: boolean;
  /** "fail" only when Pluto is meant to trade today; a switched-off Pluto and its failed probes are "warn". Absent on runs before 2026-10-12. */
  status?: "ok" | "warn" | "fail";
  detail: string;
}

export interface PlutoReadinessRecord {
  dateIso: string;
  lastRunAt: string;
  lastRunKind: "first" | "recheck" | "final";
  /** The names of the tests with status "fail" joined, "" when none fails. */
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
  /** The ladder's orders sent today, as its daily cap across the book counts them, and that cap. */
  counters: { ordersToday: number; maxOrdersPerDay: number };
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
  };
  agent: { connected: boolean; heartbeatAgeSeconds: number; gitSha: string | null; appEnvironment: string | null } | null;
}

export type PlutoTelegramVerbosity = "actions" | "off";

export interface PlutoSettings {
  capitalBudgetPct: number;
  /** % every ticker's pot is raised above its allocation: the pots may add up to more than the budget, whose cash they share. */
  excessAllowancePct: number;
  windowStartEt: string;
  windowEndEt: string;
  dailyLossBreakerPct: number;
  maxQuoteAgeMinutes: number;
  maxFillSlippagePct: number;
  bandQuotePollSeconds: number;
  burstLines: number;
  burstSettleSeconds: number;
  maxEnabledTickers: number;
  crashLoopRestartsPerHour: number;
  telegramVerbosity: PlutoTelegramVerbosity;
  // The CC + Put Ladder's strategy-wide values (a ticker may override shares, rungs and the |delta| range).
  ladderSharesPct: number;
  ladderRungs: number;
  ladderMinAbsDelta: number;
  ladderMaxAbsDelta: number;
  ladderMinDte: number;
  ladderMaxDte: number;
  ladderMaxSpreadPctOfMid: number;
  ladderShockMinPct: number;
  ladderShockMaxPct: number;
  ladderShockNoHistoryPct: number;
  ladderShockLookbackYears: number;
  ladderMaxWorkingOrdersPerTicker: number;
  ladderMaxOpenPositionsPerTicker: number;
  ladderMaxOrdersPerTickerPerDay: number;
  ladderMaxOpenPositions: number;
  ladderMaxOrdersPerDay: number;
  ladderSpyStressBreakerPct: number;
  ladderTickerCooldownMinutes: number;
  // Vol Farmer v2's values, every v2 ticker alike: set once from the lab's of 27 Oct 2026, never synced with the lab.
  volFarmerV2PutsStartCallYieldPct: number;
  volFarmerV2PutMaxAbsDelta: number;
  volFarmerV2StepBelowFirstBreakEvenPct: number;
  volFarmerV2StepRule: "fixed" | "implied_move_at_put_sale";
  volFarmerV2LeapsMinDte: number;
  volFarmerV2LeapsAbsDelta: number;
  volFarmerV2LeapsMaxAllocationPct: number;
  volFarmerV2CallMinAbsDelta: number;
  volFarmerV2CallMaxAbsDelta: number;
  volFarmerV2MaxSpreadPctOfMid: number;
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
  /** The sizing gate of a live open: the limit that set its size; absent on rows before 2026-10-21. */
  limit?: string;
}

/** close_position: a whole covered call (call bought back, shares sold) closed by code before earnings, never by the model. */
export type PlutoActionKind = "open_covered_call" | "open_cash_secured_put" | "roll" | "close_shares" | "close_leg" | "close_position" | "buy_leaps" | "sell_leaps" | "no_trade";
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
  /**
   * The top eligible open in Pluto's order: highest Edge Yield on rows with rankedBy "edge_yield" (2026-10-12 on), highest Hist
   * Yield on earlier rows that carry the yields. edgeDollars is the valuation model's expected P&L per contract since prompt v4.0
   * (the old Edge $ on earlier rows).
   */
  deterministicTopPick: {
    id: string;
    edgeDollars: number;
    grade: string;
    edgeMargin?: number;
    calibratedAnnualizedReturn?: number;
    expectedAnnualizedReturn?: number;
    capitalAtRiskDollars?: number;
    rankedBy?: "edge_yield";
    runnerUp?: { id: string; calibratedAnnualizedReturn: number; expectedAnnualizedReturn?: number } | null;
  } | null;
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
  /** Plain strings from an API older than the {symbol, concern} shape. */
  system_concerns?: ({ symbol: string | null; concern: string } | string)[];
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

/** Prompt v3.8: the heaviest major macro release before a contract's expiry, with the sessions until it and after it. */
export interface PlutoModelInputEvent {
  title: string;
  weight: "heavy" | "medium" | "light";
  date: string;
  sessions_until: number;
  sessions_after: number;
  /** Held positions only: the adverse move it is stressed with, in normal days (2 heavy, 1 medium, 0.5 light). */
  stress_normal_days?: number;
}

/** Prompt v3.8: a held short put or covered call as the model saw it, every round. */
export interface PlutoModelInputHeldPosition {
  leg_id: string;
  strategy: "cash_secured_put" | "covered_call";
  opened_by?: string;
  strike: number;
  expiry: string;
  dte?: number;
  delta?: number;
  quantity: number;
  /** Covered calls: the shares held against the call. */
  shares?: number;
  entry_credit?: number;
  bid?: number;
  ask?: number;
  captured_pct?: number;
  max_remaining_gain_dollars?: number;
  close_cost_dollars?: number;
  strike_distance_days?: number;
  event?: PlutoModelInputEvent;
  event_stress_loss_dollars?: number;
  /** Covered calls inside an event close's window only. */
  cycle_pnl_after_costs_dollars?: number;
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
  /** Prompt v3.8 on. */
  event?: PlutoModelInputEvent;
  // The valuation model's figures (prompt v4.0 on; the yield names from 2026-10-12): per contract, yields in % a year.
  sessions_to_expiry?: number;
  implied_vol?: number;
  edge_margin_pct?: number;
  hist_edge_dollars?: number;
  edge_yield_ann_pct?: number;
  hist_yield_ann_pct?: number;
  pop_pct?: number;
  avg_win?: number;
  avg_loss?: number;
  worst5_avg?: number;
  stress_2sd?: number;
  premium_after_costs?: number;
  premium_yield_ann_pct?: number;
}

export interface PlutoModelInputRoll {
  id: string;
  /** The held leg the roll replaces (an id, not shown). */
  held_leg_id?: string;
  /** Who opened the position: "pluto" or "a person". */
  opened_by?: string;
  quantity?: number;
  net_roll_edge_vp?: number;
  net_roll_edge_dollars?: number;
  /** Prompt v4.0 on: the model's net roll $ per contract and the roll's edge margin. */
  per_contract?: number;
  roll_edge_margin_pct?: number;
  net_credit_per_share?: number;
  delta_change?: number;
  grade?: string;
  flags?: string[];
  replacement: PlutoModelInputContract;
}

/**
 * A close offer (Formulas P1/P2/P3b, and from prompt v3.8 F3, before a macro release): close_leg carries the buyback figures,
 * close_shares the share figures, close_position a whole covered call; an event close also carries the release and the
 * held-position figures it is judged on.
 */
export interface PlutoModelInputCloseAction {
  id: string;
  /** Who opened the position: "pluto" or "a person". */
  opened_by?: string;
  kind: "close_leg" | "close_shares" | "close_position";
  description: string;
  cycle_pnl?: number;
  dte?: number;
  ask?: number;
  entry_credit?: number;
  /** The valuation model's hold value per contract (since 2026-10-10); hold_edge_dollars on earlier rows. */
  hold_value_dollars?: number;
  hold_edge_dollars?: number;
  close_cost_dollars?: number;
  pnl_at_ask?: number;
  shares?: number;
  entry_price?: number;
  cycle_pnl_pct_of_capital?: number | null;
  odd_lot?: boolean;
  /** Event close (v3.8): the release's title, weight, date and timing. */
  event?: string;
  event_weight?: "heavy" | "medium" | "light";
  event_date?: string;
  sessions_until?: number;
  sessions_after?: number;
  /** The adverse move the stress loss assumes, in normal days (2 heavy, 1 medium, 0.5 light). */
  stress_normal_days?: number;
  captured_pct?: number;
  max_remaining_gain_dollars?: number;
  event_stress_loss_dollars?: number;
  strike_distance_days?: number;
  /** close_position: the covered call's cycle P&L closed now, after the close cost, and the prices it closes at. */
  cycle_pnl_after_costs_dollars?: number;
  call_ask?: number;
  stock_bid?: number;
}

export interface PlutoModelInputTicker {
  symbol: string;
  sector?: string;
  spot?: number;
  day_change_pct?: number;
  atm_iv?: number;
  /** Prompts before v4.0; v4.0 renamed it forecast_vol (the same 21-session realized-volatility forecast). */
  forecast_rv?: number;
  forecast_vol?: number;
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
  /** Prompt v3.8 on. */
  held_positions?: PlutoModelInputHeldPosition[];
}

/** The user message of one model call: exactly what the model was shown (pluto/prompt.ts on the API). */
export interface PlutoModelInput {
  as_of: string;
  session?: { date: string; minutes_to_window_end: number };
  /** Prompt v3.5 on sends the kind only. */
  trigger?: { kind: string; detail?: Record<string, unknown> };
  market?: { spy_day_change_pct?: number };
  account?: { nlv?: number; free_cash?: number; pluto_budget_pct?: number; pluto_budget_used_pct?: number; open_pluto_positions?: number; managed_positions?: number; max_open_positions?: number; actions_today?: number; max_actions_per_session?: number };
  parameters?: { min_grade?: string; max_abs_delta?: number; dte_range?: [number, number]; max_ticker_pct_of_budget?: number; /** Passes before 2026-10-16: the per-ticker cap as % of the account. */ max_ticker_exposure_pct?: number; order_size_pct_of_budget?: number; confidence_floor?: number; spread_cost_share_pct?: number };
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

/** History's Orders and Model decisions filters; the API applies them, so a page and its total agree. */
export interface PlutoHistoryFilters {
  /** ISO time, or null for all time. */
  since: string | null;
  /** Part of a symbol, any case, or "". */
  ticker: string;
}

export type PlutoOrderOutcomeFilter = "all" | "filled" | "working" | "blocked" | "cancelled" | "rejected";

export interface PlutoOrdersPage {
  actions: PlutoAction[];
  /** Every order matching the filters, not only this page. */
  total: number;
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

/** Every number the How it works tab quotes (API src/pluto/howItWorks.ts): percentages in percent, deltas as fractions, money in dollars. */
export interface PlutoHowItWorks {
  shared: { windowStartEt: string; windowEndEt: string; windowEndMinutesBeforeCloseAtLeast: number; capitalBudgetPct: number; excessAllowancePct: number; dailyLossBreakerPct: number; unfilledOrderCancelMinutes: number };
  ladder: {
    minAbsDelta: number;
    maxAbsDelta: number;
    minDte: number;
    maxDte: number;
    maxSpreadPctOfMid: number;
    minimumBid: number;
    maxVolumeSharePct: number;
    rungs: number;
    sharesPct: number;
    shockMinPct: number;
    shockMaxPct: number;
    shockNoHistoryPct: number;
    shockLookbackYears: number;
    putOverCallYieldMarginPct: number;
    minEntryYieldPct: number;
    maxQuoteAgeMinutes: number;
    maxWorkingOrdersPerTicker: number;
    maxOrdersPerTickerPerDay: number;
    maxOpenPositionsPerTicker: number;
    maxOpenPositions: number;
    maxOrdersPerDay: number;
    spyStressBreakerPct: number;
    tickerCooldownMinutes: number;
    example: {
      accountValue: number;
      allocationPct: number;
      pot: number;
      sharesBudget: number;
      reserve: number;
      rungCollateral: number;
      averageCost: number;
      breakEven: number;
      shockPct: number;
      floor: number;
      rungs: { rung: number; strikeCap: number }[];
    };
  };
  volFarmerV2: {
    callMinAbsDelta: number;
    callMaxAbsDelta: number;
    maxSpreadPctOfMid: number;
    minimumBid: number;
    maxVolumeSharePct: number;
    putsStartCallYieldPct: number;
    putMaxAbsDelta: number;
    stepRule: PlutoSettings["volFarmerV2StepRule"];
    /** The fixed Step, and the implied-move Step's fallback. */
    stepBelowFirstBreakEvenPct: number;
    stepLookbackSessions: number;
    leapsMinDte: number;
    leapsAbsDelta: number;
    leapsMaxAllocationPct: number;
    example: { accountValue: number; allocationPct: number; pot: number; stockPrice: number; lots: number; firstBreakEven: number; impliedVolatilityPct: number; stepPct: number; putStrikeCap: number; leapsCap: number };
  };
}

export function fetchPlutoHowItWorks(): Promise<PlutoHowItWorks> {
  return apiRequest<PlutoHowItWorks>("/pluto/how-it-works");
}

export function updatePlutoSettings(input: PlutoSettingsInput): Promise<PlutoSettings> {
  return apiRequest<PlutoSettings>("/pluto/settings", { method: "PUT", body: JSON.stringify(input) });
}

export function fetchPlutoSettingsAudit(limit = 20): Promise<PlutoSettingsAuditRow[]> {
  return apiRequest<PlutoSettingsAuditRow[]>(`/pluto/settings/audit?limit=${limit}`);
}

/** The settings version a pass would record now (API settingsVersions.ts). */
export interface PlutoSettingsVersion {
  versionId: string;
  /** Counted in the order versions were first stored. */
  number: number;
  /** When the settings last changed. */
  since: string | null;
}

export function fetchPlutoSettingsVersion(): Promise<PlutoSettingsVersion> {
  return apiRequest<PlutoSettingsVersion>("/pluto/settings/version");
}

/** The CC + Put Ladder's values in the backtest's names (API ladderSettings.ts LadderBaselineSettings, tunable part). */
export interface PlutoLadderBaseline {
  minAbsDelta: number;
  maxAbsDelta: number;
  minDte: number;
  maxDte: number;
  maxSpreadPctOfMid: number;
  ladderRungs: number;
  ladderSharesPct: number;
  ladderShockMinPct: number;
  ladderShockMaxPct: number;
  ladderShockNoHistoryPct: number;
  ladderShockLookbackYears: number;
}

/** A ticker's ladder settings as the Pluto screen shows them (GET /pluto/ladder-settings[/:symbol]). */
export interface PlutoLadderTickerSettings {
  symbol: string;
  /** Enabled in Pluto while the CC + Put Ladder is the active strategy. */
  enabled: boolean;
  settingsVersionId: string | null;
  /** Effective: the ticker's override where it has one, else the strategy's. */
  baseline: PlutoLadderBaseline;
  strategyBaseline: PlutoLadderBaseline;
  tickerOverrides: { ladderSharesPct: number | null; ladderRungs: number | null; minAbsDelta: number | null; maxAbsDelta: number | null };
  /** % of Pluto's capital budget; null = an equal share of what the set allocations leave. */
  allocationPct: number | null;
  /** The pot in dollars while the ticker is enabled in Pluto; null otherwise or with no account value. */
  potDollars: number | null;
  overrideShockPct: number | null;
  recommendedShockPct: number | null;
  /** The fit checks' price: the last daily close and its date. */
  lastClose: { price: number; date: string } | null;
  capitalBudgetDollars: number | null;
  recommendedShockSource: { maxDrawdownPct: number | null; closesUsed: number; fromIso: string | null; toIso: string | null } | null;
  /** The strategy set on the ticker (null: the default, Vol Farmer v2) and the one Pluto runs on it. */
  strategy: PlutoStrategy | null;
  effectiveStrategy: PlutoStrategy;
}

/** The strategy Pluto runs on a ticker. */
export type PlutoStrategy = "vol_farmer_v2" | "cc_put_ladder";

/** An option one of v2's positions holds: a leg of the book, or an order still working. */
export interface PlutoVolFarmerV2Option {
  strike: number;
  expiry: string;
  contracts: number;
  working: boolean;
}

export interface PlutoVolFarmerV2Position {
  shares: number;
  costPerShare: number;
  /** B-E¹ / B-E²; null while the second position holds no shares. */
  breakEvenPerShare: number | null;
  calls: PlutoVolFarmerV2Option[];
  puts: PlutoVolFarmerV2Option[];
}

/** A Vol Farmer v2 ticker as v2's memory counts it (GET /pluto/vol-farmer-v2). */
export interface PlutoVolFarmerV2Ticker {
  symbol: string;
  adoptedAt: string | null;
  /** No memory yet: v2 waits to adopt the ticker's holdings (the last round's notes say why), or has not looked yet. */
  waiting: boolean;
  first: PlutoVolFarmerV2Position | null;
  second: PlutoVolFarmerV2Position | null;
  leaps: { strike: number; expiry: string; heldContracts: number; intendedContracts: number } | null;
  workingOrders: { kind: "covered_call" | "cash_secured_put" | "buy_leaps" | "sell_leaps"; strike: number; expiry: string; contracts: number }[];
  lastRoundAt: string | null;
  lastRoundNotes: string[];
  /** What the last round read: the pot, what the ticker commits as the pot check counts it, v2's free cash and the LEAPS cap. */
  lastRoundFigures: { potDollars: number; committedDollars: number; freeCashDollars: number; leapsCapDollars: number } | null;
}

export function fetchPlutoVolFarmerV2(): Promise<PlutoVolFarmerV2Ticker[]> {
  return apiRequest<PlutoVolFarmerV2Ticker[]>("/pluto/vol-farmer-v2");
}

export function fetchPlutoLadderSettings(): Promise<PlutoLadderTickerSettings[]> {
  return apiRequest<PlutoLadderTickerSettings[]>("/pluto/ladder-settings");
}

export function fetchPlutoLadderTickerSettings(symbol: string): Promise<PlutoLadderTickerSettings> {
  return apiRequest<PlutoLadderTickerSettings>(`/pluto/ladder-settings/${encodeURIComponent(symbol)}`);
}

export type PlutoTickerSettingsField = "allocationPct" | "ladderSharesPct" | "ladderShockOverridePct" | "ladderRungs" | "ladderMinAbsDelta" | "ladderMaxAbsDelta";

/** A ticker's own values (pluto_ticker_settings); null = the default. */
export type PlutoTickerSettingsValues = Record<PlutoTickerSettingsField, number | null> & { symbol: string; strategy: PlutoStrategy | null; updatedAt: string | null };

/** Each field a number, or null for the default again; the strategy one of Pluto's, or null for the default. */
export function savePlutoTickerSettings(symbol: string, input: Partial<Record<PlutoTickerSettingsField, number | null>> & { strategy?: PlutoStrategy | null }): Promise<PlutoTickerSettingsValues> {
  return apiRequest<PlutoTickerSettingsValues>(`/pluto/ticker-settings/${encodeURIComponent(symbol)}`, { method: "PUT", body: JSON.stringify(input) });
}

/** What PUT /pluto/allocations changed: each ticker's allocation (null: an equal share) and the excess allowance. */
export interface PlutoAllocationChanges {
  allocations: { symbol: string; from: number | null; to: number | null }[];
  excessAllowance: { from: number; to: number } | null;
}

/** The Tickers tab's save (admin only): the allocations typed, each a % of Pluto's budget or null for an equal share, and
 *  the excess allowance when it changed, saved together or not at all. */
export function savePlutoAllocations(input: { allocations: Record<string, number | null>; excessAllowancePct?: number }): Promise<PlutoAllocationChanges> {
  return apiRequest<PlutoAllocationChanges>("/pluto/allocations", { method: "PUT", body: JSON.stringify(input) });
}

export interface PlutoTickerSettingsAuditRow {
  id: number;
  changedAt: string;
  userDisplayName: string | null;
  symbol: string;
  field: PlutoTickerSettingsField;
  oldValue: string | null;
  newValue: string | null;
}

export function fetchPlutoTickerSettingsAudit(symbol: string, limit = 20): Promise<PlutoTickerSettingsAuditRow[]> {
  return apiRequest<PlutoTickerSettingsAuditRow[]>(`/pluto/ticker-settings/audit?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
}

export function fetchPlutoActions(limit = 100): Promise<PlutoAction[]> {
  return apiRequest<PlutoAction[]>(`/pluto/actions?limit=${limit}`);
}

function historyQuery(filters: PlutoHistoryFilters, limit: number, offset: number): URLSearchParams {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.since !== null) query.set("since", filters.since);
  if (filters.ticker.trim() !== "") query.set("ticker", filters.ticker.trim());
  return query;
}

/** One page of History's Orders (every action but the no-order rows), newest first, with the total matching the filters. */
export function fetchPlutoOrdersPage(filters: PlutoHistoryFilters, outcome: PlutoOrderOutcomeFilter, limit: number, offset: number): Promise<PlutoOrdersPage> {
  const query = historyQuery(filters, limit, offset);
  if (outcome !== "all") query.set("outcome", outcome);
  return apiRequest<PlutoOrdersPage>(`/pluto/orders?${query}`);
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
