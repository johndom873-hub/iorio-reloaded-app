import { useState } from "react";
import type { AnalysisBook } from "../../api/pnlAnalysis";
import { usePnlAnalysis } from "../../hooks/usePnlAnalysis";
import { formatDayMonth } from "../../lib/formatters";
import { bookChoiceLabels, sinceInceptionPeriod, type AnalysisPeriod } from "../../lib/pnlAnalysisPresentation";
import { BookTag } from "../books/BookTag";
import { CollapsibleCard } from "../CollapsibleCard";
import { Spinner } from "../Spinner";
import { AnalysisPeriodPicker } from "./AnalysisPeriodPicker";
import { BookComparisonTable } from "./BookComparisonTable";
import { BookGrowthCharts } from "./BookGrowthCharts";
import { PnlAttributionTab } from "./PnlAttributionTab";
import { PnlOverTimeTab } from "./PnlOverTimeTab";
import { PnlTickerTab } from "./PnlTickerTab";

type AnalyserTab = "overview" | "attribution" | "tickers" | "time";
const tabs: [AnalyserTab, string][] = [["overview", "Overview"], ["attribution", "Attribution"], ["tickers", "By ticker"], ["time", "Over time"]];

// The Positions page's Profit & Loss card (mockup approved by Marcelo 2026-11-13,
// https://claude.ai/artifact/6ZZiYtrzrhgvS1Z3UFEFXT): every book's returns and risk side by side, where the P&L came from,
// each ticker with its cycles, and the P&L over time. As of last night's close; the page's book switch picks the book of the
// Attribution, By ticker and Over time tabs, while Overview always compares all three.
export function PnlAnalyserCard({ book }: { book: AnalysisBook }) {
  const [period, setPeriod] = useState<AnalysisPeriod>(sinceInceptionPeriod);
  const [tab, setTab] = useState<AnalyserTab>("overview");
  const { analysis, loading, error } = usePnlAnalysis(period.days);
  const notesBeyondTheBook = analysis && book !== "all" ? <BookTag label={`${bookChoiceLabels[book]} book`} /> : null;
  const asOf = analysis?.lastNight ? <span className="text-secondary fw-normal" style={{ fontSize: "0.8rem" }}>as of the {formatDayMonth(analysis.lastNight)} close</span> : null;

  return (
    <CollapsibleCard
      className="mt-3 mb-3 pnl-card"
      title="Profit & Loss"
      subtitle={
        <>
          {notesBeyondTheBook}
          {asOf}
        </>
      }
      storageKey="positions-pnl-analyser"
      defaultOpen={false}
      headerActions={<AnalysisPeriodPicker period={period} onChange={setPeriod} />}
    >
      <ul className="nav nav-tabs pnl-analyser-tabs mb-3" role="tablist">
        {tabs.map(([key, label]) => (
          <li key={key} className="nav-item" role="presentation">
            <button type="button" role="tab" aria-selected={tab === key} className={`nav-link${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && (
        <div className="d-flex justify-content-center py-3">
          <Spinner label="Loading the P&L figures" />
        </div>
      )}
      {!loading && analysis && analysis.range === null && <div className="text-secondary">No nights in this period yet.</div>}
      {!loading && analysis && analysis.range !== null && (
        <>
          {tab === "overview" && (
            <div className="row g-4">
              <div className="col-12 col-xl-5">
                <BookComparisonTable analysis={analysis} variant="full" title={`Since the ${formatDayMonth(analysis.range.baselineNight)} close`} />
                <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
                  Pluto and Manual start at the books' first night ({analysis.booksFirstNight ? formatDayMonth(analysis.booksFirstNight) : "—"}) when the period begins earlier. Returns are time-weighted, net of deposits and moves between books. Sharpe, Sortino and Excess Calmar use the 3-month T-bill
                  {analysis.books.all.risk?.treasuryBillPercent != null ? ` (${analysis.books.all.risk.treasuryBillPercent.toFixed(2)}% over the period)` : ""}. Trade figures count closed short options; an assigned put is charged for its assignment.
                </div>
              </div>
              <div className="col-12 col-xl-7">
                <BookGrowthCharts analysis={analysis} />
              </div>
            </div>
          )}
          {tab === "attribution" && <PnlAttributionTab analysis={analysis} book={book} />}
          {tab === "tickers" && <PnlTickerTab analysis={analysis} book={book} days={period.days} />}
          {tab === "time" && <PnlOverTimeTab analysis={analysis} book={book} />}
          {analysis.books[book].missingAttributionNights.length > 0 && (
            <div className="alert alert-warning mt-3 mb-0">
              The strategies of {analysis.books[book].missingAttributionNights.length} night(s) are not computed yet ({analysis.books[book].missingAttributionNights.map(formatDayMonth).join(", ")}), so those nights are left out of the strategy figures until the nightly job fills them.
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
