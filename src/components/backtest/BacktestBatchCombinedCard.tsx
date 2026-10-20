import { Fragment, useEffect, useState } from "react";
import { errorMessage } from "../../api/client";
import { fetchBacktestBatchCombined, type BacktestBatchCombined, type BacktestBatchRun, type BacktestCurveFigures } from "../../api/backtest";
import { useTheme } from "../../hooks/useTheme";
import { formatCurrency, formatNumber, formatRatio } from "../../lib/formatters";
import { buyAndHoldColorByTheme, signedPercentDisplay, spyBuyAndHoldColorByTheme, type BacktestValueScale } from "../../lib/backtestPresentation";
import { batchCombinedColor, batchRunColor, describeRunList } from "../../lib/backtestBatchPresentation";
import { Spinner } from "../Spinner";
import { BacktestValueLinesChart } from "./BacktestCharts";
import { BacktestCard, BacktestSeriesSwatch, SignedPercent } from "./backtestBits";

// The batch page's combined portfolio (mockup approved 2026-10-17, D12; formula F1): the ticked finished runs added up day by
// day as separate accounts in one portfolio, beside buy and hold of the same tickers and pots and of SPY. Worked out by the
// API whenever the ticks change; nothing is saved.

interface SeriesRow {
  key: string;
  name: string;
  color: string;
  line: "solid" | "dashed" | "dotted";
  figures: BacktestCurveFigures;
  optionsSold: number | null;
  cycles: number | null;
}

export interface BacktestBatchCombinedCardProps {
  batchId: string;
  /** The ticked runs that have finished, in run order. */
  runs: BacktestBatchRun[];
  /** Ticked runs still running or queued: they join once finished. */
  waitingRunNumbers: number[];
  scale: BacktestValueScale;
  onClearTicks: () => void;
}

export function BacktestBatchCombinedCard({ batchId, runs, waitingRunNumbers, scale, onClearTicks }: BacktestBatchCombinedCardProps) {
  const { theme } = useTheme();
  const runNumbers = runs.map((run) => run.runNumber);
  const runNumbersKey = runNumbers.join(",");
  const [result, setResult] = useState<{ key: string; combined: BacktestBatchCombined | null; error: string | null } | null>(null);

  useEffect(() => {
    if (runNumbersKey.split(",").length < 2 || runNumbersKey === "") return;
    let cancelled = false;
    fetchBacktestBatchCombined(batchId, runNumbersKey.split(",").map(Number))
      .then((combined) => !cancelled && setResult({ key: runNumbersKey, combined, error: null }))
      .catch((err) => !cancelled && setResult({ key: runNumbersKey, combined: null, error: errorMessage(err, "Could not combine the runs.") }));
    return () => {
      cancelled = true;
    };
  }, [batchId, runNumbersKey]);

  const title = "Combined portfolio";
  const waitingNote = waitingRunNumbers.length > 0 ? ` ${describeRunList(waitingRunNumbers)} ${waitingRunNumbers.length === 1 ? "joins" : "join"} once finished.` : "";
  if (runs.length < 2) {
    return (
      <BacktestCard title={title} description="tick two or more finished runs above to add them together" className="mb-3">
        <div className="card-body text-secondary" style={{ fontSize: "0.85rem" }}>
          {runs.length === 1 ? `Run ${runs[0]!.runNumber} is ticked: tick one more finished run to combine them.` : "No runs ticked."}
          {waitingNote}
        </div>
      </BacktestCard>
    );
  }

  const description = `${describeRunList(runNumbers)} added together day by day, each still its own account · comparison only`;
  const actions = (
    <button type="button" className="btn btn-outline-secondary" onClick={onClearTicks}>
      Clear ticks
    </button>
  );
  const current = result !== null && result.key === runNumbersKey ? result : null;
  if (!current) {
    return (
      <BacktestCard title={title} description={description} actions={actions} className="mb-3">
        <div className="d-flex justify-content-center py-4">
          <Spinner size="sm" label="Adding the runs up" />
        </div>
      </BacktestCard>
    );
  }
  if (current.error || !current.combined) {
    return (
      <BacktestCard title={title} description={description} actions={actions} className="mb-3">
        <div className="card-body">
          <div className="alert alert-danger mb-0">{current.error}</div>
        </div>
      </BacktestCard>
    );
  }

  const combined = current.combined;
  const start = combined.metrics.startValue;
  const rows: SeriesRow[] = [
    { key: "combined", name: `Combined · ${describeRunList(runNumbers)}`, color: batchCombinedColor(theme), line: "solid", figures: combined.metrics, optionsSold: combined.metrics.tradeCount, cycles: combined.metrics.cycleCount ?? null },
    { key: "baseline", name: "Buy and hold of the same tickers and pots", color: buyAndHoldColorByTheme[theme], line: "solid", figures: combined.baselineFigures, optionsSold: null, cycles: null },
    ...(combined.spyBaselineFigures ? [{ key: "spy", name: "Buy and hold · SPY", color: spyBuyAndHoldColorByTheme[theme], line: "solid" as const, figures: combined.spyBaselineFigures, optionsSold: null, cycles: null }] : []),
  ];
  const lines = rows.map((row) => ({
    name: row.name,
    color: row.color,
    line: row.line,
    points: combined.points.map((point) => ({ tradingDate: point.tradingDate, value: row.key === "combined" ? point.value : row.key === "baseline" ? point.baselineValue : point.spyBaselineValue! })),
  }));
  const signedCell = (fraction: number | null) => {
    const display = signedPercentDisplay(fraction, 1);
    return <span className={display.className}>{display.text}</span>;
  };

  return (
    <BacktestCard title={title} description={description} actions={actions} className="mb-3">
      <div className="card-body py-3 border-bottom">
        <div className="backtest-combined-parts">
          {runs.map((run, index) => (
            <Fragment key={run.runNumber}>
              {index > 0 && <span className="text-secondary">+</span>}
              <span className="backtest-combined-part">
                <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                Run {run.runNumber} <span className="font-mono">{formatCurrency(run.session.startingValue, 0)}</span>
                <span className="text-secondary">({Math.round((run.session.startingValue / start) * 100)}%)</span>
              </span>
            </Fragment>
          ))}
          <span className="text-secondary">=</span>
          <span className="font-mono fw-semibold">{formatCurrency(start, 0)}</span>
        </div>
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Series</th>
              <th className="text-end">Start</th>
              <th className="text-end">End value</th>
              <th className="text-end">Total return</th>
              <th className="text-end">CAGR</th>
              <th className="text-end">Sortino</th>
              <th className="text-end">Max drawdown</th>
              <th className="text-end">Worst month</th>
              <th className="text-end">Options sold</th>
              <th className="text-end">Wheel cycles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="text-nowrap">
                  <span className="d-inline-flex align-items-center gap-2">
                    <BacktestSeriesSwatch color={row.color} line={row.line} />
                    <span className={row.key === "combined" ? "fw-semibold" : undefined}>{row.name}</span>
                  </span>
                </td>
                <td className="text-end font-mono">{formatCurrency(row.figures.startValue, 0)}</td>
                <td className="text-end font-mono">{formatCurrency(row.figures.endValue, 0)}</td>
                <td className="text-end">{signedCell(row.figures.totalReturn)}</td>
                <td className="text-end">{signedCell(row.figures.cagr)}</td>
                <td className="text-end">{formatRatio(row.figures.sortino, 2)}</td>
                <td className="text-end">{signedCell(row.figures.maxDrawdown)}</td>
                <td className="text-end">{signedCell(row.figures.worstMonth)}</td>
                <td className="text-end">{row.optionsSold === null ? <span className="text-secondary">—</span> : formatNumber(row.optionsSold)}</td>
                <td className="text-end">{row.cycles === null ? <span className="text-secondary">—</span> : formatNumber(row.cycles)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body pt-3">
        <BacktestValueLinesChart scale={scale} lines={lines} mode="dollars" />
      </div>
      <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
        Max drawdown of each run alone:{" "}
        {runs.map((run, index) => (
          <Fragment key={run.runNumber}>
            {index > 0 && ", "}
            Run {run.runNumber} <SignedPercent fraction={run.session.metrics?.maxDrawdown} />
          </Fragment>
        ))}
        . The combined line has its own Max drawdown, from the sum of the runs' values each day. The runs don't share cash, and the per-ticker and per-sector caps don't reach across runs. Worked out when shown; nothing is saved.
        {combined.daysLeftOut > 0 && ` ${formatNumber(combined.daysLeftOut)} trading day${combined.daysLeftOut === 1 ? "" : "s"} only some of the runs have ${combined.daysLeftOut === 1 ? "is" : "are"} left out of the sum.`}
        {waitingNote}
      </div>
    </BacktestCard>
  );
}
