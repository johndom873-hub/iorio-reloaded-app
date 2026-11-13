import { useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { Spinner } from "./Spinner";
import { TooltipSpan } from "./TooltipSpan";
import type { PerformanceSummary } from "../api/dashboard";
import type { AnalysisBook, BookRiskFigures, GatedFigure } from "../api/pnlAnalysis";
import { usePnlAnalysis } from "../hooks/usePnlAnalysis";
import { formatDayMonth, formatPercentageValue, formatRatio, formatSignedPercentageValue, formatSignedPnl, pnlTextClass } from "../lib/formatters";
import { bookChoiceLabels, gatedNote, sinceInceptionPeriod, type AnalysisPeriod } from "../lib/pnlAnalysisPresentation";
import { AnalysisPeriodPicker } from "./pnl/AnalysisPeriodPicker";
import { BookComparisonTable } from "./pnl/BookComparisonTable";
import { BookGrowthCharts } from "./pnl/BookGrowthCharts";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface PerformanceCardProps {
  book: AnalysisBook;
  /** The monthly grid's figures (GET /dashboard/performance for the book). */
  performance: PerformanceSummary | null;
  loading: boolean;
}

interface Headline {
  label: string;
  hint: string;
  text: string;
  className?: string;
  note: string;
}

function gatedHeadline(label: string, hint: string, figure: GatedFigure, format: (value: number) => string, noDenominatorNote?: string): Headline {
  const note = gatedNote(figure, noDenominatorNote);
  return note === null ? { label, hint, text: format(figure.value!), note: "" } : { label, hint, text: "—", className: "text-secondary", note };
}

function headlines(risk: BookRiskFigures): Headline[] {
  const drawdown = risk.maxDrawdown;
  return [
    { label: "Return", hint: "Time-weighted: the nightly returns chained", text: formatSignedPercentageValue(risk.returnPercent, 2), className: pnlTextClass(risk.returnPercent), note: formatSignedPnl(risk.pnl, 0) },
    gatedHeadline("CAGR", "(1 + Return) ^ (365 ÷ days) − 1, from 90 calendar days", risk.cagrPercent, (value) => formatSignedPercentageValue(value, 2)),
    {
      label: "Max drawdown",
      hint: "Deepest fall of the growth index below its running peak",
      text: formatSignedPercentageValue(drawdown.percent, 2),
      className: drawdown.percent < 0 ? "text-danger" : "",
      note: drawdown.percent < 0 ? `${formatSignedPnl(drawdown.dollars, 0)} · ${drawdown.recoveryNight ? `recovered ${formatDayMonth(drawdown.recoveryNight)}` : "not recovered"}` : "",
    },
    gatedHeadline("Volatility", "Standard deviation of the daily returns × √252, from 60 returns", risk.volatilityPercent, (value) => formatPercentageValue(value, 2), "flat returns"),
    gatedHeadline("Sortino", "(mean daily return − T-bill ÷ 252) × √252 ÷ downside deviation, from 60 returns", risk.sortino, (value) => formatRatio(value), "no down days"),
    gatedHeadline("Excess Calmar", "(CAGR − T-bill) ÷ |Max drawdown|, from 180 calendar days", risk.excessCalmar, (value) => formatRatio(value), "no drawdown"),
  ];
}

// The Dashboard's Performance card (mockup approved by Marcelo 2026-11-13): the book's time-weighted return and risk over a
// period, every book's growth and drawdown, Pluto vs Manual, and the monthly grid (formula in the API's
// lib/performanceReturns.ts; the month tracking began shows "—", its first snapshot being the starting point).
export function PerformanceCard({ book, performance, loading }: PerformanceCardProps) {
  const [period, setPeriod] = useState<AnalysisPeriod>(sinceInceptionPeriod);
  const [monthUnit, setMonthUnit] = useState<"percent" | "dollars">("percent");
  const { analysis, loading: analysisLoading, error } = usePnlAnalysis(period.days);
  const risk = analysis?.books[book].risk ?? null;

  const firstYear = performance?.trackingSince ? Number(performance.trackingSince.slice(0, 4)) : null;
  const lastYear = performance?.asOf ? Number(performance.asOf.slice(0, 4)) : null;
  const yearRows: number[] = [];
  if (firstYear !== null && lastYear !== null) for (let year = lastYear; year >= firstYear; year--) yearRows.push(year);
  const monthByKey = new Map((performance?.months ?? []).map((month) => [`${month.year}-${month.month}`, month]));
  const yearByYear = new Map((performance?.years ?? []).map((year) => [year.year, year]));
  const gridCell = (entry: { percent: number; profitDollars: number } | undefined, key: string, extraClassName = "") => {
    const value = entry === undefined ? undefined : monthUnit === "percent" ? entry.percent : entry.profitDollars;
    return (
      <td key={key} className={`text-end font-mono ${value === undefined ? "text-secondary" : pnlTextClass(value)} ${extraClassName}`}>
        {value === undefined ? "—" : monthUnit === "percent" ? formatSignedPercentageValue(value, 2) : formatSignedPnl(value, 0)}
      </td>
    );
  };

  return (
    <CollapsibleCard
      title="Performance"
      subtitle={
        <span className="text-secondary fw-normal" style={{ fontSize: "0.75rem" }}>
          Time-weighted, net of deposits and withdrawals{book === "all" ? "" : ` · ${bookChoiceLabels[book]} book`}
          {risk ? ` · ${formatDayMonth(risk.baselineNight)} close to ${formatDayMonth(risk.lastNight)}` : ""}
        </span>
      }
      storageKey="performance"
      className="mb-3 pnl-card"
      headerActions={<AnalysisPeriodPicker period={period} onChange={setPeriod} />}
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {analysisLoading && <Spinner size="sm" label="Loading performance" />}
      {!analysisLoading && analysis && !risk && <div className="text-secondary mb-3">The {bookChoiceLabels[book]} book has no nights in this period.</div>}
      {!analysisLoading && analysis && risk && (
        <>
          <div className="row g-3 mb-3">
            {headlines(risk).map((headline) => (
              <div key={headline.label} className="col-6 col-md-4 col-xl-2">
                <div className="text-secondary text-uppercase fw-semibold mb-1" style={{ fontSize: "0.75rem" }}>
                  <TooltipSpan text={headline.hint} className="dotted-underline-label">{headline.label}</TooltipSpan>
                </div>
                <div className={`fw-bold font-mono ${headline.className ?? ""}`} style={{ fontSize: "1.25rem" }}>{headline.text}</div>
                <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{headline.note}</div>
              </div>
            ))}
          </div>
          <div className="row g-4">
            <div className="col-12 col-xl-7">
              <BookGrowthCharts analysis={analysis} emphasisBook={book} growthHeight={230} drawdownHeight={170} />
            </div>
            <div className="col-12 col-xl-5">
              <div className="fw-semibold mb-1">Pluto vs Manual</div>
              <BookComparisonTable analysis={analysis} variant="compact" title="" />
              <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
                Pluto and Manual since the books began{analysis.booksFirstNight ? ` (${formatDayMonth(analysis.booksFirstNight)})` : ""}. The full comparison, with the trade figures, is the Positions page's Profit &amp; Loss card.
              </div>
            </div>
          </div>
        </>
      )}

      <div className="d-flex justify-content-between align-items-center mt-3 mb-1">
        <div className="fw-semibold">By month</div>
        <div className="btn-group" role="group" aria-label="Show months as">
          {(
            [
              ["percent", "%"],
              ["dollars", "$"],
            ] as const
          ).map(([unit, label]) => (
            <button key={unit} type="button" className={`btn btn-outline-secondary${monthUnit === unit ? " active" : ""}`} aria-pressed={monthUnit === unit} onClick={() => setMonthUnit(unit)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading && <Spinner size="sm" label="Loading the months" />}
      {!loading && !performance?.trackingSince && <div className="text-secondary">No account snapshots yet.</div>}
      {!loading && performance?.trackingSince && (
        <div className="table-responsive">
          <table className="table table-sm table-vcenter mb-0 performance-grid" style={{ fontSize: "0.8rem" }}>
            <thead className="table-light">
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Calendar year</span>
                </th>
                {monthLabels.map((label) => (
                  <th key={label} scope="col" className="text-end">{label}</th>
                ))}
                <th scope="col" className="text-end performance-grid-year-column">Year</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map((year) => (
                <tr key={year}>
                  <th scope="row" className="fw-semibold">{year}</th>
                  {monthLabels.map((label, monthIndex) => gridCell(monthByKey.get(`${year}-${monthIndex + 1}`), label))}
                  {gridCell(yearByYear.get(year), "year", "fw-bold performance-grid-year-column")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleCard>
  );
}
