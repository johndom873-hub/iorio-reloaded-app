import { Fragment, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import type { BacktestSettingRow, BacktestSettingsSource, BacktestTickerValueKey } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { formatCurrency, formatPercentage } from "../../lib/formatters";
import type { BacktestTickerValueGroup } from "../../lib/backtestPresentation";
import { batchRunColor, batchVaryChoices, type BatchVary, type BatchVaryKey } from "../../lib/backtestBatchPresentation";
import { hideableTickerValueColumns, tickerRowGroupSource, tickerValueColumns, type TickerRowModel } from "../../lib/backtestTickerValueEdits";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { BacktestCardTitle, BacktestSeriesSwatch, BacktestSymbolLink } from "./backtestBits";
import { ProblemLines, ResetGroupButton, SettingsSourceSwitch, SourceBadge, SourceLegend, TickerValueInput } from "./BacktestTickerValueParts";

// The New session's Runs card (mockup approved 2026-10-17, D2/D5/D6): with Several runs, one band per run (its number, what
// makes it different, its capital, Add ticker, Duplicate, Remove) and its tickers' values below it, as the Tickers card shows
// them; Make runs turns a list of values into runs. A table on wider screens, one block per run on a phone.

const tableId = "backtest-new-session-runs";
const settingsSourceExplanation: Record<BacktestSettingsSource, string> = {
  per_ticker: "Per ticker: each ticker's saved lab values where it has them, the lab's global values for the rest. For every run.",
  global: "Global: the lab's global values for every ticker; saved ticker values are left out. For every run.",
};

/** A run as the card shows it. */
export interface BacktestRunView {
  key: string;
  runNumber: number;
  rows: TickerRowModel[];
  /** What makes it different from the other runs (D7). */
  description: string;
  /** Σ its pots; null while a ticker has none. */
  capital: number | null;
  /** The picked symbols it does not hold: what Add ticker offers. */
  missingSymbols: string[];
  resolving: boolean;
  error: string | null;
  /** Problems not tied to one ticker ("Run 2 has no tickers"). */
  runProblems: string[];
}

export interface BacktestRunsCardProps {
  runs: BacktestRunView[];
  maxRuns: number;
  settingsSource: BacktestSettingsSource;
  onSettingsSourceChange: (source: BacktestSettingsSource) => void;
  vary: BatchVary;
  varyTickers: string[];
  varyPreview: { ok: boolean; label: string; text: string };
  onVaryChange: (vary: BatchVary) => void;
  onApplyVary: () => void;
  onEditChange: (runKey: string, symbol: string, key: BacktestTickerValueKey, text: string) => void;
  onEditBlur: (runKey: string, symbol: string, key: BacktestTickerValueKey) => void;
  onResetGroup: (runKey: string, symbol: string, group: BacktestTickerValueGroup) => void;
  onDuplicate: (runKey: string) => void;
  onRemove: (runKey: string) => void;
  onRemoveTicker: (runKey: string, symbol: string) => void;
  onAddTicker: (runKey: string, symbol: string) => void;
  anyEdit: boolean;
  onResetAll: () => void;
  settingRows: BacktestSettingRow[];
}

export function BacktestRunsCard(props: BacktestRunsCardProps) {
  const { runs, maxRuns, settingsSource, onSettingsSourceChange, vary, varyTickers, varyPreview, onVaryChange, onApplyVary, anyEdit, onResetAll } = props;
  const isPhone = useMediaQuery("(max-width: 767px)");
  const { theme } = useTheme();
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    tickerValueColumns.map((column) => column.key),
  );
  const resolving = runs.some((run) => run.resolving);
  const full = runs.length >= maxRuns;

  const runActions = (run: BacktestRunView, phone: boolean) => (
    <div className="backtest-run-actions">
      {run.missingSymbols.length > 0 && (
        <select className={`form-select backtest-run-add-ticker${phone ? "" : " form-select-sm"}`} aria-label={`Add a ticker to Run ${run.runNumber}`} value="" onChange={(event) => event.target.value && props.onAddTicker(run.key, event.target.value)}>
          <option value="">Add ticker</option>
          {run.missingSymbols.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      )}
      <button type="button" className={`btn btn-outline-secondary${phone ? "" : " btn-sm"}`} disabled={full} title={full ? `${maxRuns} runs at most` : undefined} onClick={() => props.onDuplicate(run.key)}>
        Duplicate
      </button>
      <button type="button" className={`btn btn-outline-danger${phone ? "" : " btn-sm"}`} disabled={runs.length === 1} title={runs.length === 1 ? "A batch keeps at least one run" : undefined} onClick={() => props.onRemove(run.key)}>
        Remove
      </button>
    </div>
  );
  const removeTickerButton = (run: BacktestRunView, symbol: string) =>
    run.rows.length > 1 && (
      <button type="button" className="btn btn-icon btn-outline-secondary backtest-icon-button" aria-label={`Remove ${symbol} from Run ${run.runNumber}`} title={`Remove ${symbol} from Run ${run.runNumber}`} onClick={() => props.onRemoveTicker(run.key, symbol)}>
        <IconX size={14} aria-hidden="true" />
      </button>
    );
  const runStatusLines = (run: BacktestRunView): ReactNode =>
    (run.error || run.runProblems.length > 0) && (
      <div className="backtest-ticker-problem" style={{ fontSize: "0.8rem" }} role="alert">
        {run.error && <div>Run {run.runNumber}'s values could not be worked out: {run.error}</div>}
        {run.runProblems.map((problem) => (
          <div key={problem}>{problem}</div>
        ))}
      </div>
    );
  const cellProps = (run: BacktestRunView) => ({
    capitalMode: "pots" as const,
    labelPrefix: `Run ${run.runNumber}`,
    onEditChange: (symbol: string, key: BacktestTickerValueKey, text: string) => props.onEditChange(run.key, symbol, key, text),
    onEditBlur: (symbol: string, key: BacktestTickerValueKey) => props.onEditBlur(run.key, symbol, key),
  });

  const varyField = (scope: string) => (
    <div className="card-body py-3 border-bottom">
      <div className="form-label mb-2">Make runs from a list of values</div>
      <div className="backtest-vary-bar">
        <div className="backtest-vary-field">
          <label className="form-label" htmlFor={`${scope}-vary-key`}>
            Value
          </label>
          <select id={`${scope}-vary-key`} className="form-select backtest-vary-value-select" value={vary.key} onChange={(event) => onVaryChange({ ...vary, key: event.target.value as BatchVaryKey })}>
            {batchVaryChoices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <div className="backtest-vary-field">
          <label className="form-label" htmlFor={`${scope}-vary-ticker`}>
            Ticker
          </label>
          <select id={`${scope}-vary-ticker`} className="form-select backtest-vary-ticker-select" value={vary.ticker} onChange={(event) => onVaryChange({ ...vary, ticker: event.target.value })}>
            <option value="*">Every ticker</option>
            {varyTickers.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </div>
        <div className="backtest-vary-field">
          <label className="form-label" htmlFor={`${scope}-vary-values`}>
            Values
          </label>
          <input id={`${scope}-vary-values`} type="text" className="form-control font-mono backtest-vary-values" placeholder="30, 50, 70" value={vary.text} onChange={(event) => onVaryChange({ ...vary, text: event.target.value })} />
        </div>
        <button type="button" className="btn btn-outline-primary" disabled={!varyPreview.ok} onClick={onApplyVary}>
          {varyPreview.label}
        </button>
      </div>
      {vary.text.trim() !== "" && (
        <div className={`backtest-vary-preview mt-2 ${varyPreview.ok ? "text-secondary" : "backtest-ticker-problem"}`} aria-live="polite">
          {varyPreview.text}
        </div>
      )}
    </div>
  );

  const valuesStrip = (
    <div className="card-body py-3 border-bottom">
      {isPhone ? (
        <>
          <span className="form-label mb-0">Ticker values</span>
          <div className="mt-2">
            <SettingsSourceSwitch value={settingsSource} onChange={onSettingsSourceChange} full />
          </div>
          <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
            {settingsSourceExplanation[settingsSource]}
          </div>
        </>
      ) : (
        <div className="d-flex flex-wrap align-items-center gap-2 column-gap-3">
          <span className="form-label mb-0">Ticker values</span>
          <SettingsSourceSwitch value={settingsSource} onChange={onSettingsSourceChange} />
          <span className="text-secondary" style={{ fontSize: "0.78rem", minWidth: 0 }}>
            {settingsSourceExplanation[settingsSource]}
          </span>
        </div>
      )}
    </div>
  );

  const header = (
    <div className="card-body d-flex align-items-center py-2 border-bottom justify-content-between gap-2 flex-nowrap">
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <BacktestCardTitle title="Runs" description={`each run is its own account · same period and settings · ${runs.length} of ${maxRuns} runs`} />
      </div>
      <div className="d-flex align-items-center gap-2 flex-wrap">
        {resolving && <Spinner size="sm" label="Working out the runs' values" />}
        {anyEdit && !isPhone && (
          <button type="button" className="btn btn-outline-secondary" onClick={onResetAll}>
            Reset ticker values
          </button>
        )}
        {isPhone && <ColumnVisibilityPopover columns={hideableTickerValueColumns.map((column) => ({ key: column.key, header: column.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
      </div>
    </div>
  );
  const legend = <SourceLegend requestMeaning="changed here for this run" closingLine="Each run is its own account and is saved as its own session. The runs queue, a few at a time; within a run the tickers take turns in alphabetical order." />;

  if (isPhone) {
    const field = (run: BacktestRunView, row: TickerRowModel, group: BacktestTickerValueGroup, label: string, wide: boolean) => {
      if (!isColumnVisible(group)) return null;
      const source = tickerRowGroupSource(row, group);
      return (
        <div className={`backtest-ticker-phone-field${wide ? " backtest-ticker-phone-wide" : ""}${source === "request" ? " backtest-ticker-block-changed" : ""}`}>
          <div className="backtest-ticker-phone-label">
            <span>{label}</span>
            <SourceBadge source={source} />
          </div>
          <div className={`backtest-ticker-phone-control${wide ? "" : " backtest-ticker-phone-control-stack"}`}>
            <TickerValueInput row={row} group={group} idPrefix={`backtest-run-phone-${run.key}`} {...cellProps(run)} />
            <ResetGroupButton row={row} group={group} capitalMode="pots" onResetGroup={(symbol, resetGroup) => props.onResetGroup(run.key, symbol, resetGroup)} />
          </div>
        </div>
      );
    };
    return (
      <div className="card mb-3">
        {header}
        {valuesStrip}
        {varyField("backtest-runs-phone")}
        {runs.map((run) => (
          <div key={run.key}>
            <div className="backtest-run-phone-band">
              <div className="d-flex justify-content-between align-items-center gap-2">
                <span className="backtest-run-title">
                  <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                  <span className="backtest-run-name">Run {run.runNumber}</span>
                </span>
                <span className="font-mono" style={{ fontSize: "0.85rem" }}>
                  {formatCurrency(run.capital, 0)}
                </span>
              </div>
              <div className="text-secondary backtest-run-differs">{run.description}</div>
              {runActions(run, true)}
              {runStatusLines(run)}
            </div>
            {run.rows.map((row) => (
              <div key={row.symbol} className="px-3 py-2 border-top">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <BacktestSymbolLink symbol={row.symbol} />
                  <span className="d-flex align-items-center gap-2">
                    {isColumnVisible("weight") && (
                      <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
                        weight <span className="font-mono">{formatPercentage(row.weight, 1)}</span>
                      </span>
                    )}
                    {removeTickerButton(run, row.symbol)}
                  </span>
                </div>
                <div className="backtest-ticker-phone-fields">
                  {field(run, row, "pot", "Pot", true)}
                  {field(run, row, "share", "Share level", false)}
                  {field(run, row, "rungs", "Rungs", false)}
                  {field(run, row, "shock", "Shock", true)}
                  {field(run, row, "delta", "|delta| range", true)}
                </div>
                <ProblemLines row={row} id={`backtest-run-phone-${run.key}-${row.symbol}-problems`} className="mt-1" />
              </div>
            ))}
          </div>
        ))}
        {legend}
        {anyEdit && (
          <div className="card-body pt-0">
            <button type="button" className="btn btn-outline-secondary w-100" onClick={onResetAll}>
              Reset ticker values
            </button>
          </div>
        )}
      </div>
    );
  }

  const shownColumns = tickerValueColumns.filter((column) => column.key === "ticker" || isColumnVisible(column.key));
  const lastKey = shownColumns.at(-1)!.key;
  return (
    <div className="card mb-3">
      {header}
      {valuesStrip}
      {varyField("backtest-runs")}
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0 backtest-ticker-values">
          <thead className="table-light">
            <tr>
              {shownColumns.map((column) => (
                <th key={column.key} className={column.key === "weight" ? "text-end" : undefined} title={column.title}>
                  {column.key === lastKey ? (
                    <div className={`d-flex align-items-center gap-1${column.key === "weight" ? " justify-content-end" : ""}`}>
                      <span>{column.header}</span>
                      <ColumnVisibilityPopover columns={hideableTickerValueColumns.map((entry) => ({ key: entry.key, header: entry.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
                    </div>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Fragment key={run.key}>
                <tr className="backtest-run-band">
                  <td colSpan={shownColumns.length}>
                    <div className="backtest-run-band-inner">
                      <div className="backtest-run-title">
                        <BacktestSeriesSwatch color={batchRunColor(theme, run.runNumber)} line="solid" />
                        <span className="backtest-run-name">Run {run.runNumber}</span>
                        <span className="text-secondary backtest-run-differs">{run.description}</span>
                      </div>
                      <div className="backtest-run-actions">
                        <span className="text-secondary backtest-run-capital">
                          Capital <span className="font-mono text-body">{formatCurrency(run.capital, 0)}</span>
                        </span>
                        {runActions(run, false)}
                      </div>
                    </div>
                    {runStatusLines(run)}
                  </td>
                </tr>
                {run.rows.map((row) => (
                  <Fragment key={row.symbol}>
                    <tr>
                      {shownColumns.map((column) => {
                        if (column.key === "ticker")
                          return (
                            <td key="ticker" className="backtest-ticker-symbol-cell">
                              <div className="backtest-ticker-symbol-line">
                                <BacktestSymbolLink symbol={row.symbol} />
                                {removeTickerButton(run, row.symbol)}
                              </div>
                            </td>
                          );
                        if (column.key === "weight")
                          return (
                            <td key="weight" className="text-end backtest-ticker-weight-cell">
                              {formatPercentage(row.weight, 1)}
                            </td>
                          );
                        const group = column.key;
                        const source = tickerRowGroupSource(row, group);
                        return (
                          <td key={group} className={source === "request" ? "backtest-ticker-value-changed" : undefined}>
                            <div className="backtest-ticker-cell">
                              <TickerValueInput row={row} group={group} idPrefix={`backtest-run-${run.key}`} {...cellProps(run)} />
                              {source && (
                                <div className="backtest-ticker-cell-meta">
                                  <SourceBadge source={source} />
                                  <ResetGroupButton row={row} group={group} capitalMode="pots" onResetGroup={(symbol, resetGroup) => props.onResetGroup(run.key, symbol, resetGroup)} />
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {row.problems.length > 0 && (
                      <tr className="backtest-ticker-error-row">
                        <td colSpan={shownColumns.length}>
                          <ProblemLines row={row} id={`backtest-run-${run.key}-${row.symbol}-problems`} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {legend}
    </div>
  );
}
