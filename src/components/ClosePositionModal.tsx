import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApiError } from "../api/client";
import { buildCloseOrder, type OrderRequest, type Position } from "../api/positions";
import { formatCurrency, formatDate } from "../lib/formatters";

interface ClosePositionModalProps {
  position: Position;
  onClose: () => void;
  onClosed: () => void;
}

// Action modal (form submission) — per the app's modal convention, does not
// close on backdrop click, only via the X button/Cancel/ESC.
//
// One flow for both a full close and a partial "downsize" (merged
// 2026-08-25 — a separate Close button would've just duplicated this same
// form, since it already handles a full close as the default case).
// Contracts-to-close always drives the stock leg's quantity (contracts *
// multiplier), never independently editable, so reducing it can't unbalance
// a covered call's coverage ratio.
export function ClosePositionModal({ position, onClose, onClosed }: ClosePositionModalProps) {
  const openLegs = position.legs.filter((leg) => !leg.exitAt);
  const optionLegs = openLegs.filter((leg) => leg.legType === "option");
  const stockLeg = openLegs.find((leg) => leg.legType === "stock");
  const optionLeg = optionLegs.length === 1 ? optionLegs[0] : undefined;

  // Defaults to the full quantity -- clicking "Close" on an ordinary
  // position should just work as a full close with no extra steps; reducing
  // the number is how you downsize instead.
  const [contractsToCloseDraft, setContractsToCloseDraft] = useState(() => String(optionLeg?.quantity ?? 1));
  const [optionLimitPriceDraft, setOptionLimitPriceDraft] = useState("");
  const [stockLimitPriceDraft, setStockLimitPriceDraft] = useState("");
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

  const contractsToClose = Number(contractsToCloseDraft);
  const validContracts = optionLeg && Number.isInteger(contractsToClose) && contractsToClose >= 1 && contractsToClose <= optionLeg.quantity;
  const sharesToClose = optionLeg ? contractsToClose * optionLeg.multiplier : 0;
  const isPartialClose = optionLeg !== undefined && contractsToClose < optionLeg.quantity;
  const remainingContracts = optionLeg ? optionLeg.quantity - contractsToClose : 0;

  async function handleSubmit() {
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
                        {optionLeg.quantity}x {optionLeg.strikePrice ? formatCurrency(Number(optionLeg.strikePrice)) : "—"}
                        {rightLabel} exp {formatDate(optionLeg.expiryDate)}
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
                        onChange={(event) => setOptionLimitPriceDraft(event.target.value)}
                        disabled={submitting}
                      />
                    </div>
                    {stockLeg && (
                      <div className="col-6">
                        <label className="form-label">Stock sell limit price</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          value={stockLimitPriceDraft}
                          onChange={(event) => setStockLimitPriceDraft(event.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {!pendingOrder && optionLeg && (
              <div className="modal-footer">
                <button type="button" className="btn btn-link text-secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-1"
                  onClick={handleSubmit}
                  disabled={submitting || !validContracts}
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
