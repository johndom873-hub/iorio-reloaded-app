import type { PlutoSettings, PlutoSettingsField, PlutoTickerAllocation } from "../api/pluto";
import { formatCurrency, formatInputNumber, hhmmMinutesBefore } from "./formatters";

// Every Pluto parameter the Settings tab edits, grouped as on the approved redesign (2026-10-06). Labels, units
// and help are the only presentation the screen carries; validation lives in the API's settingsStore.

/** Figures the help texts quote, so "% of account" settings can say what they come to in dollars right now. */
export interface PlutoParameterContext {
  netLiquidationValue: number | null;
  settings: PlutoSettings;
  /** Every shortlisted ticker's allocation and pot, for "10% of COIN's pot" in the LEAPS cap's help; null while loading. */
  tickerAllocations?: PlutoTickerAllocation[] | null;
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
  /** What 0 means ("No cap"), shown in place of the 0's unit beside the input and in place of the 0 and its unit elsewhere. */
  zeroLabel?: string;
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

/** v4's buyback runs in the window's last minutes (the API's volFarmerV4BuyBackMinutesBeforeWindowEnd). */
const volFarmerV4BuyBackMinutes = 2;

/** The summary line's buyback segment: nothing while a Call in the money is left to be assigned. */
const volFarmerV4BuyBackSummary: Record<PlutoSettings["volFarmerV4CallsInTheMoneyAtLastLook"], string> = {
  assigned: "",
  bought_back: " · ITM Calls bought back",
  bought_back_before_weekends: " · ITM Calls bought back before weekends",
};

function dollarsOfAccount(context: PlutoParameterContext, pct: number): string {
  return context.netLiquidationValue === null ? "" : ` (${formatCurrency((context.netLiquidationValue * pct) / 100, 0)} now)`;
}

export const plutoParameterGroups: PlutoParameterGroup[] = [
  {
    key: "capital",
    title: "Capital",
    summary: (settings) => `budget ${settings.capitalBudgetPct}% of the account`,
    parameters: [
      { field: "capitalBudgetPct", label: "Capital budget", unit: "% of account", kind: "number", step: "1", help: (context) => `Everything that may be committed at once on the tickers Pluto is enabled on, human positions there included${dollarsOfAccount(context, context.settings.capitalBudgetPct)}. Hedges are not counted.` },
    ],
  },
  {
    key: "volFarmerV4",
    title: "Vol Farmer",
    note: "Every Vol Farmer v4 ticker. Set from the lab's best run of 30 Oct 2026; never synced with the lab. The caps, cooldown and SPY stress breaker under Safety Limits count v4's orders too.",
    summary: (settings) =>
      `First position ${settings.volFarmerV4FirstPositionPct}% ± ${settings.volFarmerV4RebalanceBandPct}%${settings.volFarmerV4TopUpCapPct > 0 ? `, top-ups up to ${settings.volFarmerV4TopUpCapPct}%` : ""} · ${settings.volFarmerV4OptionsExpiry === "today" ? "options expiring today" : "options on the next expiry"} · Calls' |delta| ${settings.volFarmerV4CallMinAbsDelta.toFixed(2)}–${settings.volFarmerV4CallMaxAbsDelta.toFixed(2)} · Puts under ${settings.volFarmerV4PutsStartCallYieldPct}% a year, |delta| ≤ ${settings.volFarmerV4PutMaxAbsDelta.toFixed(2)} · Step ${settings.volFarmerV4StepRule === "fixed" ? `${settings.volFarmerV4StepBelowFirstBreakEvenPct}% fixed` : "the implied move"} · ${settings.volFarmerV4AlwaysHoldTheStock === "off" ? "shares only with a Call · " : ""}LEAPS ${settings.volFarmerV4LeapsMinDte}+ DTE, |delta| ${settings.volFarmerV4LeapsAbsDelta.toFixed(2)}, ≤ ${settings.volFarmerV4LeapsMaxAllocationPct}% of the pot · spread ${settings.volFarmerV4MaxSpreadPctOfMid}%${volFarmerV4BuyBackSummary[settings.volFarmerV4CallsInTheMoneyAtLastLook] ?? ""}`,
    parameters: [
      { field: "volFarmerV4CallMinAbsDelta", label: "Calls' |delta| range", unit: "min", kind: "number", step: "0.01", help: "Calls v4 may sell, by absolute delta, struck where Calls struck at least says." },
      { field: "volFarmerV4CallMaxAbsDelta", label: "Calls' max |delta|", unit: "max", kind: "number", step: "0.01", help: "Highest absolute delta of a Call v4 may sell.", pairedWithPrevious: true },
      { field: "volFarmerV4MaxSpreadPctOfMid", label: "Max spread", unit: "% of mid", kind: "number", step: "1", help: "Widest bid-ask spread, as a share of the mid, of every v4 order, the LEAPS' included." },
      { field: "volFarmerV4FirstPositionPct", label: "First position", unit: "% of the pot", kind: "number", step: "5", help: "The share of the ticker's pot the first position's shares are bought with, in whole lots, and its rebalancing target; the Puts sell on the rest (10 to 90)." },
      {
        field: "volFarmerV4RebalanceBandPct",
        label: "Rebalancing band",
        unit: "% of the pot",
        kind: "number",
        step: "1",
        help: "When the first position holds shares with no Call open, it is traded back to its target (First position % of the pot) once its value is off it by more than this: whole lots bought with the free cash, or sold, to floor(target ÷ a lot's cost), never below one lot. Pot $150,000, First position 80% and 5%: a target of $120,000, traded below $112,500 or above $127,500. A share order goes alone; the ticker's options wait for it (0 to 50).",
      },
      {
        field: "volFarmerV4Rebalances",
        label: "Rebalances",
        kind: "select",
        options: ["both_positions", "first_position"],
        optionLabels: { both_positions: "Both positions as one holding", first_position: "The first position" },
        help: "What the target covers. Both positions as one holding: the second position's shares count too; top-ups still buy into the first position, and a trim sells as Trims sell says, only lots with no Call open, the first keeping one lot.",
      },
      {
        field: "volFarmerV4TrimsSell",
        label: "Trims sell",
        kind: "select",
        options: ["higher_break_even_first", "second_position_first"],
        optionLabels: { higher_break_even_first: "The higher break-even first", second_position_first: "The second position first" },
        help: "With both positions rebalanced as one: the position with the higher break-even first, or the second position's shares first, so it empties and the Puts can sell again.",
      },
      {
        field: "volFarmerV4TopUpCapPct",
        label: "Top-ups up to",
        unit: "% of the pot",
        kind: "number",
        step: "10",
        zeroLabel: "No cap",
        help: "The most money a ticker's top-ups may take it to: what its shares cost (the second position's at their assigned strikes) plus the cash its open Puts hold. A top-up buys only the lots the room left pays for. Pot $264,052 at 100% with $211,240 in: $52,812 of room, 3 lots at $150 of the 4 rebalancing wants. A new cycle's first purchase, Calls, Puts, trims and LEAPS are not capped. 0: no cap (0 to 1000).",
      },
      {
        field: "volFarmerV4FirstPositionAfterCalledAway",
        label: "First position called away first",
        kind: "select",
        options: ["wait", "rebuild"],
        optionLabels: { wait: "Waits for the second to go", rebuild: "Rebuilt at the next look" },
        help: "A first position called away while the second still holds shares: wait for the second to be called away before a new cycle, or rebuild it at the next look, its shares bought with its Call (less the second position's shares' value when both are rebalanced as one).",
      },
      {
        field: "volFarmerV4AlwaysHoldTheStock",
        label: "Always hold the stock",
        kind: "select",
        options: ["on", "off"],
        optionLabels: { on: "On: bought on any day", off: "Off: only with a Call" },
        help: "On: shares are bought back at the next look after a call-away, and topped up on any day, even when no Call is sold that day. Off: shares are bought only on a day a Call is sold with them, so a flat ticker waits for its next expiry day. Trims sell on any day either way. A ticker's own value on the Tickers tab overrides this.",
      },
      {
        field: "volFarmerV4OptionsExpiry",
        label: "Calls and Puts expire",
        kind: "select",
        options: ["today", "next"],
        optionLabels: { today: "At today's close, on expiry days", next: "On the next expiry" },
        help: "Today's close: sold only on the days an expiry ends at the close, so they cover no night; on other days v4 sells no option, and buys shares only with Always hold the stock on. Or the next expiry after today.",
      },
      { field: "volFarmerV4OptionsMaxDaysToExpiry", label: "Next expiry within", unit: "days", kind: "integer", step: "1", help: "With the next expiry: the most calendar days it may be away for v4 to sell on it; further away, it only rebalances. 45: every next expiry (1 to 45)." },
      {
        field: "volFarmerV4CallsInTheMoneyAtLastLook",
        label: "Calls in the money at the window's end",
        kind: "select",
        options: ["assigned", "bought_back", "bought_back_before_weekends"],
        optionLabels: { assigned: "Left to be assigned", bought_back: "Bought back, the shares kept", bought_back_before_weekends: "Bought back before weekends only" },
        help: (context) =>
          `A Call expiring at today's close still in the money in the last ${volFarmerV4BuyBackMinutes} minutes before the window closes (${hhmmMinutesBefore(context.settings.windowEndEt, volFarmerV4BuyBackMinutes)}–${context.settings.windowEndEt}): left to be assigned at the close; bought back at the mid, the shares kept; or bought back only on the last session before a weekend (a Friday, or the Thursday before a Friday holiday). A buyback the settled cash can't pay for, or one still unfilled at 15:58, leaves the Call to be assigned.`,
      },
      {
        field: "volFarmerV4CallStrikeFloor",
        label: "Calls struck at least",
        kind: "select",
        options: ["none", "break_even"],
        optionLabels: { none: "Above the price", break_even: "At the break-even" },
        help: "Anywhere above the price inside the Calls' |delta| range, or at or above the position's break-even.",
      },
      {
        field: "volFarmerV4PutsSold",
        label: "Puts sold",
        kind: "select",
        options: ["calls_yield_little", "with_every_call"],
        optionLabels: { calls_yield_little: "When the Calls yield little", with_every_call: "With every Call" },
        help: "When the first position's best Call yields under Puts start under, or with every Call the first position sells, whatever it yields (the second position still holding no shares and no Put).",
      },
      { field: "volFarmerV4PutsStartCallYieldPct", label: "Puts start under", unit: "% a year", kind: "number", step: "0.5", help: "When the first position needs a new Call and the best one pays under this, v4 sells Puts with the rest of the pot." },
      { field: "volFarmerV4PutMaxAbsDelta", label: "Put |delta|", unit: "max", kind: "number", step: "0.01", help: "The Puts' highest absolute delta." },
      {
        field: "volFarmerV4PutStrikeCap",
        label: "Puts struck at most",
        kind: "select",
        options: ["first_break_even_less_step", "none"],
        optionLabels: { first_break_even_less_step: "A Step below the first break-even", none: "Below the price" },
        help: "A Step below the first position's break-even (the Step rule below), or anywhere below the price inside the Puts' |delta| limit.",
      },
      {
        field: "volFarmerV4StepRule",
        label: "Step rule",
        kind: "select",
        options: ["implied_move_at_put_sale", "fixed"],
        optionLabels: { implied_move_at_put_sale: "Implied move", fixed: "Fixed" },
        help: "How far below B-E¹ the Puts are struck at most: the one-month implied move at each Put sale, IBKR's 30-day IV of the session before × √(21 ÷ 252) (an IV of 30% gives a Step of 8.7%; without that IV, no Put and no new LEAPS that day), or the fixed Step below.",
      },
      { field: "volFarmerV4StepBelowFirstBreakEvenPct", label: "Step", unit: "% below B-E¹", kind: "number", step: "0.5", help: "The Step with the Fixed rule." },
      { field: "volFarmerV4LeapsMinDte", label: "LEAPS expiry from", unit: "days", kind: "integer", step: "1", help: "The first listed expiry at least this far out." },
      { field: "volFarmerV4LeapsAbsDelta", label: "LEAPS |delta|", kind: "number", step: "0.01", help: "The Call whose absolute delta is nearest this." },
      {
        field: "volFarmerV4LeapsMaxAllocationPct",
        label: "LEAPS cap",
        unit: "% of pot",
        kind: "number",
        step: "1",
        help: (context) => {
          const example = (context.tickerAllocations ?? []).find((ticker) => ticker.potDollars !== null);
          const cap = example ? ` ${context.settings.volFarmerV4LeapsMaxAllocationPct}% of ${example.symbol}'s ${formatCurrency(example.potDollars!, 0)} pot is ${formatCurrency((example.potDollars! * context.settings.volFarmerV4LeapsMaxAllocationPct) / 100, 0)} today.` : "";
          return `The most a LEAPS purchase spends, as a share of the ticker's pot, paid from the cash free in Pluto's budget.${cap}`;
        },
      },
    ],
  },
  {
    key: "safetyLimits",
    title: "Safety Limits",
    summary: (settings) => `${settings.safetyMaxWorkingOrdersPerTicker} working orders · ${settings.safetyMaxOpenPositionsPerTicker} open positions · ${settings.safetyMaxOrdersPerTickerPerDay} orders a day per ticker · ${settings.safetyMaxOpenPositions} positions · ${settings.safetyMaxOrdersPerDay} orders a day across the book · SPY ${settings.safetySpyStressBreakerPct}% · ${settings.safetyTickerCooldownMinutes ? `${settings.safetyTickerCooldownMinutes} min cooldown` : "no cooldown"}`,
    parameters: [
      { field: "safetyMaxWorkingOrdersPerTicker", label: "Working orders per ticker", unit: "orders", kind: "integer", step: "1", help: "At most this many of a ticker's orders work at once; the rest go at the next looks." },
      { field: "safetyMaxOpenPositionsPerTicker", label: "Open positions per ticker", unit: "positions", kind: "integer", step: "1", help: "Pluto opens nothing new on a ticker holding this many." },
      { field: "safetyMaxOrdersPerTickerPerDay", label: "Orders per ticker per day", unit: "orders", kind: "integer", step: "1", help: "Every order Pluto sends on a ticker in a day counts, re-prices included." },
      { field: "safetyMaxOpenPositions", label: "Open positions, all tickers", unit: "positions", kind: "integer", step: "1", help: "Across every Pluto ticker: open positions plus working orders. Sales beyond it wait for a later look." },
      { field: "safetyMaxOrdersPerDay", label: "Orders per day, all tickers", unit: "orders", kind: "integer", step: "1", help: "Orders Pluto sends in a day across every ticker, counted as the per-ticker cap counts them. Sales beyond it wait." },
      { field: "safetySpyStressBreakerPct", label: "SPY stress breaker", unit: "% drop", kind: "number", step: "0.1", help: "While SPY is down this much today, Vol Farmer v4 opens nothing; a sale of LEAPS or shares still goes. The daily-loss breaker is under Session & Breakers." },
      { field: "safetyTickerCooldownMinutes", label: "Ticker cooldown", unit: "min", kind: "integer", step: "1", help: "Minutes after a filled Pluto order before Pluto acts on that ticker again. 0 = no cooldown." },
    ],
  },
  {
    key: "session",
    title: "Session & Breakers",
    summary: (settings) => `window ${settings.windowStartEt}–${settings.windowEndEt} ET · daily loss breaker ${settings.dailyLossBreakerPct}% · quotes up to ${settings.maxQuoteAgeMinutes} min old`,
    parameters: [
      { field: "windowStartEt", label: "Window start", unit: "ET", kind: "time", help: "Pluto acts from this Eastern time." },
      { field: "windowEndEt", label: "Window end", unit: "ET", kind: "time", help: "Pluto stops acting at this Eastern time, or 30 minutes before an early close if that comes first." },
      { field: "dailyLossBreakerPct", label: "Daily loss breaker", unit: "% of account", kind: "number", step: "0.1", help: "A day down this much versus last night trips a breaker: Pluto stops until a person resets it." },
      { field: "maxQuoteAgeMinutes", label: "Max quote age", unit: "min", kind: "integer", step: "1", help: "A band quote older than this is left out of Pluto's look." },
      { field: "maxFillSlippagePct", label: "Max fill slippage", unit: "%", kind: "number", step: "1", help: "A fill this far past the reference price (below the bid for a sell, above the ask for a buy), as a share of it, trips the fill_slippage breaker." },
    ],
  },
  {
    key: "triggers",
    title: "Quotes & Lines",
    summary: (settings) => `option quotes checked every ${settings.bandQuotePollSeconds} s · bursts of up to ${settings.burstLines} lines · up to ${settings.maxEnabledTickers} tickers`,
    parameters: [
      { field: "bandQuotePollSeconds", label: "Option quotes poll", unit: "s", kind: "integer", step: "1", help: "How often Pluto checks the market quote loop for option quotes received since its last round." },
      { field: "burstLines", label: "Burst lines", unit: "lines", kind: "integer", step: "1", help: "Most option contracts Pluto re-quotes live in one short burst before pricing an order. Their IBKR lines are booked only while the burst runs." },
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
  volFarmerV4CallMinAbsDelta: "Vol Farmer v4 Calls' |delta| lower limit",
  volFarmerV4CallMaxAbsDelta: "Vol Farmer v4 Calls' |delta| upper limit",
  volFarmerV4MaxSpreadPctOfMid: "Vol Farmer v4 max spread",
  volFarmerV4FirstPositionPct: "Vol Farmer v4 first position",
  volFarmerV4PutsStartCallYieldPct: "Vol Farmer v4 Puts start under",
  volFarmerV4PutMaxAbsDelta: "Vol Farmer v4 Put |delta|",
  volFarmerV4StepRule: "Vol Farmer v4 Step rule",
  volFarmerV4StepBelowFirstBreakEvenPct: "Vol Farmer v4 Step",
  volFarmerV4LeapsMinDte: "Vol Farmer v4 LEAPS expiry from",
  volFarmerV4LeapsAbsDelta: "Vol Farmer v4 LEAPS |delta|",
  volFarmerV4LeapsMaxAllocationPct: "Vol Farmer v4 LEAPS cap",
};

export const plutoParameterLabelByField: Record<string, string> = {
  // Saved from the Tickers tab's allocations, not the Settings tab.
  excessAllowancePct: "Excess allowance",
  // Renamed and retired fields, still named in older settings audit rows and events.
  maxAbsDayChangePct: "Max day move (old, % of price)",
  maxTickerExposurePct: "Max per ticker (old, % of account)",
  maxSectorExposurePct: "Max per sector (old, % of account)",
  daySignalsPollSeconds: "Option quotes poll",
  ladderMaxWorkingOrdersPerTicker: "Working orders per ticker",
  ladderMaxOpenPositionsPerTicker: "Open positions per ticker",
  ladderMaxOrdersPerTickerPerDay: "Orders per ticker per day",
  ladderMaxOpenPositions: "Open positions, all tickers",
  ladderMaxOrdersPerDay: "Orders per day, all tickers",
  ladderSpyStressBreakerPct: "SPY stress breaker",
  // The CC + Put Ladder's values, retired with it (2026-11-02).
  ladderSharesPct: "CC + Put Ladder · Share level (retired)",
  ladderRungs: "CC + Put Ladder · Rungs (retired)",
  ladderMinAbsDelta: "CC + Put Ladder · Calls' |delta| lower limit (retired)",
  ladderMaxAbsDelta: "CC + Put Ladder · Calls' |delta| upper limit (retired)",
  ladderMinDte: "CC + Put Ladder · Min DTE (retired)",
  ladderMaxDte: "CC + Put Ladder · Max DTE (retired)",
  ladderMaxSpreadPctOfMid: "CC + Put Ladder · Max spread (retired)",
  ladderShockMinPct: "CC + Put Ladder · Shock floor (retired)",
  ladderShockMaxPct: "CC + Put Ladder · Shock ceiling (retired)",
  ladderShockNoHistoryPct: "CC + Put Ladder · Shock for a new listing (retired)",
  ladderShockLookbackYears: "CC + Put Ladder · Shock lookback (retired)",
  ladderShockOverridePct: "CC + Put Ladder · Shock override (retired)",
  ladderTickerCooldownMinutes: "Ticker cooldown",
  // Vol Farmer v2's settings, Vol Farmer v4's since 2026-10-31 (the same values, carried over).
  volFarmerV2FirstPositionPct: "First position (v2)",
  volFarmerV2PutsStartCallYieldPct: "Puts start under (v2)",
  volFarmerV2PutMaxAbsDelta: "Put |delta| (v2)",
  volFarmerV2StepBelowFirstBreakEvenPct: "Step (v2)",
  volFarmerV2StepRule: "Step rule (v2)",
  volFarmerV2LeapsMinDte: "LEAPS expiry from (v2)",
  volFarmerV2LeapsAbsDelta: "LEAPS |delta| (v2)",
  volFarmerV2LeapsMaxAllocationPct: "LEAPS cap (v2)",
  volFarmerV2CallMinAbsDelta: "Calls' min |delta| (v2)",
  volFarmerV2CallMaxAbsDelta: "Calls' max |delta| (v2)",
  volFarmerV2MaxSpreadPctOfMid: "Max spread (v2)",
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
  unstructuredCloseMinPct: "No Strategy close min % (retired)",
  unstructuredCloseMinDollars: "No Strategy close min $ (retired)",
  buybackMinDte: "Buyback min DTE (retired)",
  ...Object.fromEntries(plutoParameterGroups.flatMap((group) => group.parameters.map((parameter) => [parameter.field, parameterAuditLabel[parameter.field] ?? parameter.label]))),
};

export type PlutoSettingsFormState = Record<PlutoSettingsField, string>;

/** Option labels of retired select fields, still named in older settings audit rows. */
const retiredOptionLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = { executionStrategy: { edge_margin: "Edge Margin", cc_put_ladder: "CC + Put Ladder" } };

/** A saved or typed value as the screen shows it: a select's option label, a 0's zero label ("No cap"), else the value. */
export function formatSettingDisplay(field: string, value: string): string {
  if (settingShownAsZeroLabel(field, value)) return plutoParameterSpecByField[field]!.zeroLabel!;
  return (plutoParameterSpecByField[field]?.optionLabels ?? retiredOptionLabels[field])?.[value] ?? value;
}

/** True when the field has a zero label and the value is a 0 ("0", "0.00"); an empty field is not one. */
export function settingShownAsZeroLabel(field: string, value: string): boolean {
  return plutoParameterSpecByField[field]?.zeroLabel !== undefined && value.trim() !== "" && Number(value) === 0;
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

/** "Min Edge $ 30 → 25" for the save bar and the confirm dialog; a time or a select shows no unit, a select its option
 *  labels, and a change to a zero label keeps the unit on the number ("Top-ups up to 100 % of the pot → No cap"). */
export function describeSettingsChange(change: { field?: string; label: string; unit: string | null; from: string; to: string }): string {
  const unit = change.unit && change.unit !== "ET" && change.unit !== "min" && change.unit !== "max" && !change.unit.startsWith("$") ? ` ${change.unit}` : "";
  const shown = (value: string) => (change.field ? formatSettingDisplay(change.field, value) : value);
  if (change.field !== undefined && settingShownAsZeroLabel(change.field, change.to)) return `${change.label} ${shown(change.from)}${unit} → ${shown(change.to)}`;
  return `${change.label} ${shown(change.from)} → ${shown(change.to)}${unit}`;
}

// The Settings tab's values as a trader reads them, printed in place of the inputs (access levels, 2026-10-17).

/** Units written straight after the number ("50% of account", "2.0σ", "3.0× normal"); every other unit follows a space. */
const unitsWithoutSpace = /^[%σ×]/;

/** One setting with its unit: "50% of account", "15 orders", "$1.00 / day", "09:45 ET"; a select shows its option label, a
 *  0 its zero label alone ("No cap"). */
export function formatSettingWithUnit(spec: PlutoParameterSpec, value: string | number): string {
  const shown = formatSettingDisplay(spec.field, formatSettingValue(spec, value));
  const unit = spec.unit;
  if (!unit || settingShownAsZeroLabel(spec.field, String(value))) return shown;
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
