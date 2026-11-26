import { CollapsibleCard } from "./CollapsibleCard";
import { Spinner } from "./Spinner";
import { TooltipSpan } from "./TooltipSpan";
import type { AnalysisBook, BookRiskFigures, GatedFigure } from "../api/pnlAnalysis";
import { usePnlAnalysis } from "../hooks/usePnlAnalysis";
import { useStoredState } from "../hooks/useStoredState";
import { formatDayMonth, formatPercentageValue, formatRatio, formatSignedPercentageValue, formatSignedPnl, pnlTextClass, todayInEasternIso } from "../lib/formatters";
import { analysisDaysForPreset, analysisPresetLabels, bookChoiceLabels, gatedNote, liveNightOf, liveTakenAt, sinceInceptionPeriod, type AnalysisPeriod } from "../lib/pnlAnalysisPresentation";
import { AnalysisPeriodPicker } from "./pnl/AnalysisPeriodPicker";
import { BookComparisonTable } from "./pnl/BookComparisonTable";
import { BookGrowthChart } from "./pnl/BookGrowthChart";
import { PerformanceByDayTable } from "./pnl/PerformanceByDayTable";
import { PerformanceByMonthTable } from "./pnl/PerformanceByMonthTable";

interface PerformanceCardProps {
  book: AnalysisBook;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/** A remembered period: a preset, or a custom range of valid dates. */
function isStoredPeriod(stored: unknown): stored is AnalysisPeriod {
  if (typeof stored !== "object" || stored === null) return false;
  const { preset, days } = stored as AnalysisPeriod;
  if (preset in analysisPresetLabels) return true;
  return preset === "custom" && typeof days === "object" && days !== null && typeof days.from === "string" && isoDatePattern.test(days.from) && (days.to === null || (typeof days.to === "string" && isoDatePattern.test(days.to)));
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

// The Dashboard's Performance card (mockup approved by Marcelo 2026-11-13, redesign 2026-11-26): the book's time-weighted
// return and risk over a period, every book's growth, Pluto vs Manual with P&L and Return folding out by component, and the
// By day and By month grids since inception (each with its own book switch). Its period, toggles and folds are remembered in
// this browser; a remembered preset (MTD, QTD…) is recomputed for today.
export function PerformanceCard({ book }: PerformanceCardProps) {
  const [storedPeriod, setPeriod] = useStoredState<AnalysisPeriod>("performance-period", sinceInceptionPeriod, isStoredPeriod);
  const period: AnalysisPeriod = storedPeriod.preset === "custom" ? storedPeriod : { preset: storedPeriod.preset, days: analysisDaysForPreset(storedPeriod.preset, todayInEasternIso()) };
  const { analysis, loading: analysisLoading, error } = usePnlAnalysis(period.days);
  const { analysis: inceptionAnalysis, loading: inceptionLoading, error: inceptionError } = usePnlAnalysis(sinceInceptionPeriod.days);
  const risk = analysis?.books[book].risk ?? null;

  return (
    <CollapsibleCard
      title="Performance"
      subtitle={
        <span className="text-secondary fw-normal" style={{ fontSize: "0.75rem" }}>
          Time-weighted, net of deposits and withdrawals{book === "all" ? "" : ` · ${bookChoiceLabels[book]} book`}
          {risk ? ` · ${formatDayMonth(risk.baselineNight)} close to ${risk.lastNight === liveNightOf(analysis) ? `${liveTakenAt(analysis)} today (live)` : formatDayMonth(risk.lastNight)}` : ""}
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
              <BookGrowthChart analysis={analysis} emphasisBook={book} growthHeight={320} />
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

      {inceptionError && !error && <div className="alert alert-danger">{inceptionError}</div>}
      {inceptionLoading && <Spinner size="sm" label="Loading the days and months" />}
      {!inceptionLoading && inceptionAnalysis && (
        <>
          <PerformanceByDayTable analysis={inceptionAnalysis} />
          <PerformanceByMonthTable analysis={inceptionAnalysis} />
        </>
      )}
    </CollapsibleCard>
  );
}
