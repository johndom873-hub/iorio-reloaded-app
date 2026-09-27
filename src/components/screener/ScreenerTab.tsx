import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { ApiError } from "../../api/client";
import {
  addScreenerResultToShortlist,
  fetchScreenerResults,
  fetchScreenerSectors,
  type ScreenerBestRankBucket,
  type ScreenerFilters,
  type ScreenerScanRow,
} from "../../api/screener";
import { formatDate, formatNumber, formatPercentage, formatRelativeDate } from "../../lib/formatters";

interface FilterFormState {
  search: string;
  sector: string;
  minIv: string;
  bestRankBucket: ScreenerBestRankBucket | "";
}

const emptyFilterForm: FilterFormState = { search: "", sector: "", minIv: "", bestRankBucket: "" };

const bestRankBucketOptions: { value: ScreenerBestRankBucket; label: string }[] = [
  { value: "1-10", label: "1 – 10" },
  { value: "11-20", label: "11 – 20" },
  { value: "21-30", label: "21 – 30" },
  { value: "31-40", label: "31 – 40" },
  { value: "41-50", label: "41 – 50" },
  { value: "unmatched", label: "Unmatched (didn't clear this refresh)" },
];

const filterStorageKey = "iorio-screener-last-filters";

function loadStoredFilters(): FilterFormState {
  try {
    const stored = localStorage.getItem(filterStorageKey);
    if (!stored) return emptyFilterForm;
    return { ...emptyFilterForm, ...(JSON.parse(stored) as Partial<FilterFormState>) };
  } catch {
    return emptyFilterForm;
  }
}

function toFilters(form: FilterFormState): ScreenerFilters {
  const minIv = form.minIv.trim() === "" ? undefined : Number(form.minIv) / 100;
  return {
    search: form.search.trim() || undefined,
    sector: form.sector.trim() || undefined,
    minIv,
    bestRankBucket: form.bestRankBucket || undefined,
  };
}

interface ScreenerTabProps {
  onOpenTickerDetail: (symbol: string) => void;
}

export function ScreenerTab({ onOpenTickerDetail }: ScreenerTabProps) {
  const [form, setForm] = useState<FilterFormState>(loadStoredFilters);
  const [rows, setRows] = useState<ScreenerScanRow[]>([]);
  const [sectorOptions, setSectorOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);

  useEffect(() => {
    fetchScreenerSectors()
      .then(setSectorOptions)
      .catch(() => setSectorOptions([]));
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(filtersOverride?: FilterFormState) {
    const activeForm = filtersOverride ?? form;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchScreenerResults(toFilters(activeForm));
      setRows(results);
      setHasSearched(true);
      localStorage.setItem(filterStorageKey, JSON.stringify(activeForm));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load screener results.");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setForm(emptyFilterForm);
    localStorage.removeItem(filterStorageKey);
    runSearch(emptyFilterForm);
  }

  async function handleAddToShortlist(symbol: string) {
    setAddingSymbol(symbol);
    try {
      setError(null);
      await addScreenerResultToShortlist(symbol);
      setRows((prev) => prev.map((row) => (row.symbol === symbol ? { ...row, isShortlisted: true } : row)));
    } catch (err) {
      // Already monitored (409) is the same end state as success for this row.
      if (err instanceof ApiError && err.status === 409) {
        setRows((prev) => prev.map((row) => (row.symbol === symbol ? { ...row, isShortlisted: true } : row)));
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to add ticker to shortlist.");
    } finally {
      setAddingSymbol(null);
    }
  }

  const columns: DataTableColumn<ScreenerScanRow>[] = [
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
      key: "bestRank",
      header: "Best Rank",
      headerTitle: "Rank among tonight's scan matches (lowest = best). Unmatched means this ticker didn't clear any of the discovery queries on the last refresh.",
      align: "right",
      render: (row) => (row.bestRank >= 999 ? <span className="text-muted">Unmatched</span> : <span className="fw-bold">#{row.bestRank + 1}</span>),
    },
    {
      key: "matchedScanCodes",
      header: "Matched",
      render: (row) => (row.matchedScanCodes.length === 0 ? <span className="text-muted">—</span> : row.matchedScanCodes.map((code) => <span key={code} className="badge bg-blue-lt me-1">{code}</span>)),
    },
    {
      key: "impliedVolatility",
      header: "IV %",
      headerTitle: "Implied Volatility",
      align: "right",
      render: (row) => formatPercentage(row.impliedVolatility === null ? null : Number(row.impliedVolatility)),
    },
    {
      key: "avgShareVolume",
      header: "Avg Share Vol",
      align: "right",
      render: (row) => formatNumber(row.avgShareVolume),
    },
    {
      key: "avgOptionVolume",
      header: "Avg Opt Vol",
      headerTitle: "Frequently unavailable under current IBKR data entitlements",
      align: "right",
      render: (row) => formatNumber(row.avgOptionVolume),
    },
    {
      key: "callOpenInterest",
      header: "Call OI",
      align: "right",
      render: (row) => formatNumber(row.callOpenInterest),
    },
    {
      key: "putOpenInterest",
      header: "Put OI",
      align: "right",
      render: (row) => formatNumber(row.putOpenInterest),
    },
    {
      key: "bidAskSpreadPct",
      header: "Spread %",
      headerTitle: "Bid/Ask Spread",
      align: "right",
      render: (row) => formatPercentage(row.bidAskSpreadPct === null ? null : Number(row.bidAskSpreadPct)),
    },
    { key: "firstSeenAt", header: "First Seen", render: (row) => formatDate(row.firstSeenAt) },
    { key: "lastMatchedAt", header: "Last Matched", render: (row) => formatRelativeDate(row.lastMatchedAt) },
    { key: "lastRefreshedAt", header: "Last Refreshed", render: (row) => formatRelativeDate(row.lastRefreshedAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.isShortlisted ? (
          <span className="badge bg-green-lt">Shortlisted</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            disabled={addingSymbol === row.symbol}
            onClick={() => handleAddToShortlist(row.symbol)}
          >
            {addingSymbol === row.symbol && <Spinner size="sm" />}
            Add to Shortlist
          </button>
        ),
    },
  ];

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card mb-3">
        <div className="card-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
            }}
          >
            <div>
              <label className="form-label">Ticker / Company</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. AAPL or Apple"
                value={form.search}
                onChange={(event) => setForm((prev) => ({ ...prev, search: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Sector</label>
              <select
                className="form-select"
                value={form.sector}
                onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
              >
                <option value="">All Sectors</option>
                {sectorOptions.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Min IV %</label>
              <input
                type="number"
                className="form-control"
                placeholder="e.g. 30"
                value={form.minIv}
                onChange={(event) => setForm((prev) => ({ ...prev, minIv: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Best Rank</label>
              <select
                className="form-select"
                value={form.bestRankBucket}
                onChange={(event) => setForm((prev) => ({ ...prev, bestRankBucket: event.target.value as ScreenerBestRankBucket | "" }))}
              >
                <option value="">Any</option>
                {bestRankBucketOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button type="button" className="btn btn-outline-secondary" disabled={loading} onClick={resetFilters}>
              Reset
            </button>
            <button
              type="button"
              className="btn btn-primary d-inline-flex align-items-center gap-1"
              disabled={loading}
              onClick={() => runSearch()}
            >
              {loading && <Spinner size="sm" />}
              Search
            </button>
          </div>
        </div>
      </div>

      <DataTable
        tableId="screener"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage={hasSearched ? "No candidates match these filters." : "Apply filters to search the screener universe."}
      />
    </>
  );
}
