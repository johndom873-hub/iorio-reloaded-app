import type { BacktestSettingsSource, BacktestTablesMode } from "../../api/backtest";
import { useTheme } from "../../hooks/useTheme";
import { formatCurrency, pluralizeCount } from "../../lib/formatters";
import { tablesModeLabel } from "../../lib/backtestPresentation";
import { batchRunColor } from "../../lib/backtestBatchPresentation";
import { Spinner } from "../Spinner";
import { BacktestSeriesSwatch } from "./backtestBits";

const settingsSourceFact: Record<BacktestSettingsSource, { label: string; note: string }> = {
  per_ticker: { label: "Per ticker", note: "each ticker's lab values where it has them" },
  global: { label: "Global", note: "the lab's global values for every ticker" },
};

export interface BacktestStartBatchConfirmBodyProps {
  name: string;
  startDate: string;
  endDate: string;
  periodNote: string;
  decisionMakerLabel: string;
  settingsSource: BacktestSettingsSource;
  tablesMode: BacktestTablesMode;
  /** Each run as it starts: its tickers, what makes it different, its capital (null while worked out). */
  runs: { runNumber: number; symbols: string[]; description: string; capital: number | null }[];
  /** How many run at once (the API's BACKTEST_MAX_PARALLEL_SESSIONS); null when the overview has not said. */
  maxParallel: number | null;
  estimatePending: boolean;
  changes: string[];
  warnings: string[];
  problems: string[];
}

/** The Start confirmation with several runs (mockup approved 2026-10-17, Part 2): the batch's facts, every run with what makes
 *  it different, what changed for every run, and the estimates' warnings, before anything is queued. */
export function BacktestStartBatchConfirmBody(props: BacktestStartBatchConfirmBodyProps) {
  const { name, startDate, endDate, periodNote, decisionMakerLabel, settingsSource, tablesMode, runs, maxParallel, estimatePending, changes, warnings, problems } = props;
  const { theme } = useTheme();
  const count = runs.length;
  const tablesText = tablesModeLabel[tablesMode];
  const queueNote = maxParallel === null ? "they queue and start as places free up" : count <= maxParallel ? `up to ${maxParallel} at a time: all ${count} start now` : `up to ${maxParallel} at a time: ${maxParallel} start now, ${count - maxParallel} wait their turn`;

  return (
    <div>
      <dl className="backtest-confirm-facts">
        <dt>Name</dt>
        <dd>
          {name}
          <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
            sessions "{name} · Run 1 · …"
          </div>
        </dd>
        <dt>Period</dt>
        <dd>
          <span className="font-mono">
            {startDate} → {endDate}
          </span>{" "}
          <span className="text-secondary">· {periodNote}</span>
        </dd>
        <dt>Decision maker</dt>
        <dd>{decisionMakerLabel}</dd>
        <dt>Ticker values</dt>
        <dd>
          {settingsSourceFact[settingsSource].label} <span className="text-secondary">· {settingsSourceFact[settingsSource].note}</span>
        </dd>
        <dt>History tables</dt>
        <dd>{tablesText.charAt(0).toUpperCase() + tablesText.slice(1)}</dd>
        <dt>Runs</dt>
        <dd>
          {pluralizeCount(count, "run")} <span className="text-secondary">· {queueNote}</span>
        </dd>
        <dt>Compared with</dt>
        <dd>buy and hold of each run's tickers and pots, and of SPY</dd>
      </dl>

      <div className="table-responsive mb-3">
        <table className="table table-sm table-vcenter mb-0">
          <thead className="table-light">
            <tr>
              <th>Run</th>
              <th>Tickers</th>
              <th style={{ whiteSpace: "normal" }}>What makes it different</th>
              <th className="text-end">Capital</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runNumber}>
                <td>
                  <span className="d-inline-flex align-items-center gap-2 text-nowrap">
                    <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                    <span className="fw-semibold">Run {run.runNumber}</span>
                  </span>
                </td>
                <td>{[...run.symbols].sort().join(", ")}</td>
                <td className="text-secondary" style={{ whiteSpace: "normal" }}>
                  {run.description}
                </td>
                <td className="text-end font-mono">{run.capital === null && estimatePending ? <Spinner size="sm" label="Working out the capital" /> : formatCurrency(run.capital, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="subheader mb-2">Changed for every run</h4>
      {changes.length > 0 ? (
        <ul className="mb-3 ps-3" style={{ fontSize: "0.85rem" }}>
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : (
        <p className="text-secondary mb-3" style={{ fontSize: "0.85rem" }}>
          Nothing: the lab's settings as they are now.
        </p>
      )}

      {problems.length > 0 && (
        <div className="alert alert-danger" role="alert">
          <ul className="mb-0 ps-3">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mb-0 ps-3 iorio-note-amber" style={{ fontSize: "0.8rem" }}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
