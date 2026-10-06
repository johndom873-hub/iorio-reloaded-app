import type { PlutoAction, PlutoActionContract, PlutoActionKind, PlutoActionOutcome, PlutoEvent, PlutoPass, PlutoState, PlutoSystemCheck, PlutoWorkingOrder } from "../api/pluto";
import { plutoParameterLabelByField } from "./plutoParameters";
import { daysToExpiry, easternIsoDate, formatCurrency, formatDayMonth, formatEasternTime, formatRelativeAge, formatRelativeTime, formatDateTime, todayInEasternIso } from "./formatters";

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
  if (now.getTime() < windowStart) return { kind: "waiting", label: "Waiting", headline: `Outside the trading window — starts analysing at ${session.windowStartEt} ET`, subline: `Window ${session.windowStartEt}–${session.windowEndEt} ET · market closes ${session.closeTimeEt}`, holdAlert: null };
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

function rightWord(contract: PlutoActionContract | null): string {
  if (contract?.right) return contract.right === "C" ? "call" : "put";
  return contract?.strategyKey === "covered_call" ? "call" : "put";
}

function strikeText(strike: number | undefined): string {
  return strike === undefined ? "?" : `$${Number.isInteger(strike) ? strike : strike.toFixed(2).replace(/\.?0+$/, "")}`;
}

/** The contract cell: a title and a sub-line ("$24 put · 17 Oct" / "Sell to open · 11 days"). */
export function describeOrderContract(action: { kind: PlutoActionKind; contract: PlutoActionContract | null; quantity: number | null; createdAt: string }): { title: string; sub: string | null } {
  const contract = action.contract;
  if (action.kind === "close_shares") return { title: `Sell ${action.quantity ?? "?"} shares`, sub: "Close unstructured shares" };
  if (action.kind === "close_leg") return { title: contract?.expiry ? `Buy back ${strikeText(contract.strike)} ${rightWord(contract)} · ${formatDayMonth(contract.expiry)}` : "Buy back", sub: "Buy back to close" };
  if (action.kind === "roll") {
    const title = `Roll ${strikeText(contract?.fromStrike)} → ${strikeText(contract?.strike)} ${rightWord(contract)}`;
    const sub = contract?.fromExpiry && contract.expiry ? `${formatDayMonth(contract.fromExpiry)} → ${formatDayMonth(contract.expiry)} · net credit` : "net credit";
    return { title, sub };
  }
  if (action.kind === "no_trade") return { title: "No order", sub: null };
  if (!contract?.expiry) return { title: "—", sub: null };
  const dte = daysToExpiry(contract.expiry, action.createdAt);
  return { title: `${strikeText(contract.strike)} ${rightWord(contract)} · ${formatDayMonth(contract.expiry)}`, sub: action.kind === "open_covered_call" ? `Buy-write · with ${(action.quantity ?? 0) * 100} shares` : `Sell to open · ${dte} ${dte === 1 ? "day" : "days"}` };
}

/** "HOOD sell 2× $24 put" — one line for the status card and the feed. */
export function describeOrderShort(order: { symbol: string; kind: PlutoActionKind; contract: PlutoActionContract | null; quantity: number | null }): string {
  const contract = order.contract;
  const quantity = order.quantity ?? "?";
  if (order.kind === "close_shares") return `${order.symbol} sell ${quantity} shares`;
  if (order.kind === "close_leg") return `${order.symbol} buy back ${quantity}× ${strikeText(contract?.strike)} ${rightWord(contract)}`;
  if (order.kind === "roll") return `${order.symbol} roll ${strikeText(contract?.fromStrike)} → ${strikeText(contract?.strike)} ${rightWord(contract)}`;
  if (order.kind === "open_covered_call") return `${order.symbol} buy-write ${quantity}× ${strikeText(contract?.strike)} call`;
  return `${order.symbol} sell ${quantity}× ${strikeText(contract?.strike)} ${rightWord(contract)}`;
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
  return `${describeOrderShort(order)} @ ${order.limitPrice?.toFixed(2) ?? "?"} · ${age}${cancelAt ? ` · cancels at ${formatEasternTime(cancelAt.toISOString()).replace(" ET", "")} if unfilled` : ""}`;
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
      return { tone: "info", label: `Working · ${formatAgeInWords(action.createdAt, now)}`, sub: cancelAt ? `Cancels at ${formatEasternTime(cancelAt.toISOString()).replace(" ET", "")} if unfilled` : null, linksToOrder: true };
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
    { key: "pessimistic", header: "Pessimistic", title: "Fills versus the worse side of the market the order was placed into", align: "right" },
    { key: "gates", header: "Gates", align: "right" },
  ],
};

// ---------- Decisions ----------

export function describeCandidateId(candidateId: string | null | undefined): string {
  if (!candidateId) return "—";
  // SYM:strategy:expiry:strike | SYM:roll:legId:expiry:strike | SYM:close_leg:legId | SYM:close_shares:positionId
  const parts = candidateId.split(":");
  if (parts.length === 4 && (parts[1] === "covered_call" || parts[1] === "cash_secured_put")) {
    const [symbol, strategy, expiry, strike] = parts;
    return `${symbol} $${strike} ${strategy === "covered_call" ? "call" : "put"} · ${formatDayMonth(expiry!)}`;
  }
  if (parts.length === 5 && parts[1] === "roll") return `${parts[0]} roll → $${parts[4]} ${formatDayMonth(parts[3]!)}`;
  if (parts[1] === "close_leg") return `${parts[0]} buy back`;
  if (parts[1] === "close_shares") return `${parts[0]} sell shares`;
  return candidateId;
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

/** "Sell 2× HOOD $24 put, 17 Oct" — what the model chose, with the sized quantity once the gates set one. */
export function describeChosenAction(pass: PlutoPass): string {
  const { output, action } = passVerdict(pass);
  if (!output || output.decision !== "trade") return output?.decision === "abstain" ? "Abstained — the data looked unreliable" : "Nothing worth trading";
  const quantity = action?.quantity ? `${action.quantity}× ` : "";
  const contractName = (action ? describeOrderContract(action).title : describeCandidateId(output.candidate_id)).replace(" · ", ", ");
  const symbol = action?.symbol ?? output.candidate_id?.split(":")[0] ?? "";
  if (action?.kind === "roll") return `${contractName.replace(/^Roll /, `Roll ${quantity}${symbol} `)}`;
  if (action?.kind === "close_leg") return contractName.replace(/^Buy back /, `Buy back ${quantity}${symbol} `);
  if (action?.kind === "close_shares") return `${symbol} ${contractName.toLowerCase()}`;
  if (action?.kind === "open_covered_call") return `Buy-write ${quantity}${symbol} ${contractName}`;
  return `Sell ${quantity}${symbol} ${contractName}`;
}

/** How the model's pick compares with the deterministic Edge $ top pick. */
export function describeTopPickComparison(pass: PlutoPass): { tone: "ok" | "warn" | "muted"; text: string } {
  const { output, topPick, action } = passVerdict(pass);
  if (!output || output.decision !== "trade") return { tone: "muted", text: topPick ? `Top was ${describeCandidateId(topPick.id)}, $${Math.round(topPick.edgeDollars)}` : "No top pick" };
  if (action && (action.kind === "roll" || action.kind === "close_leg" || action.kind === "close_shares")) return { tone: "muted", text: `No open top pick (${action.kind === "roll" ? "roll" : "close"})` };
  if (!topPick) return { tone: "muted", text: "No top pick" };
  if (topPick.id === output.candidate_id) return { tone: "ok", text: "Same pick" };
  return { tone: "warn", text: `Differs · top was ${describeCandidateId(topPick.id).replace(/^[A-Z.]+ /, "")}` };
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
  if (verdict !== "trade") return verdict === "abstain" ? "Model: abstained" : "Model: no order";
  switch (text(payload.actionKind)) {
    case "roll":
      return "Model: roll";
    case "close_leg":
      return "Model: buy back";
    case "close_shares":
      return "Model: close shares";
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

/** "HOOD 2× $24P 2026-10-17 @ 0.62" (the agent's order description) → "HOOD sell 2× $24 put · 17 Oct @ 0.62". */
export function humanizeOrderDescription(description: string): string {
  const open = description.match(/^(\S+) (\d+)× \$(\S+?)([CP]) (\d{4}-\d{2}-\d{2}) @ ([\d.]+)$/);
  if (open) return `${open[1]} ${open[4] === "C" ? "buy-write" : "sell"} ${open[2]}× $${open[3]} ${open[4] === "C" ? "call" : "put"} · ${formatDayMonth(open[5]!)} @ ${open[6]}`;
  const roll = description.match(/^(\S+) roll (\d+)× \$(\S+) → \$(\S+) (\d{4}-\d{2}-\d{2}) @ ([\d.]+)$/);
  if (roll) return `${roll[1]} roll ${roll[2]}× $${roll[3]} → $${roll[4]} · ${formatDayMonth(roll[5]!)} @ ${roll[6]}`;
  const buyback = description.match(/^Buy back (\d+)× (\S+) \$(\S+?)([CP]) (\d{4}-\d{2}-\d{2}) at ~([\d.]+)/);
  if (buyback) return `${buyback[2]} buy back ${buyback[1]}× $${buyback[3]} ${buyback[4] === "C" ? "call" : "put"} · ${formatDayMonth(buyback[5]!)} @ ${buyback[6]}`;
  const shares = description.match(/^Sell (\d+) (\S+) shares .*?at ~([\d.]+)/);
  if (shares) return `${shares[2]} sell ${shares[1]} shares @ ${shares[3]}`;
  return description;
}

function orderLine(payload: Record<string, unknown>, context: PlutoFeedContext | undefined, price: number | null): string {
  const action = context?.actionsById.get(text(payload.actionId));
  if (action) return `${describeOrderShort(action)}${price !== null ? ` @ ${price.toFixed(2)}` : ""}`;
  const description = text(payload.description);
  return description ? humanizeOrderDescription(description) : text(payload.symbol);
}

export function describeFeedEvent(event: PlutoEvent, context?: PlutoFeedContext): PlutoFeedEntry {
  const payload = event.payload ?? {};
  const symbol = text(payload.symbol);
  const by = text(payload.by);
  switch (event.type) {
    case "order_confirmed":
      return { dot: "order", title: "Order sent", detail: orderLine(payload, context, context?.actionsById.get(text(payload.actionId))?.limitPrice ?? null), sub: null };
    case "order_built":
      return { dot: "order", title: "Order built", detail: orderLine(payload, context, context?.actionsById.get(text(payload.actionId))?.limitPrice ?? null), sub: null };
    case "order_outcome": {
      const outcome = text(payload.outcome);
      const price = payload.fillPrice ? Number(payload.fillPrice) : null;
      const what = orderLine(payload, context, price);
      if (outcome === "filled") return { dot: "fill", title: "Filled", detail: what, sub: null };
      if (outcome === "partially_filled" || outcome === "cancelled_partially_filled") return { dot: "fill", title: "Partly filled", detail: what, sub: outcome === "cancelled_partially_filled" ? "Rest cancelled" : null };
      if (outcome === "cancelled") return { dot: "look", title: "Cancelled", detail: orderLine(payload, context, null), sub: text(payload.reason) || null };
      return { dot: "bad", title: outcome === "rejected" ? "Rejected" : "Order error", detail: orderLine(payload, context, null), sub: text(payload.error) || text(payload.reason) || null };
    }
    case "model_called": {
      const trigger = describeTrigger({ trigger: text(payload.trigger), triggerDetail: (payload.triggerDetail as Record<string, unknown>) ?? {} }, "clause");
      const confidence = payload.confidence !== undefined && payload.confidence !== null ? ` · confidence ${Number(payload.confidence).toFixed(2)}` : "";
      const action = context?.actionsByPassId.get(text(payload.passId));
      const chosen = action ? `${action.symbol} ${describeOrderContract(action).title.replace(/^Roll /, "").replace(/^Buy back /, "")}` : describeCandidateId(text(payload.candidateId));
      return { dot: "model", title: modelVerdictTitle(payload), detail: text(payload.verdict) === "trade" ? chosen : null, sub: `Asked ${trigger}${confidence}` };
    }
    case "model_failed":
      return { dot: "bad", title: "Model call failed", detail: null, sub: text(payload.error) || null };
    case "no_trade": {
      const topPick = payload.deterministicTopPick as { id?: string; edgeDollars?: number } | null;
      return { dot: "look", title: "No order", detail: topPick?.id ? `Edge $ top pick was ${describeCandidateId(topPick.id)} ($${Math.round(topPick.edgeDollars ?? 0)})` : "nothing worth trading", sub: Array.isArray(payload.reasons) ? (payload.reasons as string[]).join(" ") : null };
    }
    case "action_validated":
      return { dot: "look", title: "Order checks passed", detail: `${describeCandidateId(text(payload.candidateId))} · ${text(payload.quantity)}× @ ${Number(payload.limitPrice ?? 0).toFixed(2)}`, sub: null };
    case "action_blocked": {
      const failed = Array.isArray(payload.failed) ? (payload.failed as { gate: string; detail: string }[]) : [];
      return { dot: "warn", title: "Blocked", detail: `${symbol}${payload.candidateId ? ` ${describeCandidateId(text(payload.candidateId)).replace(/^[A-Z.]+ /, "")}` : ""}`, sub: failed.length > 0 ? sentenceCase(failed.map((gate) => gate.detail).join(" · ")) : text(payload.reason) || null };
    }
    case "pass_started":
      return { dot: "look", title: "Analysis", detail: describeTrigger({ trigger: text(payload.trigger), triggerDetail: { symbols: payload.symbols } }, "short"), sub: null };
    case "pass_skipped":
      return { dot: "look", title: "Analysis skipped", detail: describeTrigger({ trigger: text(payload.trigger), triggerDetail: {} }, "short"), sub: text(payload.reason) || null };
    case "paused":
      if (by && by !== "agent") return { dot: "ctl", title: `Paused by ${by}`, detail: payload.cancelWorkingOrders ? `cancel requested for ${text(payload.cancelRequested)} working order${text(payload.cancelRequested) === "1" ? "" : "s"}` : null, sub: null };
      if (text(payload.reason) === "deploy") return { dot: "ctl", title: "Paused after an update", detail: `${shortRelease(payload.to)}`, sub: "Resume once you're happy with the new version" };
      if (text(payload.reason) === "crash_loop") return { dot: "warn", title: "Paused after repeated restarts", detail: `${text(payload.startsInLastHour)} in the last hour`, sub: null };
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
    case "session_schedule":
      return { dot: "look", title: "Session schedule", detail: `closes ${text(payload.closeTimeEt) || "?"} ET today`, sub: null };
    case "order_adopted":
      return { dot: "warn", title: "Order adopted after a restart", detail: orderLine(payload, context, null), sub: `Still working ${text(payload.ageMinutes)} min after the restart; watch resumed` };
    case "agent_started":
      return { dot: "ctl", title: "Pluto's program started", detail: `version ${shortRelease(payload.release) || "unknown"}`, sub: null };
    case "agent_stopped":
      return { dot: "ctl", title: "Pluto's program stopped", detail: text(payload.reason) || null, sub: null };
    case "warning":
      return { dot: "warn", title: "Warning", detail: symbol || null, sub: text(payload.message) || null };
    default:
      return { dot: "look", title: humanizeKey(event.type), detail: null, sub: JSON.stringify(payload) };
  }
}

/** The Live tab's Activity feed leaves out the routine analysis bookkeeping the Event log keeps. */
const feedHiddenEventTypes = new Set(["pass_started", "pass_skipped", "order_built", "action_validated", "no_trade", "lines_changed", "session_schedule"]);

export function isActivityFeedEvent(event: PlutoEvent): boolean {
  return !feedHiddenEventTypes.has(event.type);
}

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
