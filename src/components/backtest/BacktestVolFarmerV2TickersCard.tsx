import { Fragment } from "react";
import type { BacktestSettingRow } from "../../api/backtest";
import { isSettingChanged } from "../../lib/backtestPresentation";
import { formatCurrency, formatInputNumber, formatPercentageValueTrimmed } from "../../lib/formatters";
import { allocationTextProblem, excessAllowanceTextProblem, summarizeAllocations, tickerPotDollars, typedAllocationsBySymbol } from "../../lib/tickerAllocation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { BacktestCard, BacktestSymbolLink } from "./backtestBits";

// New session with Vol Farmer v2 deciding (mockup approved 2026-10-28): the tickers share one account, each with its
// allocation of the starting value (typed here, or an equal share of what the typed ones leave) raised by the excess
// allowance, so the pots can add up to more than the account, whose cash they share. The allowance is the lab's setting
// (volFarmerV2.excessAllowancePct), changed here for this session only; the allocations go in the session's overrides.

interface BacktestVolFarmerV2TickersCardProps {
  symbols: string[];
  /** NaN while the starting value is not a dollar amount. */
  startingValue: number;
  allocationTextBySymbol: Record<string, string>;
  onAllocationChange: (symbol: string, text: string) => void;
  onResetAllocations: () => void;
  allowanceRow: BacktestSettingRow;
  allowanceText: string;
  onAllowanceChange: (text: string) => void;
}

const tableId = "backtest-new-session-allocations";
/** The Ticker and Allocation columns always show; the Pot can be hidden. */
const hideableColumns = [{ key: "pot", header: "Pot" }];

export function BacktestVolFarmerV2TickersCard({ symbols, startingValue, allocationTextBySymbol, onAllocationChange, onResetAllocations, allowanceRow, allowanceText, onAllowanceChange }: BacktestVolFarmerV2TickersCardProps) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    hideableColumns.map((column) => column.key),
  );
  const potShown = isColumnVisible("pot");
  const ordered = [...symbols].sort();
  const typed = typedAllocationsBySymbol(ordered, allocationTextBySymbol);
  const allowanceProblem = excessAllowanceTextProblem(allowanceText);
  const labAllowance = typeof allowanceRow.now === "number" ? allowanceRow.now : 0;
  const allowance = allowanceProblem === null ? Number(allowanceText.trim()) : labAllowance;
  const allowanceChanged = isSettingChanged(allowanceRow, allowanceText);
  const summary = summarizeAllocations(
    ordered.map((symbol) => ({ symbol, setPct: typed[symbol] ?? null })),
    allowance,
  );
  const hasStartingValue = startingValue > 0;
  const potOf = (symbol: string) => (hasStartingValue ? tickerPotDollars(startingValue, summary.allocationBySymbol.get(symbol) ?? 0, allowance) : null);
  const allocationTotal = [...summary.allocationBySymbol.values()].reduce((sum, pct) => sum + pct, 0);
  const potsTotal = hasStartingValue ? (startingValue * summary.potsTotalPct) / 100 : null;
  const overFull = summary.setTotalPct > 100 + 1e-9;
  const anyAllocationTyped = ordered.some((symbol) => (allocationTextBySymbol[symbol] ?? "").trim() !== "");
  const equalWho =
    summary.equalSymbols.length === 1 ? (
      <BacktestSymbolLink symbol={summary.equalSymbols[0]!} />
    ) : summary.equalSymbols.length === ordered.length ? (
      `the ${ordered.length} tickers`
    ) : (
      `the other ${summary.equalSymbols.length}`
    );
  // The note's worked example: a ticker on an equal share, else the first one.
  const exampleSymbol = summary.equalSymbols[0] ?? ordered[0];
  const exampleAllocation = exampleSymbol ? (summary.allocationBySymbol.get(exampleSymbol) ?? 0) : 0;
  const exampleShare = (exampleAllocation * (100 + allowance)) / 100;
  const gear = <ColumnVisibilityPopover columns={hideableColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />;

  return (
    <BacktestCard
      title="Tickers"
      description="each ticker's share of the starting value · they share one account and its cash"
      actions={
        anyAllocationTyped && (
          <button type="button" className="btn btn-outline-secondary" onClick={onResetAllocations}>
            Reset allocations
          </button>
        )
      }
      className="mb-3"
    >
      <div className="card-body py-2 border-bottom backtest-allocation-strip">
        <span>
          Starting value <b>{hasStartingValue ? formatCurrency(startingValue, 0) : "—"}</b>
        </span>
        <span className="d-inline-flex align-items-center gap-2">
          <label htmlFor="backtest-excess-allowance" className="mb-0">
            Excess allowance
          </label>
          <span className="input-group backtest-allocation-input">
            <input
              id="backtest-excess-allowance"
              type="text"
              inputMode="decimal"
              className={`form-control font-mono text-end${allowanceChanged ? " backtest-setting-changed-input" : ""}${allowanceProblem ? " is-invalid" : ""}`}
              aria-label="Excess allowance for this session, % over each ticker's allocation"
              value={allowanceText}
              onChange={(event) => onAllowanceChange(event.target.value)}
            />
            <span className="input-group-text">%</span>
          </span>
          {allowanceChanged && (
            <span className="badge backtest-value-source-request" title={`The lab's value is ${formatPercentageValueTrimmed(labAllowance, 4)}`}>
              This session
            </span>
          )}
        </span>
        <span>
          Pots <b>{potsTotal === null ? "—" : formatCurrency(potsTotal, 0)}</b> <span className="text-secondary">({formatPercentageValueTrimmed(summary.potsTotalPct, 1)} of the starting value)</span>
        </span>
        <span className={`backtest-allocation-bar${overFull ? " over" : ""}`} aria-hidden="true">
          {summary.barSegments.map((segment) => (
            <span key={segment.symbol} className={segment.kind} style={{ width: `${segment.widthPct}%` }} />
          ))}
        </span>
        <span>
          Set <b className={overFull ? "text-danger" : undefined}>{formatPercentageValueTrimmed(summary.setTotalPct, 2)}</b>
          {summary.set.length > 0 && (
            <span className="text-secondary">
              {" ("}
              {summary.set.map((entry, index) => (
                <Fragment key={entry.symbol}>
                  {index > 0 && ", "}
                  <BacktestSymbolLink symbol={entry.symbol} /> {formatPercentageValueTrimmed(entry.pct, 4)}
                </Fragment>
              ))}
              )
            </span>
          )}
        </span>
        {summary.equalSharePct !== null && (
          <span>
            Equal share <b>{formatPercentageValueTrimmed(summary.equalSharePct, 2)}</b> each for {equalWho}
          </span>
        )}
      </div>
      {overFull && (
        <div className="card-body py-2 border-bottom text-danger" role="alert" style={{ fontSize: "0.8rem" }}>
          The set allocations come to {formatPercentageValueTrimmed(summary.setTotalPct, 2)}: at most 100% in all. Lower one, or empty one to put it back on an equal share.
        </div>
      )}
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0 backtest-allocation-table" aria-label="Each ticker's allocation">
          <thead className="table-light">
            <tr>
              <th>Ticker</th>
              <th>
                {potShown ? (
                  "Allocation"
                ) : (
                  <div className="d-flex align-items-center gap-1">
                    <span>Allocation</span>
                    {gear}
                  </div>
                )}
              </th>
              {potShown && (
                <th>
                  <div className="d-flex align-items-center justify-content-end gap-1">
                    <span>Pot</span>
                    {gear}
                  </div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ordered.map((symbol) => {
              const text = allocationTextBySymbol[symbol] ?? "";
              const problem = allocationTextProblem(text);
              const isSet = text.trim() !== "";
              const pot = potOf(symbol);
              return (
                <tr key={symbol}>
                  <td className="backtest-allocation-symbol">
                    <BacktestSymbolLink symbol={symbol} />
                  </td>
                  <td className={isSet ? "backtest-ticker-value-changed" : undefined}>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <span className="input-group backtest-allocation-input">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={`form-control font-mono text-end${isSet ? " backtest-setting-changed-input" : ""}${problem ? " is-invalid" : ""}`}
                          aria-label={`${symbol} allocation for this session, % of the starting value (empty: an equal share)`}
                          value={text}
                          placeholder={summary.equalSharePct === null ? "" : formatInputNumber(+summary.equalSharePct.toFixed(2), 2)}
                          onChange={(event) => onAllocationChange(symbol, event.target.value)}
                        />
                        <span className="input-group-text">%</span>
                      </span>
                      {isSet ? (
                        <>
                          <span className="badge backtest-value-source-request">This session</span>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onAllocationChange(symbol, "")}>
                            Equal share
                          </button>
                        </>
                      ) : (
                        <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
                          equal share
                        </span>
                      )}
                    </div>
                    {problem && (
                      <div className="text-danger mt-1" style={{ fontSize: "0.75rem" }}>
                        {problem}
                      </div>
                    )}
                  </td>
                  {potShown && <td className="text-end font-mono">{pot === null ? "—" : formatCurrency(pot, 0)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="table-totals-row">
            <tr>
              <td>Total</td>
              <td className={`font-mono${overFull ? " text-danger" : ""}`}>{formatPercentageValueTrimmed(allocationTotal, 2)}</td>
              {potShown && <td className="text-end font-mono">{potsTotal === null ? "—" : formatCurrency(potsTotal, 0)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
        <div>
          Empty: an equal share of what the set allocations leave (one ticker alone: all of it). A ticker's pot is its allocation raised by the excess allowance, as a share of the account's value at each look, so it moves with the account
          {exampleSymbol && hasStartingValue && (
            <>
              : <BacktestSymbolLink symbol={exampleSymbol} />
              's{" "}
              {allowance > 0 ? (
                <>
                  {formatPercentageValueTrimmed(exampleAllocation, 4)} × {formatInputNumber(1 + allowance / 100, 6)} = {formatPercentageValueTrimmed(exampleShare, 4)}
                </>
              ) : (
                formatPercentageValueTrimmed(exampleAllocation, 4)
              )}{" "}
              of {formatCurrency(startingValue, 0)} = {formatCurrency(potOf(exampleSymbol), 0)} at the start
            </>
          )}
          .{allowance > 0 && " The pots can add up to more than the account: they share its cash."}
        </div>
        <div className="mt-1">Turn order at every look: alphabetical, starting one ticker further each day. When the cash runs short, the ticker whose turn comes later is the one cut; the LEAPS go last.</div>
      </div>
    </BacktestCard>
  );
}
