import { apiRequest } from "./client";

// The Pluto and Manual books (backend src/books, Marcelo 2026-11-05): each book's own cash and value. Everyone reads them;
// only an admin splits a deposit or moves cash between the books.

export type BookKey = "pluto" | "manual";

export const bookLabels: Record<BookKey, string> = { pluto: "Pluto", manual: "Manual" };

export interface BookFigures {
  book: BookKey;
  cash: number;
  positionsValue: number;
  bookValue: number;
  heldAgainstPuts: number;
  ordersWorking: number;
  minCashReserve: number;
  /** What an opening order of this book may use now; null when IBKR's cash is unknown. */
  availableCash: number | null;
  availableSettledCash: number | null;
  /** True when IBKR's live cash, not the book's own ledger, set the available cash. */
  limitedByAccountCash: boolean;
}

export interface PendingTransfer {
  entryId: string;
  /** A deposit positive, a withdrawal negative. */
  amountDollars: number;
  at: string;
  description: string;
}

export type BooksState =
  | { ready: false }
  | {
      ready: true;
      books: Record<BookKey, BookFigures>;
      unallocatedCash: number;
      ibkrTotalCash: number | null;
      ibkrNetLiquidationValue: number | null;
      /** IBKR's live cash − (both books + Unallocated); null when IBKR's cash is unknown. */
      cashGapAgainstIbkr: number | null;
      confirmedThrough: string;
      minCashReservePct: number;
      /** The tickers in Pluto's book now: an order or position on any other is Manual's (hedges always are). */
      plutoSymbols: string[];
      pendingTransfers: PendingTransfer[];
      lastNightBookValues: { snapshotDate: string; pluto: number | null; manual: number | null } | null;
      lastStatement: { toDate: string; endingCash: number | null; ledgerCash: number; gap: number | null; importedAt: string } | null;
      needsReviewCount: number;
    };

export function fetchBooks(): Promise<BooksState> {
  return apiRequest<BooksState>("/books");
}

export function splitPendingTransfer(entryId: string, parts: { plutoDollars: number; manualDollars: number }): Promise<{ split: true }> {
  return apiRequest<{ split: true }>(`/books/pending-transfers/${entryId}/split`, { method: "POST", body: JSON.stringify(parts) });
}

export function moveCashBetweenBooks(move: { fromBook: BookKey; toBook: BookKey; amountDollars: number }): Promise<{ moved: true }> {
  return apiRequest<{ moved: true }>("/books/moves", { method: "POST", body: JSON.stringify(move) });
}

/** A leg a ticker switch moves between the books at its mark. */
export interface TickerSwitchLeg {
  legId: string;
  label: string;
  side: "long" | "short";
  quantity: number;
  multiplier: number;
  costBasisPrice: number;
  markPrice: number;
  markSource: "live" | "close" | "entry";
  valueDollars: number;
  realizedDollars: number;
}

export interface TickerSwitchPlan {
  symbol: string;
  fromBook: BookKey;
  toBook: BookKey;
  legs: TickerSwitchLeg[];
  /** What the receiving book pays the source (negative: the source pays). */
  totalValueDollars: number;
  realizedDollars: number;
}

/** What switching Pluto on or off for a Shortlist entry would move; transfer null before the books are started. */
export function fetchTickerSwitchPreview(entryId: string, enabled: boolean): Promise<{ transfer: TickerSwitchPlan | null; availableCashAfter?: Record<BookKey, number | null> }> {
  return apiRequest(`/shortlist/${entryId}/bot-enabled-preview?enabled=${enabled}`);
}

/** The Dashboard's book switch: All books, or one book's own figures. */
export type BookSelection = "all" | BookKey;

/** "?book=pluto" for a book, "" for All books (appended to a Dashboard request). */
export function bookQuery(selection: BookSelection, joiner: "?" | "&" = "?"): string {
  return selection === "all" ? "" : `${joiner}book=${selection}`;
}

/** The book an order belongs to: Pluto's for Pluto's own order or a ticker in Pluto's book, else Manual's. */
export function bookOfOrder(order: { plutoActionId?: string | null; symbol: string }, plutoSymbols: readonly string[]): BookKey {
  return order.plutoActionId || plutoSymbols.includes(order.symbol.trim().toUpperCase()) ? "pluto" : "manual";
}
