import { useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { cancelOrder, type OrderRequestStatus } from "../api/positions";
import { ConfirmModal } from "../components/ConfirmModal";
import { Spinner } from "../components/Spinner";

// Kept in sync with positions.ts's /orders/:id/cancel eligibility.
const cancellableStatuses = new Set<OrderRequestStatus>(["pending_confirmation", "confirmed", "submitted", "partially_filled"]);

interface PendingCancelConfirmation {
  orderId: string;
  symbol: string;
  liveAtIbkr: boolean;
}

/**
 * The Cancel button and its confirmation modal, shared by the Trade Blotter and Today's Orders.
 * Render `renderCancelButton(...)` in a row (it renders nothing for a status that can't be cancelled) and
 * `cancelModal` once anywhere. `onCancelled` runs after a successful cancel (reload the list); `onError` gets the message of a failed one.
 */
export function useOrderCancellation(onCancelled: () => Promise<void>, onError: (message: string) => void) {
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingCancelConfirmation | null>(null);

  // Never gated on age. A "pending_confirmation"/"confirmed" order was never sent to IBKR, so there's nothing external
  // to worry about cancelling regardless of how old it is. A "submitted"/"partially_filled" order is live at IBKR --
  // cancelling it is only a request (see the confirm modal's liveAtIbkr message) -- but there's still no reason to
  // block the attempt based on age: the timestamps in the list show whether an order was just built (don't touch it)
  // or has genuinely been sitting untouched.
  async function handleCancel(orderId: string) {
    setCancellingOrderId(orderId);
    try {
      await cancelOrder(orderId);
      await onCancelled();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to cancel order.");
    } finally {
      setCancellingOrderId(null);
      setConfirmation(null);
    }
  }

  // Every status that isn't cancellable is terminal, or cancel_requested: excluded on purpose so the button disappears
  // the instant a cancel is in flight, instead of allowing a second request.
  function renderCancelButton(order: { orderId: string; symbol: string; status: OrderRequestStatus }): ReactNode {
    if (!cancellableStatuses.has(order.status)) return null;
    return (
      <button
        type="button"
        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
        disabled={cancellingOrderId === order.orderId}
        onClick={() =>
          setConfirmation({ orderId: order.orderId, symbol: order.symbol, liveAtIbkr: order.status === "submitted" || order.status === "partially_filled" })
        }
      >
        {cancellingOrderId === order.orderId && <Spinner size="sm" />}
        Cancel
      </button>
    );
  }

  const cancelModal = confirmation && (
    <ConfirmModal
      title="Cancel Order"
      message={
        confirmation.liveAtIbkr ? (
          <>
            This <strong>{confirmation.symbol}</strong> order is already at IBKR. Cancelling sends a cancel request — IBKR could still fill it
            before the request is processed. This can't be undone.
          </>
        ) : (
          <>
            Cancel the pending <strong>{confirmation.symbol}</strong> order? This can't be undone.
          </>
        )
      }
      confirmLabel="Cancel Order"
      confirming={cancellingOrderId === confirmation.orderId}
      onConfirm={() => handleCancel(confirmation.orderId)}
      onCancel={() => setConfirmation(null)}
    />
  );

  return { renderCancelButton, cancelModal };
}
