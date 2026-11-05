import { Fragment, useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { fetchPlutoVolFarmerV4, type PlutoVolFarmerV4ActionState, type PlutoVolFarmerV4Position, type PlutoVolFarmerV4Ticker } from "../../api/pluto";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatNumber, formatOptionContractLabel, daysToExpiry, pluralize, todayInEasternIso } from "../../lib/formatters";
import { describeVolFarmerV4CancelledToday, describeVolFarmerV4LastOrder, describeVolFarmerV4LeapsHeld, describeVolFarmerV4Option, describeVolFarmerV4WorkingOrder, volFarmerV4LastRoundLines, volFarmerV4Warnings } from "../../lib/plutoVolFarmerV4Presentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { StrategyBadge } from "../StrategyBadge";
import { TickerButton, WarningIcon } from "./plutoBits";

// The Live tab's Vol Farmer v4 card (approved mockup https://claude.ai/artifact/QGwKxNa7orZFFjfeRBnhoU, 2026-10-28): each
// v4 ticker's two positions and LEAPS as v4's memory counts them, its working orders and what its last round said, with
// the warnings its last round's figures raise. Loaded again after every round. The Next action column (approved mockup,
// 2026-11-05) says what v4 does next on the ticker and what stops it; "All actions" lists the six things v4 can do.

interface PlutoVolFarmerV4CardProps {
  /** Pluto's last round: the card loads again when it changes. */
  lastPassAt: string | null;
  isPhone: boolean;
  onOpenTicker: (symbol: string) => void;
}

const columns = [
  { key: "ticker", header: "Ticker" },
  { key: "first", header: "First position" },
  { key: "firstBreakEven", header: "B-E¹", align: "right" },
  { key: "second", header: "Second position" },
  { key: "secondBreakEven", header: "B-E²", align: "right" },
  { key: "leaps", header: "LEAPS" },
  { key: "nextAction", header: "Next action" },
  { key: "lastRound", header: "Last round" },
] as const;

const dash = <span className="muted">—</span>;

const actionChips: Record<PlutoVolFarmerV4ActionState, { className: string; label: string }> = {
  ready: { className: "pm-b ok", label: "Ready" },
  working: { className: "pm-b info", label: "Working" },
  waiting: { className: "pm-b info", label: "Waiting" },
  blocked: { className: "pm-b warn", label: "Blocked" },
  not_due: { className: "pm-b neutral", label: "Not due" },
  done: { className: "pm-b neutral", label: "Done" },
  stopped: { className: "pm-b bad", label: "Stopped" },
};

function NextActionCell({ ticker, open, onToggle }: { ticker: PlutoVolFarmerV4Ticker; open: boolean; onToggle: () => void }) {
  const { nextAction } = ticker;
  const chip = actionChips[nextAction.state];
  return (
    <>
      <div className="pm-v4-next">
        <span className={chip.className}>{chip.label}</span>
        <span className="strong">{nextAction.text}</span>
      </div>
      {nextAction.sub && <span className="pm-cell-sub pm-v4-sub" title={nextAction.sub}>{nextAction.sub}</span>}
      {nextAction.alert && (
        <span className="pm-v4-alert">
          <WarningIcon />
          {nextAction.alert}
        </span>
      )}
      {ticker.actions.length > 0 && (
        <button type="button" className="pm-v4-more" aria-expanded={open} onClick={onToggle}>
          {open ? "Hide actions" : "All actions"}
          {open ? <IconChevronUp className="ic" /> : <IconChevronDown className="ic" />}
        </button>
      )}
    </>
  );
}

function ActionsList({ ticker }: { ticker: PlutoVolFarmerV4Ticker }) {
  return (
    <table className="pm-v4-actions">
      <tbody>
        {ticker.actions.map((action) => {
          const chip = actionChips[action.state];
          return (
            <tr key={action.key}>
              <td className="strong">{action.name}</td>
              <td><span className={chip.className}>{chip.label}</span></td>
              <td className={action.state === "blocked" ? "t-warn" : undefined}>{action.detail}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PositionCell({ position, kind, todayIso }: { position: PlutoVolFarmerV4Position | null; kind: "first" | "second"; todayIso: string }) {
  if (position === null) return dash;
  const options = [...position.calls.map((call) => describeVolFarmerV4Option(call, "C", todayIso)), ...position.puts.map((put) => describeVolFarmerV4Option(put, "P", todayIso))];
  return (
    <>
      <span className="strong">{position.shares > 0 ? `${formatNumber(position.shares)} shares` : "Selling Puts"}</span>
      {kind === "second" && position.shares > 0 && <span className="pm-cell-sub">from Puts assigned at {formatCurrency(position.costPerShare)}</span>}
      {options.map((line, index) => (
        <span key={index} className="pm-cell-sub pm-v4-option">{line}</span>
      ))}
      {position.shares > 0 && position.calls.length === 0 && <span className="pm-cell-sub">no Call open</span>}
    </>
  );
}

function LeapsCell({ leaps, todayIso }: { leaps: PlutoVolFarmerV4Ticker["leaps"]; todayIso: string }) {
  if (leaps === null) return dash;
  return (
    <>
      <span className="pm-v4-leaps">
        <StrategyBadge strategyKey="leaps" />
        {formatOptionContractLabel({ strike: leaps.strike, right: "C", expiry: leaps.expiry, dte: daysToExpiry(leaps.expiry, todayIso) })}
      </span>
      <span className="pm-cell-sub">{describeVolFarmerV4LeapsHeld(leaps)}</span>
    </>
  );
}

function LastRoundCell({ ticker, todayIso }: { ticker: PlutoVolFarmerV4Ticker; todayIso: string }) {
  return (
    <>
      {ticker.workingOrders.length > 0 && <span className="pm-b neutral">{pluralize(ticker.workingOrders.length, "working order")}</span>}
      {ticker.workingOrders.map((order, index) => (
        <span key={`order-${index}`} className="pm-cell-sub">{describeVolFarmerV4WorkingOrder(order, todayIso)}</span>
      ))}
      {volFarmerV4LastRoundLines(ticker).map((line, index) => (
        <span key={`note-${index}`} className="pm-cell-sub pm-v4-note" title={line}>{line}</span>
      ))}
      {ticker.lastOrder && <span className="pm-cell-sub pm-v4-note" title={describeVolFarmerV4LastOrder(ticker.lastOrder)}>{describeVolFarmerV4LastOrder(ticker.lastOrder)}</span>}
      {ticker.cancelledToday > 0 && <span className="pm-cell-sub">{describeVolFarmerV4CancelledToday(ticker.cancelledToday)}</span>}
    </>
  );
}

function breakEvenCell(position: PlutoVolFarmerV4Position | null): ReactNode {
  return position?.breakEvenPerShare != null ? formatCurrency(position.breakEvenPerShare) : dash;
}

function tickerSub(ticker: PlutoVolFarmerV4Ticker): string | null {
  if (ticker.waiting) return ticker.lastRoundAt === null ? "not looked at yet" : "waiting";
  return ticker.adoptedAt ? `adopted ${formatBrowserDayMonth(ticker.adoptedAt)}` : null;
}

export function PlutoVolFarmerV4Card({ lastPassAt, isPhone, onOpenTicker }: PlutoVolFarmerV4CardProps) {
  const [tickers, setTickers] = useState<PlutoVolFarmerV4Ticker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openActions, setOpenActions] = useState<ReadonlySet<string>>(new Set());
  const toggleActions = (symbol: string) =>
    setOpenActions((current) => {
      const next = new Set(current);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-vol-farmer-v4", columns.map((column) => column.key));

  useEffect(() => {
    let cancelled = false;
    fetchPlutoVolFarmerV4()
      .then((loaded) => {
        if (cancelled) return;
        setTickers(loaded);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load Vol Farmer v4's tickers."));
      });
    return () => {
      cancelled = true;
    };
  }, [lastPassAt]);

  // No v4 ticker: the card stays out of the way.
  if (tickers !== null && tickers.length === 0 && error === null) return null;

  const todayIso = todayInEasternIso();
  const lastRoundAt = (tickers ?? []).reduce<string | null>((latest, ticker) => (ticker.lastRoundAt !== null && (latest === null || ticker.lastRoundAt > latest) ? ticker.lastRoundAt : latest), null);
  const warnings = (tickers ?? []).flatMap(volFarmerV4Warnings);
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));

  let body: ReactNode;
  if (error) body = <div className="alert alert-danger pm-error mb-0">{error}</div>;
  else if (tickers === null) body = <div className="pm-empty"><Spinner size="sm" label="Loading Vol Farmer v4's tickers" /></div>;
  else if (isPhone) {
    body = (
      <ul className="pm-mlist pm-v4-mlist">
        {tickers.map((ticker) => {
          const sub = tickerSub(ticker);
          return (
            <li key={ticker.symbol}>
              <div className="pm-v4-m-head">
                <TickerButton symbol={ticker.symbol} onOpen={onOpenTicker} />
                {sub && sub !== "not looked at yet" && <span className="muted">{sub}</span>}
              </div>
              {ticker.first === null && ticker.second === null && ticker.leaps === null && ticker.workingOrders.length === 0 ? (
                <div className="pm-v4-m-quiet">{[ticker.nextAction.text, ...volFarmerV4LastRoundLines(ticker)].join(" · ")}</div>
              ) : (
              <dl className="pm-v4-m-grid">
                <dt>First position</dt>
                <dd><PositionCell position={ticker.first} kind="first" todayIso={todayIso} /></dd>
                <dt>B-E¹</dt>
                <dd className="num">{breakEvenCell(ticker.first)}</dd>
                <dt>Second position</dt>
                <dd><PositionCell position={ticker.second} kind="second" todayIso={todayIso} /></dd>
                <dt>B-E²</dt>
                <dd className="num">{breakEvenCell(ticker.second)}</dd>
                <dt>LEAPS</dt>
                <dd><LeapsCell leaps={ticker.leaps} todayIso={todayIso} /></dd>
                <dt>Next action</dt>
                <dd><NextActionCell ticker={ticker} open={openActions.has(ticker.symbol)} onToggle={() => toggleActions(ticker.symbol)} /></dd>
                <dt>Last round</dt>
                <dd><LastRoundCell ticker={ticker} todayIso={todayIso} /></dd>
              </dl>
              )}
              {openActions.has(ticker.symbol) && <div className="pm-v4-m-actions"><ActionsList ticker={ticker} /></div>}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="pm-table-wrap pm-v4-wrap">
        <table className="pm-table compact pm-v4-table">
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} className={"align" in column ? "r" : undefined}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((ticker) => {
              const sub = tickerSub(ticker);
              const cells: Record<(typeof columns)[number]["key"], ReactNode> = {
                ticker: (
                  <>
                    <TickerButton symbol={ticker.symbol} onOpen={onOpenTicker} />
                    {sub && <span className="pm-cell-sub">{sub}</span>}
                  </>
                ),
                first: <PositionCell position={ticker.first} kind="first" todayIso={todayIso} />,
                firstBreakEven: breakEvenCell(ticker.first),
                second: <PositionCell position={ticker.second} kind="second" todayIso={todayIso} />,
                secondBreakEven: breakEvenCell(ticker.second),
                leaps: <LeapsCell leaps={ticker.leaps} todayIso={todayIso} />,
                nextAction: <NextActionCell ticker={ticker} open={openActions.has(ticker.symbol)} onToggle={() => toggleActions(ticker.symbol)} />,
                lastRound: <LastRoundCell ticker={ticker} todayIso={todayIso} />,
              };
              const actionsOpen = openActions.has(ticker.symbol) && ticker.actions.length > 0;
              return (
                <Fragment key={ticker.symbol}>
                  <tr className={actionsOpen ? "pm-v4-open" : undefined}>
                    {visibleColumns.map((column) => (
                      <td key={column.key} className={"align" in column ? "r num nw" : column.key === "lastRound" ? "pm-v4-last" : column.key === "ticker" ? "pm-v4-ticker" : column.key === "first" ? "pm-v4-position" : column.key === "second" ? "pm-v4-second" : column.key === "leaps" ? "pm-v4-leaps-cell" : column.key === "nextAction" ? "pm-v4-next-cell" : undefined}>
                        {cells[column.key]}
                      </td>
                    ))}
                  </tr>
                  {actionsOpen && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="pm-v4-detail">
                        <div className="pm-v4-detail-pane">
                          <ActionsList ticker={ticker} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">Vol Farmer v4</h2>
        <div className="pm-card-meta">
          {!isPhone && <span>Each ticker's two positions and LEAPS as v4 counts them, and what it does next</span>}
          {lastRoundAt && <span>last round {formatBrowserClockTime(lastRoundAt)}</span>}
          {!isPhone && <ColumnVisibilityPopover variant="toolbar" columns={columns.map((column) => ({ key: column.key, header: column.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="pm-v4-warnings">
          <div className="pm-alert warn" role="status">
            <WarningIcon />
            <div className="pm-alert-body">
              {warnings.map((warning) => (
                <div key={`${warning.symbol}${warning.text}`} className="pm-alert-text">
                  <TickerButton symbol={warning.symbol} onOpen={onOpenTicker} />
                  {warning.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {body}
      <div className="pm-card-foot">
        B-E¹: the first position's break-even, what its shares cost less its Calls' premiums per share. B-E²: the second's, its assigned Puts' strike less its Puts' and Calls' premiums per share. Next action: what v4 does next on the ticker, when, and what stops it if something does. Last round: what the last round noted on the ticker (a quiet round says it planned nothing) and the last order Pluto sent on it. An order still working counts as planned until it is done. Warnings come from each ticker's last round.
      </div>
    </section>
  );
}
