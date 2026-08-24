import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ApiError } from "../api/client";
import { cancelOrder, confirmOrder, fetchOrder, type OrderRequest } from "../api/positions";
import { formatCurrency, formatDate } from "../lib/formatters";

interface OrderReviewPanelProps {
  order: OrderRequest;
  onCancelled: () => void;
  /** Fires once the order reaches a terminal, successful state (filled/partially_filled). */
  onFilled: () => void;
}

const pollIntervalMs = 2_000;
const terminalStatuses = new Set(["filled", "partially_filled", "cancelled", "rejected", "error"]);

function legDescription(leg: OrderRequest["payload"]["legs"][number]): string {
  if (leg.role === "stock") return `${leg.action} ${leg.quantity} sh @ ${formatCurrency(leg.unitPrice)}`;
  const right = leg.right === "C" ? "Call" : "Put";
  return `${leg.action} ${leg.quantity}x ${leg.strike ? formatCurrency(leg.strike) : "—"}${right} exp ${
    leg.expiry ? formatDate(leg.expiry.length === 8 ? `${leg.expiry.slice(0, 4)}-${leg.expiry.slice(4, 6)}-${leg.expiry.slice(6, 8)}` : leg.expiry) : "—"
  } @ ${formatCurrency(leg.unitPrice)}`;
}

function statusLabel(status: OrderRequest["status"]): string {
  switch (status) {
    case "pending_confirmation":
      return "Awaiting your confirmation";
    case "confirmed":
      return "Confirmed — sending to IBKR...";
    case "submitted":
      return "Submitted to IBKR — awaiting fill";
    case "cancel_requested":
      return "Cancelling — awaiting IBKR confirmation";
    case "filled":
      return "Filled";
    case "partially_filled":
      return "Partially filled";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return "Rejected by IBKR";
    case "error":
      return "Error";
  }
}

/**
 * Shared review → explicit confirm → live status flow (approved 2026-08-24)
 * for every order-placing action (New Position, Roll, Close). Submitting a
 * form only ever builds an OrderRequest (this component's `order` prop) —
 * nothing is sent to IBKR until the user clicks Confirm here.
 */
export function OrderReviewPanel({ order: initialOrder, onCancelled, onFilled }: OrderReviewPanelProps) {
  const [order, setOrder] = useState(initialOrder);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  function schedulePoll(orderId: string) {
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const updated = await fetchOrder(orderId);
        setOrder(updated);
        if (updated.status === "filled" || updated.status === "partially_filled") {
          onFilled();
          return;
        }
        if (!terminalStatuses.has(updated.status)) schedulePoll(orderId);
      } catch {
        schedulePoll(orderId);
      }
    }, pollIntervalMs);
  }

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const confirmed = await confirmOrder(order.id);
      setOrder(confirmed);
      schedulePoll(confirmed.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to confirm order.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const updated = await cancelOrder(order.id);
      setOrder(updated);
      if (updated.status === "cancelled") {
        onCancelled();
      } else {
        // "cancel_requested" — order was already at IBKR, so cancellation
        // isn't final until the worker's cancelOrder() call is confirmed.
        schedulePoll(updated.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel order.");
    } finally {
      setCancelling(false);
    }
  }

  const isPending = order.status === "pending_confirmation";
  const isTerminal = terminalStatuses.has(order.status);
  const isWaiting = order.status === "confirmed" || order.status === "submitted";
  const canRequestCancel = order.status === "submitted" || order.status === "partially_filled";
  const cancelRequested = order.status === "cancel_requested";

  return (
    <div className="border rounded p-3">
      <h4 className="mb-2" style={{ fontSize: "1rem" }}>
        Order Review
      </h4>
      {error && <div className="alert alert-danger">{error}</div>}
      <ul className="list-unstyled mb-2">
        {order.payload.legs.map((leg, index) => (
          <li key={index} style={{ fontSize: "0.875rem" }}>
            {legDescription(leg)}
          </li>
        ))}
      </ul>
      <div className="d-flex align-items-center gap-2 mb-3">
        <span
          className={`badge ${
            order.status === "filled"
              ? "bg-success-lt text-dark"
              : order.status === "rejected" || order.status === "error" || order.status === "cancelled"
                ? "bg-danger-lt text-dark"
                : "bg-azure-lt text-dark"
          }`}
          style={{ fontSize: "0.72rem" }}
        >
          {statusLabel(order.status)}
        </span>
        {isWaiting && <Spinner size="sm" label="Waiting for IBKR" />}
      </div>
      {order.errorMessage && <div className="alert alert-danger">{order.errorMessage}</div>}

      {isPending && (
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-primary d-inline-flex align-items-center gap-1"
            disabled={confirming}
            onClick={handleConfirm}
          >
            {confirming && <Spinner size="sm" />}
            Confirm &amp; Submit to IBKR
          </button>
          <button type="button" className="btn btn-outline-secondary" disabled={cancelling} onClick={handleCancel}>
            {cancelling && <Spinner size="sm" />}
            Cancel
          </button>
        </div>
      )}
      {canRequestCancel && (
        <button type="button" className="btn btn-outline-secondary" disabled={cancelling} onClick={handleCancel}>
          {cancelling && <Spinner size="sm" />}
          Cancel Order
        </button>
      )}
      {cancelRequested && (
        <button type="button" className="btn btn-outline-secondary" disabled>
          <Spinner size="sm" label="Waiting for IBKR to confirm the cancellation" />
        </button>
      )}
      {isTerminal && order.status !== "filled" && order.status !== "partially_filled" && (
        <button type="button" className="btn btn-outline-secondary" onClick={onCancelled}>
          Close
        </button>
      )}
    </div>
  );
}
