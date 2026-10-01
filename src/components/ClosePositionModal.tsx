import { useCallback, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { FillPriorityPicker } from "./FillPriorityPicker";
import { DottedLabelTooltip } from "./HelpTooltip";
import { ApiError } from "../api/client";
import {
  buildCloseOrder,
  cancelUnconfirmedOrder,
  openCloseLiveStream,
  type AdaptivePriority,
  type CloseLiveLegQuote,
  type CloseLiveState,
  type OrderRequest,
  type Position,
  type PositionLeg,
} from "../api/positions";
import { formatCurrency, formatCurrencyTrimmed, formatExpiryWithDte, formatSignedPnl, pnlTextClass, todayInEasternIso } from "../lib/formatters";
import { flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";
import { useTooltip } from "../hooks/useTooltip";

interface ClosePositionModalProps {
  position: Position;
  onClose: () => void;
  onClosed: () => void;
}

function legLabel(leg: PositionLeg): string {
  if (leg.legType === "option") {
    const right = leg.optionType === "call" ? "C" : "P";
    const strike = leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—";
    return `${leg.side} ${leg.quantity}x ${strike}${right} exp ${formatExpiryWithDte(leg.expiryDate, todayInEasternIso())}`;
  }
  return `${leg.side} ${leg.quantity} sh`;
}

// Compact live-quote readout, same spirit as RollPositionModal's
// LiveLegQuote — shown under each leg's limit-price input so the prefilled
// mid isn't a mystery number. Every leg (stock and option) ticks live from
// the Close form's own stream for as long as the modal is open.
function LiveMidQuote({ quote, error }: { quote: CloseLiveLegQuote | null; error: string | null }) {
  const midFlash = useFlashOnChange(quote ? quote.mid : null);
  const tooltipRef = useTooltip<HTMLSpanElement>(error);
  if (error) {
    return (
      <span ref={tooltipRef} className="text-muted" tabIndex={0}>
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

const noLegQuotes: Record<string, CloseLiveLegQuote> = {};

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

  // Everything live comes from one stream for this position: bid/ask per open
  // leg, the live wheel-cycle P&L, and the reason closing is blocked (market
  // closed, quotes not live, or an inconsistent cycle). The stream never
  // reconnects on its own, so a drop leaves the form blocked (fails closed).
  const [liveState, setLiveState] = useState<CloseLiveState | null>(null);
  const [liveStreamError, setLiveStreamError] = useState<string | null>(null);
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");

  useEffect(() => {
    return openCloseLiveStream(position.id, (event) => {
      if (event.type === "state") {
        setLiveStreamError(null);
        setLiveState(event.data);
      } else if (event.type === "streamError") {
        setLiveState(null);
        setLiveStreamError(event.message);
      }
    });
  }, [position.id]);

  const legQuotes = liveState?.legQuotes ?? noLegQuotes;
  const isAwaitingLive = !liveStreamError && (liveState === null || liveState.pending);
  const closeBlockedReason: string | null = liveStreamError
    ? `Live data connection lost: ${liveStreamError} Closing is blocked — close this window and reopen it to reconnect.`
    : liveState === null
      ? "Connecting to live data…"
      : liveState.blockReason;
  // Per-leg readout error: only once the stream has settled and that leg still has no two-sided market.
  const quoteErrorFor = (legId: string): string | null =>
    liveStreamError ? "Live data connection lost." : liveState && !liveState.pending && liveState.legQuotes[legId]?.mid == null ? "No live bid/ask." : null;

  // Seed each limit-price input from its live quote's mid once it first
  // arrives, but only if the user hasn't already typed their own value —
  // "prefill unless touched", same convention as RollPositionModal.
  useEffect(() => {
    if (!optionLeg || optionLimitTouched) return;
    const mid = legQuotes[optionLeg.id]?.mid ?? null;
    if (mid !== null) setOptionLimitPriceDraft(mid.toFixed(2));
  }, [legQuotes, optionLeg, optionLimitTouched]);

  useEffect(() => {
    if (!stockLeg || stockLimitTouched) return;
    const mid = legQuotes[stockLeg.id]?.mid ?? null;
    if (mid !== null) setStockLimitPriceDraft(mid.toFixed(2));
  }, [legQuotes, stockLeg, stockLimitTouched]);

  useEffect(() => {
    setLegDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const leg of openLegs) {
        const draft = next[leg.id];
        if (!draft || draft.limitPriceTouched) continue;
        const mid = legQuotes[leg.id]?.mid ?? null;
        if (mid !== null) {
          next[leg.id] = { ...draft, limitPriceDraft: mid.toFixed(2) };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveState]);

  // Closing with an order still under review cancels it (best effort).
  const requestClose = useCallback(() => {
    cancelUnconfirmedOrder(pendingOrder);
    onClose();
  }, [onClose, pendingOrder]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

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
    if (!optionLeg || !validContracts || closeBlockedReason !== null) return;
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
    if (!unstructuredFormValid || closeBlockedReason !== null) return;
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
  const showForm = !pendingOrder && openLegs.length > 0 && (isUnstructured || optionLeg !== undefined);

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1050 }}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Close {position.symbol}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={requestClose} disabled={submitting} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              {showForm && (
                <>
                  <div className="d-flex justify-content-between align-items-center border rounded p-2 mb-3">
                    <DottedLabelTooltip
                      label="Wheel cycle P&L"
                      tooltipHtml={`Live profit and loss of ${position.symbol}'s whole wheel cycle (every put, call, share and hedge since it began), with shares and open options marked at live prices. Covers the entire ticker, not only this position.`}
                    />
                    {liveState?.cycleTotal != null ? (
                      <span className={`fw-bold font-mono ${pnlTextClass(liveState.cycleTotal)}`}>{formatSignedPnl(liveState.cycleTotal)}</span>
                    ) : isAwaitingLive ? (
                      <Spinner size="sm" label="Loading live cycle P&L" />
                    ) : (
                      <span className="text-secondary">—</span>
                    )}
                  </div>
                  {closeBlockedReason !== null &&
                    (isAwaitingLive ? (
                      <div className="text-secondary d-flex align-items-center gap-2 mb-3" style={{ fontSize: "0.8rem" }}>
                        <Spinner size="sm" />
                        {closeBlockedReason}
                      </div>
                    ) : (
                      <div className="alert alert-warning mb-3" role="alert">
                        {closeBlockedReason}
                      </div>
                    ))}
                </>
              )}

              {pendingOrder ? (
                <OrderReviewPanel order={pendingOrder} onOrderChange={setPendingOrder} initialAdaptivePriority={adaptivePriority} onCancelled={onClose} onFilled={onClosed} />
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
                              <label className="form-label">{leg.legType === "option" && leg.side === "short" ? "Buy-back" : "Sell"} limit price</label>
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
                            <LiveMidQuote quote={legQuotes[leg.id] ?? null} error={quoteErrorFor(leg.id)} />
                          </div>
                        )}
                        {draft.included && legError && closeBlockedReason === null && <div className="alert alert-danger mt-2 mb-0">{legError}</div>}
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
                        {rightLabel} exp {formatExpiryWithDte(optionLeg.expiryDate, todayInEasternIso())}
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
                      <label className="form-label">{optionLeg?.side === "long" ? "Option sell limit price" : "Option buy-back limit price"}</label>
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
                        <LiveMidQuote quote={legQuotes[optionLeg.id] ?? null} error={quoteErrorFor(optionLeg.id)} />
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
                          <LiveMidQuote quote={legQuotes[stockLeg.id] ?? null} error={quoteErrorFor(stockLeg.id)} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {showForm && (
                <div className="mt-3">
                  <FillPriorityPicker value={adaptivePriority} onChange={setAdaptivePriority} disabled={submitting} />
                </div>
              )}
            </div>
            {showForm && (
              <div className="modal-footer">
                <button type="button" className="btn btn-link text-secondary" onClick={requestClose} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-1"
                  onClick={isUnstructured ? handleSubmitUnstructured : handleSubmitStructured}
                  disabled={submitting || closeBlockedReason !== null || (isUnstructured ? !unstructuredFormValid : !validContracts)}
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
