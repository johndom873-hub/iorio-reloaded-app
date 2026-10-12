import type { ReactNode } from "react";
import type { BacktestBookFilterValues } from "../../lib/backtestPresentation";

interface BacktestBookFiltersProps {
  idPrefix: string;
  values: BacktestBookFilterValues;
  onChange: (values: BacktestBookFilterValues) => void;
  symbols: string[];
  /** The session's period: the date inputs stay inside it. */
  startDate: string;
  endDate: string;
  /** Extra controls before the dates (the actions' outcome). */
  children?: ReactNode;
}

/** The filters of the paged Actions log and Fills: symbol (on a session with several), and a from / to trading date. */
export function BacktestBookFilters({ idPrefix, values, onChange, symbols, startDate, endDate, children }: BacktestBookFiltersProps) {
  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      {children}
      {symbols.length > 1 && (
        <select className="form-select w-auto" aria-label="Symbol" value={values.symbol} onChange={(event) => onChange({ ...values, symbol: event.target.value })}>
          <option value="">All symbols</option>
          {symbols.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      )}
      <label className="d-inline-flex align-items-center gap-1 mb-0" htmlFor={`${idPrefix}-from`} style={{ fontSize: "0.8rem" }}>
        <span className="text-secondary">From</span>
        <input id={`${idPrefix}-from`} type="date" className="form-control font-mono w-auto" min={startDate} max={values.to || endDate} value={values.from} onChange={(event) => onChange({ ...values, from: event.target.value })} />
      </label>
      <label className="d-inline-flex align-items-center gap-1 mb-0" htmlFor={`${idPrefix}-to`} style={{ fontSize: "0.8rem" }}>
        <span className="text-secondary">to</span>
        <input id={`${idPrefix}-to`} type="date" className="form-control font-mono w-auto" min={values.from || startDate} max={endDate} value={values.to} onChange={(event) => onChange({ ...values, to: event.target.value })} />
      </label>
    </div>
  );
}
