import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Pagination } from "../components/Pagination";
import { ApiError } from "../api/client";
import type { PositionStrategyKey } from "../api/positions";
import { useOrderCancellation } from "../hooks/useOrderCancellation";
import { fetchTradeBlotter, type PendingOrder, type Trade } from "../api/tradeBlotter";
import { StrategyBadge } from "../components/StrategyBadge";
import { TooltipSpan } from "../components/TooltipSpan";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";
import {
  formatCurrency,
  formatCurrencyTrimmed,
  formatDateTime,
  formatNumber,
  formatRelativeDate,
  orderRequestStatusBadgeClass,
  orderRequestStatusLabel,
  orderRequestTypeBadgeClass,
  orderRequestTypeLabel,
} from "../lib/formatters";

const rowsPerPage = 50;

const strategyOptions: { key: PositionStrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
  { key: "hedge", label: "Hedges" },
  { key: "unstructured", label: "Other" },
];

// A real fill (Trade) and a not-yet-filled order (PendingOrder) share every
// column except IBKR State (a
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
  const [strategy, setStrategy] = useState<PositionStrategyKey | "all">("all");
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<BlotterRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { open: openTickerModal } = useSignalsTickerModal();

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

  // A new filter means a new result set — start back at the first page.
  useEffect(() => {
    setPage(1);
  }, [strategy, symbol, from, to]);

  // After a refresh (e.g. a cancel) the result set can shrink below the current page.
  const lastPage = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, lastPage);
  const visibleRows = rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  // ?order=<order request id> (linked from the Pluto screen): jump to the page holding that order's
  // rows (its fills once filled, the order itself while working or cancelled) and highlight them.
  const [searchParams] = useSearchParams();
  const linkedOrderId = searchParams.get("order");
  const belongsToLinkedOrder = (row: BlotterRow) => (linkedOrderId !== null && (row.kind === "order" ? row.id.split(":")[0] === linkedOrderId : row.sourceOrderRequestId === linkedOrderId));
  useEffect(() => {
    if (!linkedOrderId || rows.length === 0) return;
    const index = rows.findIndex(belongsToLinkedOrder);
    if (index >= 0) setPage(Math.floor(index / rowsPerPage) + 1);
  }, [linkedOrderId, rows]);

  useEffect(() => {
    setLoading(true);
    loadTrades().finally(() => setLoading(false));
  }, [loadTrades]);

  const { renderCancelButton, cancelModal } = useOrderCancellation(loadTrades, setError);

  const columns: DataTableColumn<BlotterRow>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => {
        const timestamp = row.kind === "trade" ? row.executedAt : row.createdAt;
        return (
          <TooltipSpan className="text-nowrap" text={formatDateTime(timestamp)}>
            {formatRelativeDate(timestamp)}
          </TooltipSpan>
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
          onClick={() => openTickerModal(row.symbol)}
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (row) => <StrategyBadge strategyKey={row.strategyKey} />,
    },
    { key: "leg", header: "Leg", render: (row) => legSummary(row) },
    {
      key: "action",
      header: "Action",
      render: (row) => {
        // A trade only knows whether it closed a leg; an order knows its type (open / roll / close).
        const requestType = row.kind === "trade" ? (row.isClosingTrade ? "close_position" : "open_position") : row.requestType;
        return <span className={`badge ${orderRequestTypeBadgeClass(requestType)}`}>{orderRequestTypeLabel(requestType)}</span>;
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
      key: "value",
      header: "Value",
      align: "right",
      render: (row) => formatCurrency(row.value == null || row.value === "" ? null : Number(row.value)),
    },
    {
      // Only a real fill has a commission; a not-yet-filled order has none yet. NULL on a fill means IBKR never reported one.
      key: "commission",
      header: "Commission",
      align: "right",
      render: (row) => (row.kind === "trade" && row.commission !== null ? formatCurrency(Number(row.commission)) : "—"),
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
            <span className={`badge ${orderRequestStatusBadgeClass(row.status, row.cancellationReason)}`}>{orderRequestStatusLabel(row.status, row.cancellationReason)}</span>
            {row.errorMessage && (
              <TooltipSpan as="div" className="text-danger text-truncate" style={{ fontSize: "0.72rem", maxWidth: "12rem" }} text={row.errorMessage}>
                {row.errorMessage}
              </TooltipSpan>
            )}
          </div>
        );
      },
    },
    {
      key: "id",
      header: "ID",
      render: (row) => {
        // row.id is "<order_requests.id>:<legOrdinality>" for order rows (see
        // the cancel handler below) — strip the leg suffix so every leg of
        // one order shows the same ID, and shorten the UUID for display.
        const orderId = row.id.split(":")[0]!;
        return (
          <TooltipSpan text={orderId} style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
            {orderId.slice(0, 8)}
          </TooltipSpan>
        );
      },
    },
    {
      // ibkrOrderId is IBKR's per-connection order id — it resets/repeats
      // across Gateway reconnects, so it's not usable as a stable
      // cross-reference. ibkrPermId ("Perm ID") is IBKR's permanent,
      // globally-unique order identifier that never resets — it's also
      // what appears in IBKR's own trade confirmations and Flex reports.
      key: "ibkrPermId",
      header: "IBKR Order #",
      render: (row) => (row.ibkrPermId !== null ? row.ibkrPermId : "—"),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => {
        if (row.kind !== "order") return null;
        // row.id is "<order_requests.id>:<legOrdinality>" here — a multi-leg order expands to one blotter row per leg,
        // all sharing one real order id (see tradeBlotter.ts's WITH ORDINALITY comment). Cancel always targets the
        // whole order, so every leg-row's button does the same thing regardless of which leg it's attached to.
        return renderCancelButton({ orderId: row.id.split(":")[0]!, symbol: row.symbol, status: row.status });
      },
    },
  ];

  return (
    <>
      <PageHeader title="Trade Blotter" subtitle="Execution history and realized P&L" />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-2 mb-3">
        <div className="col-12 col-sm-3" style={{ maxWidth: "14rem" }}>
          <select
            className="form-select"
            aria-label="Strategy"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as PositionStrategyKey | "all")}
          >
            {strategyOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 col-sm-3" style={{ maxWidth: "10rem" }}>
          <input
            type="text"
            className="form-control"
            placeholder="Filter by symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </div>
        <div className="col-6 col-sm-3" style={{ maxWidth: "10.5rem" }}>
          <input
            type="date"
            className="form-control"
            aria-label="From date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="col-6 col-sm-3" style={{ maxWidth: "10.5rem" }}>
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
        rows={visibleRows}
        rowKey={(row) => row.id}
        rowClassName={(row) => (belongsToLinkedOrder(row) ? "table-active" : undefined)}
        loading={loading}
        emptyMessage="No trades or orders yet."
      />

      <Pagination page={currentPage} pageSize={rowsPerPage} totalRows={rows.length} onPageChange={setPage} />


      {cancelModal}
    </>
  );
}
