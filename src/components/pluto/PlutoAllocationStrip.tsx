import { Fragment } from "react";
import { IconAlertCircle, IconLock, IconPencil } from "@tabler/icons-react";
import { formatCurrency, pluralize } from "../../lib/formatters";
import { allocationPercentText, allowancePercentText, type PlutoAllocationView } from "../../lib/plutoAllocationEdit";
import { Spinner } from "../Spinner";
import { TickerButton } from "./plutoBits";

// The Tickers tab's allocation strip and Edit allocations' save bar (mockup approved 2026-10-28): the budget, the bar of
// set and equal shares, the excess allowance (typed while editing) with what the pots add up to; the changes and what
// they do to the tickers on an equal share; set allocations over 100% in a danger alert that keeps Save off. Every
// ticker named opens the ticker window.

/** "AAOI, COIN" or "AAOI or COIN": each symbol a ticker button. */
function TickerList({ symbols, onOpenTicker, lastJoin = ", " }: { symbols: string[]; onOpenTicker: (symbol: string) => void; lastJoin?: string }) {
  return (
    <>
      {symbols.map((symbol, index) => (
        <Fragment key={symbol}>
          {index > 0 && (index === symbols.length - 1 ? lastJoin : ", ")}
          <TickerButton symbol={symbol} onOpen={onOpenTicker} />
        </Fragment>
      ))}
    </>
  );
}

interface PlutoAllocationStripProps {
  view: PlutoAllocationView;
  budgetDollars: number | null;
  capitalBudgetPct: number | null;
  /** The allowance as typed while editing; null when not editing. */
  allowanceText: string | null;
  onAllowanceChange: (text: string) => void;
  /** Opens Edit allocations; null hides the button. */
  onEdit: (() => void) | null;
  /** A trader sees the button locked: only an admin may change the allocations (the API refuses a trader too). */
  locked: boolean;
  saving: boolean;
  onOpenTicker: (symbol: string) => void;
}

export function PlutoAllocationStrip({ view, budgetDollars, capitalBudgetPct, allowanceText, onAllowanceChange, onEdit, locked, saving, onOpenTicker }: PlutoAllocationStripProps) {
  const { summary } = view;
  const potsDiffer = Math.abs(summary.potsTotalPct - 100) > 0.005;
  const potsText = `pots add up to ${allocationPercentText(summary.potsTotalPct)} of the budget${potsDiffer && view.potsTotalDollars !== null ? ` (${formatCurrency(view.potsTotalDollars, 0)})` : ""}`;
  return (
    <div className="pm-alloc">
      <span>
        Pluto's budget <b>{budgetDollars === null ? "—" : formatCurrency(budgetDollars, 0)}</b>
        {budgetDollars !== null && capitalBudgetPct !== null && capitalBudgetPct > 0 && <span className="muted"> ({allocationPercentText(capitalBudgetPct)} of last night's {formatCurrency((budgetDollars * 100) / capitalBudgetPct, 0)})</span>}
      </span>
      <span className={`pm-alloc-bar${view.overFull ? " over" : ""}`} aria-hidden="true">
        {summary.barSegments.map((segment) => (
          <span key={segment.symbol} className={segment.kind === "set" ? "set" : "eq"} style={{ width: `${segment.widthPct}%` }} />
        ))}
      </span>
      <span>
        Set <b className={view.overFull ? "t-bad" : undefined}>{allocationPercentText(summary.setTotalPct)}</b>
        {summary.set.length > 0 && (
          <span className="muted">
            {" ("}
            {summary.set.map((entry, index) => (
              <Fragment key={entry.symbol}>
                {index > 0 && ", "}
                <TickerButton symbol={entry.symbol} onOpen={onOpenTicker} /> {allocationPercentText(entry.pct)}
              </Fragment>
            ))}
            )
          </span>
        )}
      </span>
      {summary.equalSharePct !== null && (
        <span>
          Equal share <b>{allocationPercentText(summary.equalSharePct)}</b> each for <TickerList symbols={summary.equalSymbols} onOpenTicker={onOpenTicker} />
        </span>
      )}
      {view.switchedOffSet.length > 0 && (
        <span className="muted">
          {view.switchedOffSet.map((entry, index) => (
            <Fragment key={entry.symbol}>
              {index > 0 && ", "}
              <TickerButton symbol={entry.symbol} onOpen={onOpenTicker} /> {allocationPercentText(entry.pct)}
            </Fragment>
          ))}{" "}
          set while switched off: counted toward the 100%
        </span>
      )}
      {allowanceText !== null ? (
        <span className="pm-alloc-allowance">
          <label htmlFor="pm-alloc-allowance">Excess allowance</label>
          <span className={`pm-input pm-alloc-input${view.allowanceProblem ? " invalid" : ""}`}>
            <input
              id="pm-alloc-allowance"
              type="text"
              inputMode="decimal"
              aria-label="Excess allowance, % over each ticker's allocation"
              value={allowanceText}
              onChange={(event) => onAllowanceChange(event.target.value)}
              disabled={saving}
            />
            <span className="unit">%</span>
          </span>
          <span className="muted">{potsText}</span>
        </span>
      ) : (
        <span>
          Excess allowance <b>{allowancePercentText(view.allowancePct)}</b> <span className="muted">{potsText}</span>
        </span>
      )}
      {allowanceText === null && onEdit && (
        <button type="button" className="pm-btn sm pm-alloc-edit" onClick={onEdit} disabled={locked} title={locked ? "Only an admin can change the allocations." : undefined}>
          {locked ? <IconLock size={14} aria-hidden="true" /> : <IconPencil size={14} aria-hidden="true" />}
          Edit allocations
        </button>
      )}
    </div>
  );
}

interface PlutoAllocationSaveBarProps {
  view: PlutoAllocationView;
  saving: boolean;
  saveError: string | null;
  onCancel: () => void;
  onSave: () => void;
  onOpenTicker: (symbol: string) => void;
}

export function PlutoAllocationSaveBar({ view, saving, saveError, onCancel, onSave, onOpenTicker }: PlutoAllocationSaveBarProps) {
  const buttons = (
    <span className="pm-alloc-savebar-actions">
      <button type="button" className="pm-btn" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button type="button" className="pm-btn primary" onClick={onSave} disabled={saving || view.request === null}>
        {saving && <Spinner size="sm" />}
        Save allocations
      </button>
    </span>
  );
  if (view.overFull) {
    const setSymbols = [...view.summary.set.map((entry) => entry.symbol), ...view.switchedOffSet.map((entry) => entry.symbol)];
    const switchedOffSymbols = view.switchedOffSet.map((entry) => entry.symbol);
    const equalSymbols = view.summary.equalSymbols;
    return (
      <div className="pm-alert pm-alloc-savebar" role="alert">
        <IconAlertCircle size={18} className="ic flex-shrink-0" aria-hidden="true" />
        <div className="pm-alloc-savebar-body">
          <div className="strong fw-semibold">The set allocations come to {allocationPercentText(view.setTotalAllPct)}: at most 100% in all</div>
          <div>
            Lower <TickerList symbols={setSymbols} onOpenTicker={onOpenTicker} lastJoin=" or " />, or empty one to put it back on an equal share.
            {switchedOffSymbols.length > 0 && (
              <>
                {" "}
                <TickerList symbols={switchedOffSymbols} onOpenTicker={onOpenTicker} lastJoin=" and " />, switched off, still {switchedOffSymbols.length === 1 ? "counts" : "count"}.
              </>
            )}
            {equalSymbols.length === 1 && (
              <>
                {" "}
                As typed, <TickerButton symbol={equalSymbols[0]!} onOpen={onOpenTicker} />, on an equal share, would get nothing.
              </>
            )}
            {equalSymbols.length > 1 && ` As typed, the ${equalSymbols.length} tickers on an equal share would get nothing.`}
          </div>
          {saveError && <div className="t-bad">{saveError}</div>}
        </div>
        {buttons}
      </div>
    );
  }
  return (
    <div className="pm-savebar pm-alloc-savebar" role="status">
      <i className="pend" aria-hidden="true" />
      <div className="pm-alloc-savebar-body">
        {view.changes.length === 0 ? (
          <span className="muted">No changes yet: type a ticker's allocation, or empty one to put it on an equal share.</span>
        ) : (
          <>
            <b className="strong">{pluralize(view.changes.length, "change")}:</b>{" "}
            {view.changes.map((change, index) => (
              <Fragment key={change.symbol ?? "allowance"}>
                {index > 0 && ", "}
                {change.symbol && (
                  <>
                    <TickerButton symbol={change.symbol} onOpen={onOpenTicker} />{" "}
                  </>
                )}
                {change.detail}
              </Fragment>
            ))}
            .{view.knockOn && ` ${view.knockOn}`}
          </>
        )}
        {view.problems.length > 0 && <div className="t-bad">{view.problems.join(" ")}</div>}
        {saveError && <div className="t-bad">{saveError}</div>}
      </div>
      {buttons}
    </div>
  );
}
