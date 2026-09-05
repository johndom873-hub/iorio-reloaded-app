import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { ApiError } from "../api/client";
import { cancelOrder } from "../api/positions";
import { fetchTradeBlotter, type PendingOrder, type Trade } from "../api/tradeBlotter";
import type { StrategyKey } from "../api/screener";
import {
  formatCurrency,
  formatCurrencyTrimmed,
  formatDateTime,
  formatNumber,
  formatRelativeDate,
  formatSignedPnl,
  orderRequestStatusBadgeClass,
  orderRequestStatusLabel,
  pnlBadgeClass,
} from "../lib/formatters";

// Kept in sync with positions.ts's /orders/:id/cancel eligibility.
const cancellableStatuses = new Set(["pending_confirmation", "confirmed", "submitted", "partially_filled"]);

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
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<{ orderId: string; symbol: string; liveAtIbkr: boolean } | null>(null);

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

  // Never gated on age. A "pending_confirmation"/"confirmed" order was never
  // sent to IBKR, so there's nothing external to worry about cancelling
  // regardless of how old it is. A "submitted"/"partially_filled" order is
  // live at IBKR — cancelling it is only a request (see the confirm modal's
  // liveAtIbkr message) — but there's still no reason to block the attempt
  // based on age. The full timestamp + relative-time label below is what
  // keeps this safe: Juan/Marcelo can see at a glance whether an order was
  // just built moments ago (don't touch it) or has genuinely been sitting
  // untouched, rather than the button carrying any built-in delay.
  async function handleCancel(orderId: string) {
    setCancellingId(orderId);
    try {
      setError(null);
      await cancelOrder(orderId);
      await loadTrades();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel order.");
    } finally {
      setCancellingId(null);
      setCancelConfirm(null);
    }
  }

  const columns: DataTableColumn<BlotterRow>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => {
        const timestamp = row.kind === "trade" ? row.executedAt : row.createdAt;
        return (
          <span className="text-nowrap" title={formatDateTime(timestamp)}>
            {formatRelativeDate(timestamp)}
          </span>
        );
      },
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
      key: "requestedBy",
      header: "Requested by",
      // A filled Trade shows a requester only if it was placed through the
      // app (trades.source_order_request_id set) — a fill placed outside
      // iorio has nothing to link to and correctly shows "—".
      render: (row) => {
        if (row.kind === "trade") return row.requestedByDisplayName ?? "—";
        return (
          <div>
            <div>{row.requestedByDisplayName ?? "—"}</div>
            {row.cancelledByDisplayName && (
              <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
                Cancelled by {row.cancelledByDisplayName}
              </div>
            )}
          </div>
        );
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
            {row.errorMessage && (
              <div className="text-danger text-truncate" style={{ fontSize: "0.72rem", maxWidth: "12rem" }} title={row.errorMessage}>
                {row.errorMessage}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "ibkrOrderId",
      header: "ID",
      render: (row) => (row.ibkrOrderId !== null && row.ibkrOrderId !== "" ? row.ibkrOrderId : "—"),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => {
        // Mirrors positions.ts's /orders/:id/cancel eligibility exactly:
        // pending_confirmation/confirmed haven't reached IBKR yet (pure
        // local cancel), submitted/partially_filled are live at IBKR
        // (cancel is a request the worker forwards via ib.cancelOrder()).
        // Every other status is terminal — cancel_requested is excluded on
        // purpose so the button disappears the instant a cancel is in
        // flight, instead of allowing a second request.
        if (row.kind !== "order" || !cancellableStatuses.has(row.status)) return null;
        // row.id is "<order_requests.id>:<legOrdinality>" here — a multi-leg
        // order expands to one blotter row per leg, all sharing one real
        // order id (see tradeBlotter.ts's WITH ORDINALITY comment). Cancel
        // always targets the whole order, so every leg-row's button does the
        // same thing regardless of which leg it's attached to.
        const orderId = row.id.split(":")[0]!;
        return (
          <button
            type="button"
            className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
            disabled={cancellingId === orderId}
            onClick={() =>
              setCancelConfirm({ orderId, symbol: row.symbol, liveAtIbkr: row.status === "submitted" || row.status === "partially_filled" })
            }
          >
            {cancellingId === orderId && <Spinner size="sm" />}
            Cancel
          </button>
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

      {cancelConfirm && (
        <ConfirmModal
          title="Cancel Order"
          message={
            cancelConfirm.liveAtIbkr ? (
              <>
                This <strong>{cancelConfirm.symbol}</strong> order is already at IBKR. Cancelling sends a cancel request — IBKR could still fill
                it before the request is processed. This can't be undone.
              </>
            ) : (
              <>
                Cancel the pending <strong>{cancelConfirm.symbol}</strong> order? This can't be undone.
              </>
            )
          }
          confirmLabel="Cancel Order"
          confirming={cancellingId === cancelConfirm.orderId}
          onConfirm={() => handleCancel(cancelConfirm.orderId)}
          onCancel={() => setCancelConfirm(null)}
        />
      )}
    </>
  );
}
