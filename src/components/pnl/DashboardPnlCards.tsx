import { useState, type ReactNode } from "react";
import type { AnalysisBook } from "../../api/pnlAnalysis";
import { usePnlAnalysis } from "../../hooks/usePnlAnalysis";
import { asShownDollars, formatSignedPnl, pnlTextClass, todayInEasternIso } from "../../lib/formatters";
import { analysisDaysForPreset, bookChoiceLabels, periodPnlRows, sumComponents, waterfallSteps, type OverTimeGranularity } from "../../lib/pnlAnalysisPresentation";
import { BookTag } from "../books/BookTag";
import { CollapsibleCard } from "../CollapsibleCard";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { PnlOverTimeChart } from "./PnlOverTimeChart";
import { PnlWaterfallChart } from "./PnlWaterfallChart";

// The Dashboard's P&L cards on the P&L Analyser's figures (mockup approved by Marcelo 2026-11-13), so they match the
// Positions card to the dollar: P&L by Period, the YTD waterfall (replacing P&L by Strategy (YTD)) and P&L by strategy over
// time (replacing P&L Over Time). All three read the since-inception range, one request shared with the Performance card.

const sinceInception = { from: null, to: null };

function bookTagFor(book: AnalysisBook): ReactNode {
  return book === "all" ? undefined : <BookTag label={`${bookChoiceLabels[book]} book`} />;
}

function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <div className="alert alert-danger mb-0">{error}</div>;
  if (loading) return <Spinner size="sm" label="Loading P&L" />;
  return null;
}

const periodRowLabels = {
  cash: ["Cash & other", "Interest, dividends, fees and their taxes"],
  ibkrValuation: ["IBKR valuation", "The account's P&L less Pluto's and Manual's: IBKR's own marks and accrued interest against the books' snapshot prices"],
  unexplained: ["Unexplained", "The book's P&L less everything above"],
} as const;

export function PnlByPeriodCard({ book }: { book: AnalysisBook }) {
  const { analysis, loading, error } = usePnlAnalysis(sinceInception);
  const nights = analysis?.books[book].nights ?? [];
  const periods = analysis?.lastNight ? periodPnlRows(nights, analysis.lastNight) : null;
  return (
    <CollapsibleCard title="P&L by Period" subtitle={bookTagFor(book)} storageKey="pnl-by-period" className="pnl-card">
      <LoadState loading={loading} error={error} />
      {!loading && periods && (
        <div className="table-responsive table-flush">
          <table className="table table-sm table-vcenter card-table mb-0">
            <thead className="table-light">
              <tr>
                <th>Strategy</th>
                {["Day", "WTD", "MTD", "YTD"].map((label) => (
                  <th key={label} className="text-end">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    {row.key === "cash" || row.key === "ibkrValuation" || row.key === "unexplained" ? (
                      <TooltipSpan text={periodRowLabels[row.key][1]} className="dotted-underline-label">{periodRowLabels[row.key][0]}</TooltipSpan>
                    ) : (
                      <CycleBucketBadge bucket={row.key} />
                    )}
                  </td>
                  {row.values.map((value, index) => (
                    <td key={index} className={`text-end font-mono ${pnlTextClass(asShownDollars(value))}`}>{formatSignedPnl(asShownDollars(value), 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="table-totals-row">
              <tr>
                <td>Total</td>
                {periods.totals.map((value, index) => (
                  <td key={index} className={`text-end font-mono ${pnlTextClass(asShownDollars(value))}`}>{formatSignedPnl(asShownDollars(value), 0)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </CollapsibleCard>
  );
}

export function YtdComponentsCard({ book }: { book: AnalysisBook }) {
  const { analysis, loading, error } = usePnlAnalysis(analysisDaysForPreset("ytd", todayInEasternIso()));
  const nights = analysis?.books[book].nights ?? [];
  const components = sumComponents(nights);
  return (
    <CollapsibleCard title="YTD P&L by component" subtitle={bookTagFor(book)} storageKey="pnl-by-strategy" className="pnl-card">
      <LoadState loading={loading} error={error} />
      {!loading && analysis && (nights.length === 0 ? <div className="text-secondary">No nights this year yet.</div> : <PnlWaterfallChart steps={waterfallSteps(components)} total={components.bookPnl} orientation="horizontal" />)}
      {!loading && analysis && nights.length > 0 && <div className="text-secondary" style={{ fontSize: "0.72rem" }}>Green adds, red takes away; the last bar is the book's P&amp;L.</div>}
    </CollapsibleCard>
  );
}

export function StrategyOverTimeCard({ book }: { book: AnalysisBook }) {
  const [granularity, setGranularity] = useState<OverTimeGranularity>("week");
  const { analysis, loading, error } = usePnlAnalysis(sinceInception);
  return (
    <CollapsibleCard
      title="P&L by strategy over time"
      subtitle={bookTagFor(book)}
      storageKey="pnl-over-time"
      className="mb-3 pnl-card"
      headerActions={
        <div className="btn-group" role="group" aria-label="Bars per">
          {(
            [
              ["day", "Day"],
              ["week", "Week"],
              ["month", "Month"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" className={`btn btn-outline-secondary${granularity === value ? " active" : ""}`} aria-pressed={granularity === value} onClick={() => setGranularity(value)}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      <LoadState loading={loading} error={error} />
      {!loading && analysis && <PnlOverTimeChart nights={analysis.books[book].nights} group="strategy" granularity={granularity} height={280} />}
      {!loading && analysis && (
        <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
          Each bar's segments add up to the line, the book's P&amp;L from its nightly value: Unexplained is a segment of its own, so a gap in the attribution shows.
        </div>
      )}
    </CollapsibleCard>
  );
}
