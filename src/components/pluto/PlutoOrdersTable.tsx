import type { PlutoAction, PlutoState } from "../../api/pluto";
import { easternIsoDate, formatDayMonth, formatEasternTime, formatSignedPnl } from "../../lib/formatters";
import { describeImpliedFill, describeOrderContract, describeOutcome, formatExposure, gatesPassedLabel, plutoOrderColumns, type PlutoOrdersVariant } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { ClockIcon, OrderOutcomeBadge, StrategyBadge, TickerButton } from "./plutoBits";

// The orders table (Live: today's orders; History: every order), one row per Pluto action that reached the order
// stage or was blocked on the way. Column visibility is owned by the parent (gear in the card header).

interface PlutoOrdersTableProps {
  variant: PlutoOrdersVariant;
  rows: PlutoAction[];
  now: Date;
  state: PlutoState | null;
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  isColumnVisible: (key: string) => boolean;
  onOpenTicker: (symbol: string) => void;
  /** Phone: a list instead of the table. */
  isPhone: boolean;
}

function clockTime(iso: string): string {
  return formatEasternTime(iso).replace(" ET", "");
}

function priceText(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function FillCell({ action }: { action: PlutoAction }) {
  if (action.fillPrice === null) return <span className="muted">—</span>;
  if (action.impliedFillPrice !== null && Math.abs(action.impliedFillPrice - action.fillPrice) > 0.004) {
    return (
      <>
        {action.impliedFillPrice.toFixed(2)}
        <TooltipSpan text={describeImpliedFill(action.fillPrice, action.impliedFillPrice)} className="pm-split-note">
          IBKR split {action.fillPrice.toFixed(2)}
        </TooltipSpan>
      </>
    );
  }
  return <>{action.fillPrice.toFixed(2)}</>;
}

function RealizedCell({ action }: { action: PlutoAction }) {
  if (action.realizedPnl !== null && action.openLegCount === 0 && action.closedLegCount > 0) return <span className={`num ${action.realizedPnl >= 0 ? "t-ok" : "t-bad"}`}>{formatSignedPnl(action.realizedPnl, 0)}</span>;
  if (action.openLegCount > 0) return <span className="muted">open</span>;
  return <span className="muted">—</span>;
}

export function PlutoOrdersTable({ variant, rows, now, state, loading, error, emptyMessage, isColumnVisible, onOpenTicker, isPhone }: PlutoOrdersTableProps) {
  if (error) return <div className="alert alert-danger pm-error mb-0">{error}</div>;
  if (loading) return <div className="pm-empty"><Spinner size="sm" label="Loading orders" /></div>;
  if (rows.length === 0) return <div className="pm-empty">{emptyMessage}</div>;

  if (isPhone) {
    return (
      <ul className="pm-mlist">
        {rows.map((action) => {
          const outcome = describeOutcome(action, now, state);
          const contract = describeOrderContract(action);
          const working = action.outcome === "confirmed" || action.outcome === "order_built";
          const metaParts: string[] = [variant === "history" ? `${formatDayMonth(easternIsoDate(action.createdAt))} ${clockTime(action.createdAt)}` : clockTime(action.createdAt)];
          if (action.outcome === "blocked") metaParts.push(outcome.sub ?? "Blocked");
          else {
            if (action.quantity !== null) metaParts.push(`${action.kind === "open_covered_call" ? "buy-write " : ""}${action.quantity} × ${action.fillPrice === null ? `limit ${priceText(action.limitPrice)}` : `filled ${(action.impliedFillPrice ?? action.fillPrice).toFixed(2)}${action.impliedFillPrice !== null && Math.abs(action.impliedFillPrice - action.fillPrice) > 0.004 ? ` (IBKR split ${action.fillPrice.toFixed(2)})` : ""}`}`);
            if (action.exposureDollars !== null) metaParts.push(`EXP ${formatExposure(action.exposureDollars)}`);
            if (outcome.sub) metaParts.push(outcome.sub.charAt(0).toLowerCase() + outcome.sub.slice(1));
          }
          return (
            <li key={action.id} className={`pm-m-order${working ? " working" : ""}`}>
              <div className="top">
                <span className="what">
                  <TickerButton symbol={action.symbol} onOpen={onOpenTicker} />
                  <StrategyBadge kind={action.kind} contract={action.contract} />
                  <span className="medium">{contract.title}</span>
                </span>
                <OrderOutcomeBadge tone={outcome.tone} label={outcome.label.replace(/ · .*$/, "")} orderRequestId={outcome.linksToOrder ? action.orderRequestId : null} />
              </div>
              <div className={`meta${action.outcome === "blocked" ? "" : " num"}`}>{metaParts.join(" · ")}</div>
            </li>
          );
        })}
      </ul>
    );
  }

  const columns = plutoOrderColumns[variant].filter((column) => isColumnVisible(column.key));
  return (
    <div className="pm-table-wrap">
      <table className="pm-table compact">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "r" : undefined}>
                {column.title ? <TooltipSpan text={column.title} className="pm-th-help">{column.header}</TooltipSpan> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((action) => {
            const outcome = describeOutcome(action, now, state);
            const contract = describeOrderContract(action);
            const gates = gatesPassedLabel(action);
            const working = action.outcome === "confirmed" || action.outcome === "order_built";
            const cells: Record<string, React.ReactNode> = {
              time:
                variant === "history" ? (
                  <>
                    <span className="medium">{formatDayMonth(easternIsoDate(action.createdAt))}</span> <span className="muted">{clockTime(action.createdAt)}</span>
                  </>
                ) : (
                  <span className="muted">{clockTime(action.createdAt)}</span>
                ),
              ticker: <TickerButton symbol={action.symbol} onOpen={onOpenTicker} />,
              strategy: <StrategyBadge kind={action.kind} contract={action.contract} />,
              contract: (
                <>
                  <span className="medium">{contract.title}</span>
                  {contract.sub && <span className="pm-cell-sub">{contract.sub}</span>}
                </>
              ),
              qty: action.quantity ?? <span className="muted">—</span>,
              limit: action.limitPrice === null ? <span className="muted">—</span> : priceText(action.limitPrice),
              fill: <FillCell action={action} />,
              exp: action.exposureDollars === null ? <span className="muted">—</span> : formatExposure(action.exposureDollars),
              status: (
                <>
                  <OrderOutcomeBadge tone={outcome.tone} label={outcome.label} orderRequestId={outcome.linksToOrder ? action.orderRequestId : null} icon={working ? <ClockIcon /> : undefined} />
                  {outcome.sub && <span className="pm-cell-sub">{outcome.sub}</span>}
                </>
              ),
              realized: <RealizedCell action={action} />,
              pessimistic: action.pessimisticPnl === null ? <span className="muted">—</span> : <span className={`num ${action.pessimisticPnl >= 0 ? "t-ok" : "t-bad"}`}>{formatSignedPnl(action.pessimisticPnl, 0)}</span>,
              gates: <span className={gates.allPassed ? "muted" : "t-warn strong"}>{gates.label}</span>,
            };
            return (
              <tr key={action.id} className={working ? "working" : undefined}>
                {columns.map((column) => (
                  <td key={column.key} className={[column.align === "right" ? "r" : "", column.key === "status" ? "why" : "", column.key === "contract" || column.key === "time" || column.key === "fill" ? "nw" : "", column.key === "qty" || column.key === "limit" || column.key === "fill" || column.key === "exp" || column.key === "time" || column.key === "gates" ? "num" : ""].filter(Boolean).join(" ") || undefined}>
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
