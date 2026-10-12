import { useState } from "react";
import type { BacktestCycle } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatNumber, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import { backtestCycleLabel, backtestCycleMetricExplanation, cycleBucketOrder, cycleStockDollars, describeBreakEven, describeOpenCycles, summarizeCycleTotals } from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { DottedLabelTooltip } from "../HelpTooltip";
import { Pagination } from "../Pagination";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";

const cyclesPerPage = 25;

type CycleStatusFilter = "all" | "open" | "closed";

function SignedDollars({ value, bold = false }: { value: number; bold?: boolean }) {
  return <span className={`${pnlTextClass(value)}${bold ? " fw-semibold" : ""}`}>{formatSignedPnl(value, 0)}</span>;
}

/** Each strategy's share of the cycle in the platform's badges and order: CSP, N/S, CC, Hedge, the ones that took part. */
function CycleStrategies({ cycle }: { cycle: BacktestCycle }) {
  const parts = cycleBucketOrder.filter((bucket) => cycle.buckets[bucket].total !== 0 || cycle.buckets[bucket].premium !== 0 || cycle.buckets[bucket].capital !== 0);
  if (parts.length === 0) return <span className="text-secondary">—</span>;
  return (
    <span className="d-inline-flex flex-wrap align-items-center column-gap-2 row-gap-1">
      {parts.map((bucket) => (
        <span key={bucket} className="d-inline-flex align-items-center gap-1 text-nowrap">
          <CycleBucketBadge bucket={bucket} />
          <SignedDollars value={cycle.buckets[bucket].total} />
        </span>
      ))}
    </span>
  );
}

const columns: DataTableColumn<BacktestCycle>[] = [
  {
    key: "cycle",
    header: "Cycle",
    cellClassName: "text-nowrap fw-semibold",
    render: (cycle) => backtestCycleLabel(cycle),
  },
  { key: "pnl", header: "Cycle P&L", headerTitle: backtestCycleMetricExplanation.cyclePnl, align: "right", render: (cycle) => <SignedDollars value={cycle.totalDollars} bold /> },
  {
    key: "status",
    header: "Status",
    headerTitle: "Open: the symbol is not flat yet at the session's end, and its P&L is at the last marks. Closed: the symbol went flat again.",
    render: (cycle) => (cycle.status === "open" ? <span className="fw-semibold">Open</span> : <span className="text-secondary">Closed</span>),
  },
  { key: "opened", header: "Opened", cellClassName: "font-mono text-nowrap", render: (cycle) => cycle.openedOn },
  { key: "closed", header: "Closed", cellClassName: "font-mono text-nowrap", render: (cycle) => cycle.closedOn ?? <span className="text-secondary">open</span> },
  { key: "assigned", header: "Put assigned", headerTitle: "The first day a put of the cycle was assigned.", cellClassName: "font-mono text-nowrap", render: (cycle) => cycle.assignedOn ?? <span className="text-secondary">—</span> },
  {
    key: "recovery",
    header: "Recovery",
    headerTitle: "Trading sessions from the assignment to the cycle's close (closed cycles that had an assignment).",
    align: "right",
    cellClassName: "text-nowrap",
    render: (cycle) => (cycle.recoverySessions === null ? "—" : pluralizeCount(cycle.recoverySessions, "session")),
  },
  {
    key: "age",
    header: "Open for",
    headerTitle: "Open cycles: trading sessions from the assignment (else from the opening) to the session's last day.",
    align: "right",
    cellClassName: "text-nowrap",
    render: (cycle) => (cycle.status === "open" && cycle.ageSessions !== null ? pluralizeCount(cycle.ageSessions, "session") : "—"),
  },
  { key: "premium", header: "Net premium", headerTitle: "Premiums in − buybacks − commissions.", align: "right", render: (cycle) => <SignedDollars value={cycle.netPremiumDollars} /> },
  { key: "stock", header: "Stock P&L", headerTitle: "What the shares made: the put's assignment charge and the stock's P&L while the strategies held it.", align: "right", render: (cycle) => <SignedDollars value={cycleStockDollars(cycle)} /> },
  { key: "strategies", header: "By strategy", headerTitle: "Each strategy's part of the cycle P&L, as the platform's Profit & Loss scoreboard attributes it.", render: (cycle) => <CycleStrategies cycle={cycle} /> },
  { key: "shares", header: "Shares held", headerTitle: "Shares the cycle's ledger holds at the end: an open cycle's shares. A closed cycle with shares left has a data flag.", align: "right", render: (cycle) => (cycle.sharesHeld === 0 ? "—" : formatNumber(cycle.sharesHeld)) },
  { key: "breakEven", header: "Break-even", headerTitle: "The share price at which the cycle is flat, after its premiums: Free once the premiums have paid for the shares.", align: "right", render: (cycle) => describeBreakEven(cycle.breakEvenPerShare) },
  {
    key: "flags",
    header: "Data flags",
    headerTitle: "Where the platform's cycle engine found the cycle's ledger incomplete; its figures may be off.",
    render: (cycle) =>
      cycle.dataFlags.length === 0 ? (
        <span className="text-secondary">—</span>
      ) : (
        <DottedLabelTooltip label={pluralizeCount(cycle.dataFlags.length, "flag")} tooltipHtml={escapeTooltipHtml(cycle.dataFlags.join("; "))} className="iorio-note-amber text-nowrap" />
      ),
  },
];

/** Every wheel cycle of the session, cycle P&L first, newest first, 25 a page; filter by symbol and status. Collapsible
 *  (remembered in this browser). */
export function BacktestCyclesTable({ cycles, symbols }: { cycles: BacktestCycle[]; symbols: string[] }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-cycles", true);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CycleStatusFilter>("all");
  const [page, setPage] = useState(1);
  const totals = summarizeCycleTotals(cycles);
  const title = "Wheel cycles";
  const description = `${pluralizeCount(totals.closedCount, "closed cycle")} · ${describeOpenCycles(totals.openCount, totals.openDollars)}`;
  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

  if (!isOpen || cycles.length === 0) {
    return (
      <BacktestCard title={title} description={cycles.length === 0 ? "no cycle yet" : description} actions={cycles.length === 0 ? undefined : toggle} className="mb-3">
        {null}
      </BacktestCard>
    );
  }

  const filtered = cycles
    .filter((cycle) => (symbolFilter === "" || cycle.symbol === symbolFilter) && (statusFilter === "all" || cycle.status === statusFilter))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.symbol.localeCompare(b.symbol));
  const totalPages = Math.max(1, Math.ceil(filtered.length / cyclesPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * cyclesPerPage, currentPage * cyclesPerPage);
  const filteredTotals = summarizeCycleTotals(filtered);
  const filteredPnl = filteredTotals.closedDollars + filteredTotals.openDollars;

  return (
    <div className="mb-3">
      <DataTable
        tableId="backtest-cycles"
        columns={columns}
        rows={pageRows}
        rowKey={(cycle) => `${cycle.symbol}-${cycle.cycleNumber}`}
        emptyMessage="No cycle matches the filters."
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
                  setStatusFilter(event.target.value as CycleStatusFilter);
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
        footerCells={{
          cycle: filtered.length === cycles.length ? "All cycles" : `${pluralizeCount(filtered.length, "cycle")} shown`,
          pnl: <SignedDollars value={filteredPnl} bold />,
          premium: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycle.netPremiumDollars, 0)} />,
          stock: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycleStockDollars(cycle), 0)} />,
        }}
        afterTable={
          <div className="px-3 pb-3">
            <Pagination page={currentPage} pageSize={cyclesPerPage} totalRows={filtered.length} onPageChange={setPage} />
          </div>
        }
      />
    </div>
  );
}
