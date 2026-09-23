import type { RoadmapStatus, SignalCandidate, SignalFlag, SignalGrade, SignalsPriceSource, SignalsUnscoredReason } from "../api/signals";
import { formatCurrencyTrimmed, formatDate } from "./formatters";

// Labels, badge classes and short explanations for the Signals screen and
// modal (mockup approved 2026-09-22). Every label a user can see has a plain
// explanation here so the screen can show it as a tooltip.

export const gradeLabel: Record<SignalGrade, string> = { strong: "Strong", good: "Good", marginal: "Marginal", avoid: "Avoid" };

// Tabler semantic badges in the mockup's palette: green / teal / amber (dark text) / grey.
export const gradeBadgeClass: Record<SignalGrade, string> = { strong: "bg-success", good: "bg-cyan", marginal: "bg-yellow text-dark", avoid: "bg-secondary" };

export const gradeExplanation = "Grades are cut from this ticker's own live net-Edge distribution across its candidates: Strong = top 10%, Good = next 20%, Marginal = next 30%, the rest Avoid. Any contract with net Edge at or below zero is Avoid whatever its rank.";

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

export const signalFlagLetter: Record<SignalFlag, string> = { spans_earnings: "E", outside_fitted_range: "X", wide_spread: "W", no_shares: "S", insufficient_cash: "$" };
export const signalFlagExplanation: Record<SignalFlag, string> = {
  spans_earnings: "Spans earnings — flagged, not adjusted",
  outside_fitted_range: "Strike is outside the fitted curve — extrapolated",
  wide_spread: "Spread wider than 50% of the mid",
  no_shares: "No free 100 shares to cover this call",
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
} as const;
