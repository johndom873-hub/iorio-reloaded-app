import { useState } from "react";
import type { BacktestMonthlyReturn } from "../../api/backtest";
import { formatSignedNumber } from "../../lib/formatters";
import { buildMonthlyReturnYears, hasSpyMonthlyReturns, monthLabels, monthlyReturnCellClass, roundToShownPercent, type MonthlyReturnSeries } from "../../lib/backtestPresentation";
import { BacktestCard, SignedPercent } from "./backtestBits";

interface BacktestMonthlyReturnsCardProps {
  monthlyReturns: BacktestMonthlyReturn[];
  /** "Buy and hold · SMCI, HOOD" and "Buy and hold · SPY": the series the card can switch to, for comparison only. */
  baselineLabel: string;
  spyBaselineLabel: string;
}

/** Monthly returns as a year × month heat table (green gain, red loss), with the year compounded; switchable to either buy and
 *  hold (comparison only). SPY's is offered only when the session kept it. */
export function BacktestMonthlyReturnsCard({ monthlyReturns, baselineLabel, spyBaselineLabel }: BacktestMonthlyReturnsCardProps) {
  const [series, setSeries] = useState<MonthlyReturnSeries>("session");
  // Short option names (a session's symbols can be 30 long); the card's description names the series in full.
  const seriesOptions: { key: MonthlyReturnSeries; label: string; fullName: string }[] = [
    { key: "session", label: "This session", fullName: "This session" },
    { key: "baseline", label: "Buy and hold of the symbols", fullName: `${baselineLabel}, for comparison only` },
    ...(hasSpyMonthlyReturns(monthlyReturns) ? [{ key: "spy" as const, label: "Buy and hold of SPY", fullName: `${spyBaselineLabel}, for comparison only` }] : []),
  ];
  const shown = seriesOptions.find((option) => option.key === series) ?? seriesOptions[0]!;
  const shownSeries = shown.key;
  const years = buildMonthlyReturnYears(monthlyReturns, shownSeries);

  return (
    <BacktestCard
      title="Monthly returns"
      description={shownSeries === "session" ? "% of the account at the start of each month; the year compounds its months" : `${shown.fullName}: % at the start of each month; the year compounds its months`}
      actions={
        <select className="form-select w-auto backtest-monthly-series" aria-label="Monthly returns of" value={shownSeries} onChange={(event) => setSeries(event.target.value as MonthlyReturnSeries)}>
          {seriesOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
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
