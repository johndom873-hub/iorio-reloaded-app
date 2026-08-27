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
  if (status === "success" && jobRunHasProblems(details)) return "success — issues found";
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
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
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
