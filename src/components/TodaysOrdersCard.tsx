import { useCallback, useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "./DataTable/DataTable";
import { StrategyBadge } from "./StrategyBadge";
import { TooltipSpan } from "./TooltipSpan";
import { ApiError } from "../api/client";
import { openNotificationStream } from "../api/notifications";
import { fetchTodaysOrders, type TodaysOrder } from "../api/positions";
import { useOrderCancellation } from "../hooks/useOrderCancellation";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";
import { useTickingNow } from "../hooks/useTickingNow";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatOrderLegDescription,
  formatRelativeAge,
  orderRequestStatusBadgeClass,
  orderRequestStatusLabel,
  orderRequestTypeBadgeClass,
  orderRequestTypeLabel,
} from "../lib/formatters";

// A "<filled>/<ordered>" line per leg, plus the average fill price once something filled.
function legFillDescription(leg: TodaysOrder["legs"][number]): string {
  const filled = `${formatNumber(leg.filledQuantity)}/${formatNumber(leg.quantity)}`;
  return leg.averageFillPrice === null ? filled : `${filled} @ ${formatCurrency(leg.averageFillPrice)}`;
}

function formatNetLimit(netLimitPrice: number): string {
  if (netLimitPrice === 0) return "Even";
  return `${netLimitPrice < 0 ? "Credit" : "Debit"} ${formatCurrency(Math.abs(netLimitPrice))}`;
}

/**
 * Every order whose last status update is today (US/Eastern), plus any still-active one from an earlier day,
 * newest update first. Refetches on the worker's order and position pushes.
 */
export function TodaysOrdersCard() {
  const [orders, setOrders] = useState<TodaysOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { open: openTickerModal } = useSignalsTickerModal();
  const now = useTickingNow(orders.reduce<string | null>((newest, order) => (newest === null || order.updatedAt > newest ? order.updatedAt : newest), null));

  const loadOrders = useCallback(async () => {
    try {
      setOrders(await fetchTodaysOrders());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load today's orders.");
    }
  }, []);

  useEffect(() => {
    loadOrders().finally(() => setLoading(false));
  }, [loadOrders]);

  // A fill's trade rows land after the order's "filled" push (the worker buffers an opening fill until the position
  // exists), so the Filled column also needs the position pushes.
  useEffect(() => {
    return openNotificationStream((notification) => {
      if (notification.type === "order_status" || notification.type === "position_opened" || notification.type === "position_closed") void loadOrders();
    });
  }, [loadOrders]);

  const { renderCancelButton, cancelModal } = useOrderCancellation(loadOrders, setError);

  const columns: DataTableColumn<TodaysOrder>[] = [
    {
      key: "created",
      header: "Created",
      render: (row) => (
        <TooltipSpan className="text-nowrap" text={formatDateTime(row.createdAt)}>
          {formatRelativeAge(row.createdAt, now)}
        </TooltipSpan>
      ),
    },
    {
      key: "updated",
      header: "Last update",
      render: (row) => (
        <TooltipSpan className="text-nowrap" text={formatDateTime(row.updatedAt)}>
          {formatRelativeAge(row.updatedAt, now)}
        </TooltipSpan>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button type="button" className="btn btn-link px-2 py-1 text-decoration-none fw-bold" onClick={() => openTickerModal(row.symbol)}>
          {row.symbol}
        </button>
      ),
    },
    { key: "strategy", header: "Strategy", render: (row) => <StrategyBadge strategyKey={row.strategyKey} /> },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <span className={`badge ${orderRequestTypeBadgeClass(row.requestType)}`} style={{ fontSize: "0.72rem" }}>
          {orderRequestTypeLabel(row.requestType)}
        </span>
      ),
    },
    {
      key: "legs",
      header: "Legs",
      render: (row) => (
        <div className="text-nowrap">
          {row.legs.map((leg, index) => (
            <div key={index}>{formatOrderLegDescription(leg)}</div>
          ))}
        </div>
      ),
    },
    {
      key: "netLimit",
      header: "Net limit",
      headerTitle: "Per-share net of the legs' limit prices: a credit is money received, a debit money paid",
      align: "right",
      render: (row) => <span className="text-nowrap">{formatNetLimit(row.netLimitPrice)}</span>,
    },
    {
      key: "filled",
      header: "Filled",
      headerTitle: "Filled / ordered per leg, with the average fill price",
      render: (row) => (
        <div className="text-nowrap">
          {row.legs.map((leg, index) => (
            <div key={index} className={leg.filledQuantity === 0 ? "text-muted" : undefined}>
              {legFillDescription(leg)}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      render: (row) => (row.commission === null ? "—" : formatCurrency(row.commission)),
    },
    { key: "priority", header: "Priority", headerTitle: "IBKR Adaptive algo priority (Normal when none was chosen)", render: (row) => row.adaptivePriority ?? "Normal" },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div>
          <span className={`badge ${orderRequestStatusBadgeClass(row.status, row.cancellationReason)}`} style={{ fontSize: "0.72rem" }}>
            {orderRequestStatusLabel(row.status, row.cancellationReason)}
          </span>
          {row.errorMessage && (
            <TooltipSpan as="div" className="text-danger text-truncate" style={{ fontSize: "0.72rem", maxWidth: "12rem" }} text={row.errorMessage}>
              {row.errorMessage}
            </TooltipSpan>
          )}
        </div>
      ),
    },
    { key: "requestedBy", header: "Requested by", render: (row) => row.requestedByDisplayName ?? "—" },
    { key: "cancelledBy", header: "Cancelled by", render: (row) => row.cancelledByDisplayName ?? "—" },
    {
      key: "ibkrId",
      header: "IBKR Order #",
      render: (row) => (
        <TooltipSpan text={`IBKR order id ${row.ibkrOrderId ?? "—"} · perm id ${row.ibkrPermId ?? "—"} · request ${row.id}`}>{row.ibkrPermId ?? "—"}</TooltipSpan>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => renderCancelButton({ orderId: row.id, symbol: row.symbol, status: row.status }),
    },
  ];

  return (
    <div className="mt-3">
      <DataTable
        tableId="todays-orders"
        dense
        columns={columns}
        rows={orders}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No orders today."
        toolbar={
          <h3 className="card-title mb-0 d-flex align-items-baseline gap-2" style={{ fontSize: "1rem" }}>
            Today's Orders
            <span className="text-muted fw-normal d-none d-md-inline" style={{ fontSize: "0.8rem" }}>
              last update today (ET), plus any still active
            </span>
          </h3>
        }
        beforeTable={error ? <div className="alert alert-danger m-3 mb-0">{error}</div> : undefined}
      />
      {cancelModal}
    </div>
  );
}
