import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { saveTickerSuitability, type BacktestTickerSuitability } from "../../api/backtest";
import { formatDateTime } from "../../lib/formatters";
import { tickerSuitabilityBadgeClass, tickerSuitabilityLabel } from "../../lib/backtestPresentation";
import { Spinner } from "../Spinner";

interface TickerSuitabilityModalProps {
  symbol: string;
  /** Null: Pending. */
  suitability: BacktestTickerSuitability | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
  /** Open over another window (the Analyse window): the stacked layer, 1100. */
  stacked?: boolean;
}

const noteMaxLength = 5000;

/**
 * A ticker's suitability window (Marcelo 2026-10-19, approved mockup): the note to type or edit, saved with Mark suitable or
 * Mark unsuitable. ESC and Cancel close without saving; a click outside does nothing, so a stray click never loses the text.
 */
export function TickerSuitabilityModal({ symbol, suitability, onSaved, onClose, stacked = false }: TickerSuitabilityModalProps) {
  const zIndex = stacked ? 1100 : 1050;
  const [note, setNote] = useState(suitability?.note ?? "");
  const [saving, setSaving] = useState<"suitable" | "unsuitable" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const status = suitability?.status ?? "pending";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textareaRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && saving === null) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [saving, onClose]);

  const mark = async (newStatus: "suitable" | "unsuitable") => {
    setSaving(newStatus);
    setSaveError(null);
    try {
      await saveTickerSuitability(symbol, newStatus, note);
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError(errorMessage(err, `Could not save ${symbol}'s suitability.`));
      setSaving(null);
    }
  };

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {symbol} suitability
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={saving !== null} />
            </div>
            <div className="modal-body d-flex flex-column gap-2">
              {saveError && <div className="alert alert-danger mb-0">{saveError}</div>}
              <div className="d-flex flex-wrap align-items-center gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
                <span className={`badge ${tickerSuitabilityBadgeClass[status]}`}>{tickerSuitabilityLabel[status]}</span>
                <span>{suitability ? `Last changed by ${suitability.updatedByName ?? "a deleted user"} on ${formatDateTime(suitability.updatedAt)}` : "Not marked yet"}</span>
              </div>
              <label htmlFor={`${titleId}-note`} className="form-label fw-bold mb-0">
                Explanation
              </label>
              <textarea
                id={`${titleId}-note`}
                ref={textareaRef}
                className="form-control"
                rows={6}
                maxLength={noteMaxLength}
                placeholder="Why this ticker suits the CC + Put Ladder, or why it doesn't."
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={saving !== null}
              />
              <p className="text-secondary mb-0" style={{ fontSize: "0.8rem" }}>
                ESC closes without saving.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving !== null}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-1" onClick={() => void mark("unsuitable")} disabled={saving !== null}>
                {saving === "unsuitable" && <Spinner size="sm" />}
                Mark unsuitable
              </button>
              <button type="button" className="btn btn-success d-inline-flex align-items-center gap-1" onClick={() => void mark("suitable")} disabled={saving !== null}>
                {saving === "suitable" && <Spinner size="sm" />}
                Mark suitable
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
