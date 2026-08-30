import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApiError } from "../api/client";
import { buildCloseOrder, type OrderRequest, type Position, type PositionLeg } from "../api/positions";
import { formatCurrencyTrimmed, formatExpiryWithDte } from "../lib/formatters";

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

interface UnstructuredLegDraft {
  included: boolean;
  quantityDraft: string;
  limitPriceDraft: string;
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

  const [legDrafts, setLegDrafts] = useState<Record<string, UnstructuredLegDraft>>(() =>
    Object.fromEntries(
      openLegs.map((leg) => [leg.id, { included: true, quantityDraft: String(leg.quantity), limitPriceDraft: "" }]),
    ),
  );

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
                                onChange={(event) => updateLegDraft(leg.id, { limitPriceDraft: event.target.value })}
                                disabled={submitting}
                              />
                            </div>
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
