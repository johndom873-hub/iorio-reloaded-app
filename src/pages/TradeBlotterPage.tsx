import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import { fetchTradeBlotter, type PendingOrder, type Trade } from "../api/tradeBlotter";
import type { StrategyKey } from "../api/screener";
import {
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
  formatNumber,
  formatSignedPnl,
  orderRequestStatusBadgeClass,
  orderRequestStatusLabel,
  pnlBadgeClass,
} from "../lib/formatters";

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

// A real fill (Trade) and a not-yet-filled order (PendingOrder) share every
// column except P&L (an order hasn't realized anything) and IBKR State (a
// Trade's state is trivially "Filled" — it only exists because IBKR filled
// it — while an order's is its real, current order_requests.status).
type BlotterRow = ({ kind: "trade" } & Trade) | ({ kind: "order" } & PendingOrder);

function legSummary(row: BlotterRow): string {
  const legType = row.kind === "trade" ? row.legType : row.legRole;
  if (legType === "stock") return "Stock";
  const strike = row.kind === "trade" ? row.strikePrice : row.strike;
  const optionType = row.kind === "trade" ? (row.optionType === "call" ? "C" : "P") : row.optionType;
  return `${strike ? formatCurrencyTrimmed(Number(strike)) : "—"}${optionType ?? ""}`;
}

export function TradeBlotterPage() {
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<BlotterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchTradeBlotter({
        strategyKey: strategy === "all" ? undefined : strategy,
        symbol: symbol.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      const tradeRows: BlotterRow[] = result.trades.map((trade) => ({ kind: "trade", ...trade }));
      const orderRows: BlotterRow[] = result.pendingOrders.map((order) => ({ kind: "order", ...order }));
      // Newest first across both kinds — a pending order's createdAt and a
      // trade's executedAt are both real timestamps of when something
      // happened, so merging on that gives one coherent timeline.
      setRows(
        [...tradeRows, ...orderRows].sort((a, b) => {
          const aTime = a.kind === "trade" ? a.executedAt : a.createdAt;
          const bTime = b.kind === "trade" ? b.executedAt : b.createdAt;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trades.");
    }
  }, [strategy, symbol, from, to]);

  useEffect(() => {
    setLoading(true);
    loadTrades().finally(() => setLoading(false));
  }, [loadTrades]);

  const columns: DataTableColumn<BlotterRow>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => formatDate(row.kind === "trade" ? row.executedAt : row.createdAt),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link p-0 text-decoration-none fw-bold"
          onClick={() => setDetailSymbol(row.symbol)}
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (row) => (
        <span className="badge bg-azure-lt">
          {row.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
        </span>
      ),
    },
    { key: "leg", header: "Leg", render: (row) => legSummary(row) },
    {
      key: "action",
      header: "Action",
      render: (row) => {
        const isClose = row.kind === "trade" ? row.isClosingTrade : row.requestType === "close_position";
        const isRoll = row.kind === "order" && row.requestType === "roll_leg";
        const label = isRoll ? "Roll" : isClose ? "Close" : "Open";
        const actionBadgeClass = isRoll ? "bg-yellow-lt" : isClose ? "bg-secondary-lt" : "bg-azure-lt";
        return <span className={`badge ${actionBadgeClass} text-dark`}>{label}</span>;
      },
    },
    {
      key: "side",
      header: "Side",
      render: (row) => {
        const side = row.kind === "trade" ? row.side : row.action.toLowerCase();
        return side === "buy" ? "Buy" : "Sell";
      },
    },
    { key: "quantity", header: "Qty", align: "right", render: (row) => formatNumber(row.quantity) },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (row) => {
        const rawPrice = row.kind === "trade" ? row.price : row.unitPrice;
        return formatCurrency(rawPrice == null || rawPrice === "" ? null : Number(rawPrice));
      },
    },
    {
      key: "pnl",
      header: "P&L",
      align: "right",
      render: (row) => {
        if (row.kind === "order" || row.pnl === null) return "—";
        const pnl = Number(row.pnl);
        return <span className={`badge ${pnlBadgeClass(pnl)}`}>{formatSignedPnl(pnl)}</span>;
      },
    },
    {
      key: "ibkrState",
      header: "IBKR State",
      render: (row) => {
        if (row.kind === "trade") return <span className="badge bg-success-lt">Filled</span>;
        return (
          <div>
            <span className={`badge ${orderRequestStatusBadgeClass(row.status)}`}>{orderRequestStatusLabel(row.status)}</span>
            {row.ibkrOrderId !== null && (
              <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
                IBKR order #{row.ibkrOrderId}
              </div>
            )}
            {row.errorMessage && (
              <div className="text-danger" style={{ fontSize: "0.72rem" }}>
                {row.errorMessage}
              </div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Trade Blotter" subtitle="Execution history and realized P&L" />

      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="nav nav-tabs mb-3">
        {strategyTabs.map((tab) => (
          <li className="nav-item" key={tab.key}>
            <button
              type="button"
              className={`nav-link ${strategy === tab.key ? "active" : ""}`}
              onClick={() => setStrategy(tab.key)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="row g-2 mb-3">
        <div className="col-12 col-sm-4 col-md-3">
          <input
            type="text"
            className="form-control"
            placeholder="Filter by symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </div>
        <div className="col-6 col-sm-4 col-md-3">
          <input
            type="date"
            className="form-control"
            aria-label="From date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="col-6 col-sm-4 col-md-3">
          <input
            type="date"
            className="form-control"
            aria-label="To date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      <DataTable
        tableId="trade-blotter"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No trades or orders yet."
      />

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
