import type { BacktestBatchRun } from "../../api/backtest";
import { useTheme } from "../../hooks/useTheme";
import { formatNumber } from "../../lib/formatters";
import { batchRunColor } from "../../lib/backtestBatchPresentation";
import { BacktestCard, BacktestSeriesSwatch, BacktestSymbolLink, SignedDollars } from "./backtestBits";

// The batch page's tickers × runs (mockup approved 2026-10-17, D13): each ticker's cycle P&L and options sold inside each run,
// from the run's own Per symbol table.

export function BacktestBatchTickersCard({ runs }: { runs: BacktestBatchRun[] }) {
  const { theme } = useTheme();
  const symbols = [...new Set(runs.flatMap((run) => run.session.symbols))].sort();
  return (
    <BacktestCard title="Per ticker in each run" description="cycle P&L and options sold, from each run's Per symbol table" className="mb-3">
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Ticker</th>
              {runs.map((run) => (
                <th key={run.runNumber} className="text-end">
                  <span className="d-inline-flex align-items-center gap-1">
                    <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                    Run {run.runNumber}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => (
              <tr key={symbol}>
                <td>
                  <BacktestSymbolLink symbol={symbol} />
                </td>
                {runs.map((run) => {
                  if (!run.session.symbols.includes(symbol))
                    return (
                      <td key={run.runNumber} className="text-end text-secondary text-nowrap backtest-cell-words" style={{ fontSize: "0.78rem" }}>
                        not in this run
                      </td>
                    );
                  const statistics = run.tickerStatistics.find((entry) => entry.symbol === symbol);
                  if (run.session.status !== "succeeded" || !statistics)
                    return (
                      <td key={run.runNumber} className="text-end text-secondary">
                        —
                      </td>
                    );
                  return (
                    <td key={run.runNumber} className="text-end text-nowrap">
                      <span className="font-mono">
                        <SignedDollars value={statistics.totalPnlDollars} />
                      </span>
                      <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
                        {formatNumber(statistics.optionSaleCount)} options sold
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BacktestCard>
  );
}
