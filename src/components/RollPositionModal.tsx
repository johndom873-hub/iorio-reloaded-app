import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { ApiError } from "../api/client";
import { rollPosition, type Position } from "../api/positions";
import type { RollStructure, TradeAlert } from "../api/tradeAlerts";
import { formatCurrency, formatDate } from "../lib/formatters";

interface RollPositionModalProps {
  alert: TradeAlert & { suggestedStructure: RollStructure };
  onClose: () => void;
  onRolled: (position: Position) => void;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Action modal (form submission, not just informational) — per the app's
// modal convention, does not close on backdrop click, only via the X
// button/Cancel/ESC, so an accidental outside click can't discard an
// in-progress roll.
export function RollPositionModal({ alert, onClose, onRolled }: RollPositionModalProps) {
  const { closeLeg, replacement, trigger, dte } = alert.suggestedStructure;

  const [exitPriceDraft, setExitPriceDraft] = useState(closeLeg.currentPrice.toFixed(2));
  const [exitAtDraft, setExitAtDraft] = useState(todayIsoDate());
  const [entryPriceDraft, setEntryPriceDraft] = useState(replacement.premium.toFixed(2));
  const [entryAtDraft, setEntryAtDraft] = useState(todayIsoDate());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!alert.relatedPositionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const position = await rollPosition(alert.relatedPositionId, {
        sourceAlertId: alert.id,
        closeLegId: closeLeg.legId,
        exitPrice: Number(exitPriceDraft),
        exitAt: exitAtDraft,
        newLeg: {
          strikePrice: replacement.strike,
          expiryDate: replacement.expiry,
          quantity: closeLeg.quantity,
          multiplier: closeLeg.multiplier,
          entryPrice: Number(entryPriceDraft),
          entryAt: entryAtDraft,
        },
      });
      onRolled(position);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to roll position.");
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
                Roll {alert.symbol} ${closeLeg.strike.toFixed(2)}
                {rightLabel}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={submitting} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              <div className="text-secondary mb-3" style={{ fontSize: "0.8rem" }}>
                Trigger: {triggerLabel}
              </div>

              <h6 className="text-secondary text-uppercase" style={{ fontSize: "0.72rem" }}>
                Close existing leg
              </h6>
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    Contract
                  </div>
                  <div>
                    ${closeLeg.strike.toFixed(2)}
                    {rightLabel} exp {formatDate(closeLeg.expiry)}
                  </div>
                </div>
                <div className="col-6">
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    Credit collected
                  </div>
                  <div>{formatCurrency(closeLeg.entryPrice)}</div>
                </div>
              </div>
              <div className="row g-2 mb-4">
                <div className="col-6">
                  <label className="form-label">Buy-back price</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={exitPriceDraft}
                    onChange={(event) => setExitPriceDraft(event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">Close date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={exitAtDraft}
                    onChange={(event) => setExitAtDraft(event.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <h6 className="text-secondary text-uppercase" style={{ fontSize: "0.72rem" }}>
                Open replacement leg
              </h6>
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    Contract
                  </div>
                  <div>
                    ${replacement.strike.toFixed(2)}
                    {rightLabel} exp {formatDate(replacement.expiry)} ({replacement.dte} DTE, Δ{replacement.delta.toFixed(2)})
                  </div>
                </div>
                <div className="col-6">
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    Suggested premium
                  </div>
                  <div>{formatCurrency(replacement.premium)}</div>
                </div>
              </div>
              <div className="row g-2">
                <div className="col-6">
                  <label className="form-label">Fill price</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={entryPriceDraft}
                    onChange={(event) => setEntryPriceDraft(event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">Open date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={entryAtDraft}
                    onChange={(event) => setEntryAtDraft(event.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>
            </div>
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
                Confirm Roll
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
