import { useState } from "react";
import { ApiError } from "../../api/client";
import { splitPendingTransfer, type BooksState, type PendingTransfer } from "../../api/books";
import { ConfirmModal } from "../ConfirmModal";
import { formatCurrency, formatDayMonthYear, easternIsoDate } from "../../lib/formatters";
import { parseDollarAmountText } from "../../lib/backtestPresentation";
import { bookAfterCashMoves, splitProRataByBookValue } from "../../lib/booksPresentation";

type ReadyBooks = Extract<BooksState, { ready: true }>;

// A deposit or withdrawal waiting in Unallocated, split between the books by an admin (Marcelo 2026-11-05; mockup
// https://claude.ai/artifact/BsfaHtEXioGY52rbmVBHLr). Shown to admins only, and only while one is waiting: typing one part
// fills the other with the rest, so the two always add up to the amount. Pro rata follows last night's book values.

const toText = (dollars: number) => (Math.round(dollars * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

function PendingTransferRow({ transfer, books, onSplit }: { transfer: PendingTransfer; books: ReadyBooks; onSplit: () => void }) {
  const amount = transfer.amountDollars;
  const [plutoText, setPlutoText] = useState("");
  const [manualText, setManualText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pluto = parseDollarAmountText(plutoText);
  const manual = parseDollarAmountText(manualText);
  const addsUp = Number.isFinite(pluto) && Number.isFinite(manual) && Math.round((pluto + manual) * 100) === Math.round(amount * 100);
  const sameSign = Number.isFinite(pluto) && Number.isFinite(manual) && pluto * amount >= 0 && manual * amount >= 0;
  const valid = addsUp && sameSign;
  const kind = amount >= 0 ? "deposit" : "withdrawal";
  const lastNight = books.lastNightBookValues;
  const proRata = splitProRataByBookValue(amount, lastNight?.pluto ?? books.books.pluto.bookValue, lastNight?.manual ?? books.books.manual.bookValue);
  const plutoPct = Math.round((proRata.pluto / (amount || 1)) * 100);

  const setParts = (parts: { pluto: number; manual: number }) => {
    setPlutoText(toText(parts.pluto));
    setManualText(toText(parts.manual));
  };
  const onPlutoChange = (text: string) => {
    setPlutoText(text);
    const value = parseDollarAmountText(text);
    if (Number.isFinite(value)) setManualText(toText(amount - value));
  };
  const onManualChange = (text: string) => {
    setManualText(text);
    const value = parseDollarAmountText(text);
    if (Number.isFinite(value)) setPlutoText(toText(amount - value));
  };
  const split = () => {
    setSplitting(true);
    setError(null);
    splitPendingTransfer(transfer.entryId, { plutoDollars: pluto, manualDollars: manual })
      .then(() => {
        setConfirming(false);
        onSplit();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "The split failed."))
      .finally(() => setSplitting(false));
  };
  const plutoAfter = bookAfterCashMoves(books.books.pluto, valid ? pluto : 0, books.minCashReservePctByBook.pluto);
  const manualAfter = bookAfterCashMoves(books.books.manual, valid ? manual : 0, books.minCashReservePctByBook.manual);

  return (
    <div className="card mb-3">
      <div className="card-status-start bg-warning" />
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <div className="fw-bold">A {kind} is waiting to be split between the books</div>
            <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
              {transfer.recordedBeforeStatement ? `${transfer.description}.` : `${transfer.description} on ${formatDayMonthYear(easternIsoDate(transfer.at))}, from IBKR's statement.`} Until it is split, neither book can use it.
            </div>
          </div>
          <div className="fw-bold font-mono" style={{ fontSize: "1.25rem" }}>
            {formatCurrency(amount, 0)}
          </div>
        </div>
        <div className="row g-3 mt-1 align-items-end">
          <div className="col-12 col-md-3">
            <label className="form-label" htmlFor={`split-pluto-${transfer.entryId}`}>
              To Pluto
            </label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input id={`split-pluto-${transfer.entryId}`} className="form-control font-mono" inputMode="decimal" value={plutoText} onChange={(event) => onPlutoChange(event.target.value)} />
            </div>
          </div>
          <div className="col-12 col-md-3">
            <label className="form-label" htmlFor={`split-manual-${transfer.entryId}`}>
              To Manual
            </label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input id={`split-manual-${transfer.entryId}`} className="form-control font-mono" inputMode="decimal" value={manualText} onChange={(event) => onManualChange(event.target.value)} />
            </div>
          </div>
          <div className="col-12 col-md-6 d-flex flex-wrap gap-2 justify-content-md-end">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setParts({ pluto: amount, manual: 0 })}>
              All to Pluto
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setParts({ pluto: 0, manual: amount })}>
              All to Manual
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setParts(proRata)}>
              Pro rata ({plutoPct} / {100 - plutoPct})
            </button>
            <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => setConfirming(true)}>
              Split {kind}
            </button>
          </div>
        </div>
        <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
          The two parts must add up to {formatCurrency(amount, 2)}{amount >= 0 ? "" : ", each 0 or below"}. Pro rata follows the books' values at last night's close ({formatCurrency(lastNight?.pluto ?? null, 0)} and {formatCurrency(lastNight?.manual ?? null, 0)}). Shown to admins only.
        </div>
      </div>
      {confirming && (
        <ConfirmModal
          title={`Split the ${formatCurrency(amount, 0)} ${kind}?`}
          danger={false}
          size="lg"
          confirming={splitting}
          confirmLabel={`Split ${kind}`}
          onConfirm={split}
          onCancel={() => setConfirming(false)}
          message={
            <div className="d-flex flex-column gap-2">
              {error && <div className="alert alert-danger mb-0">{error}</div>}
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Book</th>
                      <th className="text-end">Gets</th>
                      <th className="text-end">Available after</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Pluto</td>
                      <td className="text-end font-mono">{formatCurrency(pluto, 0)}</td>
                      <td className="text-end font-mono">{formatCurrency(plutoAfter.availableCash, 0)}</td>
                    </tr>
                    <tr>
                      <td>Manual</td>
                      <td className="text-end font-mono">{formatCurrency(manual, 0)}</td>
                      <td className="text-end font-mono">{formatCurrency(manualAfter.availableCash, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                Available after also keeps each book's min cash reserve of the added value: Pluto {books.minCashReservePctByBook.pluto}%, Manual {books.minCashReservePctByBook.manual}%. The split is recorded with your name and can only be changed by moving cash between books.
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}

export function PendingTransferCards({ books, onSplit }: { books: ReadyBooks; onSplit: () => void }) {
  return (
    <>
      {books.pendingTransfers.map((transfer) => (
        <PendingTransferRow key={transfer.entryId} transfer={transfer} books={books} onSplit={onSplit} />
      ))}
    </>
  );
}
