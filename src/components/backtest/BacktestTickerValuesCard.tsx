import type { ReactNode } from "react";
import type { BacktestSettingRow, BacktestSettingsSource, BacktestSymbolResolution, BacktestSymbolSettingSource, BacktestTickerValueKey } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCurrency, formatPercentage } from "../../lib/formatters";
import {
  backtestValueSourceBadgeClass,
  backtestValueSourceLabel,
  backtestValueSourceLegend,
  backtestValueSourceOrder,
  backtestValueSourceTitle,
  describeTickerProblem,
  describeTickerResetTarget,
  mostSpecificValueSource,
  tickerValueGroupKeys,
  type BacktestTickerValueGroup,
} from "../../lib/backtestPresentation";
import { tickerEditProblems, tickerValueBelowEdit, tickerValueDisplay, type BacktestCapitalMode, type BacktestTickerEdits, type BacktestTickerResolution, type TickerValueDisplay } from "../../lib/backtestTickerValueEdits";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { BacktestCardTitle, BacktestSegmentedSwitch } from "./backtestBits";

const tableId = "backtest-new-session-tickers";

const columns: { key: "ticker" | "weight" | BacktestTickerValueGroup; header: string; title?: string }[] = [
  { key: "ticker", header: "Ticker" },
  { key: "pot", header: "Pot $", title: "The ticker's money. Its weight is its pot ÷ the sum of the pots." },
  { key: "weight", header: "Weight", title: "Pot ÷ the sum of the pots: the ticker's share of the account for its ladder's base, fixed for the session." },
  { key: "share", header: "Share level", title: "The ladder's shares at most, at cost, as a % of the ticker's base; the rest is its puts' reserve." },
  { key: "rungs", header: "Rungs", title: "The reserve is spent in this many puts." },
  { key: "shock", header: "Shock", title: "The fall at which the reserve is fully committed: the stock's Max drawdown in the years before the cycle, within the range, or a fixed %." },
  { key: "delta", header: "|delta| range", title: "The |delta| range of the Calls and Puts sold." },
];
/** The gear lists every column but the ticker's. */
const hideableColumns = columns.filter((column) => column.key !== "ticker");

const settingsSourceOptions: { value: BacktestSettingsSource; label: string }[] = [
  { value: "per_ticker", label: "Per ticker" },
  { value: "global", label: "Global" },
];

const settingsSourceExplanation: Record<BacktestSettingsSource, string> = {
  per_ticker: "Per ticker: each ticker's saved lab values where it has them, the lab's global values for the rest.",
  global: "Global: the lab's global values for every ticker; saved ticker values are left out.",
};

const tickersDescription = "each ticker's pot and ladder values · they share one account and its cash";

export interface BacktestTickerValuesCardProps {
  /** The picked symbols, any order: the rows run in turn order (alphabetical). */
  symbols: string[];
  settingsSource: BacktestSettingsSource;
  onSettingsSourceChange: (source: BacktestSettingsSource) => void;
  capitalMode: BacktestCapitalMode;
  /** With a starting value split equally: that value (NaN while not a valid amount). */
  splitStartingValue: number;
  /** The latest estimate's resolution (it may lag the form by the estimate's pause); null before the first. */
  resolution: BacktestTickerResolution | null;
  resolving: boolean;
  resolutionError: string | null;
  edits: BacktestTickerEdits;
  onEditChange: (symbol: string, key: BacktestTickerValueKey, text: string) => void;
  /** An input lost focus: a value typed equal to the one under it stops being an edit. */
  onEditBlur: (symbol: string, key: BacktestTickerValueKey) => void;
  onResetGroup: (symbol: string, group: BacktestTickerValueGroup) => void;
  onResetAll: () => void;
  settingRows: BacktestSettingRow[];
}

/** One ticker's values as its cells show them, with the reset target of each column. */
interface TickerRowModel {
  symbol: string;
  resolution: BacktestSymbolResolution | undefined;
  display: Record<BacktestTickerValueKey, TickerValueDisplay>;
  weight: number | null;
  problems: { key: string | null; text: string }[];
}

function SourceBadge({ source }: { source: BacktestSymbolSettingSource | null }) {
  if (!source) return null;
  return (
    <span className={`badge ${backtestValueSourceBadgeClass[source]}`} title={backtestValueSourceTitle[source]}>
      {backtestValueSourceLabel[source]}
    </span>
  );
}

function groupKeys(row: TickerRowModel, group: BacktestTickerValueGroup): BacktestTickerValueKey[] {
  return tickerValueGroupKeys(group, String(row.display.ladderShock.value ?? "history"));
}

function groupSource(row: TickerRowModel, group: BacktestTickerValueGroup): BacktestSymbolSettingSource | null {
  return mostSpecificValueSource(groupKeys(row, group).map((key) => row.display[key].source));
}

/** The values a column's Reset returns to: for each of its keys, the value under this session's edit. */
function resetTarget(row: TickerRowModel, group: BacktestTickerValueGroup): { text: string; title: string } {
  const below: Partial<Record<BacktestTickerValueKey, number | string | null>> = {};
  const sources: (BacktestSymbolSettingSource | null)[] = [];
  // The shock's numbers follow the mode it returns to.
  const shockBelow = tickerValueBelowEdit(row.resolution, "ladderShock")?.value ?? row.display.ladderShock.value;
  const keys = group === "shock" ? tickerValueGroupKeys("shock", String(shockBelow ?? "history")) : groupKeys(row, group);
  for (const key of keys) {
    const under = row.display[key].source === "request" ? tickerValueBelowEdit(row.resolution, key) : { value: row.display[key].value, source: row.display[key].source };
    below[key] = under?.value ?? null;
    sources.push(under?.source ?? null);
  }
  const text = describeTickerResetTarget(group, below);
  const source = mostSpecificValueSource(sources);
  return { text, title: text === "Clear" || !source ? "Remove this session's pot: the ticker has no other" : `Back to ${backtestValueSourceTitle[source]}` };
}

interface CellProps {
  row: TickerRowModel;
  group: BacktestTickerValueGroup;
  capitalMode: BacktestCapitalMode;
  idPrefix: string;
  onEditChange: BacktestTickerValuesCardProps["onEditChange"];
  onEditBlur: BacktestTickerValuesCardProps["onEditBlur"];
}

/** A column's input(s) for one ticker; amber text once changed for this session, marked when a problem names it. */
function TickerValueInput({ row, group, capitalMode, idPrefix, onEditChange, onEditBlur }: CellProps) {
  const { symbol } = row;
  const invalidKeys = new Set(row.problems.map((problem) => problem.key));
  const input = (key: BacktestTickerValueKey, label: string, className = "") => {
    const shown = row.display[key];
    const invalid = invalidKeys.has(key);
    return (
      <input
        type="text"
        inputMode={key === "potDollars" || key === "ladderRungs" ? "numeric" : "decimal"}
        id={`${idPrefix}-${symbol}-${key}`}
        className={`form-control font-mono${shown.source === "request" ? " backtest-setting-changed-input" : ""}${invalid ? " is-invalid" : ""} ${className}`.trim()}
        aria-label={`${symbol} ${label} for this session`}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${idPrefix}-${symbol}-problems` : undefined}
        value={shown.text}
        disabled={key === "potDollars" && capitalMode === "split"}
        onChange={(event) => onEditChange(symbol, key, event.target.value)}
        onBlur={() => onEditBlur(symbol, key)}
      />
    );
  };
  if (group === "pot") {
    return (
      <div className="input-group flex-nowrap backtest-ticker-input-pot">
        <span className="input-group-text">$</span>
        {input("potDollars", "pot")}
      </div>
    );
  }
  if (group === "share") {
    return (
      <div className="input-group flex-nowrap backtest-ticker-input-share">
        {input("ladderSharesPct", "share level")}
        <span className="input-group-text">%</span>
      </div>
    );
  }
  if (group === "rungs") return input("ladderRungs", "rungs", "backtest-ticker-input-rungs");
  if (group === "shock") {
    const shock = row.display.ladderShock;
    return (
      <div className="input-group flex-nowrap backtest-ticker-input-shock">
        <select
          className={`form-select${shock.source === "request" ? " backtest-setting-changed-input" : ""}`}
          id={`${idPrefix}-${symbol}-ladderShock`}
          aria-label={`${symbol} shock for this session`}
          value={String(shock.value ?? "history")}
          onChange={(event) => onEditChange(symbol, "ladderShock", event.target.value)}
          onBlur={() => onEditBlur(symbol, "ladderShock")}
        >
          <option value="history">History</option>
          <option value="fixed">Fixed</option>
        </select>
        {shock.value === "fixed" ? (
          <>
            {input("ladderShockPct", "fixed shock")}
            <span className="input-group-text">%</span>
          </>
        ) : (
          <>
            {input("ladderShockMinPct", "shock at least")}
            <span className="input-group-text">–</span>
            {input("ladderShockMaxPct", "shock at most")}
            <span className="input-group-text">%</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="input-group flex-nowrap backtest-ticker-input-delta">
      {input("minAbsDelta", "|delta| from")}
      <span className="input-group-text">–</span>
      {input("maxAbsDelta", "|delta| to")}
    </div>
  );
}

function ResetGroupButton({ row, group, capitalMode, onResetGroup }: { row: TickerRowModel; group: BacktestTickerValueGroup; capitalMode: BacktestCapitalMode; onResetGroup: BacktestTickerValuesCardProps["onResetGroup"] }) {
  if (groupSource(row, group) !== "request" || (group === "pot" && capitalMode === "split")) return null;
  const target = resetTarget(row, group);
  return (
    <button type="button" className="btn btn-sm btn-outline-secondary text-nowrap" title={target.title} onClick={() => onResetGroup(row.symbol, group)}>
      {target.text}
    </button>
  );
}

function ProblemLines({ row, id, className = "" }: { row: TickerRowModel; id: string; className?: string }) {
  if (row.problems.length === 0) return null;
  return (
    <div id={id} className={`backtest-ticker-problem ${className}`.trim()} style={{ fontSize: "0.8rem" }}>
      {row.problems.map((problem) => (
        <div key={`${problem.key}-${problem.text}`}>{problem.text}</div>
      ))}
    </div>
  );
}

function SourceLegend() {
  return (
    <div className="card-footer backtest-ticker-legend">
      <div className="text-secondary mb-1">Where a value comes from, the last one winning:</div>
      <ol className="backtest-ticker-legend-list">
        {backtestValueSourceOrder.map((source) => (
          <li key={source}>
            <SourceBadge source={source} />
            <span className="text-secondary">{backtestValueSourceLegend[source]}</span>
          </li>
        ))}
      </ol>
      <div className="text-secondary mt-2">Turn order at every look: alphabetical. When the cash runs short, the tickers later in the alphabet are the ones cut.</div>
    </div>
  );
}

/**
 * The New session's Tickers card (the Baseline deciding, at least one symbol): each ticker's pot and ladder values, with
 * where each comes from and a Reset back to the value under this session's change; the capital is the sum of the pots.
 * A table on wider screens, one block per ticker on a phone.
 */
export function BacktestTickerValuesCard(props: BacktestTickerValuesCardProps) {
  const { symbols, settingsSource, onSettingsSourceChange, capitalMode, splitStartingValue, resolution, resolving, resolutionError, edits, onEditChange, onEditBlur, onResetGroup, onResetAll, settingRows } = props;
  const isPhone = useMediaQuery("(max-width: 767px)");
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    columns.map((column) => column.key),
  );
  const orderedSymbols = [...symbols].sort();
  const splitPot = capitalMode === "split" && splitStartingValue > 0 && orderedSymbols.length > 0 ? splitStartingValue / orderedSymbols.length : null;
  const localProblems = tickerEditProblems(orderedSymbols, edits, capitalMode);
  const rowsModel: TickerRowModel[] = orderedSymbols.map((symbol) => {
    const symbolResolution = resolution?.bySymbol[symbol];
    const display = Object.fromEntries(
      (["potDollars", "minAbsDelta", "maxAbsDelta", "ladderSharesPct", "ladderRungs", "ladderShock", "ladderShockPct", "ladderShockMinPct", "ladderShockMaxPct"] as BacktestTickerValueKey[]).map((key) => [
        key,
        tickerValueDisplay(symbolResolution, key, edits[symbol]?.[key], { mode: capitalMode, splitPot }),
      ]),
    ) as Record<BacktestTickerValueKey, TickerValueDisplay>;
    const problems = [
      ...localProblems.filter((problem) => problem.symbol === symbol).map((problem) => ({ key: problem.key as string | null, text: problem.message })),
      ...(symbolResolution?.problems ?? []).map((problem) => ({ key: problem.key, text: describeTickerProblem(symbol, problem, settingRows) })),
    ];
    return { symbol, resolution: symbolResolution, display, weight: symbolResolution?.weight ?? null, problems };
  });
  const capital = capitalMode === "split" ? (splitStartingValue > 0 ? splitStartingValue : null) : (resolution?.capital ?? null);
  const totalsNote =
    capital !== null
      ? `${capitalMode === "split" ? `${formatCurrency(capital, 0)} split equally` : "the sum of the pots"} · each ticker's ladder works on its weight of the one account`
      : "known once every ticker has a pot";
  const anyEdit = Object.values(edits).some((symbolEdits) => Object.keys(symbolEdits).length > 0);
  const firstResolution = resolution === null && resolving;

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
      {capitalMode === "split" && (
        <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
          Pots: {splitStartingValue > 0 ? formatCurrency(splitStartingValue, 0) : "the starting value"} split equally (Capital, above).
        </div>
      )}
      {resolutionError && (
        <div className="backtest-ticker-problem mt-2" style={{ fontSize: "0.8rem" }} role="alert">
          The tickers' values could not be worked out: {resolutionError}
        </div>
      )}
    </div>
  );

  const headerActions: ReactNode[] = [];
  if (resolving) headerActions.push(<Spinner key="spinner" size="sm" label="Working out the tickers' values" />);
  if (anyEdit && !isPhone)
    headerActions.push(
      <button key="reset" type="button" className="btn btn-outline-secondary" onClick={onResetAll}>
        Reset ticker values
      </button>,
    );
  if (isPhone)
    headerActions.push(
      <ColumnVisibilityPopover
        key="gear"
        columns={hideableColumns.map((column) => ({ key: column.key, header: column.header }))}
        isColumnVisible={isColumnVisible}
        onToggleColumn={toggleColumn}
      />,
    );

  const header = (
    <div className="card-body d-flex align-items-center py-2 border-bottom justify-content-between gap-2 flex-nowrap">
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <BacktestCardTitle title="Tickers" description={tickersDescription} />
      </div>
      {headerActions.length > 0 && <div className="d-flex align-items-center gap-2 flex-wrap">{headerActions}</div>}
    </div>
  );

  if (firstResolution) {
    return (
      <div className="card mb-3">
        {header}
        {valuesStrip}
        <div className="d-flex justify-content-center py-4">
          <Spinner size="sm" label="Working out the tickers' values" />
        </div>
      </div>
    );
  }

  if (isPhone) {
    const field = (row: TickerRowModel, group: BacktestTickerValueGroup, label: string, wide: boolean) => {
      if (!isColumnVisible(group)) return null;
      const source = groupSource(row, group);
      return (
        <div className={`backtest-ticker-phone-field${wide ? " backtest-ticker-phone-wide" : ""}${source === "request" ? " backtest-ticker-block-changed" : ""}`}>
          <div className="backtest-ticker-phone-label">
            <span>{label}</span>
            <SourceBadge source={source} />
          </div>
          <div className={`backtest-ticker-phone-control${wide ? "" : " backtest-ticker-phone-control-stack"}`}>
            <TickerValueInput row={row} group={group} capitalMode={capitalMode} idPrefix="backtest-ticker-phone" onEditChange={onEditChange} onEditBlur={onEditBlur} />
            <ResetGroupButton row={row} group={group} capitalMode={capitalMode} onResetGroup={onResetGroup} />
          </div>
        </div>
      );
    };
    return (
      <div className="card mb-3">
        {header}
        {valuesStrip}
        {rowsModel.map((row) => (
          <div key={row.symbol} className="px-3 py-2 border-bottom">
            <div className="d-flex align-items-baseline justify-content-between gap-2">
              <span className="fw-semibold">{row.symbol}</span>
              {isColumnVisible("weight") && (
                <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
                  weight <span className="font-mono">{formatPercentage(row.weight, 1)}</span>
                </span>
              )}
            </div>
            <div className="backtest-ticker-phone-fields">
              {field(row, "pot", "Pot", true)}
              {field(row, "share", "Share level", false)}
              {field(row, "rungs", "Rungs", false)}
              {field(row, "shock", "Shock", true)}
              {field(row, "delta", "|delta| range", true)}
            </div>
            <ProblemLines row={row} id={`backtest-ticker-phone-${row.symbol}-problems`} className="mt-1" />
          </div>
        ))}
        <div className="backtest-ticker-phone-totals">
          <div className="px-3 py-2 d-flex align-items-baseline justify-content-between gap-2 fw-bold backtest-ticker-phone-totals-head">
            <span>Capital</span>
            <span className="font-mono">{formatCurrency(capital, 0)}</span>
          </div>
          <div className="px-3 pb-2 text-secondary" style={{ fontSize: "0.75rem" }}>
            {totalsNote}
          </div>
        </div>
        <SourceLegend />
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

  const shownColumns = columns.filter((column) => column.key === "ticker" || isColumnVisible(column.key));
  const lastKey = shownColumns.at(-1)!.key;
  const potShown = isColumnVisible("pot");
  const weightShown = isColumnVisible("weight");
  const restSpan = shownColumns.length - 1 - (potShown ? 1 : 0) - (weightShown ? 1 : 0);

  return (
    <div className="card mb-3">
      {header}
      {valuesStrip}
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0 backtest-ticker-values">
          <thead className="table-light">
            <tr>
              {shownColumns.map((column) => {
                const label = <span>{column.header}</span>;
                return (
                  <th key={column.key} className={column.key === "weight" ? "text-end" : undefined} title={column.title}>
                    {column.key === lastKey ? (
                      <div className={`d-flex align-items-center gap-1${column.key === "weight" ? " justify-content-end" : ""}`}>
                        {label}
                        <ColumnVisibilityPopover columns={hideableColumns.map((entry) => ({ key: entry.key, header: entry.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
                      </div>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsModel.map((row) => [
              <tr key={row.symbol}>
                {shownColumns.map((column) => {
                  if (column.key === "ticker")
                    return (
                      <td key="ticker" className="backtest-ticker-symbol-cell">
                        {row.symbol}
                      </td>
                    );
                  if (column.key === "weight")
                    return (
                      <td key="weight" className="text-end backtest-ticker-weight-cell">
                        {formatPercentage(row.weight, 1)}
                      </td>
                    );
                  const group = column.key;
                  const source = groupSource(row, group);
                  const reset = <ResetGroupButton row={row} group={group} capitalMode={capitalMode} onResetGroup={onResetGroup} />;
                  return (
                    <td key={group} className={source === "request" ? "backtest-ticker-value-changed" : undefined}>
                      <div className="backtest-ticker-cell">
                        <TickerValueInput row={row} group={group} capitalMode={capitalMode} idPrefix="backtest-ticker" onEditChange={onEditChange} onEditBlur={onEditBlur} />
                        {source && (
                          <div className="backtest-ticker-cell-meta">
                            <SourceBadge source={source} />
                            {reset}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>,
              row.problems.length > 0 && (
                <tr key={`${row.symbol}-problems`} className="backtest-ticker-error-row">
                  <td colSpan={shownColumns.length}>
                    <ProblemLines row={row} id={`backtest-ticker-${row.symbol}-problems`} />
                  </td>
                </tr>
              ),
            ])}
          </tbody>
          <tfoot className="table-totals-row">
            <tr>
              <td>Capital</td>
              {potShown && <td className="font-mono">{formatCurrency(capital, 0)}</td>}
              {weightShown && <td className="text-end">{capital !== null ? "100%" : "—"}</td>}
              {restSpan > 0 && (
                <td colSpan={restSpan} className="text-secondary backtest-ticker-totals-note">
                  {totalsNote}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <SourceLegend />
    </div>
  );
}

function SettingsSourceSwitch({ value, onChange, full = false }: { value: BacktestSettingsSource; onChange: (source: BacktestSettingsSource) => void; full?: boolean }) {
  return <BacktestSegmentedSwitch options={settingsSourceOptions} value={value} onChange={onChange} ariaLabel="Ticker values" className={full ? "backtest-switch-full" : undefined} />;
}
