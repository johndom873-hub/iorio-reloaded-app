import type { ReactNode } from "react";
import { useEffect } from "react";
import { Spinner } from "./Spinner";

interface ConfirmModalProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Shared confirmation dialog for destructive actions that previously fired
// immediately on click with no way to back out (Screener "Remove", Trade
// Blotter "Cancel" order — found 2026-08-31 during the modal-wiring audit).
// Confirmation modal per the app's convention: does NOT close on backdrop
// click or ESC, since accidentally dismissing it should never be mistaken
// for confirming — Cancel is the only way out besides the actual buttons.
export function ConfirmModal({ title, message, confirmLabel = "Confirm", danger = true, confirming = false, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1050 }}>
        <div className="modal-dialog modal-sm">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onCancel} disabled={confirming} />
            </div>
            <div className="modal-body">{message}</div>
            <div className="modal-footer">
              <button type="button" className="btn btn-link text-secondary" onClick={onCancel} disabled={confirming}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${danger ? "btn-danger" : "btn-primary"} d-inline-flex align-items-center gap-1`}
                onClick={onConfirm}
                disabled={confirming}
              >
                {confirming && <Spinner size="sm" />}
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
