import type { BacktestSettingsSource, BacktestSymbolSettingSource, BacktestTickerValueKey } from "../../api/backtest";
import { backtestValueSourceBadgeClass, backtestValueSourceLabel, backtestValueSourceLegend, backtestValueSourceOrder, backtestValueSourceTitle, type BacktestTickerValueGroup } from "../../lib/backtestPresentation";
import { tickerRowGroupSource, tickerRowResetTarget, type BacktestCapitalMode, type TickerRowModel } from "../../lib/backtestTickerValueEdits";
import { BacktestSegmentedSwitch } from "./backtestBits";

// The pieces of a ticker's values on the New session form (mockup approved 2026-10-15), shared by the one-run Tickers card
// and the several-runs Runs card (mockup approved 2026-10-17): the inputs, where a value comes from, its Reset, its problems.

const settingsSourceOptions: { value: BacktestSettingsSource; label: string }[] = [
  { value: "per_ticker", label: "Per ticker" },
  { value: "global", label: "Global" },
];

export function SettingsSourceSwitch({ value, onChange, full = false }: { value: BacktestSettingsSource; onChange: (source: BacktestSettingsSource) => void; full?: boolean }) {
  return <BacktestSegmentedSwitch options={settingsSourceOptions} value={value} onChange={onChange} ariaLabel="Ticker values" className={full ? "backtest-switch-full" : undefined} />;
}

export function SourceBadge({ source }: { source: BacktestSymbolSettingSource | null }) {
  if (!source) return null;
  return (
    <span className={`badge ${backtestValueSourceBadgeClass[source]}`} title={backtestValueSourceTitle[source]}>
      {backtestValueSourceLabel[source]}
    </span>
  );
}

export interface TickerValueCellProps {
  row: TickerRowModel;
  group: BacktestTickerValueGroup;
  capitalMode: BacktestCapitalMode;
  idPrefix: string;
  onEditChange: (symbol: string, key: BacktestTickerValueKey, text: string) => void;
  /** An input lost focus: a value typed equal to the one under it stops being an edit. */
  onEditBlur: (symbol: string, key: BacktestTickerValueKey) => void;
  /** Prefixed to each input's label: "Run 2" in a batch. */
  labelPrefix?: string;
}

/** A column's input(s) for one ticker; amber text once changed for this session, marked when a problem names it. */
export function TickerValueInput({ row, group, capitalMode, idPrefix, onEditChange, onEditBlur, labelPrefix }: TickerValueCellProps) {
  const { symbol } = row;
  const invalidKeys = new Set(row.problems.map((problem) => problem.key));
  const namePrefix = labelPrefix ? `${labelPrefix} ${symbol}` : symbol;
  const input = (key: BacktestTickerValueKey, label: string, className = "") => {
    const shown = row.display[key];
    const invalid = invalidKeys.has(key);
    return (
      <input
        type="text"
        inputMode={key === "potDollars" || key === "ladderRungs" ? "numeric" : "decimal"}
        id={`${idPrefix}-${symbol}-${key}`}
        className={`form-control font-mono${shown.source === "request" ? " backtest-setting-changed-input" : ""}${invalid ? " is-invalid" : ""} ${className}`.trim()}
        aria-label={`${namePrefix} ${label} for this session`}
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
          aria-label={`${namePrefix} shock for this session`}
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

export function ResetGroupButton({ row, group, capitalMode, onResetGroup }: { row: TickerRowModel; group: BacktestTickerValueGroup; capitalMode: BacktestCapitalMode; onResetGroup: (symbol: string, group: BacktestTickerValueGroup) => void }) {
  if (tickerRowGroupSource(row, group) !== "request" || (group === "pot" && capitalMode === "split")) return null;
  const target = tickerRowResetTarget(row, group);
  return (
    <button type="button" className="btn btn-sm btn-outline-secondary text-nowrap" title={target.title} onClick={() => onResetGroup(row.symbol, group)}>
      {target.text}
    </button>
  );
}

export function ProblemLines({ row, id, className = "" }: { row: TickerRowModel; id: string; className?: string }) {
  if (row.problems.length === 0) return null;
  return (
    <div id={id} className={`backtest-ticker-problem ${className}`.trim()} style={{ fontSize: "0.8rem" }}>
      {row.problems.map((problem) => (
        <div key={`${problem.key}-${problem.text}`}>{problem.text}</div>
      ))}
    </div>
  );
}

/** The sources in precedence order, and a closing line (the turn order with one run, what a run is with several). */
export function SourceLegend({ requestMeaning, closingLine }: { requestMeaning?: string; closingLine: string }) {
  return (
    <div className="card-footer backtest-ticker-legend">
      <div className="text-secondary mb-1">Where a value comes from, the last one winning:</div>
      <ol className="backtest-ticker-legend-list">
        {backtestValueSourceOrder.map((source) => (
          <li key={source}>
            <SourceBadge source={source} />
            <span className="text-secondary">{source === "request" && requestMeaning ? requestMeaning : backtestValueSourceLegend[source]}</span>
          </li>
        ))}
      </ol>
      <div className="text-secondary mt-2">{closingLine}</div>
    </div>
  );
}
