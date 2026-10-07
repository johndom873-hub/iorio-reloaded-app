import type { PlutoSettings, PlutoSettingsField } from "../api/pluto";
import { formatCurrency } from "./formatters";

// Every Pluto parameter the Settings tab edits, grouped as on the approved redesign (2026-10-06). Labels, units
// and help are the only presentation the screen carries; validation lives in the API's settingsStore.

/** Figures the help texts quote, so "% of account" settings can say what they come to in dollars right now. */
export interface PlutoParameterContext {
  netLiquidationValue: number | null;
  settings: PlutoSettings;
}

export interface PlutoParameterSpec {
  field: PlutoSettingsField;
  label: string;
  help: string | ((context: PlutoParameterContext) => string);
  kind: "number" | "integer" | "text" | "time" | "select";
  /** Shown after the input ("% of account", "contracts"); none for a bare number or a text. */
  unit?: string;
  step?: string;
  options?: readonly string[];
  /** Rendered on one row with the parameter before it (min/max pairs). */
  pairedWithPrevious?: boolean;
}

export interface PlutoParameterGroup {
  key: string;
  title: string;
  parameters: PlutoParameterSpec[];
  /** The group's key figures, shown in its header while collapsed. */
  summary: (settings: PlutoSettings) => string;
}

function dollarsOfAccount(context: PlutoParameterContext, pct: number): string {
  return context.netLiquidationValue === null ? "" : ` (${formatCurrency((context.netLiquidationValue * pct) / 100, 0)} now)`;
}

function orderSizeDollars(context: PlutoParameterContext): string {
  if (context.netLiquidationValue === null) return "";
  const budget = (context.netLiquidationValue * context.settings.capitalBudgetPct) / 100;
  return ` (${formatCurrency((budget * context.settings.orderSizePctOfBudget) / 100, 0)} now)`;
}

export const plutoParameterGroups: PlutoParameterGroup[] = [
  {
    key: "capital",
    title: "Capital",
    summary: (settings) => `budget ${settings.capitalBudgetPct}% of the account · order size ${settings.orderSizePctOfBudget}% of budget · up to ${settings.maxOpenPositions} positions`,
    parameters: [
      { field: "capitalBudgetPct", label: "Capital budget", unit: "% of account", kind: "number", step: "1", help: (context) => `Everything Pluto may have committed at once${dollarsOfAccount(context, context.settings.capitalBudgetPct)}. Human trades are not counted.` },
      { field: "maxTickerExposurePct", label: "Max per ticker", unit: "% of account", kind: "number", step: "1", help: (context) => `Ceiling per underlying, counting human positions too${dollarsOfAccount(context, context.settings.maxTickerExposurePct)}.` },
      { field: "maxSectorExposurePct", label: "Max per sector", unit: "% of account", kind: "number", step: "1", help: "Ceiling per sector. 100 turns the check off." },
      { field: "maxOpenPositions", label: "Max open positions", unit: "positions", kind: "integer", step: "1", help: "Pluto opens nothing new once it holds this many." },
      { field: "maxActionsPerSession", label: "Max orders per day", unit: "orders", kind: "integer", step: "1", help: "Orders Pluto may send in one trading day." },
      { field: "orderSizePctOfBudget", label: "Order size", unit: "% of budget", kind: "number", step: "1", help: (context) => `What Pluto commits per order${orderSizeDollars(context)}. Less only when a tighter limit applies: budget left, per-ticker cap, cash reserve or the contract's volume today.` },
      { field: "minCashReservePct", label: "Min cash reserve", unit: "% of account", kind: "number", step: "1", help: "Cash that must stay uncommitted after an order." },
    ],
  },
  {
    key: "quality",
    title: "Candidate quality",
    summary: (settings) => `grade ${settings.minGrade} or better · Edge $${settings.minEdgeDollars}+ · |delta| ≤ ${settings.maxAbsDelta} · ${settings.minDte}–${settings.maxDte} DTE`,
    parameters: [
      { field: "minGrade", label: "Min grade", kind: "select", options: ["strong", "good", "weak"], help: "Lowest Signals grade the model may be offered." },
      { field: "minEdgeDollars", label: "Min Edge $", unit: "$ / contract", kind: "number", step: "1", help: "Lowest Edge $ per contract a candidate needs to be offered. Rolls are judged per contract too." },
      { field: "maxAbsDelta", label: "Max |delta|", kind: "number", step: "0.01", help: "Furthest-in-the-money strike Pluto may sell, by absolute delta." },
      { field: "minDte", label: "Days to expiry", unit: "min", kind: "integer", step: "1", help: "Shortest and longest expiry Pluto may trade." },
      { field: "maxDte", label: "Max DTE", unit: "max", kind: "integer", step: "1", help: "Longest expiry, in days.", pairedWithPrevious: true },
      { field: "minAnnualizedYieldPct", label: "Min annualized yield", unit: "%", kind: "number", step: "1", help: "Lowest annualized premium yield a candidate needs." },
      { field: "maxSpreadPct", label: "Max spread", unit: "% of mid", kind: "number", step: "1", help: "Widest bid-ask spread, as a share of the mid, Pluto will trade into." },
      { field: "minOpenInterest", label: "Min open interest", unit: "contracts", kind: "integer", step: "1", help: "At the 10:00 snapshot." },
      { field: "minSessionVolume", label: "Min session volume", unit: "contracts", kind: "integer", step: "1", help: "Contracts traded today." },
      { field: "maxQuoteAgeMinutes", label: "Max quote age", unit: "min", kind: "integer", step: "1", help: "Oldest live quote Pluto accepts before re-quoting." },
      { field: "maxContractsVolumeSharePct", label: "Max share of contract volume", unit: "%", kind: "number", step: "1", help: "One order may be at most this share of the contract's volume today." },
    ],
  },
  {
    key: "surface",
    title: "Surface & model risk",
    summary: (settings) => `slice fit error up to ${settings.maxSliceRmseVp} vp · IV shift up to ${settings.maxIvShiftVp} vp · day move up to ${settings.maxDayMoveMultiple}× normal`,
    parameters: [
      { field: "maxSliceRmseVp", label: "Max slice fit error", unit: "vp", kind: "number", step: "0.1", help: "Worst surface fit error, in volatility points, Pluto trusts for the expiry." },
      { field: "minSlicePointCount", label: "Min slice points", unit: "quotes", kind: "integer", step: "1", help: "Fewest quotes the expiry's fit must rest on." },
      { field: "maxMidVsSurfaceIvVp", label: "Max mid vs surface IV", unit: "vp", kind: "number", step: "0.1", help: "Largest gap between the market's mid IV and the surface before the candidate is suspect." },
      { field: "maxIvShiftVp", label: "Max IV shift", unit: "vp", kind: "number", step: "0.1", help: "Largest move of the ticker's IV since the 10:00 fit before Pluto stands aside." },
      { field: "maxDayMoveMultiple", label: "Max day move", unit: "× normal", kind: "number", step: "0.1", help: "Pluto ignores a ticker whose move today is more than this many times its normal day (its forecast volatility ÷ √252). At 3×, a stock whose normal day is 4.2% is ignored beyond 12.6%." },
    ],
  },
  {
    key: "session",
    title: "Session & breakers",
    summary: (settings) => `window ${settings.windowStartEt}–${settings.windowEndEt} ET · daily loss breaker ${settings.dailyLossBreakerPct}% · SPY stress −${settings.spyStressBreakerPct}%`,
    parameters: [
      { field: "windowStartEt", label: "Window start", unit: "ET", kind: "time", help: "Pluto acts from this Eastern time." },
      { field: "windowEndEt", label: "Window end", unit: "ET", kind: "time", help: "Pluto stops acting at this Eastern time, or 30 minutes before an early close if that comes first." },
      { field: "dailyLossBreakerPct", label: "Daily loss breaker", unit: "% of account", kind: "number", step: "0.1", help: "A day down this much versus last night trips a breaker: Pluto stops until a person resets it." },
      { field: "spyStressBreakerPct", label: "SPY stress", unit: "% down", kind: "number", step: "0.1", help: "SPY down this much today blocks new positions; rolls and closes continue. Lifts by itself when SPY recovers." },
      { field: "maxEdgeDriftVp", label: "Max edge drift", unit: "vp", kind: "number", step: "0.1", help: "If the net edge moved more than this between the model's decision and the order, the order is refused." },
      { field: "tickerCooldownMinutes", label: "Ticker cooldown", unit: "min", kind: "integer", step: "1", help: "Minutes Pluto waits after one of its orders on a ticker fills before acting on that ticker again (an order that never filled doesn't count). Closes are not held back. 0 turns the cooldown off." },
      { field: "maxFillSlippagePct", label: "Max fill slippage", unit: "%", kind: "number", step: "1", help: "A fill this far past the reference price (below the bid for a sell, above the ask for a buy), as a share of it, trips the fill_slippage breaker." },
    ],
  },
  {
    key: "model",
    title: "Model",
    summary: (settings) => `${settings.modelId} · $${settings.dailyCostCeilingUsd.toFixed(2)} a day ceiling · confidence floor ${settings.confidenceFloor}`,
    parameters: [
      { field: "modelId", label: "Model", kind: "text", help: "OpenRouter model id, requested at the cheapest eligible tier (:floor). A change is audited like any other parameter." },
      { field: "reasoningEffort", label: "Reasoning effort", kind: "select", options: ["low", "medium", "high"], help: "How hard the model thinks per call; higher costs more and takes longer." },
      { field: "callTimeoutSeconds", label: "Call timeout", unit: "s", kind: "integer", step: "1", help: "A model call slower than this counts as a failure." },
      { field: "dailyCostCeilingUsd", label: "Daily cost ceiling", unit: "$ / day", kind: "number", step: "0.5", help: "No more model calls once today's spend reaches this." },
      { field: "confidenceFloor", label: "Confidence floor", kind: "number", step: "0.05", help: "An order verdict below this confidence is treated as no order." },
      { field: "consecutiveModelFailuresBreaker", label: "Consecutive failures breaker", unit: "failures", kind: "integer", step: "1", help: "This many model failures in a row trip a breaker." },
      { field: "promptVersion", label: "Prompt version", kind: "text", help: "Recorded with every decision so prompt changes can be compared." },
    ],
  },
  {
    key: "triggers",
    title: "Analysis & lines",
    summary: (settings) => `Day Signals every ${settings.daySignalsPollSeconds} s · ${settings.perTickerModelCooldownMinutes} min per-ticker model cooldown · up to ${settings.maxEnabledTickers} tickers`,
    parameters: [
      { field: "daySignalsPollSeconds", label: "Day Signals poll", unit: "s", kind: "integer", step: "1", help: "How often Pluto checks Day Signals for contracts quoted since its last analysis." },
      { field: "burstLines", label: "Burst lines", unit: "lines", kind: "integer", step: "1", help: "Most option contracts Pluto quotes live in one short burst before deciding on a ticker. Their IBKR lines are booked only while the burst runs." },
      { field: "burstSettleSeconds", label: "Burst settle", unit: "s", kind: "integer", step: "1", help: "How long a burst waits for quotes before scoring." },
      { field: "perTickerModelCooldownMinutes", label: "Per-ticker model cooldown", unit: "min", kind: "integer", step: "1", help: "The model is not asked about the same ticker again within this time." },
      { field: "maxEnabledTickers", label: "Max allowed tickers", unit: "tickers", kind: "integer", step: "1", help: "Cap on Shortlist tickers Pluto may trade; each holds one IBKR market-data line." },
      { field: "messageRateLimitPerSecond", label: "Message rate limit", unit: "msg / s", kind: "integer", step: "1", help: "Ceiling on IBKR messages per second from Pluto's connection." },
    ],
  },
  {
    key: "operations",
    title: "Operations & closes",
    summary: (settings) => `Telegram: ${settings.telegramVerbosity === "actions" ? "actions" : "off"} · buyback from ${settings.buybackMinDte} DTE`,
    parameters: [
      { field: "crashLoopRestartsPerHour", label: "Crash-loop restarts", unit: "per hour", kind: "integer", step: "1", help: "More agent restarts than this in an hour pause Pluto until a person resumes it." },
      { field: "telegramVerbosity", label: "Telegram verbosity", kind: "select", options: ["actions", "off"], help: "actions: every order and close Pluto sends, and how each one ended. off: none of those. Breakers, pauses and switching Pluto on or off are always sent." },
      { field: "unstructuredCloseMinPct", label: "Unstructured close min", unit: "% of cost", kind: "number", step: "0.1", help: "Shares with no call against them are offered for closing only above this cycle profit." },
      { field: "unstructuredCloseMinDollars", label: "Unstructured close min", unit: "$", kind: "number", step: "1", help: "And only above this dollar profit." },
      { field: "buybackMinDte", label: "Buyback min DTE", unit: "days", kind: "integer", step: "1", help: "A short leg closer to expiry than this is left to expire rather than bought back." },
    ],
  },
];

export const plutoParameterCount = plutoParameterGroups.reduce((sum, group) => sum + group.parameters.length, 0);

export const plutoParameterSpecByField: Record<string, PlutoParameterSpec> = Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameter])));

export function plutoParameterHelp(spec: PlutoParameterSpec, context: PlutoParameterContext): string {
  return typeof spec.help === "function" ? spec.help(context) : spec.help;
}

/** The API validates numbers as numbers, so numeric fields are sent as such; everything else as text. */
export function settingsInputValue(field: PlutoSettingsField, value: string): string | number {
  const kind = plutoParameterSpecByField[field]?.kind;
  return kind === "number" || kind === "integer" ? Number(value) : value;
}

export const plutoParameterLabelByField: Record<string, string> = {
  // Renamed fields, still named in older settings audit rows and events.
  maxAbsDayChangePct: "Max day move (old, % of price)",
  ...Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameter.field === "maxDte" ? "Max DTE" : parameter.field === "minDte" ? "Min DTE" : parameter.label]))),
};

export type PlutoSettingsFormState = Record<PlutoSettingsField, string>;

/** A number as the field shows it: the step's decimals ("0.30" for step 0.01), integers bare. */
export function formatSettingValue(spec: PlutoParameterSpec, value: string | number): string {
  if (spec.kind !== "number" || typeof value !== "number") return String(value);
  const decimals = spec.step?.includes(".") ? spec.step.split(".")[1]!.length : 0;
  return Number.isInteger(value) && decimals === 0 ? String(value) : value.toFixed(decimals);
}

export function settingsToFormState(settings: PlutoSettings): PlutoSettingsFormState {
  const state = {} as PlutoSettingsFormState;
  for (const group of plutoParameterGroups) for (const parameter of group.parameters) state[parameter.field] = formatSettingValue(parameter, settings[parameter.field]);
  return state;
}

function settingsValueDiffers(spec: PlutoParameterSpec, from: string, to: string): boolean {
  if ((spec.kind === "number" || spec.kind === "integer") && to !== "" && Number.isFinite(Number(to))) return Number(from) !== Number(to);
  return from !== to;
}

export interface PlutoSettingsChange {
  field: PlutoSettingsField;
  label: string;
  unit: string | null;
  from: string;
  to: string;
}

/** Fields whose text differs from the loaded settings, with both values for the save bar and the confirm dialog. */
export function changedSettingsFields(settings: PlutoSettings, form: PlutoSettingsFormState): PlutoSettingsChange[] {
  const changes: PlutoSettingsChange[] = [];
  for (const group of plutoParameterGroups) {
    for (const parameter of group.parameters) {
      const from = formatSettingValue(parameter, settings[parameter.field]);
      const to = form[parameter.field].trim();
      if (settingsValueDiffers(parameter, from, to)) changes.push({ field: parameter.field, label: plutoParameterLabelByField[parameter.field] ?? parameter.label, unit: parameter.unit ?? null, from, to });
    }
  }
  return changes;
}

/** "Min Edge $ 30 → 25" for the save bar and the audit list; a time or a select shows no unit. */
export function describeSettingsChange(change: { label: string; unit: string | null; from: string; to: string }): string {
  const unit = change.unit && change.unit !== "ET" && change.unit !== "min" && change.unit !== "max" && !change.unit.startsWith("$") ? ` ${change.unit}` : "";
  return `${change.label} ${change.from} → ${change.to}${unit}`;
}
