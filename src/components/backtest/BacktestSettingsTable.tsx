import type { BacktestSettingRow } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { describeUnavailableChoices, formatSettingRowValue, gradeOptions, isSettingChanged, settingUnitSuffix, settingValueProblem, tradeGradeLabel } from "../../lib/backtestPresentation";

interface BacktestSettingsTableProps {
  rows: BacktestSettingRow[];
  valueByPath: Record<string, string>;
  onValueChange: (path: string, value: string) => void;
  onReset: (path: string) => void;
  /** The Baseline deciding with per-ticker pots: the per-ticker rows say so, with a line on how they meet the Tickers card. */
  showPerTicker?: boolean;
}

const perTickerGroup = "Baseline wheel";
const perTickerExplanation = "A change here goes to every ticker, over its lab value; a value set under Tickers still wins.";

function groupedRows(rows: BacktestSettingRow[]): { group: string; rows: BacktestSettingRow[] }[] {
  const groups: { group: string; rows: BacktestSettingRow[] }[] = [];
  for (const row of rows) {
    const existing = groups.find((entry) => entry.group === row.group);
    if (existing) existing.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}

/** What is off in a choice row (a choice that cannot be picked yet), under its select so it shows without opening the list. */
function UnavailableChoicesHint({ row }: { row: BacktestSettingRow }) {
  const lines = describeUnavailableChoices(row);
  if (lines.length === 0) return null;
  return (
    <div className="text-secondary mt-1" style={{ fontSize: "0.75rem", lineHeight: 1.35 }}>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

/** A setting's input: a select for a choice or grade, else a number with its unit. Shared with the Lab settings section. */
export function SettingInput({ row, value, changed, invalid, onValueChange, ariaLabel }: { row: BacktestSettingRow; value: string; changed: boolean; invalid: boolean; onValueChange: (value: string) => void; ariaLabel?: string }) {
  const changedClass = changed ? " backtest-setting-changed-input" : "";
  const label = ariaLabel ?? `${row.label} for this session`;
  if (row.unit === "choice") {
    const choices = row.choices ?? [];
    return (
      <div className="backtest-setting-choice">
        <select className={`form-select${changedClass}${invalid ? " is-invalid" : ""}`} aria-label={label} aria-invalid={invalid || undefined} value={value} onChange={(event) => onValueChange(event.target.value)}>
          {!choices.some((choice) => choice.value === value) && <option value={value}>{value}</option>}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value} disabled={Boolean(choice.unavailableReason)} title={choice.unavailableReason}>
              {choice.unavailableReason ? `${choice.label} (${choice.unavailableReason})` : choice.label}
            </option>
          ))}
        </select>
        <UnavailableChoicesHint row={row} />
      </div>
    );
  }
  if (row.unit === "grade") {
    const options = gradeOptions.includes(value as (typeof gradeOptions)[number]) ? gradeOptions : [...gradeOptions, value];
    return (
      <select className={`form-select${changedClass}`} style={{ width: "8rem" }} aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {tradeGradeLabel(option)}
          </option>
        ))}
      </select>
    );
  }
  const suffix = settingUnitSuffix[row.unit];
  return (
    <div className="input-group flex-nowrap" style={{ width: "9.5rem" }}>
      {row.unit === "dollars" && <span className="input-group-text">$</span>}
      <input
        type="text"
        inputMode="decimal"
        className={`form-control font-mono${changedClass}${invalid ? " is-invalid" : ""}`}
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {suffix && <span className="input-group-text">{suffix}</span>}
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onReset}>
      Reset
    </button>
  );
}

function PerTickerMark() {
  return (
    <div className="text-secondary fw-normal" style={{ fontSize: "0.75rem" }}>
      per ticker
    </div>
  );
}

function PerTickerIntro() {
  return (
    <>
      Rows marked <strong>per ticker</strong> can differ by ticker. {perTickerExplanation}
    </>
  );
}

function rowState(row: BacktestSettingRow, valueByPath: Record<string, string>) {
  const value = valueByPath[row.path] ?? String(row.now);
  return {
    value,
    changed: row.editable && isSettingChanged(row, value),
    invalid: row.editable && settingValueProblem(row, value) !== null,
    note: row.note ?? (row.editable ? null : "Read-only in a backtest."),
    /** A choice's values are sentences: they wrap and read in the text font, not the numbers' mono. */
    isChoice: row.unit === "choice",
  };
}

/** "Lab now" vs "This session": rows, groups, labels, choices and notes come from the API's settings template (the backtesting
 *  lab's values). A table on wider screens; on a phone each setting stacks (label and note, then the lab's value and the
 *  session's input). */
export function BacktestSettingsTable({ rows, valueByPath, onValueChange, onReset, showPerTicker = false }: BacktestSettingsTableProps) {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const groups = groupedRows(rows);

  if (isPhone) {
    return (
      <div>
        {groups.map(({ group, rows: groupRows }) => (
          <section key={group}>
            <div className="backtest-settings-group-band px-3 py-1">
              <h4 className="subheader mb-0">{group}</h4>
            </div>
            {showPerTicker && group === perTickerGroup && (
              <div className="px-3 py-2 border-bottom text-secondary" style={{ fontSize: "0.78rem" }}>
                <PerTickerIntro />
              </div>
            )}
            {groupRows.map((row) => {
              const { value, changed, invalid, note, isChoice } = rowState(row, valueByPath);
              const control = row.editable ? (
                <SettingInput row={row} value={value} changed={changed} invalid={invalid} onValueChange={(next) => onValueChange(row.path, next)} />
              ) : (
                <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
                  fixed
                </span>
              );
              return (
                <div key={row.path} className={`px-3 py-2 border-bottom${changed ? " backtest-setting-changed-block" : ""}`}>
                  <div className="fw-medium">{row.label}</div>
                  {showPerTicker && row.perTicker && <PerTickerMark />}
                  {note && (
                    <div className="text-secondary" style={{ fontSize: "0.75rem", lineHeight: 1.35 }}>
                      {note}
                    </div>
                  )}
                  {isChoice ? (
                    <>
                      <div className="text-secondary mt-1" style={{ fontSize: "0.78rem" }}>
                        Lab now: {formatSettingRowValue(row, row.now)}
                      </div>
                      {row.editable && (
                        <div className="d-flex align-items-start gap-2 mt-1">
                          <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            {control}
                          </div>
                          {changed && <ResetButton onReset={() => onReset(row.path)} />}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="d-flex align-items-center gap-2 mt-1">
                      <span className="text-secondary text-nowrap" style={{ fontSize: "0.78rem" }}>
                        Lab now <span className="font-mono">{formatSettingRowValue(row, row.now)}</span>
                      </span>
                      <span className="ms-auto d-inline-flex align-items-center gap-2">
                        {changed && <ResetButton onReset={() => onReset(row.path)} />}
                        {control}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm table-vcenter card-table mb-0">
        <thead className="table-light">
          <tr>
            <th>Setting</th>
            <th>Lab now</th>
            <th>This session</th>
            <th>Note</th>
            <th>
              <span className="visually-hidden">Reset</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, rows: groupRows }) => [
            <tr key={`group-${group}`} className="backtest-settings-group-row">
              <td colSpan={5}>
                <span className="subheader">{group}</span>
              </td>
            </tr>,
            showPerTicker && group === perTickerGroup && (
              <tr key={`group-${group}-per-ticker`}>
                <td colSpan={5} className="text-secondary" style={{ fontSize: "0.78rem", whiteSpace: "normal" }}>
                  <PerTickerIntro />
                </td>
              </tr>
            ),
            ...groupRows.map((row) => {
              const { value, changed, invalid, note, isChoice } = rowState(row, valueByPath);
              const nowClassName = isChoice ? "text-secondary backtest-setting-choice-now" : "font-mono text-secondary text-nowrap";
              return (
                <tr key={row.path} className={changed ? "backtest-setting-changed" : undefined}>
                  <td className="fw-medium">
                    {row.label}
                    {showPerTicker && row.perTicker && <PerTickerMark />}
                  </td>
                  <td className={nowClassName}>{formatSettingRowValue(row, row.now)}</td>
                  <td>
                    {row.editable ? (
                      <SettingInput row={row} value={value} changed={changed} invalid={invalid} onValueChange={(next) => onValueChange(row.path, next)} />
                    ) : (
                      <span className={nowClassName}>{formatSettingRowValue(row, row.now)}</span>
                    )}
                  </td>
                  <td className="text-secondary backtest-wrapping-note">{note}</td>
                  <td className="text-end">{changed && <ResetButton onReset={() => onReset(row.path)} />}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}
