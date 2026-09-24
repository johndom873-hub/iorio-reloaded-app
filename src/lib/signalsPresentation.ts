import type { AppNotification } from "../api/notifications";
import type { DayQuotesFrameStatus, RoadmapStatus, SignalCandidate, SignalFlag, SignalGrade, SignalQuoteSource, SignalsPriceSource, SignalsUnscoredReason } from "../api/signals";
import { formatCurrencyTrimmed, formatDate, formatLocalTime, formatShortAge, formatSignedPnl, formatVolatilityPoints } from "./formatters";

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

export const priceSourceLabel: Record<SignalsPriceSource, string> = {
  live: "Live price",
  frozen: "Last known price (pre-live)",
  snapshot: "10:00 ET snapshot price",
};

export const quoteSourceLabel: Record<SignalQuoteSource, string> = {
  live: "Live IBKR quote",
  day: "Day Signals quote — refreshed by the intraday loop every few minutes",
  snapshot: "10:00 ET snapshot quote — this contract is not in today's refresh pool",
};

/** Age range text for a set of day quotes: "1m–6m old", "now–2m old", or null. */
export function describeQuoteAgeRange(asOf: { oldest: string; newest: string } | null | undefined, now: Date = new Date()): string | null {
  if (!asOf) return null;
  const newest = formatShortAge(asOf.newest, now);
  const oldest = formatShortAge(asOf.oldest, now);
  if (!newest || !oldest) return null;
  return newest === oldest ? `${newest} old` : `${newest}–${oldest} old`;
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
  if (loop.reason.startsWith("waiting for today's pool")) return { label: "Day quotes idle · waiting for the 10:00 ET capture", tone: "text-secondary", pulse: false };
  return { label: `Day quotes idle · ${loop.reason}`, tone: "iorio-note-amber", pulse: false };
}

/** "AAOI Put $95 · Oct 17 upgraded Weak → Good (+6.3vp, +$142)" — Pulse's Latest Events and the in-app toast. */
export function describeSignalUpgrade(notification: Extract<AppNotification, { type: "signal_upgraded" }>): string {
  const contract = `${notification.strategyKey === "covered_call" ? "Call" : "Put"} ${formatCurrencyTrimmed(notification.strike)} · ${formatDate(notification.expiry)}`;
  const previous = gradeLabel[notification.previousGrade as SignalGrade] ?? notification.previousGrade;
  const next = gradeLabel[notification.grade as SignalGrade] ?? notification.grade;
  return `${notification.symbol} ${contract} upgraded ${previous} → ${next} (${formatVolatilityPoints(notification.netEdge)}, ${formatSignedPnl(notification.edgeDollars, 0)})`;
}

export const roadmapStatusLabel: Record<RoadmapStatus, string> = {
  waiting_on_data: "Waiting on data",
  waiting_on_sign_off: "Waiting on your sign-off",
  waiting_on_decision: "Waiting on a decision",
  waiting_on_later_phase: "Waiting on later phases",
  waiting_on_build: "Approved, building",
};

export const roadmapStatusBadgeClass: Record<RoadmapStatus, string> = {
  waiting_on_data: "bg-azure-lt",
  waiting_on_sign_off: "bg-warning-lt",
  waiting_on_decision: "bg-danger-lt",
  waiting_on_later_phase: "bg-secondary-lt",
  waiting_on_build: "bg-teal-lt",
};

export const signalFlagLetter: Record<SignalFlag, string> = { earnings_calendar_unresolved: "?", outside_fitted_range: "X", wide_spread: "W", insufficient_cash: "$" };
export const signalFlagExplanation: Record<SignalFlag, string> = {
  earnings_calendar_unresolved: "Earnings calendar not resolved for this ticker — trade could span an undetected report date",
  outside_fitted_range: "Strike is outside the fitted curve — extrapolated",
  wide_spread: "Spread wider than 50% of the mid",
  insufficient_cash: "Not enough free cash to secure this put",
};

/** "Put $106 · Oct 23, 2026" */
export function describeCandidate(candidate: SignalCandidate): string {
  return `${candidate.strategyKey === "covered_call" ? "Call" : "Put"} ${formatCurrencyTrimmed(candidate.strike)} · ${formatDate(candidate.expiry)}`;
}

/** Column explanations, shown as header tooltips and in the mobile cards. */
export const signalsColumnExplanation = {
  price: "Live stock price (same source as the Positions table).",
  day: "Change versus the previous session's close.",
  best: "The candidate contract with the highest Edge $ across every expiry and strike on the out-of-the-money side.",
  grade: gradeExplanation,
  netEdge: "Net Edge = implied volatility at the strike (fitted surface) minus the forecast volatility minus friction (half-spread and commission), in volatility points.",
  edgeDollars: "Net Edge x vega x 100: the excess premium in dollars per contract.",
  atmIv: "At-the-money implied volatility from the fitted surface, expiry nearest 30 days.",
  forecast: "Forecast realized volatility: trailing 63-day Yang-Zhang (21-day when 63 is unavailable).",
  momentum: "Trailing 12-month return skipping the most recent month (12-1 momentum).",
  volFlag: "Elevated when the 21-day / 126-day volatility ratio is above this ticker's own 90th percentile (or a fixed 1.3 until a year of history exists).",
  earnings: "Next earnings date on record.",
  surface: "Fitted expiries / expiries captured in the 10:00 ET snapshot.",
  notAccountedFor: "Measures the ranking does not use yet, what each is waiting on, and when it should be ready.",
  quotes: "What the best opportunity's numbers are based on: a live IBKR line, a Day Signals quote (age shown), or still the 10:00 ET snapshot quote.",
} as const;
