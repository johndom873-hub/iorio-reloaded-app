import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { fetchPlutoVolFarmerV2, type PlutoVolFarmerV2Position, type PlutoVolFarmerV2Ticker } from "../../api/pluto";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatNumber, formatOptionContractLabel, daysToExpiry, pluralize, todayInEasternIso } from "../../lib/formatters";
import { describeVolFarmerV2LeapsHeld, describeVolFarmerV2Option, describeVolFarmerV2WorkingOrder, volFarmerV2LastRoundLines, volFarmerV2Warnings } from "../../lib/plutoVolFarmerV2Presentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { StrategyBadge } from "../StrategyBadge";
import { TickerButton, WarningIcon } from "./plutoBits";

// The Live tab's Vol Farmer v2 card (approved mockup https://claude.ai/artifact/QGwKxNa7orZFFjfeRBnhoU, 2026-10-28): each
// v2 ticker's two positions and LEAPS as v2's memory counts them, its working orders and what its last round said, with
// the warnings its last round's figures raise. Loaded again after every round.

interface PlutoVolFarmerV2CardProps {
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
  { key: "lastRound", header: "Last round" },
] as const;

const dash = <span className="muted">—</span>;

function PositionCell({ position, kind, todayIso }: { position: PlutoVolFarmerV2Position | null; kind: "first" | "second"; todayIso: string }) {
  if (position === null) return dash;
  const options = [...position.calls.map((call) => describeVolFarmerV2Option(call, "C", todayIso)), ...position.puts.map((put) => describeVolFarmerV2Option(put, "P", todayIso))];
  return (
    <>
      <span className="strong">{position.shares > 0 ? `${formatNumber(position.shares)} shares` : "Selling Puts"}</span>
      {kind === "second" && position.shares > 0 && <span className="pm-cell-sub">from Puts assigned at {formatCurrency(position.costPerShare)}</span>}
      {options.map((line, index) => (
        <span key={index} className="pm-cell-sub pm-v2-option">{line}</span>
      ))}
      {position.shares > 0 && position.calls.length === 0 && <span className="pm-cell-sub">no Call open</span>}
    </>
  );
}

function LeapsCell({ leaps, todayIso }: { leaps: PlutoVolFarmerV2Ticker["leaps"]; todayIso: string }) {
  if (leaps === null) return dash;
  return (
    <>
      <span className="pm-v2-leaps">
        <StrategyBadge strategyKey="leaps" />
        {formatOptionContractLabel({ strike: leaps.strike, right: "C", expiry: leaps.expiry, dte: daysToExpiry(leaps.expiry, todayIso) })}
      </span>
      <span className="pm-cell-sub">{describeVolFarmerV2LeapsHeld(leaps)}</span>
    </>
  );
}

function LastRoundCell({ ticker, todayIso }: { ticker: PlutoVolFarmerV2Ticker; todayIso: string }) {
  return (
    <>
      {ticker.workingOrders.length > 0 && <span className="pm-b neutral">{pluralize(ticker.workingOrders.length, "working order")}</span>}
      {ticker.workingOrders.map((order, index) => (
        <span key={`order-${index}`} className="pm-cell-sub">{describeVolFarmerV2WorkingOrder(order, todayIso)}</span>
      ))}
      {volFarmerV2LastRoundLines(ticker).map((line, index) => (
        <span key={`note-${index}`} className="pm-cell-sub pm-v2-note" title={line}>{line}</span>
      ))}
    </>
  );
}

function breakEvenCell(position: PlutoVolFarmerV2Position | null): ReactNode {
  return position?.breakEvenPerShare != null ? formatCurrency(position.breakEvenPerShare) : dash;
}

function tickerSub(ticker: PlutoVolFarmerV2Ticker): string | null {
  if (ticker.waiting) return ticker.lastRoundAt === null ? "not looked at yet" : "waiting";
  return ticker.adoptedAt ? `adopted ${formatBrowserDayMonth(ticker.adoptedAt)}` : null;
}

export function PlutoVolFarmerV2Card({ lastPassAt, isPhone, onOpenTicker }: PlutoVolFarmerV2CardProps) {
  const [tickers, setTickers] = useState<PlutoVolFarmerV2Ticker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-vol-farmer-v2", columns.map((column) => column.key));

  useEffect(() => {
    let cancelled = false;
    fetchPlutoVolFarmerV2()
      .then((loaded) => {
        if (cancelled) return;
        setTickers(loaded);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load Vol Farmer v2's tickers."));
      });
    return () => {
      cancelled = true;
    };
  }, [lastPassAt]);

  // No v2 ticker: the card stays out of the way.
  if (tickers !== null && tickers.length === 0 && error === null) return null;

  const todayIso = todayInEasternIso();
  const lastRoundAt = (tickers ?? []).reduce<string | null>((latest, ticker) => (ticker.lastRoundAt !== null && (latest === null || ticker.lastRoundAt > latest) ? ticker.lastRoundAt : latest), null);
  const warnings = (tickers ?? []).flatMap(volFarmerV2Warnings);
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));

  let body: ReactNode;
  if (error) body = <div className="alert alert-danger pm-error mb-0">{error}</div>;
  else if (tickers === null) body = <div className="pm-empty"><Spinner size="sm" label="Loading Vol Farmer v2's tickers" /></div>;
  else if (isPhone) {
    body = (
      <ul className="pm-mlist pm-v2-mlist">
        {tickers.map((ticker) => {
          const sub = tickerSub(ticker);
          return (
            <li key={ticker.symbol}>
              <div className="pm-v2-m-head">
                <TickerButton symbol={ticker.symbol} onOpen={onOpenTicker} />
                {sub && sub !== "not looked at yet" && <span className="muted">{sub}</span>}
              </div>
              {ticker.first === null && ticker.second === null && ticker.leaps === null && ticker.workingOrders.length === 0 ? (
                <div className="pm-v2-m-quiet">{volFarmerV2LastRoundLines(ticker).join(" · ")}</div>
              ) : (
              <dl className="pm-v2-m-grid">
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
                <dt>Last round</dt>
                <dd><LastRoundCell ticker={ticker} todayIso={todayIso} /></dd>
              </dl>
              )}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="pm-table-wrap">
        <table className="pm-table compact pm-v2-table">
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
                lastRound: <LastRoundCell ticker={ticker} todayIso={todayIso} />,
              };
              return (
                <tr key={ticker.symbol}>
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={"align" in column ? "r num nw" : column.key === "lastRound" ? "pm-v2-last" : column.key === "ticker" ? "pm-v2-ticker" : column.key === "first" || column.key === "second" ? "pm-v2-position" : column.key === "leaps" ? "pm-v2-leaps-cell" : undefined}>
                      {cells[column.key]}
                    </td>
                  ))}
                </tr>
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
        <h2 className="pm-card-t">Vol Farmer v2</h2>
        <div className="pm-card-meta">
          {!isPhone && <span>Each ticker's two positions and LEAPS, as v2 counts them</span>}
          {lastRoundAt && <span>last round {formatBrowserClockTime(lastRoundAt)}</span>}
          {!isPhone && <ColumnVisibilityPopover variant="toolbar" columns={columns.map((column) => ({ key: column.key, header: column.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="pm-v2-warnings">
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
        B-E¹: the first position's break-even, what its shares cost less its Calls' premiums per share. B-E²: the second's, its assigned Puts' strike less its Puts' and Calls' premiums per share. An order still working counts as planned until it is done. Warnings come from each ticker's last round.
      </div>
    </section>
  );
}
