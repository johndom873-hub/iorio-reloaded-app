import { useState } from "react";
import { ApiError } from "../../api/client";
import { bookLabels, moveCashBetweenBooks, type BookKey, type BooksState } from "../../api/books";
import { ConfirmModal } from "../ConfirmModal";
import { formatCurrency } from "../../lib/formatters";
import { parseDollarAmountText } from "../../lib/backtestPresentation";
import { bookAfterCashMoves } from "../../lib/booksPresentation";

type ReadyBooks = Extract<BooksState, { ready: true }>;

// Moves cash from one book to the other (admin, Marcelo 2026-11-05; mockup https://claude.ai/artifact/BsfaHtEXioGY52rbmVBHLr):
// at most the source's available cash, what its Puts hold stays. A confirmation: closes only on Cancel.
export function MoveCashModal({ books, onMoved, onCancel }: { books: ReadyBooks; onMoved: () => void; onCancel: () => void }) {
  const [fromBook, setFromBook] = useState<BookKey>("manual");
  const [amountText, setAmountText] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toBook: BookKey = fromBook === "pluto" ? "manual" : "pluto";
  const amount = parseDollarAmountText(amountText);
  const available = books.books[fromBook].availableCash;
  const valid = Number.isFinite(amount) && amount > 0 && available !== null && Math.round(amount * 100) <= Math.round(available * 100);
  const fromAfter = bookAfterCashMoves(books.books[fromBook], valid ? -amount : 0, books.minCashReservePct);
  const toAfter = bookAfterCashMoves(books.books[toBook], valid ? amount : 0, books.minCashReservePct);

  const confirm = () => {
    if (!valid) return;
    setMoving(true);
    setError(null);
    moveCashBetweenBooks({ fromBook, toBook, amountDollars: amount })
      .then(onMoved)
      .catch((err) => setError(err instanceof ApiError ? err.message : "The move failed."))
      .finally(() => setMoving(false));
  };

  return (
    <ConfirmModal
      title="Move cash between books"
      danger={false}
      size="lg"
      confirming={moving}
      confirmDisabled={!valid}
      confirmLabel={valid ? `Move ${formatCurrency(amount, 0)}` : "Move"}
      onConfirm={confirm}
      onCancel={onCancel}
      message={
        <div className="d-flex flex-column gap-3">
          {error && <div className="alert alert-danger mb-0">{error}</div>}
          <div className="row g-2">
            <div className="col-6">
              <label className="form-label" htmlFor="move-cash-from">
                From
              </label>
              <select id="move-cash-from" className="form-select" value={fromBook} onChange={(event) => setFromBook(event.target.value as BookKey)}>
                <option value="manual">Manual</option>
                <option value="pluto">Pluto</option>
              </select>
            </div>
            <div className="col-6">
              <label className="form-label" htmlFor="move-cash-to">
                To
              </label>
              <input id="move-cash-to" className="form-control" value={bookLabels[toBook]} readOnly />
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="move-cash-amount">
              Amount
            </label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input id="move-cash-amount" className="form-control font-mono" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="10,000" />
            </div>
            <div className="form-hint">
              {bookLabels[fromBook]} can move up to {formatCurrency(Math.max(0, available ?? 0), 0)}, its available cash. Cash held against Puts stays with the book.
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>Book</th>
                  <th className="text-end">Value after</th>
                  <th className="text-end">Available after</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { book: fromBook, after: fromAfter },
                  { book: toBook, after: toAfter },
                ].map(({ book, after }) => (
                  <tr key={book}>
                    <td>{bookLabels[book]}</td>
                    <td className="text-end font-mono">{formatCurrency(after.bookValue, 0)}</td>
                    <td className="text-end font-mono">{formatCurrency(after.availableCash, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
