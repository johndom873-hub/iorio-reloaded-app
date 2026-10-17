import type { ReactNode } from "react";
import type { BacktestSettingRow, BacktestSettingsSource, BacktestTickerValueKey } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCurrency, formatPercentage } from "../../lib/formatters";
import type { BacktestTickerValueGroup } from "../../lib/backtestPresentation";
import {
  buildTickerRowModels,
  hideableTickerValueColumns,
  tickerRowGroupSource,
  tickerValueColumns,
  type BacktestCapitalMode,
  type BacktestTickerEdits,
  type BacktestTickerResolution,
  type TickerRowModel,
} from "../../lib/backtestTickerValueEdits";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { BacktestCardTitle, BacktestSymbolLink } from "./backtestBits";
import { ProblemLines, ResetGroupButton, SettingsSourceSwitch, SourceBadge, SourceLegend, TickerValueInput } from "./BacktestTickerValueParts";

const tableId = "backtest-new-session-tickers";
const columns = tickerValueColumns;
const hideableColumns = hideableTickerValueColumns;

const settingsSourceExplanation: Record<BacktestSettingsSource, string> = {
  per_ticker: "Per ticker: each ticker's saved lab values where it has them, the lab's global values for the rest.",
  global: "Global: the lab's global values for every ticker; saved ticker values are left out.",
};

const tickersDescription = "each ticker's pot and ladder values · they share one account and its cash";
const turnOrderLine = "Turn order at every look: alphabetical. When the cash runs short, the tickers later in the alphabet are the ones cut.";

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

const groupSource = tickerRowGroupSource;

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
  const rowsModel: TickerRowModel[] = buildTickerRowModels({ symbols, edits, resolution, capitalMode, splitStartingValue, settingRows });
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
              <BacktestSymbolLink symbol={row.symbol} />
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
        <SourceLegend closingLine={turnOrderLine} />
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
                        <BacktestSymbolLink symbol={row.symbol} />
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
      <SourceLegend closingLine={turnOrderLine} />
    </div>
  );
}
