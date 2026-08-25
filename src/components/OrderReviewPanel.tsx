import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ApiError } from "../api/client";
import { cancelOrder, confirmOrder, fetchOrder, fetchOrderLegQuote, type OrderLegQuote, type OrderRequest } from "../api/positions";
import { fetchAccountValue } from "../api/dashboard";
import type { StrategyKey } from "../api/screener";
import { formatCurrency, formatDate, formatNumber, formatPercentage, formatPercentageValue, formatSignedPnl, orderRequestStatusBadgeClass } from "../lib/formatters";
import { computeCapitalAtRiskFromOrderLegs, computePayoff, orderLegsToPayoffInput } from "../lib/payoff";

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
// Whole calendar days between now and an option leg's YYYYMMDD/YYYY-MM-DD
// expiry -- matches how DTE is presented everywhere else in this app.
function daysToExpiry(expiry: string): number {
  const iso = expiry.length === 8 ? `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}` : expiry;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function OrderReviewPanel({ order: initialOrder, onCancelled, onFilled }: OrderReviewPanelProps) {
  const [order, setOrder] = useState(initialOrder);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<OrderLegQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [totalAccountValue, setTotalAccountValue] = useState<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  // So Capital at Risk (below) can show what % of the account this order
  // would commit, before the user confirms — approved 2026-08-25 so this
  // is visible at the decision point, not just after the fact on Positions.
  useEffect(() => {
    fetchAccountValue()
      .then((result) => setTotalAccountValue(result.netLiquidationValue))
      .catch(() => setTotalAccountValue(null));
  }, []);

  // Fetched once when the panel opens, not continuously polled -- same
  // on-demand-fetch-once pattern as Positions' Greeks column. Only orders
  // with an option leg have anything to quote (a lone stock leg never does).
  useEffect(() => {
    if (!order.payload.legs.some((leg) => leg.role === "option")) return;
    setQuoteLoading(true);
    fetchOrderLegQuote(order.id)
      .then(setQuote)
      .catch((err) => setQuoteError(err instanceof ApiError ? err.message : "Failed to load live quote."))
      .finally(() => setQuoteLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  // Max gain/loss/breakeven/capital-at-risk only make sense read against an
  // opening entry price -- computing them off a close/roll/downsize order's
  // legs would treat the closing price as if it were a fresh entry (found
  // 2026-08-25 testing the downsize flow: a real close showed "Capital at
  // Risk: $48,419" and a max-loss bigger than the position itself, both
  // nonsensical for a trade that's ending the position, not starting one).
  const isOpeningOrder = order.payload.strategyKey && order.requestType.startsWith("open_");
  const payoff = isOpeningOrder ? computePayoff(order.payload.strategyKey as StrategyKey, orderLegsToPayoffInput(order.payload.legs)) : null;
  const capitalAtRisk = isOpeningOrder ? computeCapitalAtRiskFromOrderLegs(order.payload.strategyKey as StrategyKey, order.payload.legs) : null;
  const optionLeg = order.payload.legs.find((leg) => leg.role === "option");
  const dte = optionLeg?.expiry ? daysToExpiry(optionLeg.expiry) : null;

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

      {(payoff || capitalAtRisk !== null || dte !== null) && (
        <div className="row g-2 mb-2" style={{ fontSize: "0.85rem" }}>
          {dte !== null && (
            <div className="col-4 col-md-2">
              <div className="text-secondary">DTE</div>
              <div>{dte}</div>
            </div>
          )}
          {capitalAtRisk !== null && (
            <div className="col-4 col-md-2">
              <div className="text-secondary">EXP $</div>
              <div>{formatCurrency(capitalAtRisk)}</div>
            </div>
          )}
          {capitalAtRisk !== null && (
            <div className="col-4 col-md-2">
              <div className="text-secondary">EXP %</div>
              <div title="Share of total account value (positions + cash) this order would commit">
                {totalAccountValue === null ? "—" : formatPercentageValue((capitalAtRisk / totalAccountValue) * 100, 1)}
              </div>
            </div>
          )}
          {payoff && (
            <>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Max Gain</div>
                <div>{formatSignedPnl(payoff.maxGain)}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Max Loss</div>
                <div>{formatSignedPnl(-payoff.maxLoss)}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Breakeven</div>
                <div>{formatCurrency(payoff.breakeven)}</div>
              </div>
            </>
          )}
        </div>
      )}

      {optionLeg && (
        <div className="mb-2" style={{ fontSize: "0.85rem" }}>
          {quoteLoading && <Spinner size="sm" label="Loading live quote" />}
          {quoteError && (
            <span className="text-muted" title={quoteError}>
              Live quote unavailable
            </span>
          )}
          {quote && (
            <div className="row g-2">
              <div className="col-4 col-md-2">
                <div className="text-secondary">Bid / Ask</div>
                <div>
                  {quote.bid !== null ? formatCurrency(quote.bid) : "—"} / {quote.ask !== null ? formatCurrency(quote.ask) : "—"}
                </div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Spread</div>
                <div>{quote.bid !== null && quote.ask !== null ? formatCurrency(quote.ask - quote.bid) : "—"}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">IV</div>
                <div>{formatPercentage(quote.impliedVolatility)}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Delta</div>
                <div>{formatNumber(quote.delta, 2)}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Theta</div>
                <div>{formatNumber(quote.theta, 2)}</div>
              </div>
              <div className="col-4 col-md-2">
                <div className="text-secondary">Vega</div>
                <div>{formatNumber(quote.vega, 2)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="d-flex align-items-center gap-2 mb-3">
        <span className={`badge ${orderRequestStatusBadgeClass(order.status)}`} style={{ fontSize: "0.72rem" }}>
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
