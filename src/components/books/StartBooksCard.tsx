import { useState } from "react";
import { ApiError } from "../../api/client";
import { previewBooksCutover, startBooks, type BooksCutoverPreview } from "../../api/books";
import { ConfirmModal } from "../ConfirmModal";
import { formatCurrency, formatDayMonthYear } from "../../lib/formatters";
import { parseDollarAmountText } from "../../lib/backtestPresentation";

// Starts the Pluto and Manual books (Marcelo 2026-11-05; mockup https://claude.ai/artifact/BsfaHtEXioGY52rbmVBHLr, section
// 7): admins only, shown on Risk & Limits until the books are started. Pluto's starting value is set; Manual gets the rest
// of the account's cash. Prod starts from IBKR's statement, staging from IBKR's live figures. Once only.

export function StartBooksCard({ startsFrom, onStarted }: { startsFrom: "statement" | "live"; onStarted: () => void }) {
  const [valueText, setValueText] = useState("");
  const [preview, setPreview] = useState<BooksCutoverPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = parseDollarAmountText(valueText);
  const valid = Number.isFinite(value) && value >= 0;
  // The preview shown is for the value typed; a changed value needs a new preview before starting.
  const previewMatches = preview !== null && valid && preview.pluto.bookValue === value;
  const negativeCash = preview !== null && (preview.pluto.cash < 0 || preview.manual.cash < 0);

  const runPreview = () => {
    if (!valid) return;
    setPreviewing(true);
    setError(null);
    previewBooksCutover(value)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "The preview failed."))
      .finally(() => setPreviewing(false));
  };
  const start = () => {
    setStarting(true);
    setError(null);
    startBooks(value)
      .then(() => {
        setConfirming(false);
        onStarted();
      })
      .catch((err) => {
        setConfirming(false);
        setError(err instanceof ApiError ? err.message : "Starting the books failed.");
      })
      .finally(() => setStarting(false));
  };

  return (
    <div className="card mb-3">
      <div className="card-status-start bg-primary" />
      <div className="card-body d-flex flex-column gap-3">
        <div>
          <div className="fw-bold">Start the books</div>
          <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
            Until the books are started, no opening order can be placed. Set Pluto's starting value; Manual gets the rest of the account's cash. This is done once.
          </div>
        </div>
        {error && <div className="alert alert-danger mb-0">{error}</div>}
        <div className="row g-3 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label" htmlFor="start-books-pluto-value">
              Pluto's starting value
            </label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input id="start-books-pluto-value" className="form-control font-mono" inputMode="decimal" value={valueText} onChange={(event) => setValueText(event.target.value)} placeholder="400,000" />
            </div>
            {preview && <div className="form-hint">At least {formatCurrency(preview.pluto.positionsValue, 0)}, what Pluto's tickers hold, or Pluto starts with negative cash.</div>}
          </div>
          <div className="col-12 col-md-8 d-flex flex-wrap gap-2 justify-content-md-end">
            <button type="button" className="btn btn-outline-secondary" disabled={!valid || previewing} onClick={runPreview}>
              {previewing ? "Previewing…" : "Preview"}
            </button>
            <button type="button" className="btn btn-primary" disabled={!previewMatches || negativeCash || starting} onClick={() => setConfirming(true)}>
              Start the books
            </button>
          </div>
        </div>
        {preview && (
          <div className="table-responsive">
            <table className="table table-sm table-vcenter mb-0">
              <thead className="table-light">
                <tr>
                  <th>Book</th>
                  <th className="text-end">Cash</th>
                  <th className="text-end">Positions</th>
                  <th className="text-end">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Pluto{preview.plutoSymbols.length > 0 ? ` (${preview.plutoSymbols.join(", ")})` : ""}</td>
                  <td className={`text-end font-mono${preview.pluto.cash < 0 ? " text-danger" : ""}`}>{formatCurrency(preview.pluto.cash, 0)}</td>
                  <td className="text-end font-mono">{formatCurrency(preview.pluto.positionsValue, 0)}</td>
                  <td className="text-end font-mono fw-bold">{formatCurrency(preview.pluto.bookValue, 0)}</td>
                </tr>
                <tr>
                  <td>Manual</td>
                  <td className={`text-end font-mono${preview.manual.cash < 0 ? " text-danger" : ""}`}>{formatCurrency(preview.manual.cash, 0)}</td>
                  <td className="text-end font-mono">{formatCurrency(preview.manual.positionsValue, 0)}</td>
                  <td className="text-end font-mono fw-bold">{formatCurrency(preview.manual.bookValue, 0)}</td>
                </tr>
                <tr>
                  <td>{preview.mode === "statement" ? `IBKR's ending cash, ${formatDayMonthYear(preview.statementToDate ?? "")}` : "IBKR cash now"}</td>
                  <td className="text-end font-mono">{formatCurrency(preview.ibkrCash, 0)}</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {negativeCash && <div className="text-danger" style={{ fontSize: "0.8rem" }}>A book would start with negative cash: change Pluto's starting value.</div>}
        {preview && preview.legsWithoutClosingPrice.length > 0 && (
          <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
            Valued at their entry price, with no closing price that day: {preview.legsWithoutClosingPrice.join(", ")}.
          </div>
        )}
        <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
          {startsFrom === "statement"
            ? "From IBKR's statement: its ending cash and the positions' closing prices on its last day. Fills since then count from the app's records until the next statement."
            : "From IBKR's live cash and the positions' marks now (this account's statement has no sections to start from)."}
        </div>
      </div>
      {confirming && preview && (
        <ConfirmModal
          title={`Start the books with Pluto at ${formatCurrency(preview.pluto.bookValue, 0)}?`}
          danger={false}
          confirming={starting}
          confirmLabel="Start the books"
          onConfirm={start}
          onCancel={() => setConfirming(false)}
          message={
            <div style={{ fontSize: "0.85rem" }}>
              Pluto starts with {formatCurrency(preview.pluto.cash, 0)} of cash and its {formatCurrency(preview.pluto.positionsValue, 0)} of positions; Manual with {formatCurrency(preview.manual.cash, 0)} of cash and its {formatCurrency(preview.manual.positionsValue, 0)} of positions. Recorded with your name; this cannot be done again, and later changes are moves between the books.
              {preview.mode === "live" && " The figures are taken again at the moment you confirm, so they may move a little."}
            </div>
          }
        />
      )}
    </div>
  );
}
