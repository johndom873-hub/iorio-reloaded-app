import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApiError } from "../api/client";
import { buildRollOrder, type OrderRequest } from "../api/positions";
import type { RollStructure, TradeAlert } from "../api/tradeAlerts";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatNumber } from "../lib/formatters";

interface RollPositionModalProps {
  alert: TradeAlert & { suggestedStructure: RollStructure };
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

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
        sourceAlertId: alert.id,
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
                        {formatCurrencyTrimmed(closeLeg.strike)} {rightLabel} exp {formatDate(closeLeg.expiry)}
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Credit collected
                      </div>
                      <div className="text-success">{formatCurrency(closeLeg.entryPrice)}</div>
                    </div>
                  </div>
                  <div className="row g-3 mb-4">
                    <div className="col-6">
                      <label className="form-label">Buy-back limit price</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={closeLimitPriceDraft}
                        onChange={(event) => setCloseLimitPriceDraft(event.target.value)}
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
                  <div className="row g-3">
                    <div className="col-6">
                      <label className="form-label">Sell limit price</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={newLegLimitPriceDraft}
                        onChange={(event) => setNewLegLimitPriceDraft(event.target.value)}
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
