import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApiError } from "../api/client";
import { buildRollOrder, openContractQuoteStream, type OrderLegQuote, type OrderRequest } from "../api/positions";
import type { RollStructure } from "../api/tradeAlerts";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatNumber } from "../lib/formatters";

function midPrice(quote: OrderLegQuote): number | null {
  if (quote.bid !== null && quote.ask !== null) return (quote.bid + quote.ask) / 2;
  return quote.last;
}

// Small inline live-quote readout for one leg, matching OrderReviewPanel's
// "Live Quote" card in spirit but compact enough for two of these to sit
// side by side (close leg + replacement) instead of one full-width block.
function LiveLegQuote({ quote, error }: { quote: OrderLegQuote | null; error: string | null }) {
  if (error) {
    return (
      <span className="text-muted" title={error}>
        Live quote unavailable
      </span>
    );
  }
  if (!quote) return <Spinner size="sm" label="Loading live quote" />;
  return (
    <div className="font-mono" style={{ fontSize: "0.8rem" }}>
      Bid {quote.bid !== null ? formatCurrency(quote.bid) : "—"} / Ask {quote.ask !== null ? formatCurrency(quote.ask) : "—"}
      {" · "}Δ {formatNumber(quote.delta, 2)}
    </div>
  );
}

// Widened 2026-08-31 (was `TradeAlert & {suggestedStructure: RollStructure}`)
// so an on-demand roll candidate (fetchRollCandidate — no backing
// trade_alerts row, so no real `id`/`status`/etc.) can be passed here too,
// not just a real roll alert. Every field actually used below is still
// present on both shapes; `id` is optional and simply omitted as
// sourceAlertId when absent.
interface RollPositionModalProps {
  alert: { id?: string; symbol: string; relatedPositionId: string | null; suggestedStructure: RollStructure };
  onClose: () => void;
  onRolled: () => void;
}

// Action modal (form submission, not just informational) — per the app's
// modal convention, does not close on backdrop click, only via the X
// button/Cancel/ESC, so an accidental outside click can't discard an
// in-progress roll.
export function RollPositionModal({ alert, onClose, onRolled }: RollPositionModalProps) {
  const { closeLeg, replacement, trigger, dte } = alert.suggestedStructure;

  const [closeLimitPriceDraft, setCloseLimitPriceDraft] = useState(closeLeg.currentPrice.toFixed(2));
  const [newLegLimitPriceDraft, setNewLegLimitPriceDraft] = useState(replacement.premium.toFixed(2));
  const [closeLimitTouched, setCloseLimitTouched] = useState(false);
  const [newLegLimitTouched, setNewLegLimitTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  const [closeLegQuote, setCloseLegQuote] = useState<OrderLegQuote | null>(null);
  const [closeLegQuoteError, setCloseLegQuoteError] = useState<string | null>(null);
  const [replacementQuote, setReplacementQuote] = useState<OrderLegQuote | null>(null);
  const [replacementQuoteError, setReplacementQuoteError] = useState<string | null>(null);

  const rightParam = closeLeg.right === "call" ? "C" : "P";

  // Live for as long as this modal's review step stays open (approved
  // 2026-08-27, matching Order Review/Ticker Detail's convention) — the
  // alert's suggestedStructure prices are only ever a scan/refresh-time
  // snapshot, and this modal can stay open review-side for a while.
  useEffect(() => {
    const closeExpiry = closeLeg.expiry.replaceAll("-", "");
    const closeStream = openContractQuoteStream(alert.symbol, closeExpiry, closeLeg.strike, rightParam, (event) => {
      if (event.type === "quote") setCloseLegQuote(event.data);
      if (event.type === "streamError") setCloseLegQuoteError(event.message);
    });
    const replacementExpiry = replacement.expiry.replaceAll("-", "");
    const replacementStream = openContractQuoteStream(alert.symbol, replacementExpiry, replacement.strike, rightParam, (event) => {
      if (event.type === "quote") setReplacementQuote(event.data);
      if (event.type === "streamError") setReplacementQuoteError(event.message);
    });
    return () => {
      closeStream();
      replacementStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.symbol, closeLeg.expiry, closeLeg.strike, replacement.expiry, replacement.strike, rightParam]);

  // Seed the editable limit-price inputs from the live quote once it first
  // arrives, but only if the user hasn't already typed their own value —
  // same "prefill unless touched" convention as PositionsPage's stock entry
  // price. Both prices remain freely editable either way.
  useEffect(() => {
    if (closeLimitTouched || !closeLegQuote) return;
    const mid = midPrice(closeLegQuote);
    if (mid !== null) setCloseLimitPriceDraft(mid.toFixed(2));
  }, [closeLegQuote, closeLimitTouched]);

  useEffect(() => {
    if (newLegLimitTouched || !replacementQuote) return;
    const mid = midPrice(replacementQuote);
    if (mid !== null) setNewLegLimitPriceDraft(mid.toFixed(2));
  }, [replacementQuote, newLegLimitTouched]);

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

  async function handleSubmit() {
    if (!alert.relatedPositionId) {
      setError("This alert isn't linked to a position.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const order = await buildRollOrder(alert.relatedPositionId, {
        sourceAlertId: alert.id ?? undefined,
        closeLegId: closeLeg.legId,
        closeLimitPrice: Number(closeLimitPriceDraft),
        newLeg: {
          strikePrice: replacement.strike,
          expiryDate: replacement.expiry,
          quantity: closeLeg.quantity,
          limitPrice: Number(newLegLimitPriceDraft),
        },
      });
      setPendingOrder(order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to build roll order.");
    } finally {
      setSubmitting(false);
    }
  }

  const rightLabel = closeLeg.right === "call" ? "C" : "P";
  const triggerLabel = trigger === "decay" ? "decayed to ≤50% of credit collected" : `≤21 DTE (${dte} remaining)`;

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1050 }}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                Roll {alert.symbol} {formatCurrencyTrimmed(closeLeg.strike)} {rightLabel}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={submitting} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              {alert.suggestedStructure.stillTriggered === false && !pendingOrder && (
                <div className="alert alert-warning">
                  This leg hasn't actually hit the 50%-decay/21-DTE roll trigger yet — you're rolling early.
                </div>
              )}

              {pendingOrder ? (
                <OrderReviewPanel order={pendingOrder} onCancelled={onClose} onFilled={onRolled} />
              ) : (
                <>
                  <div className="text-secondary mb-3" style={{ fontSize: "0.8rem" }}>
                    Trigger: {triggerLabel}
                  </div>

                  <h6 className="text-secondary text-uppercase" style={{ fontSize: "0.72rem" }}>
                    Close existing leg
                  </h6>
                  <div className="row g-3 mb-2">
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Contract
                      </div>
                      <div>
                        {formatCurrencyTrimmed(closeLeg.strike)} {rightLabel} exp {formatDate(closeLeg.expiry)} ({dte} DTE)
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Credit collected
                      </div>
                      <div className="text-success">{formatCurrency(closeLeg.entryPrice)}</div>
                    </div>
                  </div>
                  <div className="mb-2">
                    <LiveLegQuote quote={closeLegQuote} error={closeLegQuoteError} />
                  </div>
                  <div className="row g-3 mb-4">
                    <div className="col-6">
                      <label className="form-label">Buy-back limit price</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={closeLimitPriceDraft}
                        onChange={(event) => {
                          setCloseLimitTouched(true);
                          setCloseLimitPriceDraft(event.target.value);
                        }}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <h6 className="text-secondary text-uppercase" style={{ fontSize: "0.72rem" }}>
                    Open replacement leg
                  </h6>
                  <div className="row g-3 mb-2">
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Contract
                      </div>
                      <div>
                        {formatCurrencyTrimmed(replacement.strike)} {rightLabel} exp {formatDate(replacement.expiry)} ({replacement.dte} DTE, Δ
                        {formatNumber(replacement.delta, 2)})
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Suggested premium
                      </div>
                      <div className="text-success">{formatCurrency(replacement.premium)}</div>
                    </div>
                  </div>
                  <div className="mb-2">
                    <LiveLegQuote quote={replacementQuote} error={replacementQuoteError} />
                  </div>
                  <div className="row g-3">
                    <div className="col-6">
                      <label className="form-label">Sell limit price</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={newLegLimitPriceDraft}
                        onChange={(event) => {
                          setNewLegLimitTouched(true);
                          setNewLegLimitPriceDraft(event.target.value);
                        }}
                        disabled={submitting}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            {!pendingOrder && (
              <div className="modal-footer">
                <button type="button" className="btn btn-link text-secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-1"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting && <Spinner size="sm" />}
                  Review Roll Order
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
