// Shared formatting helpers. Any new formatting logic anywhere in the app
// should be added here rather than inlined at the call site.
import type { OrderCancellationReason, OrderRequestStatus } from "../api/positions";
import type { JobRunStatus } from "../api/systemHealth";

// Shared between OrderReviewPanel (the live confirm/submit flow) and the
// Trade Blotter (showing every in-flight order's real IBKR state) — both
// need the exact same order_requests.status -> human label mapping. A cancel
// nobody asked for says why (cancellationReason), e.g. a DAY order's expiry.
export function orderRequestStatusLabel(status: OrderRequestStatus, cancellationReason: OrderCancellationReason | null): string {
  if (status === "cancelled" && cancellationReason) return cancelledWithoutUserLabel[cancellationReason];
  if (status === "cancelled_partially_filled" && cancellationReason === "expired_at_close") return "Expired after partly filling";
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
    case "cancelled_partially_filled":
      return "Cancelled after partly filling";
    case "rejected":
      return "Rejected by IBKR";
    case "error":
      return "Error";
  }
}

const cancelledWithoutUserLabel: Record<OrderCancellationReason, string> = {
  expired_at_close: "Expired at close",
  cancelled_by_ibkr: "Cancelled by IBKR",
  not_confirmed_in_time: "Not confirmed in time",
  not_filled_in_time: "Not filled in time",
};

/** An order that expired at the close or was never confirmed is not a failure: neutral, not red. */
export function orderRequestStatusBadgeClass(status: OrderRequestStatus, cancellationReason: OrderCancellationReason | null): string {
  if (status === "cancelled" && (cancellationReason === "expired_at_close" || cancellationReason === "not_confirmed_in_time" || cancellationReason === "not_filled_in_time")) return "bg-secondary-lt";
  if (status === "filled") return "bg-success-lt";
  if (status === "rejected" || status === "error" || status === "cancelled") return "bg-danger-lt";
  if (status === "cancelled_partially_filled") return "bg-warning-lt";
  return "bg-azure-lt";
}

/** "Open" / "Roll" / "Close" for an order_requests.request_type (open_covered_call, open_cash_secured_put, roll_leg, close_position). */
export function orderRequestTypeLabel(requestType: string): string {
  if (requestType === "roll_leg") return "Roll";
  if (requestType === "close_position") return "Close";
  return "Open";
}

export function orderRequestTypeBadgeClass(requestType: string): string {
  if (requestType === "roll_leg") return "bg-yellow-lt";
  if (requestType === "close_position") return "bg-secondary-lt";
  return "bg-azure-lt";
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
  if (status === "success" && jobRunHasProblems(details)) return "bg-warning-lt";
  if (status === "success") return "bg-success-lt";
  if (status === "failure") return "bg-danger-lt";
  return "bg-azure-lt";
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

// "$18.2k" style — for Iorio Pulse's Positions and Top Signals panels, whose
// fixed 292px column width can't fit a full formatCurrency figure alongside
// the other columns in the same row. Not used anywhere space isn't this tight.
export function formatCompactDollars(amountInDollars: number | null | undefined): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  if (Number.isNaN(amountInDollars)) return "—";
  const abs = Math.abs(amountInDollars);
  const sign = amountInDollars < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** "$64.7k" / "$500k" / "$1.2M" — compact dollars with a trailing ".0" dropped, for the Pluto status figures. */
export function formatCompactDollarsTrimmed(amountInDollars: number | null | undefined): string {
  if (amountInDollars === null || amountInDollars === undefined || Number.isNaN(amountInDollars)) return "—";
  const abs = Math.abs(amountInDollars);
  const sign = amountInDollars < 0 ? "−" : "";
  const trimmed = (value: number) => value.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${sign}$${trimmed(abs / 1_000_000)}M`;
  if (abs >= 1000) return `${sign}$${trimmed(abs / 1000)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** "4 h 10 min" / "25 min" — the time until an instant, in words; "0 min" once it has passed. */
/** Seconds left when the target is under a minute away, else null: countdowns switch to seconds for their last minute. */
function secondsLeftInLastMinute(targetIso: string, now: Date): number | null {
  const secondsLeft = Math.max(0, Math.ceil((new Date(targetIso).getTime() - now.getTime()) / 1000));
  return secondsLeft < 60 ? secondsLeft : null;
}

export function formatHoursMinutesUntil(targetIso: string, now: Date = new Date()): string {
  const seconds = secondsLeftInLastMinute(targetIso, now);
  if (seconds !== null) return `${seconds} s`;
  const totalMinutes = Math.max(0, Math.round((new Date(targetIso).getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
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

// IBKR returns option expiries as "YYYYMMDD" (e.g. an order leg's expiry); the
// rest of the app stores/sends dates as ISO "YYYY-MM-DD".
export function ibkrExpiryToIsoDate(expiryYyyymmdd: string): string {
  return `${expiryYyyymmdd.slice(0, 4)}-${expiryYyyymmdd.slice(4, 6)}-${expiryYyyymmdd.slice(6, 8)}`;
}

const plainIsoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  // A plain "YYYY-MM-DD" (no time/offset) names a calendar date, not an
  // instant — `new Date("2026-09-08")` parses it as UTC midnight, which
  // Intl.DateTimeFormat then renders in the browser's local zone, landing
  // on the day before in any zone behind UTC (found 2026-09-08: a snapshot
  // dated 2026-09-08 in the DB displayed as "Sep 7" in the UI). Parsing via
  // the Date(year, month, day) constructor instead builds local midnight
  // for that same calendar date, so formatting it locally can't shift days.
  // Anything else (a real timestamp, or already a Date) keeps the old
  // instant-based parsing — correct there, since it's a real point in time.
  if (typeof dateInput === "string" && plainIsoDatePattern.test(dateInput)) {
    const [year, month, day] = dateInput.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
  }
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

// Today's calendar date in US/Eastern, as "YYYY-MM-DD" — the timezone
// option expiries are actually defined in, regardless of the viewer's own
// timezone. Used to anchor the Expiry column's "expired"/"today"/"tomorrow"
// label (see formatDaysToExpiry) so a position expiring today doesn't flip
// to "expired" hours early just because the viewer is ahead of US market
// time (found 2026-09-09: daysToExpiry's default asOf is local wall-clock
// time diffed against expiryIsoDate parsed as UTC midnight, so a viewer in
// WITA, UTC+8, sees "expired" for a same-US-trading-day expiry well before
// the market has even closed).
export function todayInEasternIso(): string {
  return easternIsoDate(new Date());
}

/** The US/Eastern calendar date ("YYYY-MM-DD") an instant falls on, regardless of the viewer's timezone. */
export function easternIsoDate(dateInput: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof dateInput === "string" ? new Date(dateInput) : dateInput);
}

/** Minutes since midnight on the US/Eastern clock for an instant, e.g. 10:06 ET = 606, regardless of the viewer's timezone. */
export function easternMinutesOfDay(isoTimestamp: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoTimestamp));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

/** Clock time in US/Eastern (market time) regardless of the viewer's timezone, e.g. "09:31 ET". */
export function formatEasternTime(isoTimestamp: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(isoTimestamp));
  return `${time} ET`;
}

/** Clock time in the viewer's own timezone, in the browser locale's own 12- or 24-hour style, e.g. "8:23 PM" or "20:23". */
export function formatBrowserClockTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** Clock time to the second in the viewer's own timezone and locale style, e.g. "8:23:05 PM" or "20:23:05". */
export function formatBrowserClockTimeWithSeconds(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}

/** Date and time in the viewer's own timezone and locale style, with the zone named, e.g. "Oct 6, 2026, 8:23 PM GMT+8". */
export function formatBrowserDateTimeWithZone(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

/** Whether the browser's locale writes clock times with AM/PM (wider than a 24-hour "20:23"). */
export function browserUsesTwelveHourClock(): boolean {
  const hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return hourCycle === "h11" || hourCycle === "h12";
}

/** The viewer's own calendar date ("YYYY-MM-DD") an instant falls on. */
export function browserLocalIsoDate(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The viewer's own calendar day an instant falls on, as a short day and month: "Oct 6". */
export function formatBrowserDayMonth(dateInput: string | Date): string {
  return formatDayMonth(browserLocalIsoDate(dateInput));
}

/** When a snapshot was captured, as short as the day allows: the Eastern clock time ("10:03 ET") if it was today, else the Eastern date ("Sep 30"). */
export function formatSnapshotStamp(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—";
  const capturedDate = easternIsoDate(isoTimestamp);
  return capturedDate === todayInEasternIso() ? formatEasternTime(isoTimestamp) : formatMonthDay(capturedDate);
}

// Platform-wide convention (approved 2026-08-28): every plain expiry date
// shown anywhere always carries its DTE alongside it, so "when does this
// expire" and "how soon" are never split across a hover/lookup. Takes an
// ISO "YYYY-MM-DD" date — callers holding IBKR's "YYYYMMDD" format convert
// via ibkrExpiryToIsoDate first. Not used where a relative label
// ("in 7d") already stands in for the date itself (e.g. Positions'
// Expiry column) — the DTE would just repeat what "in 7d" already says.
// asOf defaults to now; pass it for a historical DTE (see daysToExpiry).
/** A plain "YYYY-MM-DD" as a short month and day, no year: "Oct 2". Same local-date parsing as formatDate. */
export function formatMonthDay(dateIso: string): string {
  if (!plainIsoDatePattern.test(dateIso)) return "—";
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

/** A plain "YYYY-MM-DD" as day then short month, no year: "17 Oct" (the Pluto screen's contract and audit dates). */
export function formatDayMonth(dateIso: string): string {
  if (!plainIsoDatePattern.test(dateIso)) return "—";
  const [year, month, day] = dateIso.split("-").map(Number);
  return `${day} ${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, month - 1, day))}`;
}

/** A plain "YYYY-MM-DD" as day, short month and year: "7 Oct 2026". */
export function formatDayMonthYear(dateIso: string): string {
  if (!plainIsoDatePattern.test(dateIso)) return "—";
  return `${formatDayMonth(dateIso)} ${dateIso.slice(0, 4)}`;
}

export function formatExpiryWithDte(expiryIsoDate: string | null | undefined, asOf?: string | Date): string {
  if (!expiryIsoDate) return "—";
  return `${formatDate(expiryIsoDate)} (${daysToExpiry(expiryIsoDate, asOf)} DTE)`;
}

/** A strike as the contract label writes it: "$46", "$42.5". */
export function formatStrike(strike: number): string {
  return `$${Number.isInteger(strike) ? strike : strike.toFixed(2).replace(/\.?0+$/, "")}`;
}

/**
 * The platform's contract label: "SMCI $47 Call · 9 Oct (2DTE)", or "$47 Call · 9 Oct (2DTE)" without a symbol (a table
 * with its own Ticker column); DTE left out when null. Where space is tight, formatOptionContractShort ("47C 2DTE").
 */
export function formatOptionContractLabel(contract: { symbol?: string; strike: number; right: "C" | "P"; expiry: string; dte: number | null }): string {
  const symbol = contract.symbol ? `${contract.symbol} ` : "";
  return `${symbol}${formatStrike(contract.strike)} ${contract.right === "C" ? "Call" : "Put"} · ${formatDayMonth(contract.expiry)}${contract.dte === null ? "" : ` (${contract.dte}DTE)`}`;
}

/** The order size after a contract label: " · 11× @ 0.39", or " · 11×" without a price. */
export function formatOrderSize(quantity: number, price: number | null): string {
  return ` · ${quantity}×${price === null ? "" : ` @ ${price.toFixed(2)}`}`;
}

/** "114P 3DTE" / "202.5C 3DTE" — the compact contract label shared by Pulse's Trades and Latest Events and the Signals Top Signal column. */
export function formatOptionContractShort(strike: number | string, right: "C" | "P", dte: number | null): string {
  return `${formatNumber(strike, 2)}${right}${dte === null ? "" : ` ${dte}DTE`}`;
}

/** One order leg as a short line: "Buy 100 sh @ 52.30" / "Sell 1x 55C Oct 17 @ 1.20" (expiry as IBKR's YYYYMMDD). */
export function formatOrderLegDescription(leg: {
  role: "stock" | "option";
  action: string;
  quantity: number;
  unitPrice: number;
  strike: number | null;
  expiry: string | null;
  right: "C" | "P" | null;
}): string {
  const action = leg.action === "BUY" ? "Buy" : "Sell";
  const price = formatCurrency(leg.unitPrice);
  if (leg.role === "stock") return `${action} ${formatNumber(leg.quantity)} sh @ ${price}`;
  const strike = leg.strike === null ? "—" : formatCurrencyTrimmed(leg.strike);
  const expiry = leg.expiry && leg.expiry.length === 8 ? ` ${formatMonthDay(ibkrExpiryToIsoDate(leg.expiry))}` : "";
  return `${action} ${formatNumber(leg.quantity)}x ${strike}${leg.right ?? ""}${expiry} @ ${price}`;
}

// Pairs with daysToExpiry for the "(in X days)" label shown next to an
// expiry date across the app (Positions table, Order Review).
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

// A fixed daily UTC clock time (a scheduled job or restart slot) in the viewer's own browser time with its zone
// label, e.g. "13:30 GMT+8". Built on today's date, so the viewer's own daylight saving applies.
export function formatUtcClockTimeInBrowserTime(utcHour: number, utcMinute: number, now: Date = new Date()): string {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute));
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(slot);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

// 24-hour local time, e.g. "14:32:05" — matches the clock/event-log
// convention already used across Iorio Pulse (PulsePage.tsx).
export function formatLocalTime(dateInput: string | Date | number): string {
  const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  return date.toLocaleTimeString("en-US", { hour12: false });
}

// Feed timestamp (Pulse Trades / Latest Events): the HH:MM:SS clock time for
// anything under 24h old, "Xd ago" once it's a full day or more — a bare clock
// time is ambiguous for older rows, and "Xd ago" is the narrowest unambiguous label.
export function formatFeedTime(dateInput: string | Date | number): string {
  const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  const ageInDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (ageInDays >= 1) return `${ageInDays}d ago`;
  return formatLocalTime(date);
}

// 24-hour local time without seconds, e.g. "14:32" — used for chart x-axis
// tick labels, where formatLocalTime's HH:MM:SS is too dense.
export function formatHourMinute(dateInput: string | Date | number): string {
  const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

// Trading days per year, not calendar days -- matches the API's own daily_price_bars convention (one row
// per trading day). Used to turn a raw bar count into a human "how much history" figure (Shortlist).
const tradingDaysPerYear = 252;

/** "1 position" / "3 positions"; pass `plural` for irregular nouns. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatBarsAsYears(dailyBarCount: number): string {
  return `${(dailyBarCount / tradingDaysPerYear).toFixed(1)}y`;
}

/** A number as the text of an editable input: up to decimalPlaces decimals, no trailing zeros, no thousands separators (2.5 stays "2.5", 20 stays "20"). */
export function formatInputNumber(value: number, decimalPlaces = 2): string {
  return String(Number(value.toFixed(decimalPlaces)));
}

export function formatNumber(value: number | string | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined) return "—";
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numericValue)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(numericValue);
}

// Compact "k"/"M" volume-style formatting, capped at 3 significant digits
// (1234 -> "1.23k", 123456 -> "123k", 1234567 -> "1.23M"). Below 1000, the
// value is shown as-is. Only two magnitudes since callers are share-volume
// figures, which don't reach billions (Marcelo, 2026-09-09).
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  if (absValue < 1000) return `${sign}${Math.round(absValue)}`;

  const units: { threshold: number; suffix: string }[] = [
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "k" },
  ];
  for (let i = 0; i < units.length; i++) {
    const { threshold, suffix } = units[i];
    if (absValue < threshold) continue;
    const scaled = absValue / threshold;
    const integerDigits = Math.floor(scaled).toString().length;
    const decimalPlaces = Math.max(0, 3 - integerDigits);
    const rounded = Number(scaled.toFixed(decimalPlaces));
    // Rounding can carry the value into the next unit's range (e.g. 999.5k -> "1000k")
    if (rounded >= 1000 && i > 0) {
      const bumped = units[i - 1];
      return `${sign}${(absValue / bumped.threshold).toFixed(2)}${bumped.suffix}`;
    }
    return `${sign}${rounded.toFixed(decimalPlaces)}${suffix}`;
  }
  return `${sign}${Math.round(absValue)}`;
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

/** "12s ago", "5m ago", "3h ago", "2d ago" -- the age of a timestamp, counting seconds under a minute. Pass `now` from a ticking clock to keep it current; "—" when unknown or invalid. */
export function formatRelativeAge(dateInput: string | Date | null | undefined, now: Date = new Date()): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "—";
  // A client clock slightly behind the server's would otherwise show a negative age for a brand-new timestamp.
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.floor(ageHours / 24)}d ago`;
}

/** Compact age for a value shown next to a quote: "now", "3m", "1h 05m"; null when unknown, invalid or in the future. */
export function formatShortAge(dateInput: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!dateInput) return null;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return null;
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const hours = Math.floor(diffMinutes / 60);
  return `${hours}h ${String(diffMinutes % 60).padStart(2, "0")}m`;
}

/** Like formatShortAge but counts seconds under a minute: "12s", "3m", "1h 05m"; null when unknown, invalid or in the future. */
export function formatShortAgeWithSeconds(dateInput: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!dateInput) return null;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return null;
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s`;
  return formatShortAge(date, now);
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

/** Time left until `targetIso` as "2d 14h", "6h 12m" or "14m" (the top-bar market countdown). Minute resolution, never negative. */
export function formatCountdownUntil(targetIso: string, now: Date = new Date()): string {
  const seconds = secondsLeftInLastMinute(targetIso, now);
  if (seconds !== null) return `${seconds}s`;
  const totalMinutes = Math.max(0, Math.round((new Date(targetIso).getTime() - now.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function formatSignedPnl(amountInDollars: number | null | undefined, decimalPlaces = 2): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  if (Number.isNaN(amountInDollars)) return "—";
  const formatted = formatCurrency(Math.abs(amountInDollars), decimalPlaces);
  if (amountInDollars > 0) return `+${formatted}`;
  if (amountInDollars < 0) return `-${formatted}`;
  return formatted;
}

// An option quote (bid/ask/mid) as it appears in a chain: always two decimals, no currency symbol.
export function formatQuotePrice(priceOrNull: number | null | undefined): string {
  if (priceOrNull === null || priceOrNull === undefined || Number.isNaN(priceOrNull)) return "—";
  return priceOrNull.toFixed(2);
}

// Volatility points ("vp"): a difference between two annualized volatilities
// given as fractions (0.061 -> "+6.1 vp"), the Signals screen's net Edge unit.
export function formatVolatilityPoints(fractionOrNull: number | null | undefined, decimalPlaces = 1): string {
  if (fractionOrNull === null || fractionOrNull === undefined) return "—";
  if (Number.isNaN(fractionOrNull)) return "—";
  const points = fractionOrNull * 100;
  const formatted = `${Math.abs(points).toFixed(decimalPlaces)} vp`;
  if (points > 0) return `+${formatted}`;
  if (points < 0) return `-${formatted}`;
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

/** A plain number with its sign: "+0.23", "-0.33", "0.00" (sigmas, skew, momentum). */
export function formatSignedNumber(valueOrNull: number | null | undefined, decimalPlaces = 2): string {
  if (valueOrNull === null || valueOrNull === undefined || Number.isNaN(valueOrNull)) return "—";
  const formatted = Math.abs(valueOrNull).toFixed(decimalPlaces);
  if (Number(formatted) === 0) return formatted;
  return `${valueOrNull > 0 ? "+" : "-"}${formatted}`;
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
