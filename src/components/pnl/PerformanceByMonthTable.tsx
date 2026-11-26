import { Fragment } from "react";
import type { PnlAnalysis } from "../../api/pnlAnalysis";
import { useScrolledToEnd } from "../../hooks/useScrolledToEnd";
import { isBoolean, oneOf, useStoredState } from "../../hooks/useStoredState";
import { analysisBooks, bookChoiceLabels, performanceByMonth, performanceComponents, performanceDays, performanceUnits, type PerformanceBreakdown, type PerformanceUnit } from "../../lib/pnlAnalysisPresentation";
import { BookSwitch } from "../books/BookSwitch";
import { BreakdownToggle, PerformanceComponentLabel, PerformanceUnitToggle, PerformanceValueCell } from "./performanceBreakdownBits";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function totalOf(breakdown: PerformanceBreakdown | undefined, unit: PerformanceUnit): number | undefined {
  return breakdown === undefined ? undefined : unit === "percent" ? breakdown.returnPercent : breakdown.pnl;
}

// The Performance card's By month grid (mockup approved 2026-11-13, breakdown 2026-11-26): each month's and year's
// time-weighted return or P&L, from the analyser's nights since inception (today's live night included during the trading
// day). Each year folds out into Stock, Call premiums, Put premiums, LEAPS and Other: percentage points of the period's
// return that add up to it, or dollars. The month the book began shows "—" when its first night is the starting point.
// Its book, unit and fold are remembered in this browser.
export function PerformanceByMonthTable({ analysis }: { analysis: PnlAnalysis }) {
  const [book, setBook] = useStoredState("performance-by-month-book", "all", oneOf(analysisBooks));
  const [unit, setUnit] = useStoredState("performance-by-month-unit", "percent", oneOf(performanceUnits));
  const [open, setOpen] = useStoredState("performance-by-month-breakdown-open", false, isBoolean);
  const { months, years } = performanceByMonth(performanceDays(analysis.books[book].nights));
  const yearRows = [...years.keys()].sort().reverse();
  const scrollBox = useScrolledToEnd<HTMLDivElement>(`${book}|${unit}|${open}|${yearRows.length}`);
  const componentValue = (breakdown: PerformanceBreakdown | undefined, key: (typeof performanceComponents)[number]["key"]) => (breakdown === undefined ? undefined : unit === "percent" ? breakdown.points[key] : breakdown.dollars[key]);

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3 mb-1">
        <div>
          <span className="fw-semibold">By month</span>
          <span className="text-secondary" style={{ fontSize: "0.75rem" }}> · {bookChoiceLabels[book]}</span>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <BookSwitch selection={book} onChange={setBook} />
          <PerformanceUnitToggle unit={unit} label="Show months as" onChange={setUnit} />
        </div>
      </div>
      {yearRows.length === 0 ? (
        <div className="text-secondary">The {bookChoiceLabels[book]} book has no sessions yet.</div>
      ) : (
        <>
          <div className="table-responsive" ref={scrollBox}>
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
                  <Fragment key={year}>
                    <tr>
                      <th scope="row" className="fw-semibold text-nowrap">
                        <BreakdownToggle open={open} label={`${year}`} onToggle={() => setOpen(!open)} />
                        {year}
                      </th>
                      {monthLabels.map((label, monthIndex) => (
                        <PerformanceValueCell key={label} value={totalOf(months.get(`${year}-${String(monthIndex + 1).padStart(2, "0")}`), unit)} unit={unit} />
                      ))}
                      <PerformanceValueCell value={totalOf(years.get(year), unit)} unit={unit} className="fw-bold performance-grid-year-column" />
                    </tr>
                    {open &&
                      performanceComponents.map((component) => (
                        <tr key={`${year}-${component.key}`} className="pnl-breakdown-row">
                          <th scope="row" className="fw-normal ps-4"><PerformanceComponentLabel component={component} /></th>
                          {monthLabels.map((label, monthIndex) => (
                            <PerformanceValueCell key={label} value={componentValue(months.get(`${year}-${String(monthIndex + 1).padStart(2, "0")}`), component.key)} unit={unit} />
                          ))}
                          <PerformanceValueCell value={componentValue(years.get(year), component.key)} unit={unit} className="performance-grid-year-column" />
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {open && (
            <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
              {unit === "percent" ? "A component's figure is its share of that month's (or year's) return in percentage points; the five add up to it." : "Dollars in that month or year. The five rows add up to its P&L."}
            </div>
          )}
        </>
      )}
    </>
  );
}
