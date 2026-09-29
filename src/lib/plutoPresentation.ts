import type { PlutoAction, PlutoActionOutcome, PlutoEvent, PlutoPass } from "../api/pluto";
import { formatDate, formatExpiryWithDte } from "./formatters";

// Presentation rules for Pluto's ledger (timeline events, actions, passes). Pure functions so the
// screen components stay declarative and the wording is unit-testable.

export interface PlutoTimelineEntry {
  badgeClass: string;
  badgeLabel: string;
  line: string;
  reason: string | null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Heroku release "v212" stays as is; a bare git SHA is shortened to 7 characters. */
function shortRelease(value: unknown): string {
  const release = text(value);
  return /^[0-9a-f]{40}$/.test(release) ? release.slice(0, 7) : release;
}

function joined(value: unknown): string | null {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(" ") : null;
}

export function describeCandidateId(candidateId: string | null | undefined): string {
  if (!candidateId) return "—";
  // SYM:strategy:expiry:strike | SYM:roll:legId:expiry:strike
  const parts = candidateId.split(":");
  if (parts.length === 4) {
    const [symbol, strategy, expiry, strike] = parts;
    const right = strategy === "covered_call" ? "C" : strategy === "cash_secured_put" ? "P" : "";
    return `${symbol} $${strike}${right} ${formatDate(expiry)}`;
  }
  if (parts.length === 5 && parts[1] === "roll") return `${parts[0]} roll → $${parts[4]} ${formatDate(parts[3]!)}`;
  return candidateId;
}

/** "trading_halt" → "Trading halt" */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describePlutoEvent(event: PlutoEvent): PlutoTimelineEntry {
  const payload = event.payload ?? {};
  const symbol = text(payload.symbol);
  switch (event.type) {
    case "agent_started":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "agent started", line: `release ${shortRelease(payload.release) || "unknown"} on ${text(payload.environment) || "unknown"}`, reason: null };
    case "agent_stopped":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "agent stopped", line: text(payload.reason) || "clean stop", reason: null };
    case "pass_started":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "pass", line: `${humanizeKey(text(payload.trigger))}${Array.isArray(payload.symbols) && payload.symbols.length > 0 ? ` on ${payload.symbols.join(", ")}` : ""}`, reason: null };
    case "pass_skipped":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "skipped", line: `${humanizeKey(text(payload.trigger))}: ${text(payload.reason)}`, reason: null };
    case "model_called": {
      const served = Array.isArray(payload.servedModelIds) ? [...new Set(payload.servedModelIds.map(String))].join(", ") : "";
      const verdict = text(payload.verdict);
      return { badgeClass: "bg-azure-lt", badgeLabel: "model called", line: `2 calls · ${served || "model"} · $${Number(payload.costUsd ?? 0).toFixed(4)} · ${verdict === "trade" ? `trade ${describeCandidateId(text(payload.candidateId))}` : verdict}${payload.agreement ? ` · ${text(payload.agreement)}` : ""}`, reason: joined(payload.reasons) };
    }
    case "model_failed":
      return { badgeClass: "bg-danger-lt", badgeLabel: "model failed", line: text(payload.error), reason: null };
    case "no_trade": {
      const topPick = payload.deterministicTopPick as { id?: string; edgeDollars?: number } | null;
      return { badgeClass: "bg-secondary-lt", badgeLabel: "no trade", line: topPick?.id ? `Edge $ top pick was ${describeCandidateId(topPick.id)} ($${Math.round(topPick.edgeDollars ?? 0)})` : "nothing worth trading", reason: joined(payload.reasons) };
    }
    case "action_validated":
      return { badgeClass: "bg-azure-lt", badgeLabel: "validated", line: `${symbol} ${describeCandidateId(text(payload.candidateId))} · quantity ${text(payload.quantity)} · limit ${Number(payload.limitPrice ?? 0).toFixed(2)}`, reason: joined(payload.reasons) };
    case "action_blocked": {
      const failed = Array.isArray(payload.failed) ? (payload.failed as { gate: string; detail: string }[]) : [];
      return { badgeClass: "bg-warning-lt", badgeLabel: "blocked", line: `${symbol} ${payload.candidateId ? describeCandidateId(text(payload.candidateId)) : ""}: ${failed.length > 0 ? failed.map((gate) => gate.gate).join(", ") : text(payload.reason)}`, reason: failed.length > 0 ? failed.map((gate) => gate.detail).join(" · ") : null };
    }
    case "order_built":
      return { badgeClass: "bg-azure-lt", badgeLabel: "order built", line: text(payload.description) || symbol, reason: null };
    case "order_confirmed":
      return { badgeClass: "bg-success-lt", badgeLabel: "order confirmed", line: text(payload.description) || symbol, reason: null };
    case "order_outcome": {
      const outcome = text(payload.outcome);
      const good = outcome === "filled" || outcome === "partially_filled";
      return { badgeClass: good ? "bg-success text-white" : outcome === "cancelled" ? "bg-secondary-lt" : "bg-danger-lt", badgeLabel: humanizeKey(outcome).toLowerCase(), line: `${symbol}${payload.fillPrice ? ` · avg fill ${Number(payload.fillPrice).toFixed(2)}` : ""}`, reason: text(payload.error) || text(payload.reason) || null };
    }
    case "paused":
      return { badgeClass: "bg-warning text-white", badgeLabel: "paused", line: payload.by ? `by ${text(payload.by)}${payload.cancelWorkingOrders ? ` · cancel requested for ${text(payload.cancelRequested)} working order(s)` : ""}` : text(payload.reason) || humanizeKey(text(payload.kind)), reason: null };
    case "resumed":
      return { badgeClass: "bg-success-lt", badgeLabel: "resumed", line: `by ${text(payload.by) || "an operator"}`, reason: null };
    case "breaker_tripped":
      return { badgeClass: "bg-danger text-white", badgeLabel: "breaker tripped", line: humanizeKey(text(payload.name)), reason: text(payload.detail) || null };
    case "breaker_reset":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "breaker reset", line: `${humanizeKey(text(payload.name))} by ${text(payload.by) || "an operator"}`, reason: null };
    case "mode_changed":
      return { badgeClass: text(payload.mode) === "on" ? "bg-success text-white" : "bg-secondary", badgeLabel: `mode ${text(payload.mode)}`, line: `by ${text(payload.by) || "an operator"}`, reason: null };
    case "settings_changed": {
      const fields = Array.isArray(payload.fields) ? (payload.fields as { field: string; from: unknown; to: unknown }[]) : [];
      return { badgeClass: "bg-secondary-lt", badgeLabel: "settings", line: `${text(payload.by) || "an operator"} changed ${fields.map((change) => `${change.field} ${text(change.from)} → ${text(change.to)}`).join(", ")}`, reason: null };
    }
    case "ticker_enabled":
      return { badgeClass: "bg-success-lt", badgeLabel: "ticker on", line: `${symbol} enabled by ${text(payload.by)}`, reason: null };
    case "ticker_disabled":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "ticker off", line: `${symbol} disabled by ${text(payload.by)}`, reason: null };
    case "lines_changed":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "lines", line: `${text(payload.held)} IBKR line(s) held${payload.detail ? ` · ${text(payload.detail)}` : ""}${payload.reason ? ` · ${text(payload.reason)}` : ""}`, reason: null };
    case "order_adopted":
      return { badgeClass: "bg-warning-lt", badgeLabel: "order adopted", line: `${text(payload.description) || symbol} — still working ${text(payload.ageMinutes)} min after a restart, watch resumed`, reason: null };
    case "stress_override_changed":
      return { badgeClass: payload.enabled ? "bg-warning text-white" : "bg-secondary-lt", badgeLabel: payload.enabled ? "stress override" : "override off", line: payload.enabled ? `${text(payload.by)} allowed new opens under SPY stress for ${text(payload.dateIso)}` : `${text(payload.by)} removed today's stress override`, reason: null };
    case "session_schedule":
      return { badgeClass: "bg-secondary-lt", badgeLabel: "session", line: `closes ${text(payload.closeTimeEt) || "?"} ET today (IBKR liquid hours)`, reason: null };
    case "warning":
      return { badgeClass: "bg-warning-lt", badgeLabel: "warning", line: `${symbol ? `${symbol}: ` : ""}${text(payload.message)}`, reason: null };
    default:
      return { badgeClass: "bg-secondary-lt", badgeLabel: humanizeKey(event.type).toLowerCase(), line: JSON.stringify(payload), reason: null };
  }
}

export function plutoActionKindLabel(action: PlutoAction): string {
  switch (action.kind) {
    case "open_covered_call":
      return "CC";
    case "open_cash_secured_put":
      return "CSP";
    case "roll":
      return "Roll";
    case "close_shares":
      return "Close shares";
    case "close_leg":
      return "Buy back";
    default:
      return "No trade";
  }
}

export function describePlutoActionContract(action: PlutoAction): string {
  const contract = action.contract;
  if (!contract) return "—";
  if (contract.strike !== undefined && contract.expiry) {
    const right = contract.strategyKey === "covered_call" ? "C" : contract.strategyKey === "cash_secured_put" ? "P" : "";
    return `$${contract.strike}${right} ${formatExpiryWithDte(contract.expiry)}`;
  }
  if (contract.legIds) return `${contract.legIds.length} leg(s)`;
  return "—";
}

export function plutoOutcomeBadgeClass(outcome: PlutoActionOutcome): string {
  switch (outcome) {
    case "filled":
    case "partially_filled":
      return "bg-success text-white";
    case "confirmed":
    case "order_built":
      return "bg-azure-lt";
    case "validated":
      return "bg-azure-lt";
    case "blocked":
      return "bg-warning-lt";
    case "rejected":
    case "error":
      return "bg-danger text-white";
    case "cancelled":
      return "bg-secondary-lt";
    default:
      return "bg-secondary-lt";
  }
}

export function plutoOutcomeLabel(outcome: PlutoActionOutcome): string {
  if (outcome === "confirmed") return "working";
  return humanizeKey(outcome).toLowerCase();
}

export function gatesPassedLabel(action: PlutoAction): string {
  if (action.gateResults.length === 0) return action.kind === "close_shares" && action.outcome !== "blocked" ? "auto" : "—";
  return `${action.gateResults.filter((gate) => gate.ok).length} / ${action.gateResults.length}`;
}

/** The pass's agreed verdict for the Decisions card: the first schema-valid call's parsed output. */
export function passVerdict(pass: PlutoPass) {
  const first = pass.decisions.find((decision) => decision.parsedOutput !== null)?.parsedOutput ?? null;
  const latencyMs = pass.decisions.reduce((max, decision) => Math.max(max, decision.latencyMs ?? 0), 0);
  const topPick = pass.actions.find((action) => action.deterministicTopPick)?.deterministicTopPick ?? null;
  const agreed = pass.decisions.length >= 2 && new Set(pass.decisions.map((decision) => `${decision.parsedOutput?.decision}:${decision.parsedOutput?.candidateId ?? ""}`)).size === 1;
  return { output: first, latencyMs, topPick, agreed };
}

export function describePlutoTrigger(pass: PlutoPass): string {
  const detail = pass.triggerDetail ?? {};
  if (pass.trigger === "spot_move" && detail.symbol) return `${String(detail.symbol)} spot ${Number(detail.movePct ?? 0) >= 0 ? "+" : ""}${Number(detail.movePct ?? 0).toFixed(1)}%`;
  if (pass.trigger === "settings_changed") return "settings changed";
  if ((pass.trigger === "grade_crossing" || pass.trigger === "held_leg") && Array.isArray(detail.symbols) && detail.symbols.length > 0) return `${humanizeKey(pass.trigger).toLowerCase()} on ${(detail.symbols as string[]).join(", ")}`;
  return humanizeKey(pass.trigger).toLowerCase();
}
