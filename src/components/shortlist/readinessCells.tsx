import type { ShortlistRow } from "../../api/shortlist";
import { useTooltip } from "../../hooks/useTooltip";
import { daysToExpiry, formatBarsAsYears, formatDate, formatDaysToExpiry, ibkrExpiryToIsoDate } from "../../lib/formatters";
import { DottedLabelTooltip } from "../HelpTooltip";
import { WarningTriangle } from "./WarningTriangle";

// The data-readiness cells (redesigned 2026-09-23, re-based on the Volatility screen 2026-10-27): what the Volatility
// screen's figures read, with a warning triangle wherever something is short. Shared by the Shortlist tab and the Pluto
// screen's Tickers tab, so both show the same figures and the same warnings.

// Mirror the API repo's constants (separate repos, no shared module); keep in sync if those change. FV63 needs 64 daily
// bars (63 returns); IV Rank and IV %ile read a 252-day implied-volatility window (ivMetrics.ts); the 21-day forecast
// corrects for earnings once 4 quarters are on record.
export const dailyBarsForSixtyThreeDayForecast = 64;
export const impliedVolatilityWindowDays = 252;
export const quartersForEarningsAdjustment = 4;

export function DailyBarsCell({ row }: { row: ShortlistRow }) {
  const reasons: string[] = [];
  if (row.dailyBarCount < dailyBarsForSixtyThreeDayForecast) {
    reasons.push(`Only ${row.dailyBarCount} daily bars — FV63 needs ${dailyBarsForSixtyThreeDayForecast}, so it stays blank until then.`);
  }
  if (row.latestDailyBarDate !== null && row.latestDailyBarDate < row.lastCompletedSessionDate) {
    reasons.push(`Latest bar is ${row.latestDailyBarDate}, expected ${row.lastCompletedSessionDate}.`);
  }
  // dailyBarsPlan "none" means there is nothing more to fetch: a short history can also just mean the ticker
  // hasn't been trading long enough for more to exist yet (e.g. a recently-launched ETF), so the warning
  // must not point at an action that would fetch nothing new.
  const reason =
    reasons.length === 0
      ? null
      : row.dailyBarsPlan !== "none"
        ? `${reasons.join(" ")} Fix: Actions → Populate Daily Bars.`
        : `${reasons.join(" ")} Already fully populated — history starts ${row.historyStartDate ?? "unknown"}, that's everything IBKR has; nothing to do but wait for more trading days.`;
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {reason && <WarningTriangle reason={reason} />}
      {formatBarsAsYears(row.dailyBarCount)}
    </span>
  );
}

/** Days of implied-volatility history in IV Rank and IV %ile's window, warned under the full 252. */
export function ImpliedVolatilityDaysCell({ row }: { row: ShortlistRow }) {
  const short = row.ivWindowDays < impliedVolatilityWindowDays;
  const reason =
    row.ivWindowDays === 0
      ? `No implied-volatility history yet, so no IV Rank or IV %ile. ${row.dailyBarsPlan !== "none" ? "Fix: Actions → Populate Daily Bars." : "It builds up one day per session."}`
      : `Only ${row.ivWindowDays} days of implied-volatility history — IV Rank and IV %ile read a ${impliedVolatilityWindowDays}-day window, so they rest on fewer days until then.${row.dailyBarsPlan !== "none" ? " Fix: Actions → Populate Daily Bars." : ""}`;
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {short && <WarningTriangle reason={reason} />}
      {row.ivWindowDays}
    </span>
  );
}

export function EarningsCell({ row }: { row: ShortlistRow }) {
  if (row.isEtf) return <span className="text-secondary small">N/A — ETF</span>;
  const reasons: string[] = [];
  if (row.earningsCount < quartersForEarningsAdjustment) reasons.push(`Only ${row.earningsCount} quarter${row.earningsCount === 1 ? "" : "s"} on record; the 21-day forecast can't correct for earnings until ${quartersForEarningsAdjustment}. Fix: Actions → Populate Earnings.`);
  if (row.nextEarningsDateIso === null) reasons.push("No next earnings date known, so the Volatility screen can't flag a Call whose expiry falls after earnings. The calendar is captured nightly.");
  const nextInDays = row.nextEarningsDateIso ? formatDaysToExpiry(daysToExpiry(row.nextEarningsDateIso)) : null;
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {reasons.length > 0 && <WarningTriangle reason={reasons.join(" ")} />}
      {row.earningsCount}
      {nextInDays && <span className="text-secondary small">({nextInDays})</span>}
    </span>
  );
}

export function OptionChainExpiriesCell({ expiries }: { expiries: ShortlistRow["optionChainExpiries"] }) {
  if (expiries.length === 0) {
    return (
      <span className="d-inline-flex align-items-center gap-1">
        <WarningTriangle reason="No option-chain expiries stored yet — waits for the morning structure refresh (09:00 UTC), or Actions → Populate Option Chain." />
        0
      </span>
    );
  }
  const tooltipHtml = expiries.map((entry) => `${formatDate(ibkrExpiryToIsoDate(entry.expiry))}: ${entry.strikeCount} strikes`).join("<br>");
  return <DottedLabelTooltip label={String(expiries.length)} tooltipHtml={tooltipHtml} className="option-chain-expiries-count" />;
}

// Extracted so useTooltip (a hook) can be called once per row from inside
// the Status column's render(row) callback (a plain function, not a
// component) without violating the Rules of Hooks -- see FlashingNumber.tsx's
// doc comment for the same constraint.
export function PreparingStatusBadge({ progressPercent, onClick }: { progressPercent: number; onClick: () => void }) {
  const ref = useTooltip<HTMLButtonElement>("Click to see progress");
  return (
    <button ref={ref} type="button" className="badge ticker-prep-badge" onClick={onClick}>
      <span className="prep-ring" aria-hidden="true" />
      Preparing {progressPercent}%
    </button>
  );
}
