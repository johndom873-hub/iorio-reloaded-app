import type { PlutoSettings, PlutoSettingsField } from "../api/pluto";

// Every Pluto parameter the screen edits, grouped as on the approved mockup (2026-09-28). Labels and
// help are the only presentation the screen carries; validation lives in the API's settingsStore.

export interface PlutoParameterSpec {
  field: PlutoSettingsField;
  label: string;
  help: string;
  kind: "number" | "integer" | "text" | "time" | "select";
  step?: string;
  options?: readonly string[];
}

export interface PlutoParameterGroup {
  title: string;
  parameters: PlutoParameterSpec[];
}

export const plutoParameterGroups: PlutoParameterGroup[] = [
  {
    title: "Capital",
    parameters: [
      { field: "capitalBudgetPct", label: "Capital budget, % NLV", kind: "number", step: "1", help: "Ceiling on everything Pluto may have committed at once, as a share of net liquidation value. Human trades are not counted." },
      { field: "maxTickerExposurePct", label: "Max per ticker, % NLV", kind: "number", step: "1", help: "Ceiling per underlying, counting human positions too." },
      { field: "maxSectorExposurePct", label: "Max per sector, % NLV", kind: "number", step: "1", help: "Ceiling per sector; 100 disables the check." },
      { field: "maxOpenPositions", label: "Max open positions", kind: "integer", step: "1", help: "Pluto opens nothing new once it holds this many positions." },
      { field: "maxActionsPerSession", label: "Max actions / session", kind: "integer", step: "1", help: "Orders Pluto may send in one trading day." },
      { field: "maxOrderNotionalPct", label: "Max order, % NLV", kind: "number", step: "1", help: "Ceiling on the notional of a single order." },
      { field: "minCashReservePct", label: "Min cash reserve, % NLV", kind: "number", step: "1", help: "Cash that must remain uncommitted after an order." },
    ],
  },
  {
    title: "Candidate quality",
    parameters: [
      { field: "minGrade", label: "Min grade", kind: "select", options: ["strong", "good", "weak"], help: "Lowest Signals grade the model may be offered." },
      { field: "minEdgeDollars", label: "Min Edge $", kind: "number", step: "1", help: "Lowest Edge $ per contract a candidate needs to be offered." },
      { field: "maxAbsDelta", label: "Max |delta|", kind: "number", step: "0.01", help: "Furthest-in-the-money strike Pluto may sell, by absolute delta." },
      { field: "minDte", label: "Min DTE", kind: "integer", step: "1", help: "Shortest expiry, in days." },
      { field: "maxDte", label: "Max DTE", kind: "integer", step: "1", help: "Longest expiry, in days." },
      { field: "minAnnualizedYieldPct", label: "Min annualized yield, %", kind: "number", step: "1", help: "Lowest annualized premium yield a candidate needs." },
      { field: "maxSpreadPct", label: "Max spread, %", kind: "number", step: "1", help: "Widest bid-ask spread, as a share of the mid, Pluto will trade into." },
      { field: "minOpenInterest", label: "Min open interest", kind: "integer", step: "1", help: "Contract must have at least this much open interest at the 10:00 snapshot." },
      { field: "minSessionVolume", label: "Min session volume", kind: "integer", step: "1", help: "Contract must have traded at least this many times today." },
      { field: "maxQuoteAgeMinutes", label: "Max quote age, min", kind: "integer", step: "1", help: "Oldest live quote Pluto accepts before re-quoting." },
      { field: "maxContractsVolumeSharePct", label: "Max share of contract volume, %", kind: "number", step: "1", help: "One order may be at most this share of the contract's session volume." },
    ],
  },
  {
    title: "Surface & model risk",
    parameters: [
      { field: "maxSliceRmseVp", label: "Max slice RMSE, vp", kind: "number", step: "0.1", help: "Worst surface fit error, in volatility points, Pluto trusts for the expiry." },
      { field: "minSlicePointCount", label: "Min slice points", kind: "integer", step: "1", help: "Fewest quotes the expiry's fit must rest on." },
      { field: "maxMidVsSurfaceIvVp", label: "Max mid vs surface IV, vp", kind: "number", step: "0.1", help: "Largest gap between the market's mid IV and the surface before the candidate is suspect." },
      { field: "maxIvShiftVp", label: "Max IV shift, vp", kind: "number", step: "0.1", help: "Largest move of the ticker's IV since the 10:00 fit before Pluto stands aside." },
      { field: "maxAbsDayChangePct", label: "Max |day change|, %", kind: "number", step: "0.1", help: "Pluto ignores a ticker that moved more than this today." },
    ],
  },
  {
    title: "Session & breakers",
    parameters: [
      { field: "windowStartEt", label: "Window start, ET", kind: "time", help: "Pluto acts from this Eastern time." },
      { field: "windowEndEt", label: "Window end, ET", kind: "time", help: "Pluto stops acting at this Eastern time, or 30 minutes before an early close if that comes first." },
      { field: "dailyLossBreakerPct", label: "Daily loss breaker, % NLV", kind: "number", step: "0.1", help: "A day down this much versus last night trips a breaker: Pluto pauses until a human resets it." },
      { field: "spyStressBreakerPct", label: "SPY stress, % (blocks opens)", kind: "number", step: "0.1", help: "SPY down this much today blocks new opens; rolls and closes continue. Lifts by itself when SPY recovers." },
      { field: "unfilledCancelMinutes", label: "Unfilled cancel, min", kind: "integer", step: "1", help: "A working Pluto order is cancelled after this long unfilled, or before the close if that comes first." },
      { field: "maxEdgeDriftVp", label: "Max edge drift, vp", kind: "number", step: "0.1", help: "If the net edge moved more than this between the model's look and the order, the order is refused." },
      { field: "tickerCooldownSessions", label: "Ticker cooldown, sessions", kind: "integer", step: "1", help: "Sessions Pluto waits before touching the same ticker again; 0 allows same-day repeats." },
    ],
  },
  {
    title: "Model",
    parameters: [
      { field: "modelId", label: "Model", kind: "text", help: "OpenRouter model id. Both agreement calls use it. A change is audited like any other parameter." },
      { field: "reasoningEffort", label: "Reasoning effort", kind: "select", options: ["low", "medium", "high"], help: "How hard the model thinks per call; higher costs more and takes longer." },
      { field: "callTimeoutSeconds", label: "Call timeout, s", kind: "integer", step: "1", help: "A model call slower than this counts as a failure." },
      { field: "dailyCostCeilingUsd", label: "Daily cost ceiling, $", kind: "number", step: "0.5", help: "No more model calls once today's spend reaches this." },
      { field: "confidenceFloor", label: "Confidence floor", kind: "number", step: "0.05", help: "A trade verdict below this confidence is treated as no trade." },
      { field: "maxModelCallsPerSession", label: "Max model calls / session", kind: "integer", step: "1", help: "Calls per trading day (two per decision)." },
      { field: "consecutiveModelFailuresBreaker", label: "Consecutive failures breaker", kind: "integer", step: "1", help: "This many model failures in a row trip a breaker." },
      { field: "promptVersion", label: "Prompt version", kind: "text", help: "Recorded with every decision so prompt changes can be compared." },
    ],
  },
  {
    title: "Triggers & lines",
    parameters: [
      { field: "spotMoveTriggerPct", label: "Spot-move trigger, %", kind: "number", step: "0.1", help: "A watched stock moving this much since the last look starts a pass." },
      { field: "burstLines", label: "Burst lines", kind: "integer", step: "1", help: "IBKR market-data lines reserved for a short quote burst on the ticker being evaluated." },
      { field: "burstSettleSeconds", label: "Burst settle, s", kind: "integer", step: "1", help: "How long a burst waits for quotes before scoring." },
      { field: "coalescingWindowSeconds", label: "Coalescing window, s", kind: "integer", step: "1", help: "Triggers arriving within this window run as one pass." },
      { field: "perTickerModelCooldownMinutes", label: "Per-ticker model cooldown, min", kind: "integer", step: "1", help: "The model is not asked about the same ticker again within this time." },
      { field: "globalMinCallIntervalSeconds", label: "Global min call interval, s", kind: "integer", step: "1", help: "Minimum gap between any two model calls." },
      { field: "maxEnabledTickers", label: "Max enabled tickers", kind: "integer", step: "1", help: "Cap on shortlist tickers Pluto may watch; each holds one market-data line." },
      { field: "messageRateLimitPerSecond", label: "Message rate limit / s", kind: "integer", step: "1", help: "Ceiling on IBKR messages per second from Pluto's connection." },
    ],
  },
  {
    title: "Operations & closes",
    parameters: [
      { field: "crashLoopRestartsPerHour", label: "Crash-loop restarts / hour", kind: "integer", step: "1", help: "More agent restarts than this in an hour pause Pluto until a human resumes it." },
      { field: "telegramVerbosity", label: "Telegram verbosity", kind: "select", options: ["actions", "all", "off"], help: "actions: orders, breakers and pauses. all: every pass. off: nothing." },
      { field: "unstructuredCloseMinPct", label: "Unstructured close min, % of cost", kind: "number", step: "0.1", help: "Shares with no call against them are offered for closing only above this cycle profit." },
      { field: "unstructuredCloseMinDollars", label: "Unstructured close min, $", kind: "number", step: "1", help: "And only above this dollar profit." },
      { field: "buybackMinDte", label: "Buyback min DTE", kind: "integer", step: "1", help: "A short leg closer to expiry than this is left to expire rather than bought back." },
    ],
  },
];

export const plutoParameterCount = plutoParameterGroups.reduce((sum, group) => sum + group.parameters.length, 0);

export const plutoParameterSpecByField: Record<string, PlutoParameterSpec> = Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameter])));

/** The API validates numbers as numbers, so numeric fields are sent as such; everything else as text. */
export function settingsInputValue(field: PlutoSettingsField, value: string): string | number {
  const kind = plutoParameterSpecByField[field]?.kind;
  return kind === "number" || kind === "integer" ? Number(value) : value;
}

export const plutoParameterLabelByField: Record<string, string> = Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameter.label])));

export type PlutoSettingsFormState = Record<PlutoSettingsField, string>;

export function settingsToFormState(settings: PlutoSettings): PlutoSettingsFormState {
  const state = {} as PlutoSettingsFormState;
  for (const group of plutoParameterGroups) for (const parameter of group.parameters) state[parameter.field] = String(settings[parameter.field]);
  return state;
}

/** Fields whose text differs from the loaded settings, with both values for the confirm dialog. */
export function changedSettingsFields(settings: PlutoSettings, form: PlutoSettingsFormState): { field: PlutoSettingsField; label: string; from: string; to: string }[] {
  const changes: { field: PlutoSettingsField; label: string; from: string; to: string }[] = [];
  for (const group of plutoParameterGroups) {
    for (const parameter of group.parameters) {
      const from = String(settings[parameter.field]);
      const to = form[parameter.field].trim();
      if (from !== to) changes.push({ field: parameter.field, label: parameter.label, from, to });
    }
  }
  return changes;
}
