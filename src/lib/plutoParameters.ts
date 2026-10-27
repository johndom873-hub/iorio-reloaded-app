import type { PlutoLadderTickerSettings, PlutoSettings, PlutoSettingsField } from "../api/pluto";
import { formatCurrency, formatInputNumber } from "./formatters";

// Every Pluto parameter the Settings tab edits, grouped as on the approved redesign (2026-10-06). Labels, units
// and help are the only presentation the screen carries; validation lives in the API's settingsStore.

/** Figures the help texts quote, so "% of account" settings can say what they come to in dollars right now. */
export interface PlutoParameterContext {
  netLiquidationValue: number | null;
  settings: PlutoSettings;
  /** Every shortlisted ticker's ladder settings, for "COIN overrides it" in the ladder's help; null while loading. */
  ladderTickers?: PlutoLadderTickerSettings[] | null;
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
  /** What a select shows for each option value; the value itself when missing. */
  optionLabels?: Readonly<Record<string, string>>;
  /** Rendered on one row with the parameter before it (min/max pairs). */
  pairedWithPrevious?: boolean;
}

export interface PlutoParameterGroup {
  key: string;
  title: string;
  parameters: PlutoParameterSpec[];
  /** The group's key figures, shown in its header while collapsed. */
  summary: (settings: PlutoSettings) => string;
  /** A line above the group's settings while it is open. */
  note?: string;
}

function dollarsOfAccount(context: PlutoParameterContext, pct: number): string {
  return context.netLiquidationValue === null ? "" : ` (${formatCurrency((context.netLiquidationValue * pct) / 100, 0)} now)`;
}

/** " COIN and SMCI override it." for the tickers with their own value of a ladder setting; "" when none does. */
function ladderOverrideNote(context: PlutoParameterContext, overrides: (ticker: PlutoLadderTickerSettings) => boolean): string {
  const symbols = (context.ladderTickers ?? []).filter(overrides).map((ticker) => ticker.symbol);
  if (symbols.length === 0) return "";
  return ` ${symbols.join(", ").replace(/, ([^,]*)$/, " and $1")} override${symbols.length === 1 ? "s" : ""} it.`;
}

export const plutoParameterGroups: PlutoParameterGroup[] = [
  {
    key: "ladder",
    title: "CC + Put Ladder",
    summary: (settings) => `share level ${settings.ladderSharesPct}% · ${settings.ladderRungs} rungs · Calls' |delta| ${settings.ladderMinAbsDelta.toFixed(2)}–${settings.ladderMaxAbsDelta.toFixed(2)} · ${settings.ladderMinDte}–${settings.ladderMaxDte} DTE · shock ${settings.ladderShockMinPct}–${settings.ladderShockMaxPct}%`,
    parameters: [
      { field: "ladderSharesPct", label: "Share level", unit: "% of pot", kind: "number", step: "1", help: (context) => `Part of each ticker's pot that buys shares; the rest is the Put reserve, split across the rungs.${ladderOverrideNote(context, (ticker) => ticker.tickerOverrides.ladderSharesPct !== null)}` },
      { field: "ladderRungs", label: "Rungs", unit: "rungs", kind: "integer", step: "1", help: (context) => `Ladder Puts per ticker, each capped below the price: the first rung's cap is the price × (1 − shock ÷ rungs).${ladderOverrideNote(context, (ticker) => ticker.tickerOverrides.ladderRungs !== null)}` },
      { field: "ladderMinAbsDelta", label: "Calls' |delta| range", unit: "min", kind: "number", step: "0.01", help: (context) => `Calls the ladder may sell, by absolute delta. The ladder's Puts have no |delta| range: the rung's cap bounds them. Manual orders keep the platform's range.${ladderOverrideNote(context, (ticker) => ticker.tickerOverrides.minAbsDelta !== null || ticker.tickerOverrides.maxAbsDelta !== null)}` },
      { field: "ladderMaxAbsDelta", label: "Max |delta|", unit: "max", kind: "number", step: "0.01", help: "Highest absolute delta of a Call the ladder may sell.", pairedWithPrevious: true },
      { field: "ladderMinDte", label: "Days to expiry", unit: "min", kind: "integer", step: "1", help: "Shortest and longest expiry the ladder may sell." },
      { field: "ladderMaxDte", label: "Max DTE", unit: "max", kind: "integer", step: "1", help: "Longest expiry, in days.", pairedWithPrevious: true },
      { field: "ladderMaxSpreadPctOfMid", label: "Max spread", unit: "% of mid", kind: "number", step: "1", help: "Widest bid-ask spread, as a share of the mid, the ladder will sell into." },
      {
        field: "ladderShockMinPct",
        label: "Shock limits",
        unit: "min %",
        kind: "number",
        step: "1",
        help: (context) => {
          const example = (context.ladderTickers ?? []).find((ticker) => ticker.recommendedShockPct !== null);
          return `Each ticker's recommended shock is its Max drawdown over the lookback, kept within these limits${example ? ` (${example.symbol} now: ${example.recommendedShockPct}%)` : ""}.${ladderOverrideNote(context, (ticker) => ticker.overrideShockPct !== null)}`;
        },
      },
      { field: "ladderShockMaxPct", label: "Shock ceiling", unit: "max %", kind: "number", step: "1", help: "Highest recommended shock.", pairedWithPrevious: true },
      { field: "ladderShockNoHistoryPct", label: "Shock for a new listing", unit: "%", kind: "number", step: "1", help: "Used instead when the lookback holds fewer than 250 daily closes." },
      { field: "ladderShockLookbackYears", label: "Shock lookback", unit: "years", kind: "integer", step: "1", help: "Years of daily closes the Max drawdown is measured over." },
    ],
  },
  {
    key: "ladderSafety",
    title: "Ladder safety",
    summary: (settings) => `${settings.ladderMaxWorkingOrdersPerTicker} working orders · ${settings.ladderMaxOpenPositionsPerTicker} open positions · ${settings.ladderMaxOrdersPerTickerPerDay} orders a day per ticker · ${settings.ladderMaxOpenPositions} positions · ${settings.ladderMaxOrdersPerDay} orders a day across the book · SPY ${settings.ladderSpyStressBreakerPct}% · ${settings.ladderTickerCooldownMinutes ? `${settings.ladderTickerCooldownMinutes} min cooldown` : "no cooldown"}`,
    parameters: [
      { field: "ladderMaxWorkingOrdersPerTicker", label: "Working orders per ticker", unit: "orders", kind: "integer", step: "1", help: "At most this many of a ticker's orders work at once, the ladder's and Vol Farmer v2's alike; the rest go at the next looks." },
      { field: "ladderMaxOpenPositionsPerTicker", label: "Open positions per ticker", unit: "positions", kind: "integer", step: "1", help: "Neither strategy opens anything new on a ticker holding this many." },
      { field: "ladderMaxOrdersPerTickerPerDay", label: "Orders per ticker per day", unit: "orders", kind: "integer", step: "1", help: "Every order either strategy sends on a ticker in a day counts, re-prices included." },
      { field: "ladderMaxOpenPositions", label: "Open positions, all tickers", unit: "positions", kind: "integer", step: "1", help: "Across every Pluto ticker: open positions plus working orders. Sales beyond it wait for a later look." },
      { field: "ladderMaxOrdersPerDay", label: "Orders per day, all tickers", unit: "orders", kind: "integer", step: "1", help: "Orders both strategies send in a day across every ticker, counted as the per-ticker cap counts them. Sales beyond it wait." },
      { field: "ladderSpyStressBreakerPct", label: "SPY stress breaker", unit: "% drop", kind: "number", step: "0.1", help: "While SPY is down this much today, the ladder sends nothing and Vol Farmer v2 opens nothing; a LEAPS sale still goes. The daily-loss breaker is under Session & breakers." },
      { field: "ladderTickerCooldownMinutes", label: "Ticker cooldown", unit: "min", kind: "integer", step: "1", help: "Minutes after a filled Pluto order before either strategy acts on that ticker again. 0 = no cooldown." },
    ],
  },
  {
    key: "volFarmerV2",
    title: "Vol Farmer v2",
    note: "Every Vol Farmer v2 ticker. Set from the lab's values of 27 Oct 2026; never synced with the lab. The caps, cooldown and SPY stress breaker under Ladder safety count v2's orders too.",
    summary: (settings) => `Calls' |delta| ${settings.volFarmerV2CallMinAbsDelta.toFixed(2)}–${settings.volFarmerV2CallMaxAbsDelta.toFixed(2)} · Puts under ${settings.volFarmerV2PutsStartCallYieldPct}% a year, |delta| ≤ ${settings.volFarmerV2PutMaxAbsDelta.toFixed(2)} · Step ${settings.volFarmerV2StepRule === "fixed" ? `${settings.volFarmerV2StepBelowFirstBreakEvenPct}% fixed` : "the implied move"} · LEAPS ${settings.volFarmerV2LeapsMinDte}+ DTE, |delta| ${settings.volFarmerV2LeapsAbsDelta.toFixed(2)}, ≤ ${settings.volFarmerV2LeapsMaxAllocationPct}% of the pot · spread ${settings.volFarmerV2MaxSpreadPctOfMid}%`,
    parameters: [
      { field: "volFarmerV2CallMinAbsDelta", label: "Calls' |delta| range", unit: "min", kind: "number", step: "0.01", help: "Calls v2 may sell, by absolute delta. A Call is also struck at or above its position's break-even." },
      { field: "volFarmerV2CallMaxAbsDelta", label: "Calls' max |delta|", unit: "max", kind: "number", step: "0.01", help: "Highest absolute delta of a Call v2 may sell.", pairedWithPrevious: true },
      { field: "volFarmerV2MaxSpreadPctOfMid", label: "Max spread", unit: "% of mid", kind: "number", step: "1", help: "Widest bid-ask spread, as a share of the mid, of every v2 order, the LEAPS' included." },
      { field: "volFarmerV2PutsStartCallYieldPct", label: "Puts start under", unit: "% a year", kind: "number", step: "0.5", help: "When the first position needs a new Call and the best one pays under this, v2 sells Puts with the other half of the pot." },
      { field: "volFarmerV2PutMaxAbsDelta", label: "Put |delta|", unit: "max", kind: "number", step: "0.01", help: "The Puts' highest absolute delta." },
      {
        field: "volFarmerV2StepRule",
        label: "Step rule",
        kind: "select",
        options: ["implied_move_at_put_sale", "fixed"],
        optionLabels: { implied_move_at_put_sale: "Implied move", fixed: "Fixed" },
        help: "How far below B-E¹ the Puts are struck at most: the one-month implied move at each Put sale, IBKR's 30-day IV × √(21 ÷ 252) (an IV of 30% gives a Step of 8.7%), or the fixed Step below.",
      },
      { field: "volFarmerV2StepBelowFirstBreakEvenPct", label: "Step", unit: "% below B-E¹", kind: "number", step: "0.5", help: "The fixed Step, and the implied move's when IBKR has no IV for the ticker." },
      { field: "volFarmerV2LeapsMinDte", label: "LEAPS expiry from", unit: "days", kind: "integer", step: "1", help: "The first listed expiry at least this far out." },
      { field: "volFarmerV2LeapsAbsDelta", label: "LEAPS |delta|", kind: "number", step: "0.01", help: "The Call whose absolute delta is nearest this." },
      {
        field: "volFarmerV2LeapsMaxAllocationPct",
        label: "LEAPS cap",
        unit: "% of pot",
        kind: "number",
        step: "1",
        help: (context) => {
          const example = (context.ladderTickers ?? []).find((ticker) => ticker.effectiveStrategy === "vol_farmer_v2" && ticker.potDollars !== null);
          const cap = example ? ` ${context.settings.volFarmerV2LeapsMaxAllocationPct}% of ${example.symbol}'s ${formatCurrency(example.potDollars!, 0)} pot is ${formatCurrency((example.potDollars! * context.settings.volFarmerV2LeapsMaxAllocationPct) / 100, 0)} today.` : "";
          return `The most a LEAPS purchase spends, as a share of the ticker's pot, paid from the cash free in Pluto's budget.${cap}`;
        },
      },
    ],
  },
  {
    key: "capital",
    title: "Capital",
    summary: (settings) => `budget ${settings.capitalBudgetPct}% of the account`,
    parameters: [
      { field: "capitalBudgetPct", label: "Capital budget", unit: "% of account", kind: "number", step: "1", help: (context) => `Everything that may be committed at once on the tickers Pluto is enabled on, human positions there included${dollarsOfAccount(context, context.settings.capitalBudgetPct)}. Hedges are not counted.` },
    ],
  },
  {
    key: "session",
    title: "Session & breakers",
    summary: (settings) => `window ${settings.windowStartEt}–${settings.windowEndEt} ET · daily loss breaker ${settings.dailyLossBreakerPct}% · quotes up to ${settings.maxQuoteAgeMinutes} min old`,
    parameters: [
      { field: "windowStartEt", label: "Window start", unit: "ET", kind: "time", help: "Pluto acts from this Eastern time." },
      { field: "windowEndEt", label: "Window end", unit: "ET", kind: "time", help: "Pluto stops acting at this Eastern time, or 30 minutes before an early close if that comes first." },
      { field: "dailyLossBreakerPct", label: "Daily loss breaker", unit: "% of account", kind: "number", step: "0.1", help: "A day down this much versus last night trips a breaker: Pluto stops until a person resets it." },
      { field: "maxQuoteAgeMinutes", label: "Max quote age", unit: "min", kind: "integer", step: "1", help: "A band quote older than this is left out of the ladder's look." },
      { field: "maxFillSlippagePct", label: "Max fill slippage", unit: "%", kind: "number", step: "1", help: "A fill this far past the reference price (below the bid for a sell, above the ask for a buy), as a share of it, trips the fill_slippage breaker." },
    ],
  },
  {
    key: "triggers",
    title: "Quotes & lines",
    summary: (settings) => `ladder quotes checked every ${settings.bandQuotePollSeconds} s · bursts of up to ${settings.burstLines} lines · up to ${settings.maxEnabledTickers} tickers`,
    parameters: [
      { field: "bandQuotePollSeconds", label: "Ladder quotes poll", unit: "s", kind: "integer", step: "1", help: "How often Pluto checks the market quote loop for ladder quotes received since its last round." },
      { field: "burstLines", label: "Burst lines", unit: "lines", kind: "integer", step: "1", help: "Most option contracts Pluto re-quotes live in one short burst before pricing a ladder order. Their IBKR lines are booked only while the burst runs." },
      { field: "burstSettleSeconds", label: "Burst settle", unit: "s", kind: "integer", step: "1", help: "How long a burst waits for quotes before the order is priced." },
      { field: "maxEnabledTickers", label: "Max allowed tickers", unit: "tickers", kind: "integer", step: "1", help: "Cap on Shortlist tickers Pluto may trade; each holds one IBKR market-data line." },
    ],
  },
  {
    key: "operations",
    title: "Operations",
    summary: (settings) => `Telegram: ${settings.telegramVerbosity === "actions" ? "actions" : "off"} · pause after ${settings.crashLoopRestartsPerHour} restarts an hour`,
    parameters: [
      { field: "crashLoopRestartsPerHour", label: "Crash-loop restarts", unit: "per hour", kind: "integer", step: "1", help: "More agent restarts than this in an hour pause Pluto until a person resumes it." },
      { field: "telegramVerbosity", label: "Telegram verbosity", kind: "select", options: ["actions", "off"], help: "actions: every order and close Pluto sends, and how each one ended. off: none of those. Breakers, pauses and switching Pluto on or off are always sent." },
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

/** Where a paired field's own label reads as half of a pair ("Days to expiry", "|Delta| range"), the audit names it alone. */
const parameterAuditLabel: Partial<Record<PlutoSettingsField, string>> = {
  ladderMinDte: "Ladder min DTE",
  ladderMaxDte: "Ladder max DTE",
  ladderMinAbsDelta: "Ladder Calls' |delta| lower limit",
  ladderMaxAbsDelta: "Ladder Calls' |delta| upper limit",
  ladderShockMinPct: "Shock floor",
  ladderShockMaxPct: "Shock ceiling",
  ladderMaxSpreadPctOfMid: "Ladder max spread",
  ladderTickerCooldownMinutes: "Ladder ticker cooldown",
  volFarmerV2CallMinAbsDelta: "Vol Farmer v2 Calls' |delta| lower limit",
  volFarmerV2CallMaxAbsDelta: "Vol Farmer v2 Calls' |delta| upper limit",
  volFarmerV2MaxSpreadPctOfMid: "Vol Farmer v2 max spread",
  volFarmerV2PutsStartCallYieldPct: "Vol Farmer v2 Puts start under",
  volFarmerV2PutMaxAbsDelta: "Vol Farmer v2 Put |delta|",
  volFarmerV2StepRule: "Vol Farmer v2 Step rule",
  volFarmerV2StepBelowFirstBreakEvenPct: "Vol Farmer v2 Step",
  volFarmerV2LeapsMinDte: "Vol Farmer v2 LEAPS expiry from",
  volFarmerV2LeapsAbsDelta: "Vol Farmer v2 LEAPS |delta|",
  volFarmerV2LeapsMaxAllocationPct: "Vol Farmer v2 LEAPS cap",
};

export const plutoParameterLabelByField: Record<string, string> = {
  // Renamed and retired fields, still named in older settings audit rows and events.
  maxAbsDayChangePct: "Max day move (old, % of price)",
  maxTickerExposurePct: "Max per ticker (old, % of account)",
  maxSectorExposurePct: "Max per sector (old, % of account)",
  daySignalsPollSeconds: "Ladder quotes poll",
  maxActionsPerSession: "Max orders per day (retired)",
  executionStrategy: "Active strategy (retired)",
  maxTickerPctOfBudget: "Max per ticker (retired)",
  maxSectorPctOfBudget: "Max per sector (retired)",
  maxOpenPositions: "Max open positions (retired)",
  orderSizePctOfBudget: "Order size (retired)",
  minCashReservePct: "Min cash reserve (retired)",
  stressRiskBudgetPct: "Stress cap per order (retired)",
  stressSigmas: "Stress move (retired)",
  minGrade: "Min grade (retired)",
  minEdgeYieldPct: "Min Edge Yield (retired)",
  maxAbsDelta: "Max |delta| (retired)",
  minDte: "Min DTE (retired)",
  maxDte: "Max DTE (retired)",
  minAnnualizedYieldPct: "Min annualized yield (retired)",
  maxSpreadPct: "Max spread (retired)",
  minOpenInterest: "Min open interest (retired)",
  minSessionVolume: "Min session volume (retired)",
  maxContractsVolumeSharePct: "Max share of contract volume (retired)",
  maxSliceRmseVp: "Max slice fit error (retired)",
  minSlicePointCount: "Min slice points (retired)",
  maxMidVsSurfaceIvVp: "Max mid vs surface IV (retired)",
  maxIvShiftVp: "Max IV shift (retired)",
  maxDayMoveMultiple: "Max day move (retired)",
  spyStressBreakerPct: "SPY stress, Edge Margin (retired)",
  maxEdgeMarginDriftPts: "Max edge margin drift (retired)",
  tickerCooldownMinutes: "Ticker cooldown, Edge Margin (retired)",
  modelId: "Model (retired)",
  reasoningEffort: "Reasoning effort (retired)",
  callTimeoutSeconds: "Call timeout (retired)",
  dailyCostCeilingUsd: "Daily cost ceiling (retired)",
  confidenceFloor: "Confidence floor (retired)",
  consecutiveModelFailuresBreaker: "Consecutive failures breaker (retired)",
  promptVersion: "Prompt version (retired)",
  perTickerModelCooldownMinutes: "Per-ticker model cooldown (retired)",
  messageRateLimitPerSecond: "Message rate limit (retired)",
  unstructuredCloseMinPct: "Unstructured close min % (retired)",
  unstructuredCloseMinDollars: "Unstructured close min $ (retired)",
  buybackMinDte: "Buyback min DTE (retired)",
  ...Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameterAuditLabel[parameter.field] ?? parameter.label]))),
};

export type PlutoSettingsFormState = Record<PlutoSettingsField, string>;

/** Option labels of retired select fields, still named in older settings audit rows. */
const retiredOptionLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = { executionStrategy: { edge_margin: "Edge Margin", cc_put_ladder: "CC + Put Ladder" } };

/** A saved or typed value as the screen shows it: a select's option label, else the value. */
export function formatSettingDisplay(field: string, value: string): string {
  return (plutoParameterSpecByField[field]?.optionLabels ?? retiredOptionLabels[field])?.[value] ?? value;
}

/** A number as the field shows it: at least the step's decimals ("0.30" for step 0.01), never fewer than the value
 *  has (2.5 stays "2.5" on a step-1 field, so the text never rounds the stored setting), integers bare. */
export function formatSettingValue(spec: PlutoParameterSpec, value: string | number): string {
  if (spec.kind !== "number" || typeof value !== "number") return String(value);
  const stepDecimals = spec.step?.includes(".") ? spec.step.split(".")[1]!.length : 0;
  const valueDecimals = formatInputNumber(value, 6).split(".")[1]?.length ?? 0;
  return value.toFixed(Math.max(stepDecimals, valueDecimals));
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

/**
 * What the person typed, field by field, with the saved value it started from. Only these fields are theirs: every other
 * field always shows the live saved value, so a change saved elsewhere (another person, another tab) appears at once instead
 * of reading as an unsaved change of theirs, and a save never sends it back.
 */
export type PlutoSettingsEdits = Partial<Record<PlutoSettingsField, { value: string; startedFrom: string }>>;

/** The form as shown: the saved settings with the person's edits on top. */
export function formStateWithEdits(settings: PlutoSettings, edits: PlutoSettingsEdits): PlutoSettingsFormState {
  const state = settingsToFormState(settings);
  for (const [field, edit] of Object.entries(edits)) if (edit) state[field as PlutoSettingsField] = edit.value;
  return state;
}

/** Records one keystroke's value; typing the saved value back drops the edit. */
export function applySettingsEdit(settings: PlutoSettings, edits: PlutoSettingsEdits, field: PlutoSettingsField, value: string): PlutoSettingsEdits {
  const spec = plutoParameterSpecByField[field]!;
  const saved = formatSettingValue(spec, settings[field]);
  const next = { ...edits };
  if (!settingsValueDiffers(spec, saved, value.trim())) delete next[field];
  else next[field] = { value, startedFrom: edits[field]?.startedFrom ?? saved };
  return next;
}

/** Edited fields someone else has saved a different value for since the edit began, with the value the edit started from. */
export function settingsChangedElsewhere(settings: PlutoSettings, edits: PlutoSettingsEdits): Map<PlutoSettingsField, string> {
  const changed = new Map<PlutoSettingsField, string>();
  for (const [field, edit] of Object.entries(edits)) {
    if (!edit) continue;
    const spec = plutoParameterSpecByField[field]!;
    const saved = formatSettingValue(spec, settings[field as PlutoSettingsField]);
    if (settingsValueDiffers(spec, edit.startedFrom, saved)) changed.set(field as PlutoSettingsField, edit.startedFrom);
  }
  return changed;
}

/** "Min Edge $ 30 → 25" for the save bar and the audit list; a time or a select shows no unit, a select its option labels. */
export function describeSettingsChange(change: { field?: string; label: string; unit: string | null; from: string; to: string }): string {
  const unit = change.unit && change.unit !== "ET" && change.unit !== "min" && change.unit !== "max" && !change.unit.startsWith("$") ? ` ${change.unit}` : "";
  const shown = (value: string) => (change.field ? formatSettingDisplay(change.field, value) : value);
  return `${change.label} ${shown(change.from)} → ${shown(change.to)}${unit}`;
}

// The Settings tab's values as a trader reads them, printed in place of the inputs (access levels, 2026-10-17).

/** Units written straight after the number ("50% of account", "2.0σ", "3.0× normal"); every other unit follows a space. */
const unitsWithoutSpace = /^[%σ×]/;

/** One setting with its unit: "50% of account", "15 orders", "$1.00 / day", "09:45 ET"; a select shows its option label. */
export function formatSettingWithUnit(spec: PlutoParameterSpec, value: string | number): string {
  const shown = formatSettingDisplay(spec.field, formatSettingValue(spec, value));
  const unit = spec.unit;
  if (!unit) return shown;
  if (unit.startsWith("$")) return `${formatCurrency(Number(value), spec.step?.includes(".") ? 2 : 0)}${unit.slice(1)}`;
  return unitsWithoutSpace.test(unit) ? `${shown}${unit}` : `${shown} ${unit}`;
}

/** A settings row as printed: one setting with its unit, or a min/max pair as a range ("0.20–0.30", "2–7", "20–60%"). */
export function formatSettingRowWithUnit(row: PlutoParameterSpec[], settings: PlutoSettings): string {
  const lead = row[0]!;
  if (row.length === 1) return formatSettingWithUnit(lead, settings[lead.field]);
  // A pair's units name its ends ("min", "max %"): what is left after the end is the range's own unit.
  const unit = (row[row.length - 1]!.unit ?? "").replace(/^(min|max)\s*/, "");
  return `${row.map((parameter) => formatSettingValue(parameter, settings[parameter.field])).join("–")}${unit}`;
}
