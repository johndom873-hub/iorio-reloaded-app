import type { DaySignalsWatchStatus, PlutoAction, PlutoActionContract, PlutoActionKind, PlutoActionOutcome, PlutoEvent, PlutoEventCategory, PlutoPass, PlutoState, PlutoSystemCheck, PlutoWorkingOrder } from "../api/pluto";
import { plutoParameterLabelByField } from "./plutoParameters";
import { daysToExpiry, easternIsoDate, formatBrowserClockTime, formatCurrency, formatDayMonth, formatEasternTime, formatOptionContractLabel, formatOrderSize, formatRelativeAge, formatRelativeTime, formatDateTime, formatStrike, pluralize, todayInEasternIso } from "./formatters";

// Presentation rules for the Pluto screen (redesign approved 2026-10-06): one status at a time, plain-language
// wording for orders, decisions and the activity feed. Pure functions so the components stay declarative.

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** "trading_halt" → "Trading halt" */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------- Status (the control bar) ----------

export type PlutoStatusKind = "off" | "stopped" | "offline" | "paused" | "held" | "waiting" | "running";

export interface PlutoStatus {
  kind: PlutoStatusKind;
  label: string;
  headline: string;
  subline: string;
  /** Held: the problem Pluto is waiting on, shown under the control bar. */
  holdAlert: { title: string; text: string } | null;
}

/** Heartbeat rows are written every 45 s; three missed beats means the program is not responding. */
export const agentNotRespondingAfterSeconds = 150;

/** Time after the window opens before a missing IBKR connection counts as a problem (connect + one heartbeat). */
const agentConnectGraceMs = 2 * 60_000;

const checksThatHoldPluto: Record<string, string> = {
  trading_worker: "The trading worker is offline",
  account_data: "Account data is unavailable",
  reconciliation: "Positions haven't been reconciled recently",
  trading_halt: "Trading is halted platform-wide",
  session_close: "Today's session close is unknown",
  actions_cap: "Daily order limit reached",
  cost_ceiling: "Daily model spend ceiling reached",
  model_failures: "Repeated model failures",
};

function workingOrdersPhrase(state: PlutoState): string {
  const count = state.workingOrders.length;
  if (count === 0) return "No working orders";
  const first = state.workingOrders[0]!;
  return count === 1 ? `1 order still working (${first.symbol})` : `${count} orders still working (${state.workingOrders.map((order) => order.symbol).join(", ")})`;
}

function checksAreFromToday(state: PlutoState): boolean {
  return state.lastChecks !== null && easternIsoDate(state.lastChecks.startedAt) === todayInEasternIso();
}

export function derivePlutoStatus(state: PlutoState, now: Date, crashLoopRestarts: number | null): PlutoStatus {
  const when = (iso: string | null) => (iso ? formatRelativeTime(iso) ?? formatDateTime(iso) : "");
  if (state.mode === "off") {
    const working = state.workingOrders.length;
    if (working > 0) {
      const first = state.workingOrders[0]!;
      return { kind: "off", label: "Off", headline: `Pluto is off — ${working === 1 ? "1 order it placed is" : `${working} orders it placed are`} still working`, subline: `${describeWorkingOrderLine(first, state, now)}`, holdAlert: null };
    }
    const by = state.modeChangedBy ? ` by ${state.modeChangedBy}` : "";
    return { kind: "off", label: "Off", headline: "Pluto is off — it isn't analysing signals or placing orders", subline: state.modeChangedAt ? `Turned off${by} · ${formatDateTime(state.modeChangedAt)}` : "Switch it on to let it analyse and trade the allowed tickers", holdAlert: null };
  }
  if (Object.keys(state.breakers).length > 0) {
    return { kind: "stopped", label: "Stopped", headline: "A safety breaker tripped — Pluto is stopped until someone resets it", subline: workingOrdersPhrase(state), holdAlert: null };
  }
  const heartbeatAge = state.agent?.heartbeatAgeSeconds ?? null;
  if (heartbeatAge === null || heartbeatAge > agentNotRespondingAfterSeconds) {
    const working = state.workingOrders.length;
    return {
      kind: "offline",
      label: "Not responding",
      headline: "Pluto's program isn't responding — nothing is being analysed",
      subline: `${heartbeatAge === null ? "No sign of life yet" : `Last sign of life ${formatRelativeAge(new Date(now.getTime() - heartbeatAge * 1000), now)} (normally every 45 s)`}${working > 0 ? ` · ${working === 1 ? "1 order" : `${working} orders`} still working at IBKR` : ""}`,
      holdAlert: null,
    };
  }
  if (state.paused) {
    if (state.pauseReason === "deploy") return { kind: "paused", label: "Paused", headline: "Paused after an update — the new version hasn't traded yet", subline: `Updated ${when(state.pausedAt)} · resume once you're happy with it`, holdAlert: null };
    if (state.pauseReason === "readiness") return { kind: "paused", label: "Paused", headline: "Paused — the pre-open check still failed at 9:20 ET", subline: readinessFailureLine(state) ?? "Fix what failed, then resume", holdAlert: null };
    if (state.pauseReason === "crash_loop") return { kind: "paused", label: "Paused", headline: `Paused — Pluto restarted ${crashLoopRestarts === null ? "too often" : `${crashLoopRestarts} times`} in the last hour`, subline: "Check what went wrong before resuming", holdAlert: null };
    const by = state.pausedByDisplayName ? ` by ${state.pausedByDisplayName}` : "";
    const working = state.workingOrders.length;
    return { kind: "paused", label: "Paused", headline: `Paused${by} ${when(state.pausedAt)}`.trim(), subline: working > 0 ? `${workingOrdersPhrase(state)} — a plain pause leaves working orders alone` : "Resume when you're ready; working orders were left alone", holdAlert: null };
  }
  // Outside the window Pluto holds no IBKR lines and runs no checks by design, so it is waiting, never held.
  const session = state.session;
  const windowStart = new Date(session.windowStartAt).getTime();
  const windowEnd = new Date(session.windowEndAt).getTime();
  if (!session.isOpen) return { kind: "waiting", label: "Waiting", headline: "Market closed today — nothing to analyse", subline: `Window ${session.windowStartEt}–${session.windowEndEt} ET on trading days`, holdAlert: null };
  if (now.getTime() < windowStart) return { kind: "waiting", label: "Waiting", headline: `Outside the trading window — starts analysing at ${session.windowStartEt} ET`, subline: readinessSummaryLine(state) ?? `Window ${session.windowStartEt}–${session.windowEndEt} ET · market closes ${session.closeTimeEt}`, holdAlert: null };
  if (now.getTime() >= windowEnd) return { kind: "waiting", label: "Waiting", headline: `Trading window closed at ${session.windowEndEt} ET — done for today`, subline: `Starts again tomorrow at ${session.windowStartEt} ET`, holdAlert: null };
  // Inside the window: the agent connects as the window opens and reports it with its next heartbeat (every 45 s), so a
  // connection still missing two minutes in is a real problem.
  if (state.agent && !state.agent.connected && now.getTime() - windowStart > agentConnectGraceMs) {
    return { kind: "held", label: "Held", headline: "On, but can't place orders right now", subline: "Starts again by itself once the problem below clears", holdAlert: { title: "Pluto's IBKR connection is down", text: "Quotes and orders can't flow until it reconnects." } };
  }
  if (checksAreFromToday(state)) {
    const failing = Object.entries(state.lastChecks!.checks).find(([name, check]) => !check.ok && name in checksThatHoldPluto);
    if (failing) {
      const [name, check] = failing;
      return { kind: "held", label: "Held", headline: "On, but can't place orders right now", subline: "Starts again by itself once the problem below clears", holdAlert: { title: checksThatHoldPluto[name]!, text: check.detail } };
    }
  }
  const tickers = state.enabledTickers.count;
  return {
    kind: "running",
    label: "Running",
    headline: "Actively evaluating trading signals",
    subline: `Analyses every Day Signals update on the ${tickers} allowed ${tickers === 1 ? "ticker" : "tickers"} · last analysis ${state.lastPassAt ? formatRelativeAge(state.lastPassAt, now) : "not yet today"}`,
    holdAlert: null,
  };
}

/** "Pre-open check 06:00 ET: IBKR ✓ · API sign-in ✓ · OpenRouter ✓ · Pluto running ✓", for today's run only; null before the first one. */
export function readinessSummaryLine(state: PlutoState): string | null {
  const readiness = state.readiness;
  if (!readiness || readiness.dateIso !== todayInEasternIso()) return null;
  const marks = readiness.results.map((result) => `${result.name} ${result.ok ? "✓" : "✗"}`).join(" · ");
  const failing = readiness.signature !== "";
  // Only a failing probe leads to a pause at 9:20 ET, and only while Pluto is running: "Pluto running" failing means it is
  // already off or paused, so the API does not pause it again.
  const plutoRunning = readiness.results.every((result) => result.ok || result.name !== "Pluto running");
  const probeFailing = readiness.results.some((result) => !result.ok && result.name !== "Pluto running");
  return `Pre-open check ${formatEasternTime(readiness.lastRunAt)}: ${marks}${failing && !readiness.finalDone ? ` · re-checking every 10 min${probeFailing && plutoRunning ? ", pauses at 9:20 ET if still failing" : ""}` : ""}`;
}

/** The failing tests of today's readiness run, with their errors. */
function readinessFailureLine(state: PlutoState): string | null {
  const failing = state.readiness?.results.filter((result) => !result.ok) ?? [];
  return failing.length > 0 ? failing.map((result) => `${result.name}: ${result.detail}`).join(" · ") : null;
}

/** SPY's day change and whether it is currently blocking new positions, from the newest analysis's checks. */
export function spyStressFromState(state: PlutoState): { blocking: boolean; spyDayChangePct: number | null; detail: string } | null {
  if (!checksAreFromToday(state)) return null;
  const check = state.lastChecks!.checks.market_stress;
  if (!check) return null;
  const match = check.detail.match(/SPY ([-+]?\d+(?:\.\d+)?)%/);
  return { blocking: !check.ok, spyDayChangePct: match ? Number(match[1]) : null, detail: check.detail };
}

/** "8 min" / "45 s" / "2 h" — how long ago, the way the boards write it. */
export function formatAgeInWords(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** Gate and check details come from the agent in lower case; the screen starts them with a capital. */
export function sentenceCase(detail: string): string {
  return detail.charAt(0).toUpperCase() + detail.slice(1);
}

/** The pre-model checks in the order the agent runs them (Postgres stores the JSON keys in its own order). */
export const systemCheckOrder = ["pluto_state", "trading_halt", "market_session", "session_close", "trading_window", "trading_worker", "account_data", "daily_loss", "cost_ceiling", "actions_cap", "reconciliation", "model_failures", "market_stress"];

export function orderedChecks(checks: Record<string, PlutoSystemCheck> | null): [string, PlutoSystemCheck][] {
  const rank = (name: string) => { const index = systemCheckOrder.indexOf(name); return index === -1 ? systemCheckOrder.length : index; };
  return Object.entries(checks ?? {}).sort((a, b) => rank(a[0]) - rank(b[0]));
}

// ---------- Orders ----------

export type PlutoStrategyBadge = { className: "cc" | "csp" | "ns"; label: "CC" | "CSP" | "N/S" };

export function strategyBadgeFor(kind: PlutoActionKind, contract: PlutoActionContract | null): PlutoStrategyBadge {
  const strategy = contract?.strategyKey ?? (kind === "open_covered_call" ? "covered_call" : kind === "open_cash_secured_put" ? "cash_secured_put" : null);
  if (kind === "close_shares") return { className: "ns", label: "N/S" };
  if (strategy === "covered_call") return { className: "cc", label: "CC" };
  if (strategy === "cash_secured_put") return { className: "csp", label: "CSP" };
  return { className: "ns", label: "N/S" };
}

function contractRight(contract: PlutoActionContract | null): "C" | "P" {
  if (contract?.right) return contract.right;
  return contract?.strategyKey === "covered_call" ? "C" : "P";
}

/** One leg of an action's contract, "$46 Call · 9 Oct (2DTE)": the held leg of a roll or the leg it trades; no DTE when asOfIso is null. */
function actionLegLabel(contract: PlutoActionContract | null, leg: "held" | "traded", asOfIso: string | null): string {
  const strike = leg === "held" ? contract?.fromStrike : contract?.strike;
  const expiry = leg === "held" ? contract?.fromExpiry : contract?.expiry;
  const right = contractRight(contract);
  if (strike === undefined || !expiry) return `${strike === undefined ? "?" : formatStrike(strike)} ${right === "C" ? "Call" : "Put"}`;
  return formatOptionContractLabel({ strike, right, expiry, dte: asOfIso === null ? null : daysToExpiry(expiry, asOfIso) });
}

type DescribableOrder = { kind: PlutoActionKind; contract: PlutoActionContract | null; quantity: number | null; createdAt: string };

/**
 * What an action trades, without its verb or size, DTE as of the day it was made: "$46 Call · 9 Oct (2DTE)",
 * "$105 Put · 10 Oct → $100 Put · 17 Oct (9DTE)", "$46 Call · 9 Oct (2DTE) + sell 100 shares", "100 shares".
 */
function describeActionContracts(action: DescribableOrder): string {
  const asOfIso = easternIsoDate(action.createdAt);
  if (action.kind === "close_shares") return `${action.quantity ?? "?"} shares`;
  if (action.kind === "roll") return `${actionLegLabel(action.contract, "held", null)} → ${actionLegLabel(action.contract, "traded", asOfIso)}`;
  // A close_position's quantity is its shares.
  if (action.kind === "close_position") return `${actionLegLabel(action.contract, "traded", asOfIso)} + sell ${action.quantity ?? "?"} shares`;
  return actionLegLabel(action.contract, "traded", asOfIso);
}

const actionVerbs: Record<PlutoActionKind, string> = {
  open_covered_call: "Sell",
  open_cash_secured_put: "Sell",
  close_leg: "Buy back",
  close_position: "Close",
  close_shares: "Sell",
  roll: "Roll",
  no_trade: "",
};

/** The contract cell, under its own Ticker column: a title and a sub-line ("Sell $46 Call · 9 Oct (2DTE)" / "11 contracts with 1100 shares"). */
export function describeOrderContract(action: DescribableOrder): { title: string; sub: string | null } {
  if (action.kind === "no_trade") return { title: "No order", sub: null };
  if (action.kind === "close_shares") return { title: `Sell ${describeActionContracts(action)}`, sub: "Close unstructured shares" };
  if (!action.contract?.expiry) return { title: action.kind === "close_leg" ? "Buy back" : action.kind === "close_position" ? "Close covered Call" : "—", sub: null };
  const title = `${actionVerbs[action.kind]} ${describeActionContracts(action)}`;
  const contracts = action.quantity === null ? null : pluralize(action.kind === "close_position" ? Math.round(action.quantity / 100) : action.quantity, "contract");
  if (action.kind === "close_leg") return { title, sub: contracts };
  if (action.kind === "close_position") return { title, sub: "Buy back the Call and sell the shares together" };
  if (action.kind === "roll") return { title, sub: contracts ? `${contracts} · net credit` : "net credit" };
  if (action.quantity === null) return { title, sub: null };
  return { title, sub: action.kind === "open_covered_call" ? `${contracts} with ${action.quantity * 100} shares` : contracts };
}

/** The platform's order line: "SMCI Sell $46 Call · 9 Oct (2DTE) · 11× @ 0.39"; "SMCI Sell 100 shares @ 45.10"; no price when null. */
export function describeOrderLine(order: DescribableOrder & { symbol: string }, price: number | null): string {
  const head = `${order.symbol} ${actionVerbs[order.kind]} ${describeActionContracts(order)}`;
  if (order.kind === "close_shares") return `${head}${price === null ? "" : ` @ ${price.toFixed(2)}`}`;
  if (order.kind === "close_position") return `${head}${order.quantity === null ? "" : ` · ${Math.round(order.quantity / 100)}×`}`;
  return `${head}${order.quantity === null ? "" : formatOrderSize(order.quantity, price)}`;
}

/** When the platform's unfilled-order sweep will cancel a working order: creation plus the sweep's minutes, or the session's cancel-by if sooner. */
export function workingOrderCancelAt(order: { createdAt: string }, state: Pick<PlutoState, "unfilledCancelMinutes" | "session">): Date | null {
  const sweepAt = state.unfilledCancelMinutes > 0 ? new Date(order.createdAt).getTime() + state.unfilledCancelMinutes * 60_000 : null;
  const sessionCancelAt = new Date(state.session.closeAt).getTime() - 5 * 60_000;
  const at = sweepAt === null ? sessionCancelAt : Math.min(sweepAt, sessionCancelAt);
  return Number.isFinite(at) ? new Date(at) : null;
}

export function describeWorkingOrderLine(order: PlutoWorkingOrder, state: Pick<PlutoState, "unfilledCancelMinutes" | "session">, now: Date): string {
  const cancelAt = workingOrderCancelAt(order, state);
  const age = formatAgeInWords(order.createdAt, now);
  return `${describeOrderLine(order, order.limitPrice)} · ${age}${cancelAt ? ` · cancels at ${formatEasternTime(cancelAt.toISOString()).replace(" ET", "")} if unfilled` : ""}`;
}

export type PlutoBadgeTone = "ok" | "bad" | "warn" | "info" | "neutral";

export interface PlutoOutcomePresentation {
  tone: PlutoBadgeTone;
  label: string;
  /** Second line under the badge (why it was blocked, how a partial fill ended…). */
  sub: string | null;
  /** The badge links to the order in the Trade Blotter. */
  linksToOrder: boolean;
}

/** Model cost as the screen shows it: four decimals with trailing zeros dropped ("$0.0003", "$0.09"). */
export function formatModelCost(costUsd: number | null | undefined): string {
  return formatCurrency(costUsd ?? 0, 4).replace(/0+$/, "").replace(/\.$/, ".00").replace(/\.(\d)$/, ".$10");
}

export function describeOutcome(action: PlutoAction, now: Date, state: Pick<PlutoState, "unfilledCancelMinutes" | "session"> | null): PlutoOutcomePresentation {
  const outcome: PlutoActionOutcome = action.outcome;
  switch (outcome) {
    case "confirmed":
    case "order_built": {
      const cancelAt = state ? workingOrderCancelAt(action, state) : null;
      return { tone: "info", label: `Working · ${formatAgeInWords(action.createdAt, now)}`, sub: cancelAt ? `Cancels at ${formatBrowserClockTime(cancelAt)} if unfilled` : null, linksToOrder: true };
    }
    case "filled":
      return { tone: "ok", label: "Filled", sub: null, linksToOrder: true };
    case "partially_filled":
      return { tone: "ok", label: "Partly filled", sub: `${filledOfOrdered(action)}still working for the rest`, linksToOrder: true };
    case "cancelled_partially_filled":
      return { tone: "ok", label: "Partly filled", sub: `${filledOfOrdered(action)}rest cancelled`, linksToOrder: true };
    case "cancelled":
      return { tone: "neutral", label: "Cancelled", sub: action.blockReason ?? "Unfilled", linksToOrder: true };
    case "rejected":
      return { tone: "bad", label: "Rejected", sub: action.blockReason ?? "IBKR refused the order", linksToOrder: true };
    case "error":
      return { tone: "bad", label: "Error", sub: action.blockReason, linksToOrder: Boolean(action.orderRequestId) };
    case "blocked":
      return { tone: "warn", label: "Blocked", sub: describeBlockReason(action), linksToOrder: false };
    case "validated":
      return { tone: "info", label: "Sending", sub: null, linksToOrder: false };
    default:
      return { tone: "neutral", label: "No order", sub: null, linksToOrder: false };
  }
}

/** "2 of 3 filled, " when the fills are known, for a partly filled order's note. */
function filledOfOrdered(action: PlutoAction): string {
  return action.filledQuantity !== null && action.quantity !== null ? `${action.filledQuantity} of ${action.quantity} filled, ` : "";
}

/** The failed gates' details in plain words ("Edge moved 1.4 vp after the model decided (limit 1.0)"). */
export function describeBlockReason(action: PlutoAction): string | null {
  const failed = action.gateResults.filter((gate) => !gate.ok);
  if (failed.length > 0) return sentenceCase(failed.map((gate) => gate.detail).join(" · "));
  return action.blockReason ? sentenceCase(action.blockReason) : null;
}

export function gatesPassedLabel(action: PlutoAction): { label: string; allPassed: boolean } {
  if (action.gateResults.length === 0) return { label: action.kind === "close_shares" && action.outcome !== "blocked" ? "auto" : "—", allPassed: true };
  const passed = action.gateResults.filter((gate) => gate.ok).length;
  return { label: `${passed}/${action.gateResults.length}`, allPassed: passed === action.gateResults.length };
}

export function formatExposure(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const rounded = Math.round(amount);
  return rounded < 0 ? `−${formatCurrency(-rounded, 0)}` : formatCurrency(rounded, 0);
}

/** Today's orders (Eastern), the Live tab's table; no-trade rows are decisions, not orders. */
export function isTodaysOrder(action: PlutoAction): boolean {
  return action.kind !== "no_trade" && easternIsoDate(action.createdAt) === todayInEasternIso();
}

/** The orders table's columns (Live: today's; History: every order), keyed for the column gear. */
export type PlutoOrdersVariant = "today" | "history";

export interface PlutoOrderColumn {
  key: string;
  header: string;
  /** Full text for an abbreviated header, shown on hover. */
  title?: string;
  align?: "right";
}

export const plutoOrderColumns: Record<PlutoOrdersVariant, PlutoOrderColumn[]> = {
  today: [
    { key: "time", header: "Time" },
    { key: "ticker", header: "Ticker" },
    { key: "strategy", header: "Strategy" },
    { key: "contract", header: "Contract" },
    { key: "qty", header: "Qty", align: "right" },
    { key: "limit", header: "Limit", align: "right" },
    { key: "fill", header: "Fill", align: "right" },
    { key: "exp", header: "EXP $", title: "Exposure the order adds, as Positions counts it", align: "right" },
    { key: "status", header: "Status" },
    { key: "gates", header: "Gates", align: "right" },
  ],
  history: [
    { key: "time", header: "When" },
    { key: "ticker", header: "Ticker" },
    { key: "strategy", header: "Strategy" },
    { key: "contract", header: "Contract" },
    { key: "qty", header: "Qty", align: "right" },
    { key: "limit", header: "Limit", align: "right" },
    { key: "fill", header: "Fill", align: "right" },
    { key: "exp", header: "EXP $", title: "Exposure the order added (filled quantity), or would add while working, as Positions counts it", align: "right" },
    { key: "status", header: "Outcome" },
    { key: "realized", header: "Realized", align: "right" },
    { key: "gates", header: "Gates", align: "right" },
  ],
};

// ---------- Decisions ----------

type ParsedCandidateId =
  | { kind: "open"; symbol: string; right: "C" | "P"; strike: number; expiry: string }
  | { kind: "roll"; symbol: string; strike: number; expiry: string }
  | { kind: "close_leg" | "close_shares" | "close_position"; symbol: string }
  | null;

// SYM:strategy:expiry:strike | SYM:roll:legId:expiry:strike | SYM:close_leg:legId | SYM:close_shares:positionId | SYM:close_position:positionId
function parseCandidateId(candidateId: string): ParsedCandidateId {
  const parts = candidateId.split(":");
  const symbol = parts[0]!;
  if (parts.length === 4 && (parts[1] === "covered_call" || parts[1] === "cash_secured_put")) return { kind: "open", symbol, right: parts[1] === "covered_call" ? "C" : "P", strike: Number(parts[3]), expiry: parts[2]! };
  if (parts.length === 5 && parts[1] === "roll") return { kind: "roll", symbol, strike: Number(parts[4]), expiry: parts[3]! };
  if (parts[1] === "close_leg" || parts[1] === "close_shares" || parts[1] === "close_position") return { kind: parts[1], symbol };
  return null;
}

/**
 * A candidate as the model was offered it, DTE counted from the day of `asOf`: "SMCI $47 Call · 9 Oct (2DTE)". A roll's id
 * names only the new contract and not its right ("MU Roll → $100 · 17 Oct (9DTE)"); closes name only the kind.
 */
export function describeCandidateId(candidateId: string | null | undefined, asOf: string | Date): string {
  if (!candidateId) return "—";
  const parsed = parseCandidateId(candidateId);
  if (!parsed) return candidateId;
  const dteOf = (expiry: string) => daysToExpiry(expiry, easternIsoDate(asOf));
  if (parsed.kind === "open") return formatOptionContractLabel({ symbol: parsed.symbol, strike: parsed.strike, right: parsed.right, expiry: parsed.expiry, dte: dteOf(parsed.expiry) });
  if (parsed.kind === "roll") return `${parsed.symbol} Roll → ${formatStrike(parsed.strike)} · ${formatDayMonth(parsed.expiry)} (${dteOf(parsed.expiry)}DTE)`;
  if (parsed.kind === "close_leg") return `${parsed.symbol} Buy back`;
  if (parsed.kind === "close_shares") return `${parsed.symbol} Sell shares`;
  return `${parsed.symbol} Close covered Call`;
}

/** The model's verdict for a pass: the first schema-valid call's output (Pluto makes one call per decision). */
export function passVerdict(pass: PlutoPass) {
  const call = pass.decisions.find((decision) => decision.parsedOutput !== null) ?? pass.decisions[0] ?? null;
  const output = call?.parsedOutput ?? null;
  const action = pass.actions.find((entry) => entry.kind !== "no_trade") ?? null;
  const topPick = pass.actions.find((entry) => entry.deterministicTopPick)?.deterministicTopPick ?? null;
  const failed = call !== null && call.parsedOutput === null;
  return { call, output, action, topPick, failed, error: call?.error ?? (failed ? "The model's answer could not be read" : null) };
}

export type PlutoVerdictKind = "order" | "no_order" | "failed";

export function verdictKind(pass: PlutoPass): PlutoVerdictKind {
  const { output, failed } = passVerdict(pass);
  if (failed || !output) return "failed";
  return output.decision === "trade" ? "order" : "no_order";
}

/** The model answers an abstention as "abstain_system_concern"; "abstain" is accepted too. */
export function isAbstainVerdict(verdict: string | null | undefined): boolean {
  return verdict === "abstain" || verdict === "abstain_system_concern";
}

/** What the model chose, as an order line with the sized quantity once the gates set one: "SMCI Sell $46 Call · 9 Oct (2DTE) · 11×". */
export function describeChosenAction(pass: PlutoPass): string {
  const { output, action } = passVerdict(pass);
  if (!output || output.decision !== "trade") return isAbstainVerdict(output?.decision) ? "Abstained — the data looked unreliable" : "Nothing worth trading";
  if (action) return describeOrderLine(action, null);
  // No action row (the chosen candidate was not among the offers): the candidate id is all there is.
  const parsed = output.candidate_id ? parseCandidateId(output.candidate_id) : null;
  const label = describeCandidateId(output.candidate_id, pass.startedAt);
  return parsed?.kind === "open" ? label.replace(`${parsed.symbol} `, `${parsed.symbol} Sell `) : label;
}

/** How the model's pick compares with the deterministic Edge $ top pick. */
export function describeTopPickComparison(pass: PlutoPass): { tone: "ok" | "warn" | "muted"; text: string } {
  const { output, topPick, action } = passVerdict(pass);
  if (!output || output.decision !== "trade") return { tone: "muted", text: topPick ? `Top was ${describeCandidateId(topPick.id, pass.startedAt)}, $${Math.round(topPick.edgeDollars)}` : "No top pick" };
  if (action && (action.kind === "roll" || action.kind === "close_leg" || action.kind === "close_shares")) return { tone: "muted", text: `No open top pick (${action.kind === "roll" ? "roll" : "close"})` };
  if (!topPick) return { tone: "muted", text: "No top pick" };
  if (topPick.id === output.candidate_id) return { tone: "ok", text: "Same pick" };
  return { tone: "warn", text: `Differs · top was ${describeCandidateId(topPick.id, pass.startedAt).replace(/^[A-Z.]+ /, "")}` };
}

/** Why the analysis ran, as a short cell ("HOOD Day Signals update") or a clause ("after a Day Signals update on HOOD"). */
export function describeTrigger(pass: Pick<PlutoPass, "trigger" | "triggerDetail">, form: "short" | "clause"): string {
  const detail = pass.triggerDetail ?? {};
  const symbols = Array.isArray(detail.symbols) ? (detail.symbols as string[]) : [];
  const list = symbols.join(", ");
  switch (pass.trigger) {
    case "day_signals_update":
      return form === "short" ? `Day Signals${list ? ` · ${list}` : " update"}` : `after a Day Signals update${list ? ` on ${list}` : ""}`;
    case "grade_crossing":
      return form === "short" ? `${list || "A"} grade changed` : `after a ${list || "contract"} grade changed`;
    case "held_leg":
      return form === "short" ? `Held ${list} leg changed` : `because the held ${list} leg's numbers changed`;
    case "settings_changed":
      return form === "short" ? "Settings changed" : "after the settings changed";
    case "order_ended":
      return form === "short" ? `${list} order ended` : `after its ${list} order ended`;
    case "cooldown_ended":
      return form === "short" ? `${list} cooldown ended` : `after the ${list} cooldown ended`;
    case "position_closed":
      return form === "short" ? "Position closed" : "after a position closed";
    case "opening_analysis":
      if (detail.dataIncomplete === true) return form === "short" ? "Opening analysis · data incomplete" : "at the opening analysis, before today's data was complete";
      if (detail.afterLateSeed === true) return form === "short" ? "Opening analysis · data now complete" : "once today's data was complete, after an early opening analysis";
      return form === "short" ? "Opening analysis" : "at the opening analysis";
    case "manual":
      return form === "short" ? "Started by hand" : "when started by hand";
    default:
      return form === "short" ? humanizeKey(pass.trigger) : `after ${humanizeKey(pass.trigger).toLowerCase()}`;
  }
}

const checkLabels: Record<string, string> = {
  pluto_state: "Pluto on, not paused",
  trading_window: "Inside the trading window",
  market_session: "Market session open",
  session_close: "Session close known",
  trading_worker: "Trading worker online",
  account_data: "Account data fresh",
  trading_halt: "No trading halt",
  daily_loss: "Daily loss within limit",
  actions_cap: "Orders under the daily limit",
  cost_ceiling: "Model spend under the ceiling",
  model_failures: "No recent model failures",
  reconciliation: "Positions reconciled recently",
  market_stress: "SPY not under stress",
};

export function checkLabel(name: string): string {
  return checkLabels[name] ?? humanizeKey(name);
}

export function checksSummary(checks: Record<string, PlutoSystemCheck> | null): { passed: number; total: number } {
  const entries = Object.values(checks ?? {});
  return { passed: entries.filter((check) => check.ok).length, total: entries.length };
}

const gateLabels: Record<string, string> = {
  verdict: "Verdict",
  trade: "Verdict",
  confidence_floor: "Confidence",
  candidate_present: "Candidate offered",
  candidate_fresh: "Still qualifies",
  offer_fresh: "Still offered",
  edge_drift: "Edge drift",
  working_order: "Working order",
  ticker_cooldown: "Ticker cooldown",
  open_positions_cap: "Open positions",
  sizing: "Sizing",
  limit_price: "Limit price",
  same_contract: "Same contract",
  automatic_close: "Automatic close",
};

export function gateLabel(name: string): string {
  return gateLabels[name] ?? humanizeKey(name);
}

export function checksAndGatesSummary(pass: PlutoPass): { checks: { passed: number; total: number }; gates: { passed: number; total: number } } {
  const { action } = passVerdict(pass);
  const gates = action?.gateResults ?? [];
  return { checks: checksSummary(pass.systemChecks), gates: { passed: gates.filter((gate) => gate.ok).length, total: gates.length } };
}

// ---------- Activity feed and event log ----------

export type PlutoFeedDot = "order" | "fill" | "warn" | "bad" | "model" | "ctl" | "look";

export interface PlutoFeedEntry {
  dot: PlutoFeedDot;
  /** The bold lead ("Order sent"). */
  title: string;
  /** The rest of the first line, after the separator. */
  detail: string | null;
  sub: string | null;
}

/** Heroku release "v212" stays as is; a bare git SHA is shortened to 7 characters. */
function shortRelease(value: unknown): string {
  const release = text(value);
  return /^[0-9a-f]{40}$/.test(release) ? release.slice(0, 7) : release;
}

function modelVerdictTitle(payload: Record<string, unknown>): string {
  const verdict = text(payload.verdict);
  if (verdict !== "trade") return isAbstainVerdict(verdict) ? "Model: abstained" : "Model: no order";
  switch (text(payload.actionKind)) {
    case "roll":
      return "Model: roll";
    case "close_leg":
      return "Model: buy back";
    case "close_shares":
      return "Model: close shares";
    case "close_position":
      return "Model: close covered Call";
    default:
      return "Model: place order";
  }
}

/** The actions the feed can name in plain words; without them the API's own order descriptions are reworded by pattern. */
export interface PlutoFeedContext {
  actionsById: Map<string, PlutoAction>;
  actionsByPassId: Map<string, PlutoAction>;
}

export function buildFeedContext(actions: PlutoAction[]): PlutoFeedContext {
  const actionsById = new Map<string, PlutoAction>();
  const actionsByPassId = new Map<string, PlutoAction>();
  for (const action of actions) {
    actionsById.set(action.id, action);
    if (action.kind !== "no_trade") actionsByPassId.set(action.passId, action);
  }
  return { actionsById, actionsByPassId };
}

/**
 * An order description the API stored, as the platform's order line ("SMCI Sell $46 Call · 9 Oct (2DTE) · 11× @ 0.39"),
 * DTE counted from `asOf`. Current descriptions already are one and only lose their trailing notes ("(sold at …)",
 * "before the … earnings", "; …"); older ones ("HOOD 2× $24P 2026-10-17 @ 0.62", "Buy back 2× COIN $300P …") are reworded.
 */
export function humanizeOrderDescription(description: string, asOf: string | Date): string {
  const asOfIso = easternIsoDate(asOf);
  const label = (strike: string, right: string, expiry: string) => formatOptionContractLabel({ strike: Number(strike), right: right === "C" ? "C" : "P", expiry, dte: daysToExpiry(expiry, asOfIso) });
  const current = description.match(/^(\S+ (?:Sell|Buy back|Roll|Close) .+?)(?: \(sold at | \(unstructured\)| before the |;|$)/);
  if (current) return current[1]!;
  const open = description.match(/^(\S+) (\d+)× \$(\S+?)([CP]) (\d{4}-\d{2}-\d{2}) @ ([\d.]+)$/);
  if (open) return `${open[1]} Sell ${label(open[3]!, open[4]!, open[5]!)} · ${open[2]}× @ ${open[6]}`;
  const roll = description.match(/^(\S+) roll (\d+)× \$(\S+) → \$(\S+) (\d{4}-\d{2}-\d{2}) @ ([\d.]+)$/);
  if (roll) return `${roll[1]} Roll ${formatStrike(Number(roll[3]))} → ${formatStrike(Number(roll[4]))} · ${formatDayMonth(roll[5]!)} (${daysToExpiry(roll[5]!, asOfIso)}DTE) · ${roll[2]}× @ ${roll[6]}`;
  const buyback = description.match(/^Buy back (\d+)× (\S+) \$(\S+?)([CP]) (\d{4}-\d{2}-\d{2}) at ~([\d.]+)/);
  if (buyback) return `${buyback[2]} Buy back ${label(buyback[3]!, buyback[4]!, buyback[5]!)} · ${buyback[1]}× @ ${buyback[6]}`;
  const coveredCallClose = description.match(/^Close (\d+)× (\S+) covered call before the \S+ earnings: buy back \$(\S+?)C (\d{4}-\d{2}-\d{2}) at ~[\d.]+, sell (\d+) shares/);
  if (coveredCallClose) return `${coveredCallClose[2]} Close ${label(coveredCallClose[3]!, "C", coveredCallClose[4]!)} + sell ${coveredCallClose[5]} shares · ${coveredCallClose[1]}×`;
  const shares = description.match(/^Sell (\d+) (\S+) shares .*?at ~([\d.]+)/);
  if (shares) return `${shares[2]} Sell ${shares[1]} shares @ ${shares[3]}`;
  // An order adopted after a restart, before adopted orders were worded like the rest: "SMCI 11× open_covered_call $46 2026-10-09".
  const adopted = description.match(/^(\S+) (\d+)× (open_covered_call|open_cash_secured_put|close_leg|close_position|close_shares|roll)(?: \$(\S+))?(?: (\d{4}-\d{2}-\d{2}))?$/);
  if (adopted) {
    const [, symbol, quantity, kind, strike, expiry] = adopted;
    if (kind === "close_shares") return `${symbol} Sell ${quantity} shares`;
    const contract = strike && expiry && kind!.startsWith("open_") ? label(strike, kind === "open_covered_call" ? "C" : "P", expiry) : `${strike ? formatStrike(Number(strike)) : ""}${expiry ? ` · ${formatDayMonth(expiry)}` : ""}`.trim();
    return `${symbol} ${actionVerbs[kind as PlutoActionKind]} ${contract} · ${quantity}×`.replace(/\s+/g, " ");
  }
  return description;
}

function orderLine(payload: Record<string, unknown>, context: PlutoFeedContext | undefined, price: number | null, occurredAt: string): string {
  const action = context?.actionsById.get(text(payload.actionId));
  if (action) return describeOrderLine(action, price);
  const description = text(payload.description);
  return description ? humanizeOrderDescription(description, occurredAt) : text(payload.symbol);
}

/** The tickers an event lists: plain symbols, or objects carrying a `symbol` (a skipped pass's per-ticker summary). */
function eventSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : item && typeof item === "object" ? text((item as Record<string, unknown>).symbol) : "")).filter(Boolean);
}

export function describeFeedEvent(event: PlutoEvent, context?: PlutoFeedContext): PlutoFeedEntry {
  const payload = event.payload ?? {};
  const symbol = text(payload.symbol);
  const by = text(payload.by);
  const at = event.occurredAt;
  // A candidate the event names: the action's own wording when the feed has it, else read from the candidate id.
  const eventAction = context?.actionsById.get(text(payload.actionId));
  switch (event.type) {
    case "order_confirmed":
      return { dot: "order", title: "Order sent", detail: orderLine(payload, context, eventAction?.limitPrice ?? null, at), sub: null };
    case "order_built":
      return { dot: "order", title: "Order built", detail: orderLine(payload, context, eventAction?.limitPrice ?? null, at), sub: null };
    case "order_outcome": {
      const outcome = text(payload.outcome);
      const price = payload.fillPrice ? Number(payload.fillPrice) : null;
      const what = orderLine(payload, context, price, at);
      if (outcome === "filled") return { dot: "fill", title: "Filled", detail: what, sub: null };
      if (outcome === "partially_filled" || outcome === "cancelled_partially_filled") return { dot: "fill", title: "Partly filled", detail: what, sub: outcome === "cancelled_partially_filled" ? "Rest cancelled" : null };
      if (outcome === "cancelled") return { dot: "look", title: "Cancelled", detail: orderLine(payload, context, null, at), sub: text(payload.reason) || null };
      return { dot: "bad", title: outcome === "rejected" ? "Rejected" : "Order error", detail: orderLine(payload, context, null, at), sub: text(payload.error) || text(payload.reason) || null };
    }
    case "model_called": {
      const trigger = describeTrigger({ trigger: text(payload.trigger), triggerDetail: (payload.triggerDetail as Record<string, unknown>) ?? {} }, "clause");
      const confidence = payload.confidence !== undefined && payload.confidence !== null ? ` · confidence ${Number(payload.confidence).toFixed(2)}` : "";
      const action = context?.actionsByPassId.get(text(payload.passId));
      const chosen = action ? `${action.symbol} ${describeActionContracts(action)}` : describeCandidateId(text(payload.candidateId), at);
      return { dot: "model", title: modelVerdictTitle(payload), detail: text(payload.verdict) === "trade" ? chosen : null, sub: `Asked ${trigger}${confidence}` };
    }
    case "model_failed":
      return { dot: "bad", title: "Model call failed", detail: null, sub: text(payload.error) || null };
    case "no_trade": {
      const topPick = payload.deterministicTopPick as { id?: string; edgeDollars?: number } | null;
      const fallback = isAbstainVerdict(text(payload.verdict)) ? "the model abstained" : "nothing worth trading";
      return { dot: "look", title: "No order", detail: topPick?.id ? `Edge $ top pick was ${describeCandidateId(topPick.id, at)} ($${Math.round(topPick.edgeDollars ?? 0)})` : fallback, sub: Array.isArray(payload.reasons) ? (payload.reasons as string[]).join(" ") : null };
    }
    case "action_validated":
      return { dot: "look", title: "Order checks passed", detail: eventAction ? describeOrderLine(eventAction, Number(payload.limitPrice ?? 0)) : `${describeCandidateId(text(payload.candidateId), at)} · ${text(payload.quantity)}× @ ${Number(payload.limitPrice ?? 0).toFixed(2)}`, sub: null };
    case "action_blocked": {
      const failed = Array.isArray(payload.failed) ? (payload.failed as { gate: string; detail: string }[]) : [];
      const blockedWhat = eventAction && eventAction.kind !== "no_trade" ? `${eventAction.symbol} ${describeActionContracts(eventAction)}` : `${symbol}${payload.candidateId ? ` ${describeCandidateId(text(payload.candidateId), at).replace(/^[A-Z.]+ /, "")}` : ""}`;
      return { dot: "warn", title: "Blocked", detail: blockedWhat, sub: failed.length > 0 ? sentenceCase(failed.map((gate) => gate.detail).join(" · ")) : text(payload.reason) || null };
    }
    case "pass_started":
      return { dot: "look", title: "Pass started", detail: eventSymbols(payload.symbols).join(", ") || null, sub: null };
    case "pass_skipped":
      return { dot: "look", title: "Pass skipped", detail: eventSymbols(payload.tickers).join(", ") || null, sub: text(payload.reason) || null };
    case "paused":
      if (by && by !== "agent") return { dot: "ctl", title: `Paused by ${by}`, detail: payload.cancelWorkingOrders ? `cancel requested for ${text(payload.cancelRequested)} working order${text(payload.cancelRequested) === "1" ? "" : "s"}` : null, sub: null };
      if (text(payload.reason) === "deploy") return { dot: "ctl", title: "Paused after an update", detail: `${shortRelease(payload.to)}`, sub: "Resume once you're happy with the new version" };
      if (text(payload.reason) === "crash_loop") return { dot: "warn", title: "Paused after repeated restarts", detail: `${text(payload.startsInLastHour)} in the last hour`, sub: null };
      if (text(payload.reason) === "readiness") return { dot: "bad", title: "Paused: pre-open check still failing at 9:20 ET", detail: Array.isArray(payload.failing) ? (payload.failing as string[]).join(", ") : null, sub: "Resume once it is fixed" };
      return { dot: "ctl", title: "Paused", detail: text(payload.reason) || null, sub: null };
    case "resumed":
      return { dot: "ctl", title: `Resumed by ${by || "an operator"}`, detail: null, sub: null };
    case "breaker_tripped":
      return { dot: "bad", title: `Breaker tripped · ${humanizeKey(text(payload.name)).toLowerCase()}`, detail: null, sub: text(payload.detail) || null };
    case "breaker_reset":
      return { dot: "ctl", title: `Breaker reset by ${by || "an operator"}`, detail: humanizeKey(text(payload.name)).toLowerCase(), sub: null };
    case "mode_changed":
      return { dot: "ctl", title: text(payload.mode) === "on" ? `Switched on by ${by || "an operator"}` : `Switched off by ${by || "an operator"}`, detail: null, sub: null };
    case "settings_changed": {
      const fields = Array.isArray(payload.fields) ? (payload.fields as { field: string; from: unknown; to: unknown }[]) : [];
      return { dot: "ctl", title: `Settings changed by ${by || "an operator"}`, detail: null, sub: fields.map((change) => `${plutoParameterLabelByField[change.field] ?? humanizeKey(change.field)} ${text(change.from)} → ${text(change.to)}`).join(" · ") || null };
    }
    case "ticker_enabled":
      return { dot: "ctl", title: `${symbol} allowed`, detail: `by ${by || "an operator"}`, sub: null };
    case "ticker_disabled":
      return { dot: "ctl", title: `${symbol} switched off`, detail: `by ${by || "an operator"}`, sub: null };
    case "stress_override_changed":
      return { dot: "ctl", title: payload.enabled ? `New positions allowed under SPY stress today by ${by}` : `Stress override removed by ${by}`, detail: null, sub: null };
    case "lines_changed":
      return { dot: "look", title: "IBKR market-data lines", detail: `${text(payload.held)} held`, sub: text(payload.detail) || text(payload.reason) || null };
    case "window_opened":
      return { dot: "ctl", title: "Trading window opened", detail: payload.windowEndAt ? `until ${formatBrowserClockTime(text(payload.windowEndAt))}` : `until ${text(payload.windowEndEt)} ET`, sub: null };
    case "window_closed":
      return { dot: "ctl", title: "Trading window closed", detail: "stopped analysing new trades", sub: null };
    case "analysis_started": {
      const data = text(payload.data);
      const detail = data === "incomplete" ? "Day Signals not ready by 10:30 ET, running on incomplete data" : data === "complete_after_early_start" ? "Day Signals ready now, after an early start on incomplete data" : "Day Signals ready";
      return { dot: "model", title: "Started analysing new trades", detail, sub: null };
    }
    case "connection_lost":
      return { dot: "bad", title: "IBKR connection lost", detail: null, sub: "Quotes and orders can't flow until it reconnects" };
    case "connection_restored":
      return { dot: "ctl", title: "IBKR connection restored", detail: payload.downMinutes ? `after ${text(payload.downMinutes)} min` : null, sub: null };
    case "order_adopted":
      return { dot: "warn", title: "Order adopted after a restart", detail: orderLine(payload, context, null, at), sub: `Still working ${text(payload.ageMinutes)} min after the restart; watch resumed` };
    case "agent_started":
      return { dot: "ctl", title: "Pluto's program started", detail: `version ${shortRelease(payload.release) || "unknown"}`, sub: null };
    case "agent_stopped":
      return { dot: "ctl", title: "Pluto's program stopped", detail: text(payload.reason) || null, sub: null };
    case "readiness_check": {
      const results = Array.isArray(payload.results) ? (payload.results as { name: string; ok: boolean; detail: string }[]) : [];
      const failing = results.filter((result) => !result.ok);
      const runLabel = text(payload.kind) === "final" ? "Final pre-open check" : "Pre-open check";
      if (failing.length === 0) return { dot: "look", title: `${runLabel} passed`, detail: results.map((result) => result.name).join(", "), sub: null };
      return { dot: "bad", title: `${runLabel} failed`, detail: failing.map((result) => result.name).join(", "), sub: failing.map((result) => `${result.name}: ${result.detail}`).join(" · ") };
    }
    case "warning":
      return { dot: "warn", title: "Warning", detail: symbol || null, sub: text(payload.message) || null };
    default:
      return { dot: "look", title: humanizeKey(event.type), detail: null, sub: JSON.stringify(payload) };
  }
}

/** The Event log's category choices, in the order the dropdown lists them. Which category an event belongs to comes from the API. */
export const plutoEventCategoryOptions: { key: PlutoEventCategory; label: string }[] = [
  { key: "system", label: "System" },
  { key: "config", label: "Config" },
  { key: "safety", label: "Safety" },
  { key: "analysis", label: "Analysis" },
  { key: "trading", label: "Trading" },
  { key: "info", label: "Info" },
];

/** Info is the routine analysis bookkeeping (thousands of rows a day), so it starts unticked. */
export const defaultPlutoEventCategories: PlutoEventCategory[] = ["system", "config", "safety", "analysis", "trading"];

export function plutoEventCategoryLabel(category: PlutoEventCategory): string {
  return plutoEventCategoryOptions.find((option) => option.key === category)?.label ?? humanizeKey(category);
}

export interface PlutoEventField {
  label: string;
  value: string;
  /** A structured value (a list of objects, a nested object) shown as compact JSON in a monospaced font. */
  structured: boolean;
}

const fieldLabelWordFixes: Record<string, string> = { id: "ID", ids: "IDs", usd: "USD" };

function fieldLabel(key: string): string {
  const words = humanizeKey(key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()).split(" ");
  return words.map((word) => fieldLabelWordFixes[word.toLowerCase()] ?? word).join(" ");
}

/** Every field stored on an event, in stored order, as label + text, so nothing the agent recorded is hidden. */
export function describeEventPayloadFields(payload: Record<string, unknown> | null): PlutoEventField[] {
  if (!payload) return [];
  return Object.entries(payload).map(([key, value]) => {
    const label = fieldLabel(key);
    if (value === null || value === undefined || value === "") return { label, value: "—", structured: false };
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { label, value: String(value), structured: false };
    if (Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) return { label, value: value.length === 0 ? "—" : value.join(value.every((item) => !/\s/.test(String(item))) ? ", " : " "), structured: false };
    return { label, value: JSON.stringify(value), structured: true };
  });
}

/** The Live tab's Activity feed leaves out the routine analysis bookkeeping the Event log keeps (no_trade: older rows only, now part of model_called). */
export const activityFeedHiddenEventTypes = ["pass_started", "pass_skipped", "order_built", "action_validated", "no_trade", "lines_changed", "connection_lost", "connection_restored"];

/** Restarts in the last hour from the newest crash-loop pause event, for the paused headline. */
export function crashLoopRestartsFromEvents(events: PlutoEvent[]): number | null {
  const pause = events.find((event) => event.type === "paused" && event.payload?.reason === "crash_loop");
  return pause && typeof pause.payload.startsInLastHour === "number" ? pause.payload.startsInLastHour : null;
}

/** Why a two-part order's Fill shows a price implied by the net instead of IBKR's own figure for the option. */
export function describeImpliedFill(reportedFillPrice: number, impliedFillPrice: number): string {
  return (
    `Two-part order (shares + call, or a roll). IBKR filled the whole package at exactly its total price but split that total between the parts its own way, ` +
    `reporting this option at ${reportedFillPrice.toFixed(2)}. The Fill shown (${impliedFillPrice.toFixed(2)}) is the option's price implied by the total, ` +
    `with the other part counted at the price Pluto set. Both figures are stored.`
  );
}

/**
 * A buyback offer's description as its contract and size: the current "COIN Buy back $300 Put · 10 Oct (3DTE) · 2× @ 0.65 …"
 * or the older "Buy back 2× COIN $300P 2026-10-10 at ~0.65 …" (DTE then from `dte`); null for anything else.
 */
export function parseBuybackDescription(description: string, dte: number | null): { quantity: number; right: "C" | "P"; contract: string } | null {
  const current = description.match(/^\S+ Buy back (\$\S+ (Call|Put) · \d+ \w+(?: \(\d+DTE\))?) · (\d+)×/);
  if (current) return { quantity: Number(current[3]), right: current[2] === "Call" ? "C" : "P", contract: current[1]! };
  const older = description.match(/^Buy back (\d+)× \S+ \$(\S+?)([CP]) (\d{4}-\d{2}-\d{2})/);
  if (!older) return null;
  const right = older[3] === "C" ? "C" : "P";
  return { quantity: Number(older[1]), right, contract: formatOptionContractLabel({ strike: Number(older[2]), right, expiry: older[4]!, dte }) };
}

/** A ticker's macro calendar by day, in date order: one entry per date with every release on it. */
export function groupMacroEventsByDate(events: { date: string; title: string }[]): { date: string; titles: string[] }[] {
  const byDate = new Map<string, string[]>();
  for (const event of [...events].sort((a, b) => a.date.localeCompare(b.date))) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event.title]);
  return [...byDate.entries()].map(([date, titles]) => ({ date, titles }));
}

/** A recent decision's verdict as the model's input lists it, in words. */
export function describeRecentDecisionVerdict(verdict: string): string {
  if (verdict === "trade") return "Trade";
  if (verdict === "no_trade") return "No order";
  if (isAbstainVerdict(verdict)) return "Abstained";
  if (verdict === "invalid") return "Unreadable answer";
  return humanizeKey(verdict);
}

/** What became of a traded decision (the action's outcome, or "not_executed"), with the badge tone it reads in. */
export function describeTradeOutcome(outcome: string): { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" } {
  switch (outcome) {
    case "blocked":
      return { label: "Blocked", tone: "warn" };
    case "validated":
    case "order_built":
    case "confirmed":
      return { label: "Order working", tone: "info" };
    case "filled":
      return { label: "Filled", tone: "ok" };
    case "partially_filled":
      return { label: "Partly filled", tone: "ok" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "rejected":
      return { label: "Rejected", tone: "bad" };
    case "error":
      return { label: "Order error", tone: "bad" };
    case "not_executed":
      return { label: "Not executed", tone: "neutral" };
    default:
      return { label: humanizeKey(outcome), tone: "neutral" };
  }
}

/** A candidate flag in words: "macro_event_before_expiry" → "macro event before expiry". */
export function describeCandidateFlag(flag: string): string {
  return flag.replace(/_/g, " ");
}

/**
 * The Day Signals column (mockup approved 2026-10-07): whether Day Signals is quoting the ticker today and, when not, why and
 * when it looks again. `sessionOpen` false drops the "next re-check" promises, since nothing runs outside the session.
 */
export function describeDaySignalsWatch(status: DaySignalsWatchStatus, sessionOpen: boolean): { tone: PlutoBadgeTone; label: string; detail: string | null; phoneNote: string | null } {
  const lookedAt = status.lastLookAt ? formatBrowserClockTime(status.lastLookAt) : null;
  const triggers = status.triggerLowPrice !== null && status.triggerHighPrice !== null ? `${formatCurrency(status.triggerLowPrice)} or ${formatCurrency(status.triggerHighPrice)}` : null;
  switch (status.kind) {
    case "watched": {
      const expiries = status.pooledExpiries.map(formatDayMonth).join(", ");
      const look = lookedAt ? ` · ${status.lastLookKind === "timed" ? `re-checked ${lookedAt}` : `re-ranked ${lookedAt} after a price move`}` : "";
      return { tone: "ok", label: "Watched", detail: `${pluralize(status.pooledExpiries.length, "expiry", "expiries")} quoted (${expiries})${look}`, phoneNote: null };
    }
    case "not_watched": {
      const why = lookedAt ? `Re-checked ${lookedAt}${status.lastLookKind === "timed" ? "" : " after a price move"}: still nothing worth selling.` : "No contract had positive edge at 10:00 ET.";
      const next = !sessionOpen ? "" : status.nextTimedCheckAt ? ` Next re-check ${formatBrowserClockTime(status.nextTimedCheckAt)}${triggers ? `, or at once at ${triggers}` : ""}.` : triggers ? ` Re-checked hourly, or at once at ${triggers}.` : " Re-checked hourly.";
      return { tone: "warn", label: "Not watched today", detail: `${why}${next}`, phoneNote: `Not watched today${sessionOpen && status.nextTimedCheckAt ? ` · next re-check ${formatBrowserClockTime(status.nextTimedCheckAt)}` : ""}` };
    }
    case "no_surface":
      return { tone: "bad", label: "No surface today", detail: "Today's capture gave no usable surface, so Day Signals cannot quote it. Watched again after the next capture.", phoneNote: "No surface today: not watched until the next capture" };
    case "waiting_for_capture":
      return { tone: "neutral", label: "Waiting for today's capture", detail: "Day Signals starts once the 10:00 ET capture and its fits are done.", phoneNote: null };
    case "market_closed":
      return { tone: "neutral", label: "Market closed today", detail: null, phoneNote: null };
  }
}

