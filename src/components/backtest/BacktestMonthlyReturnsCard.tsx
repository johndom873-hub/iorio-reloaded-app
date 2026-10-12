import { useState } from "react";
import type { BacktestMonthlyReturn } from "../../api/backtest";
import { formatSignedNumber } from "../../lib/formatters";
import { buildMonthlyReturnYears, monthLabels, monthlyReturnCellClass, roundToShownPercent } from "../../lib/backtestPresentation";
import { BacktestCard, SignedPercent } from "./backtestBits";

type MonthlySeries = "session" | "baseline";

const seriesOptions: { key: MonthlySeries; label: string }[] = [
  { key: "session", label: "This session" },
  { key: "baseline", label: "Buy and hold" },
];

/** Monthly returns as a year × month heat table (green gain, red loss), with the year compounded; switchable to buy and hold. */
export function BacktestMonthlyReturnsCard({ monthlyReturns }: { monthlyReturns: BacktestMonthlyReturn[] }) {
  const [series, setSeries] = useState<MonthlySeries>("session");
  const years = buildMonthlyReturnYears(monthlyReturns, series);

  return (
    <BacktestCard
      title="Monthly returns"
      description="% of the account at the start of each month; the year compounds its months"
      actions={
        <div className="btn-group" role="group" aria-label="Monthly returns of">
          {seriesOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`btn ${series === option.key ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={series === option.key}
              onClick={() => setSeries(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
      className="h-100"
    >
      {years.length === 0 ? (
        <div className="text-secondary p-3" style={{ fontSize: "0.85rem" }}>
          No month finished yet.
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-vcenter card-table mb-0 backtest-monthly-grid" style={{ fontSize: "0.78rem" }}>
            <thead className="table-light">
              <tr>
                <th scope="col">Year</th>
                {monthLabels.map((label) => (
                  <th key={label} scope="col" className="text-end">
                    {label}
                  </th>
                ))}
                <th scope="col" className="text-end backtest-monthly-year-column">
                  Year
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((row) => (
                <tr key={row.year}>
                  <th scope="row" className="font-mono fw-semibold">
                    {row.year}
                  </th>
                  {row.months.map((value, monthIndex) => (
                    <td key={monthLabels[monthIndex]} className={`text-end ${monthlyReturnCellClass(value)}`}>
                      {value === null ? "" : formatSignedNumber(roundToShownPercent(value) * 100, 1)}
                    </td>
                  ))}
                  <td className="text-end fw-bold backtest-monthly-year-column">
                    <SignedPercent fraction={row.yearReturn} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BacktestCard>
  );
}
