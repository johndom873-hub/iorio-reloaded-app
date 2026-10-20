import { Link, useNavigate } from "react-router-dom";
import type { BacktestBatchRun, BacktestMetrics } from "../../api/backtest";
import { useTheme } from "../../hooks/useTheme";
import { formatCurrency, formatNumber, formatRatio, formatSecondsInWords } from "../../lib/formatters";
import { backtestMetricExplanation, bestValueIndex, describeJobRowTiming, signedPercentDisplay, spyBuyAndHoldColorByTheme } from "../../lib/backtestPresentation";
import { batchBuyAndHoldColor, batchBuyAndHoldLineStyles, batchRunColor, describeRunList, type BatchBuyAndHoldGroup } from "../../lib/backtestBatchPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { DottedLabelTooltip } from "../HelpTooltip";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";
import { BacktestCard, BacktestJobProgressBar, BacktestJobStatusBadge, BacktestSeriesSwatch } from "./backtestBits";

// The batch page's runs (mockup approved 2026-10-17, D9): one row per run beside buy and hold of its own tickers and pots, then
// one buy-and-hold row per distinct set of tickers and pots, and SPY. The best value among the finished runs is shaded in each
// column. Ticked runs make the combined portfolio and Compare selected (D10); a run can be ticked once it has finished (D15).

type Shown = { text: string; className: string };

interface ResultColumn {
  key: string;
  header: string;
  explanation?: string;
  better: "higher" | null;
  /** The run's figure (its metrics and its buy and hold's); null when it has none. */
  value: (metrics: BacktestMetrics, baselineMetrics: BacktestMetrics | null, run: BacktestBatchRun | null) => number | null;
  format: (value: number | null) => Shown;
  /** Only a run has it: buy and hold rows show "—". */
  runsOnly?: boolean;
  /** Buy and hold of SPY stands for every run's capital: its dollar figures show "—". */
  dollars?: boolean;
}

const plain = (text: string, className = ""): Shown => ({ text, className });
const signed = (value: number | null): Shown => {
  const display = signedPercentDisplay(value, 1);
  return { text: display.text, className: display.className };
};

const resultColumns: ResultColumn[] = [
  { key: "capital", header: "Capital", explanation: "The run's starting value: the sum of its pots.", better: null, dollars: true, value: (metrics) => metrics.startValue, format: (value) => plain(formatCurrency(value, 0), "font-mono") },
  { key: "endValue", header: "End value", explanation: "The account value on the last session day, at 10:00 ET.", better: null, dollars: true, value: (metrics) => metrics.endValue, format: (value) => plain(formatCurrency(value, 0), "font-mono") },
  { key: "totalReturn", header: "Total return", explanation: backtestMetricExplanation.totalReturn, better: "higher", value: (metrics) => metrics.totalReturn, format: signed },
  { key: "cagr", header: "CAGR", explanation: backtestMetricExplanation.cagr, better: "higher", value: (metrics) => metrics.cagr, format: signed },
  { key: "sortino", header: "Sortino", explanation: backtestMetricExplanation.sortino, better: "higher", value: (metrics) => metrics.sortino, format: (value) => plain(formatRatio(value, 2)) },
  { key: "maxDrawdown", header: "Max drawdown", explanation: backtestMetricExplanation.maxDrawdown, better: "higher", value: (metrics) => metrics.maxDrawdown, format: signed },
  { key: "worstMonth", header: "Worst month", explanation: backtestMetricExplanation.worstMonth, better: "higher", value: (metrics) => metrics.worstMonth, format: signed },
  { key: "optionsSold", header: "Options sold", better: null, runsOnly: true, value: (metrics) => metrics.tradeCount, format: (value) => plain(formatNumber(value)) },
  { key: "cycles", header: "Wheel cycles", better: null, runsOnly: true, value: (_metrics, _baseline, run) => run?.session.wheelCycles?.cycleCount ?? null, format: (value) => plain(formatNumber(value)) },
];

const columnKeys = [...resultColumns.map((column) => column.key), "run"];

function isFinished(run: BacktestBatchRun): boolean {
  return run.session.status === "succeeded" && run.session.metrics !== null;
}

/** The Run column: the time it took once finished; its progress, time left or problem while it is not. */
function RunState({ run, now }: { run: BacktestBatchRun; now: Date }) {
  const job = run.job;
  if (!job) return <span className="text-secondary">—</span>;
  if (isFinished(run)) return <span className="text-secondary text-nowrap">{job.runSeconds !== null ? formatSecondsInWords(job.runSeconds) : "—"}</span>;
  const timing = describeJobRowTiming(job, now);
  return (
    <div className="d-flex flex-column align-items-end gap-1">
      <div className="d-flex align-items-center gap-2">
        <BacktestJobStatusBadge status={job.displayStatus} />
        {job.displayStatus === "running" && <BacktestJobProgressBar job={job} className="backtest-run-progress" />}
      </div>
      {(timing || job.displayStatus === "queued") && (
        <span className={`text-nowrap ${timing?.tone === "amber" ? "iorio-note-amber" : timing?.tone === "danger" ? "backtest-ticker-problem" : "text-secondary"}`} style={{ fontSize: "0.72rem", whiteSpace: "normal" }}>
          {timing?.text ?? "waiting for a free place"}
        </span>
      )}
    </div>
  );
}

export interface BacktestBatchRunsCardProps {
  runs: BacktestBatchRun[];
  descriptions: string[];
  buyAndHold: BatchBuyAndHoldGroup[];
  spyMetrics: BacktestMetrics | null;
  ticked: number[];
  onToggleTick: (runNumber: number) => void;
  now: Date;
}

export function BacktestBatchRunsCard({ runs, descriptions, buyAndHold, spyMetrics, ticked, onToggleTick, now }: BacktestBatchRunsCardProps) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { isColumnVisible, toggleColumn } = useColumnVisibility("backtest-batch-runs", columnKeys);
  const visibleColumns = resultColumns.filter((column) => isColumnVisible(column.key));
  const runColumnVisible = isColumnVisible("run");
  const finishedRuns = runs.filter(isFinished);
  const tickedFinished = finishedRuns.filter((run) => ticked.includes(run.runNumber));
  const anyRunning = runs.some((run) => !isFinished(run));

  // The best finished run in each column, by run number.
  const bestRunByColumn = new Map(
    visibleColumns.map((column) => {
      const values = finishedRuns.map((run) => column.value(run.session.metrics!, run.baselineMetrics, run));
      const index = bestValueIndex(values, column.better);
      return [column.key, index === -1 ? null : finishedRuns[index]!.runNumber];
    }),
  );
  const gear = (
    <ColumnVisibilityPopover
      columns={[...resultColumns.map((column) => ({ key: column.key, header: column.header })), { key: "run", header: "Run time" }]}
      isColumnVisible={isColumnVisible}
      onToggleColumn={toggleColumn}
    />
  );
  const lastHeaderKey = runColumnVisible ? "run" : (visibleColumns.at(-1)?.key ?? null);
  const header = (key: string, label: string, explanation?: string) => {
    const text = explanation ? <DottedLabelTooltip label={label} tooltipHtml={escapeTooltipHtml(explanation)} /> : label;
    return (
      <th key={key} className={`text-end${key === "run" ? " ps-4" : ""}`}>
        {key === lastHeaderKey ? (
          <div className="d-flex align-items-center justify-content-end gap-1">
            {text}
            {gear}
          </div>
        ) : (
          text
        )}
      </th>
    );
  };

  // The same styles as the batch chart, which draws the groups with points.
  const drawnBuyAndHold = buyAndHold.filter((group) => group.points.length > 0);
  const lineStyles = batchBuyAndHoldLineStyles(drawnBuyAndHold);
  const lineStyleByKey = new Map(drawnBuyAndHold.map((group, index) => [group.key, lineStyles[index]!]));
  const referenceRow = (key: string, name: string, detail: string, color: string, line: "solid" | "dashed" | "dotted", metrics: BacktestMetrics | null, showsDollars: boolean) => (
    <tr key={key}>
      <td className="backtest-batch-run-cell">
        <div className="backtest-batch-run-line">
          <BacktestSeriesSwatch color={color} line={line} />
          <span>{name}</span>
        </div>
        <div className="text-secondary backtest-batch-reference-detail">{detail}</div>
      </td>
      {visibleColumns.map((column) => {
        const shown = metrics && !column.runsOnly && (showsDollars || !column.dollars) ? column.format(column.value(metrics, null, null)) : plain("—", "text-secondary");
        return (
          <td key={column.key} className="text-end">
            <span className={shown.className}>{shown.text}</span>
          </td>
        );
      })}
      {runColumnVisible && <td className="text-end text-secondary ps-4">—</td>}
    </tr>
  );

  return (
    <BacktestCard
      title="Runs against buy and hold"
      description="each run beside buy and hold of its own tickers and of SPY · the best run in each column is shaded"
      actions={
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={tickedFinished.length < 2}
          onClick={() => navigate(`/backtest/compare?ids=${tickedFinished.map((run) => run.session.id).join(",")}`)}
        >
          Compare selected ({tickedFinished.length})
        </button>
      }
      className="mb-3"
    >
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0 backtest-batch-table">
          <thead className="table-light">
            <tr>
              <th className="backtest-batch-run-cell">{lastHeaderKey === null ? <div className="d-flex align-items-center gap-1">Run {gear}</div> : "Run"}</th>
              {visibleColumns.map((column) => header(column.key, column.header, column.explanation))}
              {runColumnVisible && header("run", "Run time", "How long the run took, or its progress while it runs.")}
            </tr>
          </thead>
          <tbody>
            {runs.map((run, index) => {
              const finished = isFinished(run);
              return (
                <tr key={run.runNumber}>
                  <td className="backtest-batch-run-cell">
                    <div className="backtest-batch-run-line">
                      <label className="backtest-checkbox-hit">
                        <input
                          type="checkbox"
                          className="form-check-input m-0"
                          aria-label={`Tick Run ${run.runNumber} to combine or compare`}
                          disabled={!finished}
                          checked={finished && ticked.includes(run.runNumber)}
                          onChange={() => onToggleTick(run.runNumber)}
                        />
                      </label>
                      <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                      <Link to={`/backtest/sessions/${run.session.id}`} className="fw-semibold text-decoration-none text-nowrap backtest-session-link">
                        Run {run.runNumber}
                      </Link>
                    </div>
                    <div className="text-secondary backtest-batch-run-detail">{descriptions[index]}</div>
                  </td>
                  {visibleColumns.map((column) => {
                    if (!finished) {
                      const capital = column.key === "capital" ? formatCurrency(run.session.startingValue, 0) : "—";
                      return (
                        <td key={column.key} className={`text-end ${column.key === "capital" ? "font-mono" : "text-secondary"}`}>
                          {capital}
                        </td>
                      );
                    }
                    const shown = column.format(column.value(run.session.metrics!, run.baselineMetrics, run));
                    return (
                      <td key={column.key} className={`text-end${bestRunByColumn.get(column.key) === run.runNumber ? " backtest-best-cell" : ""}`}>
                        <span className={shown.className}>{shown.text}</span>
                      </td>
                    );
                  })}
                  {runColumnVisible && (
                    <td className="text-end ps-4">
                      <RunState run={run} now={now} />
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="backtest-reference-band">
              <td colSpan={1 + visibleColumns.length + (runColumnVisible ? 1 : 0)}>
                <span className="subheader backtest-reference-band-label">Buy and hold · comparison only</span>
              </td>
            </tr>
            {buyAndHold.map((group) =>
              referenceRow(group.key, `Buy and hold · ${group.symbols.join(", ")}`, `for ${describeRunList(group.runNumbers)} · the same pots`, batchBuyAndHoldColor(theme, group), lineStyleByKey.get(group.key) ?? "dashed", group.metrics, true),
            )}
            {referenceRow("spy", "Buy and hold · SPY", "each run's capital in SPY", spyBuyAndHoldColorByTheme[theme], "solid", spyMetrics, false)}
          </tbody>
        </table>
      </div>
      <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
        {backtestMetricExplanation.symbolsBuyAndHold} {backtestMetricExplanation.spyBuyAndHold} A buy-and-hold row shows its figures once one of its runs has finished. Tick two or more finished runs to combine them into one portfolio or to compare them
        {anyRunning ? "; a run can be ticked once it finishes" : ""}.
      </div>
    </BacktestCard>
  );
}
