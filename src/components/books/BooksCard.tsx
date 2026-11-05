import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchBooks, type BookFigures, type BooksState } from "../../api/books";
import { useIsAdmin } from "../../hooks/useAuth";
import { usePollWhileVisible } from "../../hooks/usePollWhileVisible";
import { formatCurrency, formatDayMonthYear } from "../../lib/formatters";
import { Spinner } from "../Spinner";
import { MoveCashModal } from "./MoveCashModal";
import { StartBooksCard } from "./StartBooksCard";

// Risk & Limits' books (Marcelo 2026-11-05; mockup https://claude.ai/artifact/BsfaHtEXioGY52rbmVBHLr), in place of the
// percentage split: each book's value, cash and available cash, the unallocated cash, and the books' check against IBKR
// (now, and at the last statement). Everyone sees it; only an admin moves cash. Read on open and every minute while visible.

const booksRefreshMs = 60_000;

/** Cents of difference count as matching (IBKR's 8 decimals against the ledger's 6). */
const matches = (gap: number | null) => gap !== null && Math.abs(gap) < 0.01;

function BookBlock({ title, description, figures }: { title: string; description: string; figures: BookFigures }) {
  const cells: [string, number | null][] = [
    ["Value", figures.bookValue],
    ["Cash", figures.cash],
    ["Available", figures.availableCash],
  ];
  return (
    <div className="col-12 col-lg-6">
      <div className="border rounded p-3 h-100">
        <div className="fw-bold">{title}</div>
        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
          {description}
        </div>
        <div className="row g-2 mt-1">
          {cells.map(([label, dollars]) => (
            <div key={label} className="col-4">
              <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
                {label}
              </div>
              <div className={`fw-bold font-monospace${label === "Available" && dollars !== null && dollars < 0 ? " text-danger" : ""}`}>{formatCurrency(dollars, 0)}</div>
            </div>
          ))}
        </div>
        <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
          Held against Puts {formatCurrency(figures.heldAgainstPuts, 0)} · orders working {formatCurrency(figures.ordersWorking, 0)} · min cash reserve {formatCurrency(figures.minCashReserve, 0)} · positions {formatCurrency(figures.positionsValue, 0)}
          {figures.limitedByAccountCash && " · held to IBKR's cash, which is lower than the book's records until IBKR's statement catches up"}
        </div>
      </div>
    </div>
  );
}

export function BooksCard() {
  const isAdmin = useIsAdmin();
  const [books, setBooks] = useState<BooksState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(() => {
    fetchBooks()
      .then((loaded) => {
        setBooks(loaded);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load the books."));
  }, []);
  useEffect(load, [load]);
  usePollWhileVisible(load, booksRefreshMs);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!books) return <Spinner size="sm" label="Loading the books" />;
  if (!books.ready) {
    if (isAdmin) return <StartBooksCard startsFrom={books.startsFrom} onStarted={load} />;
    return <div className="text-secondary mb-3" style={{ fontSize: "0.8rem" }}>The Pluto and Manual books have not been started yet, so no opening order can be placed.</div>;
  }
  const pendingCount = books.pendingTransfers.length;
  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <div className="fw-bold">Books</div>
          {isAdmin && (
            <button type="button" className="btn btn-outline-primary" onClick={() => setMoving(true)}>
              Move cash between books
            </button>
          )}
        </div>
        <div className="row g-3 mb-3">
          <BookBlock title="Pluto" description="The tickers Pluto is switched on for. Grows or shrinks with Pluto's own results." figures={books.books.pluto} />
          <BookBlock title="Manual" description="Every other position, whoever opened it, hedges included." figures={books.books.manual} />
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-vcenter mb-0">
            <thead className="table-light">
              <tr>
                <th>Check</th>
                <th className="text-end">Books + unallocated</th>
                <th className="text-end">IBKR</th>
                <th className="text-end">Gap</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Unallocated cash</td>
                <td className="text-end font-mono">{formatCurrency(books.unallocatedCash, 0)}</td>
                <td className="text-end">—</td>
                <td className="text-end">—</td>
                <td>
                  {pendingCount > 0 ? (
                    <span className="badge bg-warning-lt" style={{ fontSize: "0.72rem" }}>
                      {pendingCount === 1 ? "Deposit waiting to be split" : `${pendingCount} transfers waiting to be split`}
                    </span>
                  ) : (
                    <span className="badge bg-success-lt" style={{ fontSize: "0.72rem" }}>
                      Nothing waiting
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td>Cash at IBKR now</td>
                <td className="text-end font-mono">{formatCurrency(books.books.pluto.cash + books.books.manual.cash + books.unallocatedCash, 0)}</td>
                <td className="text-end font-mono">{formatCurrency(books.ibkrTotalCash, 0)}</td>
                <td className="text-end font-mono">{formatCurrency(books.cashGapAgainstIbkr, 0)}</td>
                <td>
                  {books.cashGapAgainstIbkr === null ? (
                    <span className="text-secondary">IBKR's cash unavailable</span>
                  ) : (
                    <span className={`badge ${Math.abs(books.cashGapAgainstIbkr) < 100 ? "bg-success-lt" : "bg-warning-lt"}`} style={{ fontSize: "0.72rem" }}>
                      {Math.abs(books.cashGapAgainstIbkr) < 100 ? "Matches" : "Differs until the next statement"}
                    </span>
                  )}
                </td>
              </tr>
              {books.lastStatement && (
                <tr>
                  <td>Statement of {formatDayMonthYear(books.lastStatement.toDate)}, ending cash</td>
                  <td className="text-end font-mono">{formatCurrency(books.lastStatement.ledgerCash, 2)}</td>
                  <td className="text-end font-mono">{formatCurrency(books.lastStatement.endingCash, 2)}</td>
                  <td className="text-end font-mono">{formatCurrency(books.lastStatement.gap, 2)}</td>
                  <td>
                    <span className={`badge ${matches(books.lastStatement.gap) ? "bg-success-lt" : "bg-danger-lt"}`} style={{ fontSize: "0.72rem" }}>
                      {matches(books.lastStatement.gap) ? "Matches to the cent" : "Differs: a person needs to look"}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
          Everyone sees the books; only admins move cash between them. A gap at IBKR now usually means a fill, a fee or a deposit not yet in IBKR's statement, which arrives overnight.
          {books.needsReviewCount > 0 && ` ${books.needsReviewCount} statement row(s) could not be matched to a book and were split by book value.`}
        </div>
      </div>
      {moving && (
        <MoveCashModal
          books={books}
          onCancel={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            load();
          }}
        />
      )}
    </div>
  );
}
