import type { PnlAnalysis } from "../../api/pnlAnalysis";
import { oneOf, useStoredState } from "../../hooks/useStoredState";
import { formatDayMonth, formatWeekdayShort } from "../../lib/formatters";
import { analysisBooks, bookChoiceLabels, liveNightOf, liveTakenAt, performanceComponents, performanceDays, performanceUnits } from "../../lib/pnlAnalysisPresentation";
import { BookSwitch } from "../books/BookSwitch";
import { PerformanceComponentLabel, PerformanceUnitToggle, PerformanceValueCell } from "./performanceBreakdownBits";

/** The trailing sessions shown: what fits the Dashboard's full-width card at 0.8rem (mockup approved 2026-11-26). */
const sessionsShown = 15;

// The Performance card's By day grid (mockup approved by Marcelo 2026-11-26): the last sessions' P&L split into Stock, Call
// premiums, Put premiums, LEAPS and Other, in % of the book's value the night before or in dollars, newest on the right and
// today's live session last during the trading day. Its book and unit are remembered in this browser.
export function PerformanceByDayTable({ analysis }: { analysis: PnlAnalysis }) {
  const [book, setBook] = useStoredState("performance-by-day-book", "all", oneOf(analysisBooks));
  const [unit, setUnit] = useStoredState("performance-by-day-unit", "percent", oneOf(performanceUnits));
  const days = performanceDays(analysis.books[book].nights).slice(-sessionsShown);
  const liveNight = liveNightOf(analysis);

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3 mb-1">
        <div>
          <span className="fw-semibold">By day</span>
          <span className="text-secondary" style={{ fontSize: "0.75rem" }}> · last {days.length} trading sessions · {bookChoiceLabels[book]}</span>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <BookSwitch selection={book} onChange={setBook} />
          <PerformanceUnitToggle unit={unit} label="Show days as" onChange={setUnit} />
        </div>
      </div>
      {days.length === 0 ? (
        <div className="text-secondary">The {bookChoiceLabels[book]} book has no sessions yet.</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="table table-sm table-vcenter mb-0 performance-grid performance-grid-days" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light">
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Component</span>
                  </th>
                  {days.map((day) => (
                    <th key={day.night} scope="col" className="text-end performance-grid-day-heading">
                      {day.night === liveNight ? "Today" : formatDayMonth(day.night)}
                      <span>{day.night === liveNight ? `live ${liveTakenAt(analysis)}` : formatWeekdayShort(day.night)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {performanceComponents.map((component) => (
                  <tr key={component.key}>
                    <th scope="row" className="fw-normal"><PerformanceComponentLabel component={component} /></th>
                    {days.map((day) => (
                      <PerformanceValueCell key={day.night} value={unit === "percent" ? day.percents[component.key] : day.dollars[component.key]} unit={unit} />
                    ))}
                  </tr>
                ))}
                <tr className="performance-grid-total-row">
                  <th scope="row">Total</th>
                  {days.map((day) => (
                    <PerformanceValueCell key={day.night} value={unit === "percent" ? day.returnPercent : day.pnl} unit={unit} className="fw-bold" />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
            {unit === "percent" ? "Each figure is that component's dollars that day ÷ the book's value the night before. The five rows add up to the Total." : "Dollars that day. The five rows add up to the Total."}
          </div>
        </>
      )}
    </>
  );
}
