import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { HelpTooltip } from "./HelpTooltip";
import { ApiError } from "../api/client";
import { fetchRecoveryPath, type RecoveryPath } from "../api/positions";
import { formatCurrency, formatCurrencyTrimmed, formatDate } from "../lib/formatters";

interface RecoveryPathModalProps {
  positionId: string;
  symbol: string;
  onClose: () => void;
  /** Sell This on the suggested candidate — jumps to the option chain in the parent TickerDetailModal, prefilled. */
  onSellCandidate: (prefill: { strike: number; expiry: string; quantity: number; premium: number }) => void;
}

const caveatsText =
  "This is a live projection, not a forecast: the stock could keep falling (the clock gets longer, not shorter, even while \"on track\"); " +
  "premium isn't locked in and is recomputed fresh every time you view this; if a written call gets assigned, shares are sold at the strike, " +
  "locking in a result rather than continuing the cycle; fewer than 100 shares can't write a covered call at all.";

// Informational, read-only modal (no form/submission) — closes on backdrop
// click per the app's convention for display-only modals. Read-only
// "Recovery Path Formula" projection, approved by Marcelo 2026-08-31 — see
// evaluateRecoveryPathForPosition.ts for the formula.
export function RecoveryPathModal({ positionId, symbol, onClose, onSellCandidate }: RecoveryPathModalProps) {
  const [result, setResult] = useState<RecoveryPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRecoveryPath(positionId)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to compute a recovery-path projection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [positionId]);

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

  return (
    <>
      <div
        className="modal-backdrop show"
        style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      />
      <div className="modal show d-block" style={{ zIndex: 1050 }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title d-inline-flex align-items-center gap-1">
                Recovery Path — {symbol}
                <HelpTooltip text={caveatsText} />
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {loading && <Spinner size="sm" label="Computing recovery path" />}
              {error && <div className="alert alert-danger">{error}</div>}
              {result && (
                <>
                  <div className="row g-3 mb-3">
                    <div className="col-6 col-md-3">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Shares held
                      </div>
                      <div className="font-mono">{result.shares}</div>
                    </div>
                    <div className="col-6 col-md-3">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Entry price
                      </div>
                      <div className="font-mono">{formatCurrency(result.entryPrice)}</div>
                    </div>
                    <div className="col-6 col-md-3">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Current price
                      </div>
                      <div className="font-mono">{formatCurrency(result.currentPrice)}</div>
                    </div>
                    <div className="col-6 col-md-3">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Unrealized loss
                      </div>
                      <div className="font-mono text-danger">{formatCurrency(result.unrealizedLoss)}</div>
                    </div>
                  </div>

                  {result.monthsToRecover !== null ? (
                    <div className="mb-3">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Estimated months to recover
                      </div>
                      <div className="fw-bold" style={{ fontSize: "1.5rem" }}>
                        {result.monthsToRecover}
                      </div>
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        at {formatCurrency(result.monthlyPremium ?? 0)}/month selling calls at the pace below
                      </div>
                    </div>
                  ) : (
                    <div className="alert alert-warning">{result.rationale}</div>
                  )}

                  {result.candidate && (
                    <div className="mb-2">
                      <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                        Suggested path
                      </div>
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <div>
                          Sell {result.contractsAvailable}x {formatCurrencyTrimmed(result.candidate.strike)}C exp{" "}
                          {formatDate(result.candidate.expiry)} ({result.candidate.dte} DTE) for{" "}
                          <span className="text-success">{formatCurrency(result.candidate.premium)}</span> premium
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline-primary"
                          onClick={() => {
                            const candidate = result.candidate!;
                            onSellCandidate({
                              strike: candidate.strike,
                              expiry: candidate.expiry,
                              quantity: result.contractsAvailable,
                              premium: candidate.premium,
                            });
                            onClose();
                          }}
                        >
                          Sell This
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-link text-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
