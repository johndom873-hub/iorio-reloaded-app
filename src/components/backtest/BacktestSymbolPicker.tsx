import { useState } from "react";
import { backtestMaxSymbolsPerSession, type BacktestDataFileSummary } from "../../api/backtest";
import { formatNumber, pluralizeCount } from "../../lib/formatters";

/** Above this many files the list gets a filter box. */
const filterFromFileCount = 8;

interface BacktestSymbolPickerProps {
  /** Downloaded files with a first and last date. */
  files: BacktestDataFileSummary[];
  selected: string[];
  onChange: (symbols: string[]) => void;
  invalid: boolean;
}

/** What a file row says under its symbol: its period, and what would change a session on it (missing weekdays, days without
 *  intraday quotes). */
function describeFileFacts(file: BacktestDataFileSummary): { text: string; className: string }[] {
  const facts = [{ text: `${file.firstDate} → ${file.lastDate}`, className: "text-secondary font-mono" }];
  if (file.missingWeekdays > 0) facts.push({ text: `${pluralizeCount(file.missingWeekdays, "weekday")} missing: Update it first`, className: "iorio-note-amber" });
  if (file.intradayDays === null) facts.push({ text: "no intraday quotes yet: one look a day, at 10:00", className: "text-secondary" });
  else if (file.intradayDays < file.completeDays) facts.push({ text: `intraday quotes on ${formatNumber(file.intradayDays)} of ${formatNumber(file.completeDays)} days`, className: "text-secondary" });
  return facts;
}

/** The session's symbols: a checkbox per downloaded file, up to backtestMaxSymbolsPerSession, in the order picked (the
 *  session's book keeps that order). The symbols share one book; the period must lie inside every picked file. */
export function BacktestSymbolPicker({ files, selected, onChange, invalid }: BacktestSymbolPickerProps) {
  const [filterText, setFilterText] = useState("");
  const atLimit = selected.length >= backtestMaxSymbolsPerSession;
  const filter = filterText.trim().toUpperCase();
  const shownFiles = filter === "" ? files : files.filter((file) => file.symbol.includes(filter));
  const hiddenPickedCount = selected.filter((symbol) => !shownFiles.some((file) => file.symbol === symbol)).length;

  const toggle = (symbol: string) => {
    if (selected.includes(symbol)) onChange(selected.filter((entry) => entry !== symbol));
    else if (!atLimit) onChange([...selected, symbol]);
  };

  return (
    <fieldset>
      <legend className="form-label mb-1 d-flex flex-wrap justify-content-between align-items-baseline gap-2" style={{ fontSize: "inherit" }}>
        <span>Symbols (downloaded files)</span>
        <span className={`fw-normal ${atLimit ? "iorio-note-amber" : "text-secondary"}`} style={{ fontSize: "0.75rem" }}>
          {selected.length} of {backtestMaxSymbolsPerSession} at most{atLimit ? ": the most one session takes" : ""}
        </span>
      </legend>
      {files.length > filterFromFileCount && (
        <input type="search" className="form-control mb-2" placeholder="Filter symbols" aria-label="Filter symbols" value={filterText} onChange={(event) => setFilterText(event.target.value)} />
      )}
      <div className={`backtest-symbol-picker border rounded${invalid ? " border-danger" : ""}`} role="group" aria-label="Symbols">
        {shownFiles.length === 0 && (
          <div className="text-secondary p-2" style={{ fontSize: "0.8rem" }}>
            No downloaded file matches.
          </div>
        )}
        {hiddenPickedCount > 0 && (
          <div className="text-secondary px-3 py-2 border-bottom" style={{ fontSize: "0.75rem" }}>
            {hiddenPickedCount} picked {hiddenPickedCount === 1 ? "symbol is" : "symbols are"} outside the filter and stay picked.
          </div>
        )}
        {shownFiles.map((file) => {
          const checked = selected.includes(file.symbol);
          const disabled = !checked && atLimit;
          return (
            <label key={file.symbol} className={`backtest-symbol-row${checked ? " backtest-symbol-row-picked" : ""}${disabled ? " text-secondary" : ""}`}>
              <input type="checkbox" className="form-check-input mt-0 flex-shrink-0" checked={checked} disabled={disabled} onChange={() => toggle(file.symbol)} />
              <span className="fw-semibold backtest-symbol-name">{file.symbol}</span>
              <span className="d-flex flex-wrap column-gap-2 row-gap-0" style={{ fontSize: "0.75rem", minWidth: 0 }}>
                {describeFileFacts(file).map((fact) => (
                  <span key={fact.text} className={fact.className}>
                    {fact.text}
                  </span>
                ))}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
