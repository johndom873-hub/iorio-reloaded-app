import type { AppNotification } from "../api/notifications";
import type { DayQuotesFrameStatus, HeldLegScore, HeldLegUnscoredReason, RoadmapStatus, RollSignalCandidate, RollSignalFlag, SignalCandidate, SignalFlag, SignalGrade, SignalQuoteSource, SignalsNoCandidatesReason, SignalsPriceSource, SignalsUnscoredReason, MacroEvent } from "../api/signals";
import { formatCurrencyTrimmed, formatDate, formatLocalTime, formatMonthDay, formatOptionContractShort, formatPercentageValue, formatShortAge, formatSignedPnl, formatVolatilityPoints } from "./formatters";

// Labels, badge classes and short explanations for the Signals screen and
// modal (mockup approved 2026-09-22). Every label a user can see has a plain
// explanation here so the screen can show it as a tooltip.

export const gradeLabel: Record<SignalGrade, string> = { strong: "Strong", good: "Good", weak: "Weak", avoid: "Avoid" };

// Dedicated badge-grade-* classes (theme.css) rather than Tabler's bg-success/bg-cyan/bg-yellow/bg-secondary,
// so this grade scale doesn't drift if those general-purpose semantic colors change elsewhere.
export const gradeBadgeClass: Record<SignalGrade, string> = { strong: "badge-grade-strong", good: "badge-grade-good", weak: "badge-grade-weak", avoid: "badge-grade-avoid" };

export const gradeExplanation = "Grades are fixed net Edge cut points: Strong = 10vp or more, Good = 5-10vp, Weak = 0-5vp, Avoid = net Edge at or below zero.";

export const unscoredReasonLabel: Record<SignalsUnscoredReason, string> = {
  no_snapshot: "No chain snapshot yet",
  no_surface_fit: "No fitted surface",
  no_forecast: "No volatility forecast (price history too short)",
  suspected_split: "No volatility forecast (suspected stock split in the price history)",
};

/** Badge text for a ticker with no top signal: "Filtered" when the Signals tab filters removed every contract. */
export function noSignalBadgeLabel(noCandidatesReason: SignalsNoCandidatesReason | null): string {
  return noCandidatesReason?.kind === "filtered" ? "Filtered" : "Unscored";
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeExpiryGroup(expiriesIso: string[]): string {
  const first = formatMonthDay(expiriesIso[0]!);
  const range = expiriesIso.length === 1 ? first : `${first} – ${formatMonthDay(expiriesIso[expiriesIso.length - 1]!)}`;
  return `${pluralize(expiriesIso.length, "expiry", "expiries")} (${range})`;
}

/**
 * Why a scored ticker shows no candidates, as one line for the tooltip and modal. Filtered (approved 2026-09-28):
 * best yield vs the minimum, plus the max-delta count if any. Nothing scorable: which expiries dropped and why.
 */
export function describeNoCandidatesReason(reason: SignalsNoCandidatesReason): string {
  if (reason.kind === "filtered") {
    const parts: string[] = [];
    if (reason.belowMinYieldCount > 0 && reason.bestAnnualizedYieldPct !== null) {
      parts.push(`Best annualised yield ${formatPercentageValue(reason.bestAnnualizedYieldPct, 1)} vs the ${formatPercentageValue(reason.minAnnualizedYieldPct, 0)} minimum`);
    }
    if (reason.aboveMaxDeltaCount > 0) {
      parts.push(`${pluralize(reason.aboveMaxDeltaCount, "contract", "contracts")} above the ${reason.maxNetDelta.toFixed(2)} max delta`);
    }
    return parts.join(" · ");
  }
  const parts: string[] = [];
  if (reason.surfaceFitRejectedExpiries.length > 0) parts.push(`${describeExpiryGroup(reason.surfaceFitRejectedExpiries)}: surface fit rejected`);
  if (reason.spansEarningsExpiries.length > 0) {
    const earnings = reason.earningsDateIso ? ` on ${formatMonthDay(reason.earningsDateIso)}` : "";
    parts.push(`${describeExpiryGroup(reason.spansEarningsExpiries)}: span earnings${earnings}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No contract had a usable quote to score";
}

/** The modal's empty-table message for a scored ticker with no candidates. */
export function describeNoCandidatesMessage(reason: SignalsNoCandidatesReason): string {
  const headline = reason.kind === "filtered" ? "Every contract is filtered out by the Signals settings." : "No contract could be scored.";
  return `${headline} ${describeNoCandidatesReason(reason)}.`;
}

export const priceSourceLabel: Record<SignalsPriceSource, string> = {
  live: "Live price",
  frozen: "Last known price (pre-live)",
  snapshot: "9:30 ET snapshot price",
};

export const quoteSourceLabel: Record<SignalQuoteSource, string> = {
  live: "Live IBKR quote",
  day: "Day Signals quote — refreshed by the intraday loop every few minutes",
  snapshot: "9:30 ET snapshot quote — this contract is not in today's refresh pool",
};

/** A day quote's age as the Quote column shows it, standalone and capitalised: "Now", "3m", "1h 05m", or "—". */
export function quoteAgeCellLabel(quotedAt: string | null | undefined, now: Date = new Date()): string {
  const age = formatShortAge(quotedAt, now);
  if (age === null) return "—";
  return age === "now" ? "Now" : age;
}

/** Age range text for a set of day quotes, read mid-sentence: "1m–6m old", "under a minute to 2m old", "under a minute old", or null. */
export function describeQuoteAgeRange(asOf: { oldest: string; newest: string } | null | undefined, now: Date = new Date()): string | null {
  if (!asOf) return null;
  const newest = formatShortAge(asOf.newest, now);
  const oldest = formatShortAge(asOf.oldest, now);
  if (!newest || !oldest) return null;
  if (newest === oldest) return newest === "now" ? "under a minute old" : `${newest} old`;
  return newest === "now" ? `under a minute to ${oldest} old` : `${newest}–${oldest} old`;
}

// Day quotes older than this while the loop claims to be running mean the loop is not actually refreshing.
const staleDayQuotesAfterMs = 15 * 60_000;

/** The Signals screen's "Day quotes …" status line (mockup rev 2, approved 2026-09-24). */
export function describeDayQuotesStatus(dayQuotes: DayQuotesFrameStatus | null, now: Date = new Date()): { label: string; tone: string; pulse: boolean } {
  if (!dayQuotes) return { label: "Day quotes: waiting for the live stream", tone: "text-secondary", pulse: false };
  const { loop, status } = dayQuotes;
  const newestAgeMs = status.newestQuotedAt ? now.getTime() - new Date(status.newestQuotedAt).getTime() : null;
  if (!loop || loop.state === "disabled") {
    return status.newestQuotedAt
      ? { label: `Day quotes as of ${formatLocalTime(status.newestQuotedAt)} · refresh loop not running here`, tone: "text-secondary", pulse: false }
      : { label: "Day quotes off · refresh loop not running in this environment", tone: "text-secondary", pulse: false };
  }
  if (loop.state === "running") {
    if (newestAgeMs !== null && newestAgeMs > staleDayQuotesAfterMs) {
      return { label: `Day quotes stale · last refresh ${formatLocalTime(status.newestQuotedAt!)} (loop not refreshing)`, tone: "iorio-note-amber", pulse: false };
    }
    const range = describeQuoteAgeRange(status.oldestQuotedAt && status.newestQuotedAt ? { oldest: status.oldestQuotedAt, newest: status.newestQuotedAt } : null, now);
    return { label: range ? `Day quotes refreshing · ${range}` : "Day quotes refreshing · first cycle", tone: "text-secondary", pulse: true };
  }
  if (loop.reason.startsWith("market closed")) {
    return status.newestQuotedAt ? { label: `Day quotes as of ${formatLocalTime(status.newestQuotedAt)} · market closed`, tone: "text-secondary", pulse: false } : { label: "Day quotes idle · market closed", tone: "text-secondary", pulse: false };
  }
  if (loop.reason.startsWith("waiting for today's pool")) return { label: "Day quotes idle · waiting for the 9:30 ET capture", tone: "text-secondary", pulse: false };
  return { label: `Day quotes idle · ${loop.reason}`, tone: "iorio-note-amber", pulse: false };
}

function signalUpgradeContract(notification: Extract<AppNotification, { type: "signal_upgraded" }>): string {
  return formatOptionContractShort(notification.strike, notification.strategyKey === "covered_call" ? "C" : "P", notification.dte);
}

/** "AAOI 95P 4DTE upgraded Weak → Good (+6.3vp, +$142)" — the in-app toast. */
export function describeSignalUpgrade(notification: Extract<AppNotification, { type: "signal_upgraded" }>): string {
  const previous = gradeLabel[notification.previousGrade as SignalGrade] ?? notification.previousGrade;
  const next = gradeLabel[notification.grade as SignalGrade] ?? notification.grade;
  return `${notification.symbol} ${signalUpgradeContract(notification)} upgraded ${previous} → ${next} (${formatVolatilityPoints(notification.netEdge)}, ${formatSignedPnl(notification.edgeDollars, 0)})`;
}

/** "AAOI 95P 4DTE → Good" — Pulse's Latest Events, whose rows have room for little more than the contract. */
export function describeSignalUpgradeCompact(notification: Extract<AppNotification, { type: "signal_upgraded" }>): string {
  return `${notification.symbol} ${signalUpgradeContract(notification)} → ${gradeLabel[notification.grade as SignalGrade] ?? notification.grade}`;
}

export const roadmapStatusLabel: Record<RoadmapStatus, string> = {
  waiting_on_data: "Waiting on data",
  waiting_on_sign_off: "Waiting on your sign-off",
  waiting_on_decision: "Waiting on a decision",
  waiting_on_later_phase: "Waiting on later phases",
  waiting_on_build: "Approved, building",
  waiting_on_next_run: "Waiting on tonight's run",
};

export const roadmapStatusBadgeClass: Record<RoadmapStatus, string> = {
  waiting_on_data: "bg-azure-lt",
  waiting_on_sign_off: "bg-warning-lt",
  waiting_on_decision: "bg-danger-lt",
  waiting_on_later_phase: "bg-secondary-lt",
  waiting_on_build: "bg-teal-lt",
  waiting_on_next_run: "bg-azure-lt",
};

export const signalFlagLetter: Record<SignalFlag, string> = { earnings_calendar_unresolved: "?", outside_fitted_range: "X", wide_spread: "W", insufficient_cash: "$", macro_event_before_expiry: "M" };
export const signalFlagExplanation: Record<SignalFlag, string> = {
  earnings_calendar_unresolved: "Earnings calendar not resolved for this ticker — trade could span an undetected report date",
  outside_fitted_range: "Strike is outside the fitted curve — extrapolated",
  wide_spread: "Spread wider than 50% of the mid",
  insufficient_cash: "Not enough free cash to secure this put",
  macro_event_before_expiry: "A major US macro release (FOMC, CPI, PPI, jobs report, PCE or GDP) lands before expiry — a short-dated IV spike may be an event premium, not mispricing",
};

/** The flag's explanation, naming the actual releases for the macro flag: "… — CPI: Inflation Rate MoM (Oct 14)". */
export function describeSignalFlag(flag: SignalFlag, candidate: SignalCandidate, macroEvents: MacroEvent[]): string {
  const base = signalFlagExplanation[flag];
  if (flag !== "macro_event_before_expiry") return base;
  const spanned = macroEvents.filter((event) => event.dateIso <= candidate.expiry);
  if (spanned.length === 0) return base;
  return `${base}: ${spanned.map((event) => `${event.title} (${formatDate(event.dateIso)})`).join("; ")}`;
}

/**
 * Colour check (approved 2026-09-25): how far a candidate's own live mid IV sits from the fitted,
 * shift-corrected surface IV used to grade it. Green when they agree (within 2vp) -- the grade shown
 * is trustworthy. Amber/red as mid runs increasingly below surface -- the live fill is running behind
 * what was graded, more so past 5vp. Mid running above surface is left uncoloured: not a concern for a
 * premium seller, just an upside worth a sanity check.
 */
export function surfaceIvTrustClass(surfaceIv: number, midIv: number | null): string {
  if (midIv === null) return "";
  const diffVolPoints = (midIv - surfaceIv) * 100;
  if (Math.abs(diffVolPoints) <= 2) return "text-success";
  if (diffVolPoints > 2) return "";
  if (diffVolPoints > -5) return "iorio-note-amber";
  return "text-danger";
}

/** "Put $106 · Oct 23, 2026" */
export function describeCandidate(candidate: Pick<SignalCandidate, "strategyKey" | "strike" | "expiry">): string {
  return `${candidate.strategyKey === "covered_call" ? "Call" : "Put"} ${formatCurrencyTrimmed(candidate.strike)} · ${formatDate(candidate.expiry)}`;
}

/** "110C 12DTE" — compact form for the Signals screen's Top Signal column. */
export function describeCandidateCompact(candidate: SignalCandidate): string {
  return formatOptionContractShort(candidate.strike, candidate.strategyKey === "covered_call" ? "C" : "P", candidate.dte);
}

// --- Full option chain in the Signals modal -------------------------------------------------------

/** "2026-10-16|110|C": one contract across the chain, the candidates list and the order pane. */
export function signalContractKey(contract: { expiry: string; strike: number; right: "C" | "P" }): string {
  return `${contract.expiry}|${contract.strike}|${contract.right}`;
}

export function candidateContractRight(candidate: Pick<SignalCandidate, "strategyKey">): "C" | "P" {
  return candidate.strategyKey === "covered_call" ? "C" : "P";
}

/** Expiry tab label: "Oct 16 17D". */
export function describeChainExpiryTab(expiry: { expiry: string; dte: number }): string {
  return `${formatMonthDay(expiry.expiry)} ${expiry.dte}D`;
}

export const chainCellStateExplanation = {
  candidate: "Signals candidate",
  filtered: "quoted, but left out by your Signals settings (hover for why)",
  notCaptured: "not in today's capture or refresh — quoted live when picked",
} as const;

/** Escapes server text for a Bootstrap html tooltip (DottedLabelTooltip). */
export function escapeTooltipHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// --- Roll Signals (Formula 3j, approved 2026-09-24) ---------------------------------------------

export const rollFlagLetter: Record<RollSignalFlag, string> = { near_expiry: "E", assignment_risk: "A", decayed: "D" };

export function describeRollSignalFlag(flag: RollSignalFlag, held: Pick<HeldLegScore, "dte" | "delta" | "entryPrice" | "mid">): string {
  switch (flag) {
    case "near_expiry":
      return `Held leg expires in ${held.dte ?? "?"} days: gamma and pin risk are rising.`;
    case "assignment_risk":
      return `Held leg delta ${held.delta === null ? "n/a" : held.delta.toFixed(2)}: assignment is more likely than not if held.`;
    case "decayed":
      return `Held leg has decayed to ${held.mid === null || !(held.entryPrice > 0) ? "under half" : `${Math.round((held.mid / held.entryPrice) * 100)}%`} of the ${formatCurrencyTrimmed(held.entryPrice)} credit collected.`;
  }
}

export const heldLegUnscoredReasonLabel: Record<HeldLegUnscoredReason, string> = {
  no_slice: "no fitted surface for this expiry (over 90 days out, or expiring today)",
  no_quote: "no two-sided quote for this contract yet",
  no_forecast: "no volatility forecast for this ticker",
};

export const netRollEdgeExplanation = "Net roll Edge = net Edge of the new contract (sold at the bid) − Edge of holding the current leg − friction to buy it back at the ask, in volatility points. Graded on the same cut points as a new trade.";

/** "Put $95 · 9 DTE" for a held leg. */
export function describeHeldLeg(leg: Pick<HeldLegScore, "right" | "strike" | "dte">): string {
  return `${leg.right === "C" ? "Call" : "Put"} ${formatCurrencyTrimmed(leg.strike)}${leg.dte === null ? "" : ` · ${leg.dte} DTE`}`;
}

/** "Put $95 · 9 DTE → Put $90 · 23 DTE" for a roll. */
export function describeRoll(roll: RollSignalCandidate, held: Pick<HeldLegScore, "right" | "strike" | "dte">): string {
  return `${describeHeldLeg(held)} → ${describeHeldLeg({ right: roll.replacement.strategyKey === "covered_call" ? "C" : "P", strike: roll.replacement.strike, dte: roll.replacement.dte })}`;
}

/** "COIN 177.5P 4DTE → 170P 18DTE roll upgraded Weak → Good (+5.6vp, +$262)" — the in-app toast. */
export function describeRollSignalUpgrade(notification: Extract<AppNotification, { type: "roll_signal_upgraded" }>): string {
  const right = notification.strategyKey === "covered_call" ? "C" : "P";
  const previous = gradeLabel[notification.previousGrade as SignalGrade] ?? notification.previousGrade;
  const next = gradeLabel[notification.grade as SignalGrade] ?? notification.grade;
  // heldDte is absent from payloads sent by an api deploy older than this app's.
  const held = formatOptionContractShort(notification.heldStrike, right, notification.heldDte ?? null);
  const replacement = formatOptionContractShort(notification.strike, right, notification.dte);
  return `${notification.symbol} ${held} → ${replacement} roll upgraded ${previous} → ${next} (${formatVolatilityPoints(notification.netRollEdge)}, ${formatSignedPnl(notification.netRollEdgeDollars, 0)})`;
}

/** "HOOD 120P 3DTE, Δ −0.53" — the assignment-risk toast and Pulse's Latest Events. */
export function describeAssignmentRisk(notification: Extract<AppNotification, { type: "assignment_risk" }>): string {
  const signedDelta = `${notification.delta < 0 ? "−" : ""}${Math.abs(notification.delta).toFixed(2)}`;
  return `${notification.symbol} ${formatOptionContractShort(notification.strike, notification.right, notification.dte)}, Δ ${signedDelta}`;
}

/** Column explanations, shown as header tooltips and in the mobile cards. */
export const signalsColumnExplanation = {
  price: "Live stock price (same source as the Positions table).",
  day: "Change versus the previous session's close.",
  best: "The candidate contract with the highest Edge $ across every expiry and strike on the out-of-the-money side.",
  yield: "Annualised yield of the Top Signal contract: mid premium / capital at risk, annualised to a 365-day year.",
  grade: gradeExplanation,
  netEdge: "Net Edge = implied volatility at the strike (fitted surface) minus the forecast volatility minus friction (half-spread and commission), in volatility points.",
  edgeDollars: "Net Edge x vega x 100: the excess premium in dollars per contract.",
  atmIv: "At-the-money implied volatility from the fitted surface, expiry nearest 30 days. Coloured green when it's above FV (forecast), red when below.",
  forecast: "Forecast realized volatility: trailing 63-day Yang-Zhang (21-day when 63 is unavailable).",
  momentum: "Trailing 12-month return skipping the most recent month (12-1 momentum).",
  volFlag: "Elevated when the 21-day / 126-day volatility ratio is above this ticker's own 90th percentile (or a fixed 1.3 until a year of history exists).",
  earnings: "Next earnings date on record.",
  notAccountedFor: "Measures the ranking does not use yet, what each is waiting on, and when it should be ready.",
  roll: "Open short legs on this ticker with a credit roll graded above Avoid; the colour is the best roll's grade. Click to review it.",
  quotes: "What the best opportunity's numbers are based on: a live IBKR line, a Day Signals quote (age shown), or still the 9:30 ET snapshot quote.",
} as const;

/**
 * Support/resistance line for the Technicals card. With no qualifying zone the backend falls back to the
 * lowest low / highest high of its hourly window (touches 0, quality 0) — named as that, not as a zero-quality level.
 */
export function describeSupportResistanceLevel(side: "support" | "resistance", level: { touches: number; qualityPct: number }): { label: string; detail: string } {
  if (level.touches === 0) {
    return side === "support" ? { label: "Recent low", detail: "no clear support level" } : { label: "Recent high", detail: "no clear resistance level" };
  }
  return { label: side === "support" ? "Support" : "Resistance", detail: `${level.touches} touches, ${level.qualityPct.toFixed(1)}% quality` };
}
