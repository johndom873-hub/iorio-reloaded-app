import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SavedPortfolio } from "../../../api/backtestPortfolio";
import { maxPortfolioNameLength, portfolioNameProblem } from "../../../lib/portfolioSimulatorPresentation";
import { formatCurrency, pluralizeCount } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";

interface SavePortfolioAsModalProps {
  /** The portfolio's name now, offered to edit; null for a new one. */
  currentName: string | null;
  tickerCount: number;
  accountDollars: number;
  portfolios: SavedPortfolio[];
  saving: boolean;
  /** The API's refusal, shown under the name. */
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/**
 * Save as, and the first Save of a new portfolio: a name, checked against the saved ones as it is typed. A form dialog: ESC
 * closes it through Cancel, a backdrop click doesn't (a stray click must not drop a typed name).
 */
export function SavePortfolioAsModal({ currentName, tickerCount, accountDollars, portfolios, saving, error, onSave, onCancel }: SavePortfolioAsModalProps) {
  const [name, setName] = useState(currentName ? `${currentName} (copy)` : "");
  const [touched, setTouched] = useState(false);
  const problem = portfolioNameProblem(name, portfolios);
  const shownProblem = (touched || name !== "") && problem ? problem : error;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel, saving]);

  const submit = () => {
    setTouched(true);
    if (!problem && !saving) onSave(name.trim());
  };

  return createPortal(
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1050 }} role="dialog" aria-modal="true" aria-labelledby="save-portfolio-as-title">
        <div className="modal-dialog modal-dialog-centered">
          <form
            className="modal-content"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="modal-header">
              <h5 className="modal-title" id="save-portfolio-as-title">
                {currentName ? "Save portfolio as" : "Save portfolio"}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onCancel} disabled={saving} />
            </div>
            <div className="modal-body">
              <label className="form-label" htmlFor="save-portfolio-as-name">
                Name
              </label>
              <input
                id="save-portfolio-as-name"
                className={`form-control ${shownProblem ? "is-invalid" : ""}`}
                value={name}
                maxLength={maxPortfolioNameLength + 20}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
              />
              {shownProblem && <div className="invalid-feedback">{shownProblem}</div>}
              <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
                Saves the {pluralizeCount(tickerCount, "ticker")}, their allocations and the {formatCurrency(accountDollars, 0)} account as a new portfolio and opens it.
                {currentName ? ` "${currentName}" stays as it was last saved.` : ""}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-link text-secondary" onClick={onCancel} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={saving || problem !== null}>
                {saving && <Spinner size="sm" />}
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </>,
    document.body,
  );
}
