import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { ConfirmModal } from "../ConfirmModal";
import { ApiError } from "../../api/client";
import {
  addToShortlist,
  fetchShortlist,
  removeFromShortlist,
  searchTickers,
  updateShortlistNotes,
  type ShortlistRow,
  type TickerSearchResult,
} from "../../api/shortlist";
import { formatDate, formatNumber, formatPercentage, formatPercentageValue } from "../../lib/formatters";

const searchDebounceMs = 400;

interface NotesCellProps {
  row: ShortlistRow;
  onSave: (entryId: string, notes: string) => Promise<void>;
}

// Click-to-edit: click the notes text to turn it into an input, blur/Enter
// saves, Escape cancels. Reverts the draft if the save request fails.
function NotesCell({ row, onSave }: NotesCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(row.notes ?? "");
  }, [row.notes, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  async function commit() {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed === (row.notes ?? "").trim()) return;

    setIsSaving(true);
    try {
      await onSave(row.id, trimmed);
    } catch {
      setDraft(row.notes ?? "");
    } finally {
      setIsSaving(false);
    }
  }

  if (isSaving) {
    return <Spinner size="sm" label="Saving" />;
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="form-control form-control-sm"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(row.notes ?? "");
            setIsEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="btn btn-link text-body text-decoration-none d-block w-100 text-start px-2 py-2"
      onClick={() => setIsEditing(true)}
    >
      {row.notes ?? "—"}
    </button>
  );
}

interface ShortlistTabProps {
  onOpenTickerDetail: (symbol: string) => void;
}

export function ShortlistTab({ onOpenTickerDetail }: ShortlistTabProps) {
  const [rows, setRows] = useState<ShortlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [removeConfirmRow, setRemoveConfirmRow] = useState<ShortlistRow | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  const loadRows = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchShortlist();
      setRows(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the shortlist.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRows().finally(() => setLoading(false));
  }, [loadRows]);

  // Live IBKR search-as-you-type, debounced. Matches symbol or company name,
  // US-listed optionable stocks only (filtered server-side).
  useEffect(() => {
    if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);

    const trimmed = newSymbol.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = window.setTimeout(async () => {
      try {
        const results = await searchTickers(trimmed);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, searchDebounceMs);

    return () => {
      if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
    };
  }, [newSymbol]);

  async function handleAdd(symbol: string) {
    setShowDropdown(false);
    setPendingSymbol(symbol);
    try {
      setError(null);
      await addToShortlist(symbol);
      await loadRows();
      setNewSymbol("");
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add ticker.");
    } finally {
      setPendingSymbol(null);
    }
  }

  async function handleUpdateNotes(entryId: string, notes: string) {
    try {
      setError(null);
      const result = await updateShortlistNotes(entryId, notes);
      setRows((prev) => prev.map((row) => (row.id === entryId ? { ...row, notes: result.notes } : row)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update notes.");
      throw err;
    }
  }

  async function handleRemove(entryId: string) {
    setRemovingId(entryId);
    try {
      setError(null);
      await removeFromShortlist(entryId);
      await loadRows();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove ticker.");
    } finally {
      setRemovingId(null);
      setRemoveConfirmRow(null);
    }
  }

  const columns: DataTableColumn<ShortlistRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link p-0 text-decoration-none fw-bold"
          onClick={() => onOpenTickerDetail(row.symbol)}
        >
          {row.symbol}
        </button>
      ),
    },
    { key: "companyName", header: "Company", render: (row) => row.companyName ?? "—" },
    { key: "sector", header: "Sector", render: (row) => row.sector ?? "—" },
    {
      key: "impliedVolatility",
      header: "IV %",
      headerTitle: "Implied Volatility",
      align: "right",
      render: (row) => formatPercentage(row.impliedVolatility === null ? null : Number(row.impliedVolatility)),
    },
    {
      key: "ivRank",
      header: "IV Rank",
      headerTitle: "(today's IV − 1yr low) / (1yr high − 1yr low) × 100 — skewed by a single outlier day",
      align: "right",
      render: (row) =>
        row.ivRank === null ? (
          "—"
        ) : (
          <span>
            {formatPercentageValue(row.ivRank)} <span className="text-muted small">({row.ivWindowDays}d)</span>
          </span>
        ),
    },
    {
      key: "ivPercentile",
      header: "IV %ile",
      headerTitle: "% of the last 1yr of trading days whose IV closed below today's",
      align: "right",
      render: (row) =>
        row.ivPercentile === null ? (
          "—"
        ) : (
          <span>
            {formatPercentageValue(row.ivPercentile)} <span className="text-muted small">({row.ivWindowDays}d)</span>
          </span>
        ),
    },
    {
      key: "avgOptionVolume",
      header: "Avg Vol",
      headerTitle: "Average Option Volume",
      align: "right",
      render: (row) => formatNumber(row.avgOptionVolume),
    },
    { key: "snapshotDate", header: "Refreshed", headerTitle: "Last Refreshed", render: (row) => formatDate(row.snapshotDate) },
    { key: "notes", header: "Notes", render: (row) => <NotesCell row={row} onSave={handleUpdateNotes} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="d-inline-flex gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
            disabled={removingId === row.id}
            onClick={() => setRemoveConfirmRow(row)}
          >
            {removingId === row.id && <Spinner size="sm" />}
            Remove
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card mb-3">
        <div className="card-body d-flex flex-column flex-sm-row gap-2">
          <div className="position-relative flex-fill">
            <input
              type="text"
              className="form-control"
              placeholder="Search by ticker or company name (e.g. AAPL, Apple)"
              value={newSymbol}
              onChange={(event) => setNewSymbol(event.target.value)}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => window.setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newSymbol.trim()) handleAdd(newSymbol.trim());
                if (event.key === "Escape") setShowDropdown(false);
              }}
            />
            {showDropdown && newSymbol.trim() && (
              <div
                className="card position-absolute w-100 mt-1 shadow-sm"
                style={{ zIndex: 20, maxHeight: "16rem", overflowY: "auto" }}
              >
                {isSearching ? (
                  <div className="p-3 text-center">
                    <Spinner size="sm" label="Searching" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-3 text-muted small">No optionable US tickers match "{newSymbol.trim()}".</div>
                ) : (
                  <ul className="list-group list-group-flush">
                    {searchResults.map((result) => (
                      <li key={result.symbol} className="list-group-item p-0">
                        <button
                          type="button"
                          className="btn btn-link text-decoration-none text-body d-flex justify-content-between align-items-center w-100 px-3 py-2"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleAdd(result.symbol)}
                        >
                          <strong>{result.symbol}</strong>
                          <span className="text-muted small text-truncate ms-2">{result.companyName ?? "—"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary text-nowrap d-inline-flex align-items-center justify-content-center gap-1"
            disabled={pendingSymbol !== null || !newSymbol.trim()}
            onClick={() => handleAdd(newSymbol.trim())}
          >
            {pendingSymbol !== null && <Spinner size="sm" />}
            + Add Ticker
          </button>
        </div>
      </div>

      <DataTable
        tableId="shortlist"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No tickers being monitored yet."
      />

      {removeConfirmRow && (
        <ConfirmModal
          title="Remove from Shortlist"
          message={<>Remove <strong>{removeConfirmRow.symbol}</strong> from the shortlist? It will stop being scanned for trade alerts.</>}
          confirmLabel="Remove"
          confirming={removingId === removeConfirmRow.id}
          onConfirm={() => handleRemove(removeConfirmRow.id)}
          onCancel={() => setRemoveConfirmRow(null)}
        />
      )}
    </>
  );
}
