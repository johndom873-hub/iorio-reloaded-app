import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ApiError } from "../api/client";
import { useBackgroundJobs, type OrderJob } from "../contexts/BackgroundJobsContext";
import { cancelOrder, confirmOrder, openOrderLegQuoteStream, type OrderLegQuote, type OrderRequest } from "../api/positions";
import { fetchAccountValue, fetchAvailableCash } from "../api/dashboard";
import type { StrategyKey } from "../api/screener";
import {
  daysToExpiry,
  formatCurrency,
  formatCurrencyTrimmed,
  formatExpiryWithDte,
  formatNumber,
  formatPercentage,
  formatPercentageValue,
  formatSignedPnl,
  ibkrExpiryToIsoDate,
  orderRequestStatusBadgeClass,
} from "../lib/formatters";
import { computeAnnualizedYield, computeCapitalAtRiskFromOrderLegs, computePayoff, orderLegsToPayoffInput } from "../lib/payoff";

interface OrderReviewPanelProps {
  order: OrderRequest;
  onCancelled: () => void;
  /** Fires once the order reaches a terminal, successful state (filled/partially_filled). */
  onFilled: () => void;
}

const terminalStatuses = new Set(["filled", "partially_filled", "cancelled", "rejected", "error"]);

function legDescription(leg: OrderRequest["payload"]["legs"][number]): string {
  if (leg.role === "stock") return `${leg.action} ${leg.quantity} sh @ ${formatCurrency(leg.unitPrice)}`;
  const right = leg.right === "C" ? "Call" : "Put";
  const expiryIsoDate = leg.expiry ? (leg.expiry.length === 8 ? ibkrExpiryToIsoDate(leg.expiry) : leg.expiry) : null;
  const expiryLabel = formatExpiryWithDte(expiryIsoDate);
  return `${leg.action} ${leg.quantity}x ${leg.strike ? formatCurrencyTrimmed(leg.strike) : "—"} ${right} exp ${expiryLabel} @ ${formatCurrency(leg.unitPrice)}`;
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
  const { jobs, startOrderJob } = useBackgroundJobs();
  // Once confirmed or cancel-requested, status polling is owned by
  // BackgroundJobsContext (startOrderJob below) rather than a local
  // setTimeout chain, so it keeps running -- and the toast keeps updating --
  // even if this panel/modal closes. `localOrder` only matters before that
  // handoff (the pending_confirmation phase, before Confirm/Cancel is ever
  // clicked); once a job exists for this order id, its polled snapshot wins.
  const [localOrder, setLocalOrder] = useState(initialOrder);
  const job = jobs.find((candidate): candidate is OrderJob => candidate.kind === "order" && candidate.id === localOrder.id);
  const order = job?.order ?? localOrder;
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<OrderLegQuote | null>(null);
  const [quoteStreamError, setQuoteStreamError] = useState<string | null>(null);
  const [totalAccountValue, setTotalAccountValue] = useState<number | null>(null);
  const [availableCashToTrade, setAvailableCashToTrade] = useState<number | null>(null);
  const notifiedFilledRef = useRef(false);

  // Mirrors the old schedulePoll's onFilled short-circuit, just fed by the
  // context's polling instead of a local one -- fires once, the instant the
  // shared job's order flips to a filled state, guarded so a re-render at an
  // already-terminal status doesn't call onFilled twice.
  useEffect(() => {
    if ((order.status === "filled" || order.status === "partially_filled") && !notifiedFilledRef.current) {
      notifiedFilledRef.current = true;
      onFilled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status]);

  // So Capital at Risk (below) can show what % of the account this order
  // would commit, before the user confirms — approved 2026-08-25 so this
  // is visible at the decision point, not just after the fact on Positions.
  useEffect(() => {
    fetchAccountValue()
      .then((result) => setTotalAccountValue(result.netLiquidationValue))
      .catch(() => setTotalAccountValue(null));
  }, []);

  // Live (approved 2026-08-27, see fetchAvailableCash) -- shown below the
  // Live Quote card so "can I afford this" is answered with a genuinely
  // current cash figure, not last night's snapshot.
  useEffect(() => {
    fetchAvailableCash()
      .then((result) => setAvailableCashToTrade(result.availableCashToTrade))
      .catch(() => setAvailableCashToTrade(null));
  }, []);

  // Streams for as long as the panel stays open (approved 2026-08-27,
  // replacing a fetch-once snapshot) -- every tick recomputes Ann. Yield
  // below and, for an opening order, a live delta-vs-strategy-band
  // compliance verdict that gates Confirm. Only orders with an option leg
  // have anything to quote (a lone stock leg never does).
  useEffect(() => {
    if (!order.payload.legs.some((leg) => leg.role === "option")) return;
    setQuote(null);
    setQuoteStreamError(null);
    const close = openOrderLegQuoteStream(order.id, (event) => {
      if (event.type === "quote") setQuote(event.data);
      if (event.type === "streamError") setQuoteStreamError(event.message);
    });
    return close;
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
  const stockLeg = order.payload.legs.find((leg) => leg.role === "stock");
  const dte = optionLeg?.expiry ? daysToExpiry(optionLeg.expiry) : null;

  // Gates Confirm for opening orders only (approved 2026-08-27) -- Close/Roll
  // orders keep a live quote display but no compliance check, same
  // isOpeningOrder condition as the payoff/capital-at-risk figures above.
  // Fails closed: no quote yet, or a lost stream, both count as "not
  // confirmed compliant" rather than silently letting Confirm through.
  const complianceGated = Boolean(isOpeningOrder) && Boolean(optionLeg);
  const complianceBlockReason = !complianceGated
    ? null
    : quoteStreamError
      ? "Live quote feed lost — reopen this order to re-check compliance before confirming."
      : !quote
        ? "Waiting for a live quote before this order can be confirmed."
        : !quote.compliance || quote.compliance.compliant
          ? null
          : quote.compliance.reason;

  // Recomputed from the live quote (approved 2026-08-27) so this doesn't
  // freeze at the yield shown when the order was first built -- the same
  // approved formula as everywhere else, just fed the live bid/ask instead
  // of the order's original limit price. Falls back to that limit price
  // before the live quote arrives (same fallback the mid-price display
  // elsewhere in the app uses).
  const liveOptionMid = quote ? (quote.bid !== null && quote.ask !== null ? (quote.bid + quote.ask) / 2 : quote.last) : (optionLeg?.unitPrice ?? null);
  const liveYield =
    isOpeningOrder && optionLeg?.strike !== undefined && dte !== null
      ? computeAnnualizedYield(order.payload.strategyKey as StrategyKey, {
          premium: liveOptionMid,
          dte,
          strike: optionLeg.strike,
          spotPrice: stockLeg?.unitPrice ?? optionLeg.strike,
        })
      : null;

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const confirmed = await confirmOrder(localOrder.id);
      setLocalOrder(confirmed);
      startOrderJob(confirmed);
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
      const updated = await cancelOrder(localOrder.id);
      setLocalOrder(updated);
      if (updated.status === "cancelled") {
        onCancelled();
      } else {
        // "cancel_requested" — order was already at IBKR, so cancellation
        // isn't final until the worker's cancelOrder() call is confirmed.
        startOrderJob(updated);
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
    <div className="border rounded p-3 d-flex flex-column gap-3">
      <div className="fw-bold" style={{ fontSize: "1.1rem" }}>
        Order Review
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="list-unstyled mb-0 border rounded overflow-hidden">
        {order.payload.legs.map((leg, index) => (
          <li
            key={index}
            className="font-mono px-3 py-2"
            style={{ fontSize: "0.85rem", borderBottom: index < order.payload.legs.length - 1 ? "1px solid var(--tblr-border-color)" : undefined }}
          >
            <span className={leg.action === "BUY" ? "text-success fw-bold" : "text-danger fw-bold"}>{leg.action}</span>{" "}
            {legDescription(leg).replace(`${leg.action} `, "")}
          </li>
        ))}
      </ul>

      {(payoff || capitalAtRisk !== null || liveYield !== null) && (
        <div className="row g-3 font-mono" style={{ fontSize: "0.85rem" }}>
          {liveYield !== null && (
            <div className="col-4">
              <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Ann. Yield</div>
              <div className="fw-semibold text-success">{formatPercentage(liveYield)}</div>
            </div>
          )}
          {capitalAtRisk !== null && (
            <div className="col-4">
              <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Exp $</div>
              <div className="fw-semibold">{formatCurrency(capitalAtRisk, 0)}</div>
            </div>
          )}
          {capitalAtRisk !== null && (
            <div className="col-4">
              <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Exp %</div>
              <div className="fw-semibold" title="Share of total account value (positions + cash) this order would commit">
                {totalAccountValue === null ? "—" : formatPercentageValue((capitalAtRisk / totalAccountValue) * 100, 1)}
              </div>
            </div>
          )}
          {payoff && (
            <>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Max Gain</div>
                <div className="fw-semibold text-success">{formatSignedPnl(payoff.maxGain, 0)}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Max Loss</div>
                <div className="fw-semibold text-danger">{formatSignedPnl(-payoff.maxLoss, 0)}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Breakeven</div>
                <div className="fw-semibold">{formatCurrency(payoff.breakeven)}</div>
              </div>
            </>
          )}
        </div>
      )}

      {optionLeg && (
        <div className="border rounded p-3">
          <div className="text-secondary text-uppercase mb-2" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em" }}>
            Live Quote
          </div>
          {!quote && !quoteStreamError && <Spinner size="sm" label="Loading live quote" />}
          {quoteStreamError && (
            <span className="text-muted" title={quoteStreamError}>
              Live quote unavailable
            </span>
          )}
          {quote && (
            <div className="row g-3 font-mono" style={{ fontSize: "0.85rem" }}>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Bid / Ask</div>
                <div className="fw-semibold">
                  {quote.bid !== null ? formatCurrency(quote.bid) : "—"} / {quote.ask !== null ? formatCurrency(quote.ask) : "—"}
                </div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Spread</div>
                <div className="fw-semibold">{quote.bid !== null && quote.ask !== null ? formatCurrency(quote.ask - quote.bid) : "—"}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>IV</div>
                <div className="fw-semibold">{formatPercentage(quote.impliedVolatility)}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Delta</div>
                <div className="fw-semibold">{formatNumber(quote.delta, 2)}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Theta</div>
                <div className="fw-semibold">{formatNumber(quote.theta, 2)}</div>
              </div>
              <div className="col-4">
                <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Vega</div>
                <div className="fw-semibold">{formatNumber(quote.vega, 2)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cash sufficiency check (approved 2026-08-27) -- opening orders only,
          same gate as capitalAtRisk above (Close/Roll don't commit new
          capital the same way). Only "Cash required" gets red -- it's the
          one row that's always presented as a negative figure; the other two
          keep their default color regardless of sign. font-mono applies to
          the number only, not the label, per the approved design. */}
      {isOpeningOrder && optionLeg && capitalAtRisk !== null && (
        <div className="d-flex flex-column gap-1" style={{ fontSize: "0.8rem" }}>
          <div className="d-flex justify-content-between">
            <span className="text-secondary">Available cash to trade</span>
            <span className="font-mono fw-semibold">
              {availableCashToTrade !== null ? formatCurrency(availableCashToTrade) : <Spinner size="sm" label="Loading available cash" />}
            </span>
          </div>
          <div className="d-flex justify-content-between">
            <span className="text-secondary">Cash required</span>
            <span className="font-mono fw-semibold text-danger">{formatSignedPnl(-capitalAtRisk, 0)}</span>
          </div>
          <div className="d-flex justify-content-between">
            <span className="text-secondary">Cash after this trade</span>
            <span className="font-mono fw-semibold">
              {availableCashToTrade !== null ? formatCurrency(availableCashToTrade - capitalAtRisk) : <Spinner size="sm" label="Loading available cash" />}
            </span>
          </div>
        </div>
      )}

      {/* "Awaiting your confirmation" specifically dropped (2026-08-27) —
          redundant with the visible Confirm/Cancel buttons right below it.
          Every other status still shows the badge here since it's the only
          progress indicator once those buttons are gone (confirmed →
          submitted → filled/cancelled/etc). */}
      {!isPending && (
        <div className="d-flex align-items-center gap-2">
          <span className={`badge ${orderRequestStatusBadgeClass(order.status)}`}>{statusLabel(order.status)}</span>
          {isWaiting && <Spinner size="sm" label="Waiting for IBKR" />}
        </div>
      )}
      {order.errorMessage && <div className="alert alert-danger mb-0">{order.errorMessage}</div>}
      {order.note && <div className="alert alert-info mb-0">{order.note}</div>}

      {isPending && (
        <>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-primary flex-fill d-inline-flex align-items-center justify-content-center gap-1"
              disabled={confirming || Boolean(complianceBlockReason)}
              title={complianceBlockReason ?? undefined}
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
          {complianceBlockReason && (
            <div className="text-danger" style={{ fontSize: "0.8rem" }} title={complianceBlockReason}>
              {complianceBlockReason}
            </div>
          )}
        </>
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
