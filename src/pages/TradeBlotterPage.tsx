import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import { fetchTrades, type Trade } from "../api/tradeBlotter";
import type { StrategyKey } from "../api/screener";
import { formatCurrency, formatDate, formatNumber, formatSignedPnl, pnlBadgeClass } from "../lib/formatters";

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

function legSummary(trade: Trade): string {
  if (trade.legType === "stock") return "Stock";
  const strike = trade.strikePrice ? formatCurrency(Number(trade.strikePrice)) : "—";
  const rightLabel = trade.optionType === "call" ? "C" : "P";
  return `${strike}${rightLabel}`;
}

export function TradeBlotterPage() {
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchTrades({
        strategyKey: strategy === "all" ? undefined : strategy,
        symbol: symbol.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setTrades(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trades.");
    }
  }, [strategy, symbol, from, to]);

  useEffect(() => {
    setLoading(true);
    loadTrades().finally(() => setLoading(false));
  }, [loadTrades]);

  const columns: DataTableColumn<Trade>[] = [
    {
      key: "executedAt",
      header: "Date",
      render: (row) => formatDate(row.executedAt),
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
        <span className="badge bg-azure-lt text-dark" style={{ fontSize: "0.72rem" }}>
          {row.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
        </span>
      ),
    },
    { key: "leg", header: "Leg", render: (row) => legSummary(row) },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <span className={`badge ${row.isClosingTrade ? "bg-secondary-lt" : "bg-azure-lt"} text-dark`}>
          {row.isClosingTrade ? "Close" : "Open"}
        </span>
      ),
    },
    {
      key: "side",
      header: "Side",
      render: (row) => (row.side === "buy" ? "Buy" : "Sell"),
    },
    { key: "quantity", header: "Qty", align: "right", render: (row) => formatNumber(row.quantity) },
    { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(Number(row.price)) },
    {
      key: "pnl",
      header: "P&L",
      align: "right",
      render: (row) => {
        if (row.pnl === null) return "—";
        const pnl = Number(row.pnl);
        return <span className={`badge ${pnlBadgeClass(pnl)}`}>{formatSignedPnl(pnl)}</span>;
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
        rows={trades}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No trades yet."
      />

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
