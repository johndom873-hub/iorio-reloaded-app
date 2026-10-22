import type { ReactNode } from "react";
import type { BacktestTickerStatistics } from "../../api/backtest";
import { formatNumber, formatPercentage, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { backtestCycleMetricExplanation, describeOpenCycles } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle } from "./backtestBits";

function SignedDollars({ value }: { value: number | null }) {
  return <span className={pnlTextClass(value)}>{formatSignedPnl(value, 0)}</span>;
}

function openCyclesDollars(statistics: BacktestTickerStatistics): number {
  return statistics.openCycles.reduce((sum, cycle) => sum + cycle.totalDollars, 0);
}

const recoveryGroup = { label: "Recovery sessions", title: "Closed cycles that had a put assigned: trading sessions from the assignment to the cycle's close." };

const columns: DataTableColumn<BacktestTickerStatistics>[] = [
  { key: "symbol", header: "Symbol", cellClassName: "fw-semibold", freezeOnPhone: true, render: (row) => row.symbol },
  { key: "cyclePnl", header: "Cycle P&L", headerTitle: `${backtestCycleMetricExplanation.cyclePnl} Per symbol: the sum of its cycles' totals.`, align: "right", render: (row) => <SignedDollars value={row.totalPnlDollars} /> },
  {
    key: "realized",
    header: "Realized",
    headerTitle: "Realized P&L of every position on the symbol, after commissions: what the closed legs made. Cycle P&L adds what the open positions hold at the last marks.",
    align: "right",
    render: (row) => <SignedDollars value={row.realizedPnlDollars} />,
  },
  { key: "closedCycles", header: "Closed cycles", headerTitle: "Cycles that ended with the symbol flat again. Pluto's rules only close a cycle in profit.", align: "right", render: (row) => formatNumber(row.closedCycleCount) },
  {
    key: "openCycles",
    header: "Open cycles",
    headerTitle: "Cycles still running at the session's end, with what they hold at the last marks: where a loss would be.",
    align: "right",
    cellClassName: "text-nowrap",
    render: (row) =>
      row.openCycleCount === 0 ? (
        <span className="text-secondary">none</span>
      ) : (
        <>
          {formatNumber(row.openCycleCount)} · <SignedDollars value={openCyclesDollars(row)} />
        </>
      ),
  },
  { key: "optionsSold", header: "Options sold", headerTitle: backtestCycleMetricExplanation.optionsSold, align: "right", render: (row) => formatNumber(row.optionSaleCount) },
  { key: "averageDte", header: "Avg DTE", headerTitle: "Average traded DTE: mean calendar days to expiry of the options sold.", align: "right", render: (row) => (row.averageTradedDte === null ? "—" : formatNumber(row.averageTradedDte, 1)) },
  { key: "putPositions", header: "Put positions", headerTitle: "Cash-secured put positions opened.", align: "right", render: (row) => formatNumber(row.putPositionCount) },
  {
    key: "putsAssigned",
    header: "Puts assigned",
    headerTitle: "Put positions that ended assigned ÷ put positions that ended (assigned, expired, bought back or rolled).",
    align: "right",
    cellClassName: "text-nowrap",
    render: (row) => `${formatPercentage(row.putAssignedShare, 1)} · ${formatNumber(row.putPositionsAssigned)} of ${formatNumber(row.putPositionsEnded)}`,
  },
  { key: "recoveryCount", header: "Cycles", group: recoveryGroup, headerTitle: "Closed cycles with an assignment.", align: "right", render: (row) => formatNumber(row.recoverySessions.count) },
  { key: "recoveryMedian", header: "Median", group: recoveryGroup, align: "right", render: (row) => (row.recoverySessions.median === null ? "—" : formatNumber(row.recoverySessions.median, 1)) },
  { key: "recoveryMean", header: "Mean", group: recoveryGroup, align: "right", render: (row) => (row.recoverySessions.mean === null ? "—" : formatNumber(row.recoverySessions.mean, 1)) },
  { key: "recoveryLongest", header: "Longest", group: recoveryGroup, align: "right", render: (row) => (row.recoverySessions.longest === null ? "—" : formatNumber(row.recoverySessions.longest)) },
];

/** The open cycles, listed apart: "SMCI #15 · opened 2025-02-26 · put assigned 2025-02-28 · 405 sessions · 2,900 shares · +$42,060". */
function OpenCyclesList({ statistics }: { statistics: BacktestTickerStatistics }) {
  if (statistics.openCycles.length === 0) return null;
  return (
    <div className="card-footer" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
      <div className="text-secondary mb-1">Open at the session's end ({describeOpenCycles(statistics.openCycleCount, openCyclesDollars(statistics))}):</div>
      <ul className="mb-0 ps-3">
        {statistics.openCycles.map((cycle) => {
          const parts: ReactNode[] = [
            `opened ${cycle.openedOn}`,
            cycle.assignedOn ? `put assigned ${cycle.assignedOn}` : "no assignment",
            cycle.ageSessions === null ? null : `${formatNumber(cycle.ageSessions)} ${cycle.ageSessions === 1 ? "session" : "sessions"} ${cycle.assignedOn ? "since the assignment" : "since it opened"}`,
            cycle.sharesHeld > 0 ? `${formatNumber(cycle.sharesHeld)} shares` : "no shares",
          ];
          return (
            <li key={`${cycle.symbol}-${cycle.cycleNumber}`}>
              <span className="fw-semibold">
                {cycle.symbol} #{cycle.cycleNumber}
              </span>{" "}
              <SignedDollars value={cycle.totalDollars} /> · {parts.filter((part) => part !== null).join(" · ")}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const footerCellsOf = (all: BacktestTickerStatistics): Record<string, ReactNode> => {
  const cells: Record<string, ReactNode> = {};
  for (const column of columns) cells[column.key] = column.render(all);
  return cells;
};

/** Per-ticker statistics: one row per symbol, the All symbols row as the table's total, and the open cycles listed apart. */
export function BacktestTickerStatisticsTable({ tickerStatistics, allSymbolsStatistics }: { tickerStatistics: BacktestTickerStatistics[]; allSymbolsStatistics: BacktestTickerStatistics | null }) {
  if (tickerStatistics.length === 0 && allSymbolsStatistics === null) return null;
  return (
    <div className="mb-3">
      <DataTable
        tableId="backtest-ticker-statistics"
        columns={columns}
        rows={tickerStatistics}
        rowKey={(row) => row.symbol}
        dense
        toolbar={<BacktestCardTitle title="Per symbol" description="cycle P&L, cycles, assignments and recovery, per symbol and over all of them" />}
        footerCells={allSymbolsStatistics ? footerCellsOf(allSymbolsStatistics) : undefined}
        afterTable={allSymbolsStatistics ? <OpenCyclesList statistics={allSymbolsStatistics} /> : null}
      />
    </div>
  );
}
