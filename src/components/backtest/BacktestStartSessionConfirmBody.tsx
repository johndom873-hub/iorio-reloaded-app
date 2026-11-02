import type { BacktestTablesMode } from "../../api/backtest";
import { formatCurrency } from "../../lib/formatters";
import { tablesModeLabel } from "../../lib/backtestPresentation";

export interface BacktestStartSessionConfirmBodyProps {
  name: string;
  startDate: string;
  endDate: string;
  /** "whole years 2021 to 2026", or "custom dates". */
  periodNote: string;
  decisionMakerLabel: string;
  startingValue: number;
  symbolCount: number;
  tablesMode: BacktestTablesMode;
  estimateError: string | null;
  /** The settings changed for the session, as sentences. */
  changes: string[];
  warnings: string[];
}

/** The Start session confirmation (mockup approved 2026-10-15, without the CC + Put Ladder's tickers 2026-11-02): the
 *  session's facts, what changed for it, and the estimate's warnings. */
export function BacktestStartSessionConfirmBody(props: BacktestStartSessionConfirmBodyProps) {
  const { name, startDate, endDate, periodNote, decisionMakerLabel, startingValue, symbolCount, tablesMode, estimateError, changes, warnings } = props;
  const tablesText = tablesModeLabel[tablesMode];

  return (
    <div>
      <dl className="backtest-confirm-facts">
        <dt>Name</dt>
        <dd>{name}</dd>
        <dt>Period</dt>
        <dd>
          <span className="font-mono">
            {startDate} → {endDate}
          </span>{" "}
          <span className="text-secondary">· {periodNote}</span>
        </dd>
        <dt>Decision maker</dt>
        <dd>{decisionMakerLabel}</dd>
        <dt>Capital</dt>
        <dd>
          <span className="font-mono">{formatCurrency(startingValue, 0)}</span>
          <span className="text-secondary"> · one account{symbolCount > 1 ? ` for ${symbolCount} tickers` : ""}</span>
        </dd>
        <dt>History tables</dt>
        <dd>{tablesText.charAt(0).toUpperCase() + tablesText.slice(1)}</dd>
      </dl>

      <h4 className="subheader mb-2">Changed for the session</h4>
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

      {estimateError && (
        <div className="backtest-ticker-problem mb-2" style={{ fontSize: "0.8rem" }}>
          {estimateError}
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
