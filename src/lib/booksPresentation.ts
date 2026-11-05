import type { BookFigures } from "../api/books";

// The books' "after" figures in the move and split dialogs (Marcelo 2026-11-05): cash moved into a book raises its
// available cash by the amount less the min cash reserve on it (the reserve is a share of the book's value).
// Example: Manual moves $10,000 to Pluto at a 5% reserve → Manual's available falls by $9,500, Pluto's rises by $9,500.

/** A book's value and available cash after `dollarsIn` moves into it (negative: out of it). */
export function bookAfterCashMoves(book: Pick<BookFigures, "bookValue" | "availableCash">, dollarsIn: number, minCashReservePct: number): { bookValue: number; availableCash: number | null } {
  return {
    bookValue: book.bookValue + dollarsIn,
    availableCash: book.availableCash === null ? null : book.availableCash + dollarsIn - (minCashReservePct / 100) * dollarsIn,
  };
}

/** Pro rata between the books by value: Pluto's share of `amount` rounded to the cent, Manual the rest. */
export function splitProRataByBookValue(amount: number, plutoValue: number, manualValue: number): { pluto: number; manual: number } {
  const total = Math.max(0, plutoValue) + Math.max(0, manualValue);
  const pluto = total > 0 ? Math.round(((amount * Math.max(0, plutoValue)) / total) * 100) / 100 : Math.round((amount / 2) * 100) / 100;
  return { pluto, manual: Math.round((amount - pluto) * 100) / 100 };
}
