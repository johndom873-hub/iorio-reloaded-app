import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApiError } from "../api/client";
import {
  buildCloseOrder,
  openContractQuoteStream,
  type OrderLegQuote,
  type OrderRequest,
  type Position,
  type PositionLeg,
} from "../api/positions";
import { openPositionQuoteStream, type TickerPricing } from "../api/tickerDetail";
import { formatCurrency, formatCurrencyTrimmed, formatExpiryWithDte } from "../lib/formatters";
import { flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";

interface ClosePositionModalProps {
  position: Position;
  onClose: () => void;
  onClosed: () => void;
}

function legLabel(leg: PositionLeg): string {
  if (leg.legType === "option") {
    const right = leg.optionType === "call" ? "C" : "P";
    const strike = leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—";
    return `${leg.side} ${leg.quantity}x ${strike}${right} exp ${formatExpiryWithDte(leg.expiryDate)}`;
  }
  return `${leg.side} ${leg.quantity} sh`;
}

type LegQuote = OrderLegQuote | TickerPricing;

function midPrice(quote: LegQuote): number | null {
  if (quote.bid !== null && quote.ask !== null) return (quote.bid + quote.ask) / 2;
  return quote.last;
}

// Compact live-quote readout, same spirit as RollPositionModal's
// LiveLegQuote — shown under each leg's limit-price input so the prefilled
// mid isn't a mystery number.
function LiveMidQuote({ quote, error }: { quote: LegQuote | null; error: string | null }) {
  // Option legs tick continuously for as long as this modal stays open (see
  // openContractQuoteStream/streamOrderLegQuote) -- stock legs are a one-shot
  // snapshot, so this just never flashes for those (no false flash on the
  // initial null-to-loaded transition either, same as everywhere else this
  // hook's used).
  const midFlash = useFlashOnChange(quote ? midPrice(quote) : null);
  if (error) {
    return (
      <span className="text-muted" title={error}>
        Live quote unavailable
      </span>
    );
  }
  if (!quote) return <Spinner size="sm" label="Loading live quote" />;
  return (
    <div className={`font-mono ${flashClassName(midFlash)}`} style={{ fontSize: "0.8rem" }}>
      Bid {quote.bid !== null ? formatCurrency(quote.bid) : "—"} / Ask {quote.ask !== null ? formatCurrency(quote.ask) : "—"}
    </div>
  );
}

interface UnstructuredLegDraft {
  included: boolean;
  quantityDraft: string;
  limitPriceDraft: string;
  limitPriceTouched: boolean;
}

// Action modal (form submission) — per the app's modal convention, does not
// close on backdrop click, only via the X button/Cancel/ESC.
//
// Two distinct forms live here, gated on strategyKey:
//
// Structured (covered_call/cash_secured_put) — one flow for both a full
// close and a partial "downsize" (merged 2026-08-25). Contracts-to-close
// always drives the stock leg's quantity (contracts * multiplier), never
// independently editable, so reducing it can't unbalance a covered call's
// coverage ratio. Requires exactly one open option leg.
//
// Unstructured (2026-08-31, see PROGRESS.md "close an unstructured
// position") — the leg mix isn't a known strategy shape (bare stock, a
// naked call, mismatched stock/call ratios), so there's nothing for
// contractsToClose to derive from. Instead each open leg gets its own row:
// an include checkbox, an independently editable quantity (partial close
// allowed), and its own limit price. The worker's reconciliation pass, not
// this form, decides afterward whether any legs remain open.
export function ClosePositionModal({ position, onClose, onClosed }: ClosePositionModalProps) {
  const openLegs = position.legs.filter((leg) => !leg.exitAt);
  const isUnstructured = position.strategyKey === "unstructured";
  const optionLegs = openLegs.filter((leg) => leg.legType === "option");
  const stockLeg = openLegs.find((leg) => leg.legType === "stock");
  const optionLeg = !isUnstructured && optionLegs.length === 1 ? optionLegs[0] : undefined;

  // Defaults to the full quantity -- clicking "Close" on an ordinary
  // position should just work as a full close with no extra steps; reducing
  // the number is how you downsize instead.
  const [contractsToCloseDraft, setContractsToCloseDraft] = useState(() => String(optionLeg?.quantity ?? 1));
  const [optionLimitPriceDraft, setOptionLimitPriceDraft] = useState("");
  const [stockLimitPriceDraft, setStockLimitPriceDraft] = useState("");
  const [optionLimitTouched, setOptionLimitTouched] = useState(false);
  const [stockLimitTouched, setStockLimitTouched] = useState(false);

  const [legDrafts, setLegDrafts] = useState<Record<string, UnstructuredLegDraft>>(() =>
    Object.fromEntries(
      openLegs.map((leg) => [
        leg.id,
        { included: true, quantityDraft: String(leg.quantity), limitPriceDraft: "", limitPriceTouched: false },
      ]),
    ),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  const [legQuotes, setLegQuotes] = useState<Record<string, LegQuote | null>>({});
  const [legQuoteErrors, setLegQuoteErrors] = useState<Record<string, string | null>>({});

  // Live quote per open leg, fetched once for the life of this modal (same
  // convention as RollPositionModal) — option legs via openContractQuoteStream,
  // stock legs via the ticker pricing stream. Feeds the mid-price prefill
  // below; not re-run on every render since openLegs is a fresh array each
  // time but the underlying legs/position don't change while this is open.
  useEffect(() => {
    const unsubscribers = openLegs.map((leg) => {
      if (leg.legType === "option") {
        const expiry = (leg.expiryDate ?? "").replaceAll("-", "");
        const strike = Number(leg.strikePrice);
        const right = leg.optionType === "call" ? "C" : "P";
        return openContractQuoteStream(position.symbol, expiry, strike, right, (event) => {
          if (event.type === "quote") setLegQuotes((prev) => ({ ...prev, [leg.id]: event.data }));
          if (event.type === "streamError") setLegQuoteErrors((prev) => ({ ...prev, [leg.id]: event.message }));
        });
      }
      return openPositionQuoteStream(position.symbol, (event) => {
        if (event.type === "overview") setLegQuotes((prev) => ({ ...prev, [leg.id]: event.data.pricing }));
        if (event.type === "streamError") setLegQuoteErrors((prev) => ({ ...prev, [leg.id]: event.message }));
      });
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.id]);

  // Seed each limit-price input from its live quote's mid once it first
  // arrives, but only if the user hasn't already typed their own value —
  // "prefill unless touched", same convention as RollPositionModal.
  useEffect(() => {
    if (!optionLeg || optionLimitTouched) return;
    const quote = legQuotes[optionLeg.id];
    if (!quote) return;
    const mid = midPrice(quote);
    if (mid !== null) setOptionLimitPriceDraft(mid.toFixed(2));
  }, [legQuotes, optionLeg, optionLimitTouched]);

  useEffect(() => {
    if (!stockLeg || stockLimitTouched) return;
    const quote = legQuotes[stockLeg.id];
    if (!quote) return;
    const mid = midPrice(quote);
    if (mid !== null) setStockLimitPriceDraft(mid.toFixed(2));
  }, [legQuotes, stockLeg, stockLimitTouched]);

  useEffect(() => {
    setLegDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const leg of openLegs) {
        const draft = next[leg.id];
        const quote = legQuotes[leg.id];
        if (!draft || draft.limitPriceTouched || !quote) continue;
        const mid = midPrice(quote);
        if (mid !== null) {
          next[leg.id] = { ...draft, limitPriceDraft: mid.toFixed(2) };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legQuotes]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function updateLegDraft(legId: string, patch: Partial<UnstructuredLegDraft>) {
    setLegDrafts((prev) => ({ ...prev, [legId]: { ...prev[legId]!, ...patch } }));
  }

  const includedLegs = openLegs.filter((leg) => legDrafts[leg.id]?.included);
  const unstructuredLegErrors = new Map<string, string>();
  for (const leg of includedLegs) {
    const draft = legDrafts[leg.id]!;
    const quantity = Number(draft.quantityDraft);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > leg.quantity) {
      unstructuredLegErrors.set(leg.id, `Quantity must be a whole number from 1 to ${leg.quantity}.`);
    } else if (!draft.limitPriceDraft) {
      unstructuredLegErrors.set(leg.id, "A limit price is required.");
    }
  }
  const unstructuredFormValid = includedLegs.length > 0 && unstructuredLegErrors.size === 0;

  const contractsToClose = Number(contractsToCloseDraft);
  const validContracts = optionLeg && Number.isInteger(contractsToClose) && contractsToClose >= 1 && contractsToClose <= optionLeg.quantity;
  const sharesToClose = optionLeg ? contractsToClose * optionLeg.multiplier : 0;
  const isPartialClose = optionLeg !== undefined && contractsToClose < optionLeg.quantity;
  const remainingContracts = optionLeg ? optionLeg.quantity - contractsToClose : 0;

  async function handleSubmitStructured() {
    if (!optionLeg || !validContracts) return;
    if (!optionLimitPriceDraft || (stockLeg && !stockLimitPriceDraft)) {
      setError("A limit price is required for every leg.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const legs = [
        { legId: optionLeg.id, limitPrice: Number(optionLimitPriceDraft) },
        ...(stockLeg ? [{ legId: stockLeg.id, limitPrice: Number(stockLimitPriceDraft) }] : []),
      ];
      const order = await buildCloseOrder(position.id, legs, contractsToClose);
      setPendingOrder(order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to build close order.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitUnstructured() {
    if (!unstructuredFormValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const legs = includedLegs.map((leg) => {
        const draft = legDrafts[leg.id]!;
        return { legId: leg.id, quantity: Number(draft.quantityDraft), limitPrice: Number(draft.limitPriceDraft) };
      });
      const order = await buildCloseOrder(position.id, legs);
      setPendingOrder(order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to build close order.");
    } finally {
      setSubmitting(false);
    }
  }

  const rightLabel = optionLeg?.optionType === "call" ? "C" : "P";

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1050 }}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Close {position.symbol}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={submitting} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              {pendingOrder ? (
                <OrderReviewPanel order={pendingOrder} onCancelled={onClose} onFilled={onClosed} />
              ) : openLegs.length === 0 ? (
                <div className="alert alert-warning">This position has no open legs to close.</div>
              ) : isUnstructured ? (
                <>
                  <div className="text-secondary mb-2" style={{ fontSize: "0.8rem" }}>
                    This position's leg mix isn't a standard strategy shape — pick which legs to close and at what
                    quantity. Unchecked legs, or leftover quantity on an included leg, stay open.
                  </div>
                  {openLegs.map((leg) => {
                    const draft = legDrafts[leg.id]!;
                    const legError = unstructuredLegErrors.get(leg.id);
                    return (
                      <div key={leg.id} className="border rounded p-2 mb-2">
                        <div className="form-check mb-2">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            id={`leg-${leg.id}`}
                            checked={draft.included}
                            onChange={(event) => updateLegDraft(leg.id, { included: event.target.checked })}
                            disabled={submitting}
                          />
                          <label className="form-check-label" htmlFor={`leg-${leg.id}`}>
                            {legLabel(leg)}
                          </label>
                        </div>
                        {draft.included && (
                          <div className="row g-3">
                            <div className="col-6">
                              <label className="form-label">Quantity to close</label>
                              <input
                                type="number"
                                min={1}
                                max={leg.quantity}
                                step={1}
                                className="form-control"
                                value={draft.quantityDraft}
                                onChange={(event) => updateLegDraft(leg.id, { quantityDraft: event.target.value })}
                                disabled={submitting}
                              />
                            </div>
                            <div className="col-6">
                              <label className="form-label">{leg.legType === "option" ? "Buy-back" : "Sell"} limit price</label>
                              <input
                                type="number"
                                step="0.01"
                                className="form-control"
                                value={draft.limitPriceDraft}
                                onChange={(event) =>
                                  updateLegDraft(leg.id, { limitPriceDraft: event.target.value, limitPriceTouched: true })
                                }
                                disabled={submitting}
                              />
                            </div>
                          </div>
                        )}
                        {draft.included && (
                          <div className="mt-2">
                            <LiveMidQuote quote={legQuotes[leg.id] ?? null} error={legQuoteErrors[leg.id] ?? null} />
                          </div>
                        )}
                        {draft.included && legError && <div className="alert alert-danger mt-2 mb-0">{legError}</div>}
                      </div>
                    );
                  })}
                  {includedLegs.length === 0 && <div className="alert alert-danger">Select at least one leg to close.</div>}
                </>
              ) : !optionLeg ? (
                <div className="alert alert-warning">
                  Closing only supports positions with exactly one open option leg — this one has {optionLegs.length}.
                </div>
              ) : (
                <>
                  <div className="row g-3 mb-2">
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Contract
                      </div>
                      <div>
                        {optionLeg.quantity}x {optionLeg.strikePrice ? formatCurrencyTrimmed(Number(optionLeg.strikePrice)) : "—"}
                        {rightLabel} exp {formatExpiryWithDte(optionLeg.expiryDate)}
                      </div>
                    </div>
                    {stockLeg && (
                      <div className="col-6">
                        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                          Stock held
                        </div>
                        <div>{stockLeg.quantity} sh</div>
                      </div>
                    )}
                  </div>

                  <div className="row g-3 mb-2">
                    <div className="col-6">
                      <label className="form-label">Contracts to close</label>
                      <input
                        type="number"
                        min={1}
                        max={optionLeg.quantity}
                        step={1}
                        className="form-control"
                        value={contractsToCloseDraft}
                        onChange={(event) => setContractsToCloseDraft(event.target.value)}
                        disabled={submitting}
                      />
                    </div>
                    {stockLeg && (
                      <div className="col-6">
                        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                          Shares to close (derived)
                        </div>
                        <div>{validContracts ? sharesToClose : "—"} sh</div>
                      </div>
                    )}
                  </div>

                  {!validContracts && (
                    <div className="alert alert-danger">
                      Contracts to close must be a whole number from 1 to {optionLeg.quantity}.
                    </div>
                  )}
                  {validContracts && isPartialClose && (
                    <div className="alert alert-warning">
                      This will leave {remainingContracts} contract{remainingContracts === 1 ? "" : "s"} ({remainingContracts * optionLeg.multiplier} sh) open — the position won't be fully closed.
                    </div>
                  )}

                  <div className="row g-3 mb-2">
                    <div className="col-6">
                      <label className="form-label">Option buy-back limit price</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={optionLimitPriceDraft}
                        onChange={(event) => {
                          setOptionLimitTouched(true);
                          setOptionLimitPriceDraft(event.target.value);
                        }}
                        disabled={submitting}
                      />
                      <div className="mt-1">
                        <LiveMidQuote quote={legQuotes[optionLeg.id] ?? null} error={legQuoteErrors[optionLeg.id] ?? null} />
                      </div>
                    </div>
                    {stockLeg && (
                      <div className="col-6">
                        <label className="form-label">Stock sell limit price</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          value={stockLimitPriceDraft}
                          onChange={(event) => {
                            setStockLimitTouched(true);
                            setStockLimitPriceDraft(event.target.value);
                          }}
                          disabled={submitting}
                        />
                        <div className="mt-1">
                          <LiveMidQuote quote={legQuotes[stockLeg.id] ?? null} error={legQuoteErrors[stockLeg.id] ?? null} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {!pendingOrder && openLegs.length > 0 && (isUnstructured || optionLeg) && (
              <div className="modal-footer">
                <button type="button" className="btn btn-link text-secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-1"
                  onClick={isUnstructured ? handleSubmitUnstructured : handleSubmitStructured}
                  disabled={submitting || (isUnstructured ? !unstructuredFormValid : !validContracts)}
                >
                  {submitting && <Spinner size="sm" />}
                  Review Close Order
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
