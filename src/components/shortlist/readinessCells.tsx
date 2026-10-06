import type { ShortlistRow } from "../../api/shortlist";
import { useTooltip } from "../../hooks/useTooltip";
import { daysToExpiry, formatBarsAsYears, formatDate, formatDaysToExpiry, ibkrExpiryToIsoDate } from "../../lib/formatters";
import { DottedLabelTooltip } from "../HelpTooltip";
import { WarningTriangle } from "./WarningTriangle";

// The data-readiness cells (redesigned 2026-09-23): exactly what the Signals pipeline reads before it can score a
// candidate, with a warning triangle wherever something is short. Shared by the Shortlist tab and the Pluto screen's
// Tickers tab, so both show the same figures and the same warnings.

// Mirrors the API repo's signalsRoadmap.ts constants (separate repos, no shared module) -- how much daily-bar
// history Signals needs before momentum/the own-volatility threshold turn on, and how many earnings quarters
// before the vol forecast can correct for them. Keep in sync if those change.
export const tradingDaysForMomentum = 253;
export const tradingDaysForOwnVolatilityThreshold = 377;
export const quartersForEarningsAdjustment = 4;

export function DailyBarsCell({ row }: { row: ShortlistRow }) {
  const reasons: string[] = [];
  if (row.suspectedSplitDateIso) {
    reasons.push(`Suspected stock split on ${row.suspectedSplitDateIso} — stored prices jump the way a split does, so the volatility forecast refuses to use them and this ticker isn't scored.`);
  }
  if (row.dailyBarCount < tradingDaysForMomentum) {
    reasons.push(`Only ${row.dailyBarCount} daily bars — momentum needs ${tradingDaysForMomentum}, currently unavailable.`);
  } else if (row.dailyBarCount < tradingDaysForOwnVolatilityThreshold) {
    reasons.push(`Only ${row.dailyBarCount} daily bars — the own-volatility threshold needs ${tradingDaysForOwnVolatilityThreshold}, so it stays on the fixed 1.3x default until then.`);
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

export function EarningsCell({ row }: { row: ShortlistRow }) {
  if (row.isEtf) return <span className="text-muted small">N/A — ETF</span>;
  const thin = row.earningsCount < quartersForEarningsAdjustment;
  const nextInDays = row.nextEarningsDateIso ? formatDaysToExpiry(daysToExpiry(row.nextEarningsDateIso)) : null;
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {thin && <WarningTriangle reason={`Only ${row.earningsCount} quarter${row.earningsCount === 1 ? "" : "s"} on record; the vol forecast can't correct for earnings until ${quartersForEarningsAdjustment}. Fix: Actions → Backfill Earnings.`} />}
      {row.earningsCount}
      {nextInDays && <span className="text-muted small">({nextInDays})</span>}
    </span>
  );
}

export function DividendCell({ row }: { row: ShortlistRow }) {
  if (row.dividendHistoryCount === 0) return <span className="text-muted">—</span>;
  if (row.dividendCadenceUnknown) {
    return (
      <span className="d-inline-flex align-items-center gap-1">
        <WarningTriangle reason="There's an upcoming ex-dividend but no regular cadence could be inferred from the dates on record, so only that next date is used — later dividends aren't projected forward. Not fixable by backfilling: cadence inference only ever needs the next + most recent ex-dividend, which are already captured — this means the actual cadence is irregular, or this is a first-time payer." />
        Missing
      </span>
    );
  }
  return <>Known</>;
}

export function SnapshotsCell({ row }: { row: ShortlistRow }) {
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {row.chainSnapshotCount === 0 && <WarningTriangle reason="No option-chain snapshot yet, so no surface fit and no Signals score. Not manually backfillable — waits for tonight's nightly capture." />}
      {row.chainSnapshotCount}
    </span>
  );
}

export function OptionChainExpiriesCell({ expiries }: { expiries: ShortlistRow["optionChainExpiries"] }) {
  if (expiries.length === 0) {
    return (
      <span className="d-inline-flex align-items-center gap-1">
        <WarningTriangle reason="No option-chain expiries captured yet — waits for tonight's nightly capture, or Actions → Populate Option Chain." />
        0
      </span>
    );
  }
  const tooltipHtml = expiries.map((entry) => `${formatDate(ibkrExpiryToIsoDate(entry.expiry))}: ${entry.strikeCount} strikes`).join("<br>");
  return <DottedLabelTooltip label={String(expiries.length)} tooltipHtml={tooltipHtml} className="option-chain-expiries-count" />;
}

/** Fitted/total expiries; the figure opens the volatility surface. `linkClassName` lets a host restyle the link (the Pluto screen uses its own). */
export function SurfaceFitCell({ row, onOpenSurface, linkClassName = "btn btn-link p-0 text-decoration-none font-mono" }: { row: ShortlistRow; onOpenSurface: () => void; linkClassName?: string }) {
  if (row.latestTotalSliceCount === null) return <span className="text-muted">—</span>;
  const partial = (row.latestFittedSliceCount ?? 0) < row.latestTotalSliceCount;
  return (
    <span className="d-inline-flex align-items-center gap-1">
      {partial && <WarningTriangle reason={`Only ${row.latestFittedSliceCount}/${row.latestTotalSliceCount} expiries fitted on the most recent snapshot — the rest have no usable candidates tonight.`} />}
      <button type="button" className={linkClassName} onClick={onOpenSurface} title={`Open the ${row.symbol} volatility surface`}>
        {row.latestFittedSliceCount}/{row.latestTotalSliceCount}
      </button>
    </span>
  );
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
