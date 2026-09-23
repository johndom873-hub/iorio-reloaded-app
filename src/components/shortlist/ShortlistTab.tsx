import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { ConfirmModal } from "../ConfirmModal";
import { TickerPrepModal } from "./TickerPrepModal";
import { WarningTriangle } from "./WarningTriangle";
import { VolatilitySurfaceModal } from "../VolatilitySurfaceModal";
import { ActionsMenu, type ActionsMenuItem } from "./ActionsMenu";
import { useTooltip } from "../../hooks/useTooltip";
import { ApiError } from "../../api/client";
import {
  addToShortlist,
  backfillTickerEarnings,
  backfillTickerPriceHistory,
  fetchShortlist,
  removeFromShortlist,
  retryTickerBackfill,
  searchTickers,
  updateShortlistNotes,
  type ShortlistRow,
  type TickerBackfillRun,
  type TickerSearchResult,
} from "../../api/shortlist";
import { daysToExpiry, formatBarsAsYears, formatDaysToExpiry } from "../../lib/formatters";

const searchDebounceMs = 400;

// Mirrors the API repo's signalsRoadmap.ts constants (separate repos, no shared module) -- how much daily-bar
// history Signals needs before momentum/the own-volatility threshold turn on, and how many earnings quarters
// before the vol forecast can correct for them. Keep in sync if those change.
const tradingDaysForMomentum = 253;
const tradingDaysForOwnVolatilityThreshold = 377;
const quartersForEarningsAdjustment = 4;
const preparingRefreshMs = 4_000;

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

// Extracted so useTooltip (a hook) can be called once per row from inside
// the Status column's render(row) callback (a plain function, not a
// component) without violating the Rules of Hooks -- see FlashingNumber.tsx's
// doc comment for the same constraint.
function PreparingStatusBadge({ progressPercent, onClick }: { progressPercent: number; onClick: () => void }) {
  const ref = useTooltip<HTMLButtonElement>("Click to see progress");
  return (
    <button ref={ref} type="button" className="badge ticker-prep-badge" onClick={onClick}>
      <span className="prep-ring" aria-hidden="true" />
      Preparing {progressPercent}%
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
  const [startingBackfillTickerId, setStartingBackfillTickerId] = useState<string | null>(null);
  const [backfillingEarningsTickerId, setBackfillingEarningsTickerId] = useState<string | null>(null);
  const [backfillingPriceHistoryTickerId, setBackfillingPriceHistoryTickerId] = useState<string | null>(null);
  const [confirmEarningsRow, setConfirmEarningsRow] = useState<ShortlistRow | null>(null);
  const [confirmPriceHistoryRow, setConfirmPriceHistoryRow] = useState<ShortlistRow | null>(null);
  const [prepTicker, setPrepTicker] = useState<{ tickerId: string; symbol: string; companyName: string | null } | null>(null);
  const [surfaceModalSymbol, setSurfaceModalSymbol] = useState<string | null>(null);

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

  // While any ticker is still preparing, refresh the list every few seconds so
  // its badge percentage advances and clears when the run finishes, even with
  // the modal closed.
  const anyTickerPreparing = rows.some((row) => row.backfillStatus === "preparing");
  useEffect(() => {
    if (!anyTickerPreparing) return;
    const timer = window.setInterval(loadRows, preparingRefreshMs);
    return () => window.clearInterval(timer);
  }, [anyTickerPreparing, loadRows]);

  const handlePrepRunChange = useCallback(
    (run: TickerBackfillRun | null) => {
      if (run && run.status !== "running") void loadRows();
    },
    [loadRows],
  );

  // Starts the full preparation pipeline (5 years of history, calendar, strikes, snapshot) for a
  // ticker that is missing history. One ticker at a time: the buttons are disabled while any
  // ticker is preparing, so history requests to IBKR are paced by the user, not by a timer.
  async function handleStartBackfill(row: ShortlistRow) {
    setStartingBackfillTickerId(row.tickerId);
    try {
      setError(null);
      await retryTickerBackfill(row.tickerId);
      setPrepTicker({ tickerId: row.tickerId, symbol: row.symbol, companyName: row.companyName });
      await loadRows();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to start the backfill for ${row.symbol}.`);
    } finally {
      setStartingBackfillTickerId(null);
    }
  }

  async function handleBackfillEarnings(row: ShortlistRow) {
    setConfirmEarningsRow(null);
    setBackfillingEarningsTickerId(row.tickerId);
    try {
      setError(null);
      await backfillTickerEarnings(row.tickerId);
      await loadRows();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to backfill earnings for ${row.symbol}.`);
    } finally {
      setBackfillingEarningsTickerId(null);
    }
  }

  // Scoped to just the price-history step (see routes/shortlist.ts) -- unlike handleStartBackfill below,
  // this does not touch the calendar or option-chain strikes, and doesn't open the 4-step prep modal: it's
  // a single fast action, not the full new-ticker pipeline (found live 2026-09-23: clicking this used to
  // silently trigger all 4 steps, including a chain-strike warmup that can run for many minutes on a
  // dense ETF like QQQ).
  async function handleBackfillPriceHistory(row: ShortlistRow) {
    setConfirmPriceHistoryRow(null);
    setBackfillingPriceHistoryTickerId(row.tickerId);
    try {
      setError(null);
      await backfillTickerPriceHistory(row.tickerId);
      await loadRows();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to backfill price history for ${row.symbol}.`);
    } finally {
      setBackfillingPriceHistoryTickerId(null);
    }
  }

  async function handleAdd(symbol: string) {
    setShowDropdown(false);
    setPendingSymbol(symbol);
    try {
      setError(null);
      const added = await addToShortlist(symbol);
      setPrepTicker({ tickerId: added.tickerId, symbol: added.symbol, companyName: added.companyName });
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
      header: "Ticker",
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
    { key: "companyName", header: "Name", render: (row) => row.companyName ?? "—" },
    { key: "sector", header: "Sector", render: (row) => (row.isEtf ? <span className="text-muted fst-italic">ETF</span> : row.sector ?? "—") },
    {
      key: "dailyBars",
      header: "Daily Bars",
      headerTitle: "Daily price/IV history — momentum needs 253 bars, the own-volatility threshold needs 377",
      align: "right",
      render: (row) => {
        const reasons: string[] = [];
        if (row.suspectedSplitDateIso) {
          reasons.push(`Suspected stock split on ${row.suspectedSplitDateIso} — stored prices jump the way a split does, so the volatility forecast refuses to use them and this ticker isn't scored.`);
        }
        if (row.dailyBarCount < tradingDaysForMomentum) {
          reasons.push(`Only ${row.dailyBarCount} daily bars — momentum needs ${tradingDaysForMomentum}, currently unavailable.`);
        } else if (row.dailyBarCount < tradingDaysForOwnVolatilityThreshold) {
          reasons.push(`Only ${row.dailyBarCount} daily bars — the own-volatility threshold needs ${tradingDaysForOwnVolatilityThreshold}, so it stays on the fixed 1.3x default until then.`);
        }
        // row.historyIncomplete means IBKR actually has more to give and we haven't fetched it yet --
        // only then is "Backfill Price History" a real fix. A short history can also just mean the ticker
        // hasn't been trading long enough for more to exist yet (e.g. a recently-launched ETF); pointing
        // at an action that would fetch nothing new was a real bug here (Marcelo caught it on DRAM, only
        // 0.5y old and correctly already fully backfilled -- 2026-09-23).
        const reason =
          reasons.length === 0
            ? null
            : row.historyIncomplete
              ? `${reasons.join(" ")} Fix: Actions → Backfill Price History.`
              : `${reasons.join(" ")} Already fully backfilled — history starts ${row.historyStartDate ?? "unknown"}, that's everything IBKR has; nothing to do but wait for more trading days.`;
        if (backfillingPriceHistoryTickerId === row.tickerId) {
          return <Spinner size="sm" label={`Backfilling price history for ${row.symbol}`} />;
        }
        return (
          <span className="d-inline-flex align-items-center gap-1">
            {reason && <WarningTriangle reason={reason} />}
            {formatBarsAsYears(row.dailyBarCount)}
          </span>
        );
      },
    },
    {
      key: "earnings",
      header: "Earnings",
      headerTitle: "Earnings dates on record — the vol forecast can't correct for an earnings-spanning expiry until 4 quarters are on record",
      align: "right",
      render: (row) => {
        if (row.isEtf) return <span className="text-muted small">N/A — ETF</span>;
        if (backfillingEarningsTickerId === row.tickerId) {
          return <Spinner size="sm" label={`Backfilling earnings for ${row.symbol}`} />;
        }
        const thin = row.earningsCount < quartersForEarningsAdjustment;
        const nextInDays = row.nextEarningsDateIso ? formatDaysToExpiry(daysToExpiry(row.nextEarningsDateIso)) : null;
        return (
          <span className="d-inline-flex align-items-center gap-1">
            {thin && <WarningTriangle reason={`Only ${row.earningsCount} quarter${row.earningsCount === 1 ? "" : "s"} on record; the vol forecast can't correct for earnings until ${quartersForEarningsAdjustment}. Fix: Actions → Backfill Earnings.`} />}
            {row.earningsCount}
            {nextInDays && <span className="text-muted small">({nextInDays})</span>}
          </span>
        );
      },
    },
    {
      key: "dividendCadence",
      header: "Dividend",
      headerTitle: "Whether a regular ex-dividend cadence could be inferred to project later dividends into the forward",
      render: (row) => {
        if (row.dividendHistoryCount === 0) return <span className="text-muted">—</span>;
        if (row.dividendCadenceUnknown) {
          return (
            <span className="d-inline-flex align-items-center gap-1">
              <WarningTriangle reason="There's an upcoming ex-dividend but no regular cadence could be inferred from the dates on record, so only that next date is used — later dividends aren't projected forward. Not fixable by backfilling: cadence inference only ever needs the next + most recent ex-dividend, which are already captured — this means the actual cadence is irregular, or this is a first-time payer." />
              Missing
            </span>
          );
        }
        return "Known";
      },
    },
    {
      key: "chainSnapshots",
      header: "Snapshots",
      headerTitle: "Nightly option-chain captures on record — the only source, nothing to manually backfill",
      align: "right",
      render: (row) => (
        <span className="d-inline-flex align-items-center gap-1">
          {row.chainSnapshotCount === 0 && (
            <WarningTriangle reason="No option-chain snapshot yet, so no surface fit and no Signals score. Not manually backfillable — waits for tonight's nightly capture." />
          )}
          {row.chainSnapshotCount}
        </span>
      ),
    },
    {
      key: "latestSurfaceFit",
      header: "Surface Fit",
      headerTitle: "Fitted vs. total expiries on the most recent option-chain snapshot",
      align: "right",
      render: (row) => {
        if (row.latestTotalSliceCount === null) return <span className="text-muted">—</span>;
        const partial = (row.latestFittedSliceCount ?? 0) < row.latestTotalSliceCount;
        return (
          <span className="d-inline-flex align-items-center gap-1">
            {partial && <WarningTriangle reason={`Only ${row.latestFittedSliceCount}/${row.latestTotalSliceCount} expiries fitted on the most recent snapshot — the rest have no usable candidates tonight.`} />}
            <button type="button" className="btn btn-link p-0 text-decoration-none font-mono" onClick={() => setSurfaceModalSymbol(row.symbol)}>
              {row.latestFittedSliceCount}/{row.latestTotalSliceCount}
            </button>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.backfillStatus === "preparing" ? (
          <PreparingStatusBadge
            progressPercent={row.backfillProgressPercent ?? 0}
            onClick={() => setPrepTicker({ tickerId: row.tickerId, symbol: row.symbol, companyName: row.companyName })}
          />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "notes", header: "Notes", render: (row) => <NotesCell row={row} onSave={handleUpdateNotes} /> },
    {
      key: "actions",
      header: "",
      // Not align: "right" -- that adds the .text-end class, which theme.css's numeric-column convention
      // (.table td.text-end { font-family: "Roboto Mono" }) applies platform-wide. Actions isn't a numeric
      // column; it just needs to sit at the right edge, done here with plain flex instead (found 2026-09-23:
      // the Actions dropdown's menu text was rendering in the numeric monospace font because of this).
      render: (row) => {
        const items: ActionsMenuItem[] = [
          {
            key: "backfill-earnings",
            label: "Backfill Earnings",
            onClick: () => setConfirmEarningsRow(row),
            loading: backfillingEarningsTickerId === row.tickerId,
            disabled: row.isEtf || row.earningsCount >= quartersForEarningsAdjustment,
            disabledReason: row.isEtf ? "ETFs don't report earnings" : `${row.earningsCount} on record, already sufficient`,
          },
          {
            key: "backfill-price-history",
            label: "Backfill Price History",
            onClick: () => setConfirmPriceHistoryRow(row),
            loading: backfillingPriceHistoryTickerId === row.tickerId,
            disabled: !row.historyIncomplete || backfillingPriceHistoryTickerId !== null,
            disabledReason:
              backfillingPriceHistoryTickerId !== null
                ? "Another price-history backfill is already running. One at a time."
                : `Already backfilled — history starts ${row.historyStartDate ?? "unknown"}, that's everything IBKR has`,
          },
          {
            key: "retry-full-setup",
            label: "Retry Full Setup",
            onClick: () => handleStartBackfill(row),
            loading: startingBackfillTickerId === row.tickerId,
            disabled: !row.backfillNeedsRetry || anyTickerPreparing || startingBackfillTickerId !== null,
            disabledReason:
              anyTickerPreparing || startingBackfillTickerId !== null
                ? "Another ticker is being prepared. One at a time."
                : "Nothing failed — the setup pipeline (history, calendar, chain strikes, first snapshot) completed cleanly",
          },
          {
            key: "remove",
            label: "Remove",
            onClick: () => setRemoveConfirmRow(row),
            loading: removingId === row.id,
            danger: true,
          },
        ];
        return (
          <div className="d-flex justify-content-end">
            <ActionsMenu items={items} />
          </div>
        );
      },
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
              onChange={(event) => {
                setNewSymbol(event.target.value);
                setShowDropdown(true);
              }}
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

      {prepTicker && (
        <TickerPrepModal
          tickerId={prepTicker.tickerId}
          symbol={prepTicker.symbol}
          companyName={prepTicker.companyName}
          onRunChange={handlePrepRunChange}
          onClose={() => setPrepTicker(null)}
        />
      )}

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

      {confirmEarningsRow && (
        <ConfirmModal
          title="Backfill Earnings"
          message={
            <>
              Fetch historical earnings dates for <strong>{confirmEarningsRow.symbol}</strong> from API Ninjas and add them to the record?
            </>
          }
          confirmLabel="Backfill"
          danger={false}
          onConfirm={() => handleBackfillEarnings(confirmEarningsRow)}
          onCancel={() => setConfirmEarningsRow(null)}
        />
      )}

      {confirmPriceHistoryRow && (
        <ConfirmModal
          title="Backfill Price History"
          message={
            <>
              Re-fetch five years of daily price history for <strong>{confirmPriceHistoryRow.symbol}</strong> from IBKR?
            </>
          }
          confirmLabel="Backfill"
          danger={false}
          onConfirm={() => handleBackfillPriceHistory(confirmPriceHistoryRow)}
          onCancel={() => setConfirmPriceHistoryRow(null)}
        />
      )}

      {surfaceModalSymbol && <VolatilitySurfaceModal symbol={surfaceModalSymbol} onClose={() => setSurfaceModalSymbol(null)} />}
    </>
  );
}
