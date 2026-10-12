import { useState } from "react";
import type { BacktestPosition } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatCurrency, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import { describeLegExit, describePositionEnding, describePositionLeg, describeUnstructuredReason, formatBookInstant, positionTotalPnl, priceScaleNote } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { StrategyBadge } from "../StrategyBadge";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";

const positionsPerPage = 25;

type PositionStatusFilter = "all" | "open" | "closed";

function SignedDollars({ value, bold = false }: { value: number | null; bold?: boolean }) {
  return <span className={`${pnlTextClass(value)}${bold ? " fw-semibold" : ""}`}>{formatSignedPnl(value, 0)}</span>;
}

/** Every leg on its own line: the contract label (or the shares), then how it ended and what it made. */
function PositionLegs({ position }: { position: BacktestPosition }) {
  return (
    <div className="d-flex flex-column gap-1">
      {position.legs.map((leg) => {
        const scaleNote = priceScaleNote(leg.priceScale);
        return (
          <div key={leg.legId} className="backtest-leg-line">
            <span className="text-nowrap">{describePositionLeg(leg)}</span> <span className="text-secondary text-nowrap">· {describeLegExit(leg)}</span>
            {leg.realizedPnlDollars !== null && (
              <>
                {" "}
                <span className="text-nowrap">
                  <span className="text-secondary">·</span> <SignedDollars value={leg.realizedPnlDollars} />
                </span>
              </>
            )}
            {scaleNote && <span className="text-secondary"> · {scaleNote}</span>}
          </div>
        );
      })}
    </div>
  );
}

const columns: DataTableColumn<BacktestPosition>[] = [
  { key: "symbol", header: "Symbol", cellClassName: "fw-semibold", render: (position) => position.symbol },
  { key: "strategy", header: "Strategy", render: (position) => <StrategyBadge strategyKey={position.strategyKey} /> },
  {
    key: "pnl",
    header: "P&L",
    headerTitle: "The position's P&L as Positions shows it: realized (premium and stock parts, after commissions), plus what it holds at the session's last marks while open.",
    align: "right",
    render: (position) => <SignedDollars value={positionTotalPnl(position)} bold />,
  },
  {
    key: "cycle",
    header: "Cycle",
    headerTitle: "The wheel cycle of its symbol that was running when it opened.",
    cellClassName: "text-nowrap",
    render: (position) => position.cycleLabel ?? <span className="text-secondary">—</span>,
  },
  { key: "opened", header: "Opened", cellClassName: "font-mono text-nowrap", render: (position) => formatBookInstant(position.openedAt) },
  { key: "legs", header: "Legs", headerTitle: "Each leg as traded: the contract, its quantity and price per share (options net of the opening commission, shares with it), how it ended and what it realized.", cellClassName: "backtest-legs-cell", render: (position) => <PositionLegs position={position} /> },
  {
    key: "ended",
    header: "Ended",
    headerTitle: "How the position closed: expired, assigned, closed by Pluto (bought back, rolled or sold), or its shares moved to a covered call. Positions with no strategy say why they hold shares.",
    cellClassName: "text-nowrap",
    render: (position) => {
      const reason = describeUnstructuredReason(position);
      return (
        <div className="d-flex flex-column">
          <span className={position.status === "open" ? "fw-semibold" : undefined}>
            {describePositionEnding(position)}
            {position.closedAt && <span className="font-mono text-secondary"> {formatBookInstant(position.closedAt)}</span>}
          </span>
          {reason && (
            <span className="text-secondary text-wrap" style={{ fontSize: "0.75rem" }}>
              {reason}
            </span>
          )}
        </div>
      );
    },
  },
  { key: "premium", header: "Premium", headerTitle: "Realized premium P&L, after commissions.", align: "right", render: (position) => <SignedDollars value={position.realizedPremiumPnlDollars} /> },
  { key: "stock", header: "Stock", headerTitle: "Realized stock P&L, after commissions.", align: "right", render: (position) => <SignedDollars value={position.realizedStockPnlDollars} /> },
  { key: "unrealized", header: "Unrealized", headerTitle: "What an open position holds at the session's last marks.", align: "right", render: (position) => (position.unrealizedPnlDollars === null ? "—" : <SignedDollars value={position.unrealizedPnlDollars} />) },
  {
    key: "exposure",
    header: "EXP $",
    headerTitle: "EXP $ now: the position's capital at risk, net of premium; — once nothing is held.",
    align: "right",
    render: (position) => (position.capitalAtRiskDollars === null ? "—" : formatCurrency(position.capitalAtRiskDollars, 0)),
  },
  { key: "deployed", header: "Capital deployed", headerTitle: "The position's P&L % base.", align: "right", render: (position) => (position.capitalDeployedDollars === null ? "—" : formatCurrency(position.capitalDeployedDollars, 0)) },
];

/** The simulated book: every position with its P&L (third, so a phone shows it without scrolling) and legs, newest first,
 *  25 a page; filter by symbol and status.
 *  Collapsible (remembered in this browser). */
export function BacktestPositionsTable({ positions, symbols }: { positions: BacktestPosition[]; symbols: string[] }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-positions", true);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PositionStatusFilter>("all");
  const [page, setPage] = useState(1);
  const openCount = positions.filter((position) => position.status === "open").length;
  const title = "Positions";
  const description = `${pluralizeCount(positions.length, "position")} · ${openCount} open · newest first`;
  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

  if (!isOpen || positions.length === 0) {
    return (
      <BacktestCard title={title} description={positions.length === 0 ? "the session has no simulated book (run before the wheel was simulated) or no position yet" : description} actions={positions.length === 0 ? undefined : toggle} className="mt-3">
        {null}
      </BacktestCard>
    );
  }

  const filtered = positions
    .filter((position) => (symbolFilter === "" || position.symbol === symbolFilter) && (statusFilter === "all" || position.status === statusFilter))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || b.positionId.localeCompare(a.positionId, undefined, { numeric: true }));
  const totalPages = Math.max(1, Math.ceil(filtered.length / positionsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * positionsPerPage, currentPage * positionsPerPage);

  return (
    <div className="mt-3">
      <DataTable
        tableId="backtest-positions"
        columns={columns}
        rows={pageRows}
        rowKey={(position) => position.positionId}
        emptyMessage="No position matches the filters."
        dense
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            <div className="d-flex flex-wrap align-items-center gap-2">
              {symbols.length > 1 && (
                <select
                  className="form-select w-auto"
                  aria-label="Symbol"
                  value={symbolFilter}
                  onChange={(event) => {
                    setSymbolFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All symbols</option>
                  {symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="form-select w-auto"
                aria-label="Status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as PositionStatusFilter);
                  setPage(1);
                }}
              >
                <option value="all">Open and closed</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
              {toggle}
            </div>
          </>
        }
        afterTable={
          <div className="px-3 pb-3">
            <Pagination page={currentPage} pageSize={positionsPerPage} totalRows={filtered.length} onPageChange={setPage} />
          </div>
        }
      />
    </div>
  );
}
