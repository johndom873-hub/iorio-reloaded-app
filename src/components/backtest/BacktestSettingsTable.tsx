import type { BacktestSettingRow } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatBacktestSettingValue, gradeOptions, isSettingChanged, settingUnitSuffix, settingValueProblem, tradeGradeLabel } from "../../lib/backtestPresentation";

interface BacktestSettingsTableProps {
  rows: BacktestSettingRow[];
  valueByPath: Record<string, string>;
  onValueChange: (path: string, value: string) => void;
  onReset: (path: string) => void;
}

function groupedRows(rows: BacktestSettingRow[]): { group: string; rows: BacktestSettingRow[] }[] {
  const groups: { group: string; rows: BacktestSettingRow[] }[] = [];
  for (const row of rows) {
    const existing = groups.find((entry) => entry.group === row.group);
    if (existing) existing.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}

function SettingInput({ row, value, changed, invalid, onValueChange }: { row: BacktestSettingRow; value: string; changed: boolean; invalid: boolean; onValueChange: (value: string) => void }) {
  const changedClass = changed ? " backtest-setting-changed-input" : "";
  const label = `${row.label} for this session`;
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
    <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.75rem" }} onClick={onReset}>
      Reset
    </button>
  );
}

function rowState(row: BacktestSettingRow, valueByPath: Record<string, string>) {
  const value = valueByPath[row.path] ?? String(row.now);
  return {
    value,
    changed: row.editable && isSettingChanged(row, value),
    invalid: row.editable && settingValueProblem(row, value) !== null,
    note: row.note ?? (row.editable ? null : "Read-only in a backtest."),
  };
}

/** "Pluto now" vs "This session": rows, groups, labels and notes come from the API's settings template. A table on wider
 *  screens; on a phone each setting stacks (label and note, then Pluto's value and the session's input). */
export function BacktestSettingsTable({ rows, valueByPath, onValueChange, onReset }: BacktestSettingsTableProps) {
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
            {groupRows.map((row) => {
              const { value, changed, invalid, note } = rowState(row, valueByPath);
              return (
                <div key={row.path} className={`px-3 py-2 border-bottom${changed ? " backtest-setting-changed-block" : ""}`}>
                  <div className="fw-medium">{row.label}</div>
                  {note && (
                    <div className="text-secondary" style={{ fontSize: "0.75rem", lineHeight: 1.35 }}>
                      {note}
                    </div>
                  )}
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <span className="text-secondary text-nowrap" style={{ fontSize: "0.78rem" }}>
                      Pluto now <span className="font-mono">{formatBacktestSettingValue(row.unit, row.now)}</span>
                    </span>
                    <span className="ms-auto d-inline-flex align-items-center gap-2">
                      {changed && <ResetButton onReset={() => onReset(row.path)} />}
                      {row.editable ? (
                        <SettingInput row={row} value={value} changed={changed} invalid={invalid} onValueChange={(next) => onValueChange(row.path, next)} />
                      ) : (
                        <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
                          fixed
                        </span>
                      )}
                    </span>
                  </div>
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
            <th>Pluto now</th>
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
            ...groupRows.map((row) => {
              const { value, changed, invalid, note } = rowState(row, valueByPath);
              return (
                <tr key={row.path} className={changed ? "backtest-setting-changed" : undefined}>
                  <td className="fw-medium">{row.label}</td>
                  <td className="font-mono text-secondary text-nowrap">{formatBacktestSettingValue(row.unit, row.now)}</td>
                  <td>
                    {row.editable ? (
                      <SettingInput row={row} value={value} changed={changed} invalid={invalid} onValueChange={(next) => onValueChange(row.path, next)} />
                    ) : (
                      <span className="font-mono text-secondary text-nowrap">{formatBacktestSettingValue(row.unit, row.now)}</span>
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
