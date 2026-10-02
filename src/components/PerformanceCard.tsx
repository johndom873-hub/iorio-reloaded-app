import { CollapsibleCard } from "./CollapsibleCard";
import { Spinner } from "./Spinner";
import type { PerformanceSummary } from "../api/dashboard";
import { formatDate, formatSignedPercentageValue, pnlTextClass } from "../lib/formatters";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const daysPerYear = 365;

interface PerformanceCardProps {
  performance: PerformanceSummary | null;
  loading: boolean;
}

// Time-weighted return, net of deposits, withdrawals and transfers between accounts (formula in the API's
// lib/performanceReturns.ts). The month tracking began shows "—": the first snapshot is the starting point.
export function PerformanceCard({ performance, loading }: PerformanceCardProps) {
  const firstYear = performance?.trackingSince ? Number(performance.trackingSince.slice(0, 4)) : null;
  const lastYear = performance?.asOf ? Number(performance.asOf.slice(0, 4)) : null;
  const yearRows: number[] = [];
  if (firstYear !== null && lastYear !== null) for (let year = lastYear; year >= firstYear; year--) yearRows.push(year);

  const monthPercentByKey = new Map((performance?.months ?? []).map((month) => [`${month.year}-${month.month}`, month.percent]));
  const yearPercentByYear = new Map((performance?.years ?? []).map((year) => [year.year, year.percent]));
  const spanDays = performance?.trackingSpanDays ?? null;

  const percentCell = (percent: number | undefined, key: string, extraClassName = "") => (
    <td key={key} className={`text-end font-mono ${percent === undefined ? "text-muted" : pnlTextClass(percent)} ${extraClassName}`}>
      {formatSignedPercentageValue(percent ?? null, 2)}
    </td>
  );

  return (
    <CollapsibleCard
      title="Performance"
      subtitle={
        <span className="text-muted fw-normal" style={{ fontSize: "0.75rem" }}>
          Time-weighted, net of deposits and withdrawals
        </span>
      }
      storageKey="performance"
      className="mb-3"
    >
      {loading && <Spinner size="sm" label="Loading performance" />}
      {!loading && !performance?.trackingSince && <div className="text-muted">No account snapshots yet.</div>}
      {!loading && performance?.trackingSince && (
        <>
          <div className="d-flex flex-wrap column-gap-5 row-gap-2 mb-3">
            <div>
              <div className="text-muted text-uppercase fw-semibold mb-1" style={{ fontSize: "0.75rem" }}>
                Since inception
              </div>
              <span className={`fw-bold font-mono ${pnlTextClass(performance.sinceInceptionPercent)}`} style={{ fontSize: "1.25rem" }}>
                {formatSignedPercentageValue(performance.sinceInceptionPercent, 2)}
              </span>
              <span className="text-muted ms-2" style={{ fontSize: "0.75rem" }}>
                since {formatDate(performance.trackingSince)}
              </span>
            </div>
            <div>
              <div className="text-muted text-uppercase fw-semibold mb-1" style={{ fontSize: "0.75rem" }}>
                CAGR
              </div>
              <span className={`fw-bold font-mono ${pnlTextClass(performance.compoundAnnualGrowthRatePercent)}`} style={{ fontSize: "1.25rem" }}>
                {formatSignedPercentageValue(performance.compoundAnnualGrowthRatePercent, 2)}
              </span>
              {spanDays !== null && (
                <span className="text-muted ms-2" style={{ fontSize: "0.75rem" }}>
                  {spanDays < daysPerYear ? `annualised from ${spanDays} ${spanDays === 1 ? "day" : "days"}` : "per year"}
                </span>
              )}
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm table-vcenter mb-0 performance-grid" style={{ fontSize: "0.8rem" }}>
              <thead className="table-light">
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Calendar year</span>
                  </th>
                  {monthLabels.map((label) => (
                    <th key={label} scope="col" className="text-end">
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="text-end performance-grid-year-column">
                    Year
                  </th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map((year) => (
                  <tr key={year}>
                    <th scope="row" className="fw-semibold">
                      {year}
                    </th>
                    {monthLabels.map((label, monthIndex) => percentCell(monthPercentByKey.get(`${year}-${monthIndex + 1}`), label))}
                    {percentCell(yearPercentByYear.get(year), "year", "fw-bold performance-grid-year-column")}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}
