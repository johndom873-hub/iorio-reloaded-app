// Shared formatting helpers. Any new formatting logic anywhere in the app
// should be added here rather than inlined at the call site.
import type { OrderRequestStatus } from "../api/positions";
import type { JobRunStatus } from "../api/systemHealth";

// Shared between OrderReviewPanel (the live confirm/submit flow) and the
// Trade Blotter (showing every in-flight order's real IBKR state) — both
// need the exact same order_requests.status -> human label mapping.
export function orderRequestStatusLabel(status: OrderRequestStatus): string {
  switch (status) {
    case "pending_confirmation":
      return "Awaiting confirmation";
    case "confirmed":
      return "Confirmed — sending to IBKR...";
    case "submitted":
      return "Submitted to IBKR";
    case "cancel_requested":
      return "Cancelling";
    case "filled":
      return "Filled";
    case "partially_filled":
      return "Partially filled";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return "Rejected by IBKR";
    case "error":
      return "Error";
  }
}

export function orderRequestStatusBadgeClass(status: OrderRequestStatus): string {
  if (status === "filled") return "bg-success-lt text-dark";
  if (status === "rejected" || status === "error" || status === "cancelled") return "bg-danger-lt text-dark";
  return "bg-azure-lt text-dark";
}

// A job_run can report status "success" while its details still carry a
// non-empty `problems` array (e.g. the watchdog job flagging a stuck run) —
// that's a degraded run, not a clean one, and should not badge as plain green.
function jobRunHasProblems(details: Record<string, unknown> | null | undefined): boolean {
  if (!details) return false;
  const problems = (details as { problems?: unknown }).problems;
  return Array.isArray(problems) && problems.length > 0;
}

export function jobRunStatusBadgeClass(
  status: JobRunStatus,
  details?: Record<string, unknown> | null,
): string {
  if (status === "success" && jobRunHasProblems(details)) return "bg-warning-lt text-dark";
  if (status === "success") return "bg-success-lt text-dark";
  if (status === "failure") return "bg-danger-lt text-dark";
  return "bg-azure-lt text-dark";
}

export function jobRunStatusLabel(status: JobRunStatus, details?: Record<string, unknown> | null): string {
  if (status === "success" && jobRunHasProblems(details)) return "issues found";
  return status;
}

export function formatCurrency(amountInDollars: number | null | undefined, decimalPlaces = 2): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  if (Number.isNaN(amountInDollars)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(amountInDollars);
}

// Same as formatCurrency, but drops decimal places entirely when the amount
// is a whole number (e.g. option strikes, which are usually round dollars).
export function formatCurrencyTrimmed(amountInDollars: number | null | undefined, decimalPlaces = 2): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  if (Number.isNaN(amountInDollars)) return "—";
  return formatCurrency(amountInDollars, Number.isInteger(amountInDollars) ? 0 : decimalPlaces);
}

export function formatPercentage(fractionOrNull: number | null | undefined, decimalPlaces = 1): string {
  if (fractionOrNull === null || fractionOrNull === undefined) return "—";
  if (Number.isNaN(fractionOrNull)) return "—";
  return `${(fractionOrNull * 100).toFixed(decimalPlaces)}%`;
}

// For values already expressed on a 0-100 scale (e.g. IV Rank), unlike
// formatPercentage above which expects a 0-1 fraction.
export function formatPercentageValue(percentOrNull: number | null | undefined, decimalPlaces = 0): string {
  if (percentOrNull === null || percentOrNull === undefined) return "—";
  if (Number.isNaN(percentOrNull)) return "—";
  return `${percentOrNull.toFixed(decimalPlaces)}%`;
}

// IBKR returns option expiries as "YYYYMMDD" (see OptionQuote.expiry); the
// rest of the app stores/sends dates as ISO "YYYY-MM-DD".
export function ibkrExpiryToIsoDate(expiryYyyymmdd: string): string {
  return `${expiryYyyymmdd.slice(0, 4)}-${expiryYyyymmdd.slice(4, 6)}-${expiryYyyymmdd.slice(6, 8)}`;
}

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

// Whole calendar days between a reference point (default: now) and an ISO
// "YYYY-MM-DD" expiry date. Pass asOf for a historical DTE — e.g. the
// Events feed wants "how many days out was this expiry when the position
// was opened/closed", not a live countdown that goes negative once the
// expiry's in the past (found 2026-08-28: every historical leg was
// showing a stale/negative DTE relative to today instead of the DTE that
// was actually true at the time).
export function daysToExpiry(expiryIsoDate: string, asOf: string | Date = new Date()): number {
  const asOfTime = typeof asOf === "string" ? new Date(asOf).getTime() : asOf.getTime();
  return Math.round((new Date(expiryIsoDate).getTime() - asOfTime) / 86_400_000);
}

// Platform-wide convention (approved 2026-08-28): every plain expiry date
// shown anywhere always carries its DTE alongside it, so "when does this
// expire" and "how soon" are never split across a hover/lookup. Takes an
// ISO "YYYY-MM-DD" date — callers holding IBKR's "YYYYMMDD" format convert
// via ibkrExpiryToIsoDate first. Not used where a relative label
// ("in 7d") already stands in for the date itself (e.g. Positions'
// Expiry column) — the DTE would just repeat what "in 7d" already says.
// asOf defaults to now; pass it for a historical DTE (see daysToExpiry).
export function formatExpiryWithDte(expiryIsoDate: string | null | undefined, asOf?: string | Date): string {
  if (!expiryIsoDate) return "—";
  return `${formatDate(expiryIsoDate)} (${daysToExpiry(expiryIsoDate, asOf)} DTE)`;
}

// Pairs with daysToExpiry for the "(in X days)" label shown next to an
// expiry date across the app (Positions table, Order Review, Trade Alerts).
export function formatDaysToExpiry(days: number): string {
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

// Whole calendar days between an ISO "YYYY-MM-DD"/timestamp and now, for a
// date that's typically in the past (e.g. Positions' Opened column) —
// mirrors daysToExpiry but the sign convention matches how people talk
// about a past date ("2 days ago", not "-2 days").
export function daysAgo(dateInput: string | Date): number {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return Math.round((Date.now() - date.getTime()) / 86_400_000);
}

// Pairs with daysAgo for the relative label shown in place of a raw date
// (Positions table's Opened column) — the date itself moves to a hover
// tooltip instead.
export function formatDaysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// Finer-grained sibling of formatDaysAgo — "x minutes/hours ago" within the
// last 24h (via formatRelativeTime), falling back to the day-level label
// once it's a full day old or more. Pair with formatDateTime (not
// formatDate) for the hover tooltip: a "3 hours ago" label needs the exact
// time on hover, not just the calendar date.
export function formatRelativeDate(dateInput: string | Date | null | undefined): string {
  const fineGrained = formatRelativeTime(dateInput);
  if (fineGrained) return fineGrained;
  if (!dateInput) return "—";
  return formatDaysAgo(daysAgo(dateInput));
}

export function formatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number | string | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined) return "—";
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numericValue)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(numericValue);
}

// "x minutes/hours ago" for anything within the last 24h, otherwise null —
// callers pair this with formatDateTime's full timestamp rather than using
// it alone, so nothing older just silently has no relative label.
export function formatRelativeTime(dateInput: string | Date | null | undefined): string | null {
  if (!dateInput) return null;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0 || diffMs >= 24 * 60 * 60 * 1000) return null;

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
}

export function formatDuration(
  startedAt: string | Date | null | undefined,
  finishedAt: string | Date | null | undefined,
): string {
  if (!startedAt) return "—";
  if (!finishedAt) return "running…";

  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const end = typeof finishedAt === "string" ? new Date(finishedAt) : finishedAt;
  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatSignedPnl(amountInDollars: number | null | undefined, decimalPlaces = 2): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  if (Number.isNaN(amountInDollars)) return "—";
  const formatted = formatCurrency(Math.abs(amountInDollars), decimalPlaces);
  if (amountInDollars > 0) return `+${formatted}`;
  if (amountInDollars < 0) return `-${formatted}`;
  return formatted;
}

// Signed version of formatPercentageValue (0-100 scale, not a 0-1
// fraction) — e.g. a Day P&L % next to its $ figure.
export function formatSignedPercentageValue(percentOrNull: number | null | undefined, decimalPlaces = 2): string {
  if (percentOrNull === null || percentOrNull === undefined) return "—";
  if (Number.isNaN(percentOrNull)) return "—";
  const formatted = formatPercentageValue(Math.abs(percentOrNull), decimalPlaces);
  if (percentOrNull > 0) return `+${formatted}`;
  if (percentOrNull < 0) return `-${formatted}`;
  return formatted;
}

// Global UI/UX standard: badge-change-pos/neg/flat for any price/change
// value, never inline colors — see Trade Blotter/Positions P&L columns.
export function pnlBadgeClass(pnl: number): string {
  if (pnl > 0) return "badge-change-pos";
  if (pnl < 0) return "badge-change-neg";
  return "badge-change-flat";
}

// Same pos/neg/flat convention as pnlBadgeClass, for signed dollar figures
// rendered as plain text rather than a badge (e.g. Dashboard P&L, Trade
// Alerts Max Gain/Max Loss) — null/undefined gets no color, matching an
// unloaded/unknown value rather than a real zero.
export function pnlTextClass(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return "";
  if (pnl > 0) return "text-success";
  if (pnl < 0) return "text-danger";
  return "";
}
