import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { MultiSelectDropdown } from "../MultiSelectDropdown";
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
import { formatCompactNumber, formatNumber, formatPercentage, formatRelativeDate } from "../../lib/formatters";

interface FilterFormState {
  search: string;
  sector: string[];
  minIv: string;
  minOpenInterest: string;
  bestRankBucket: ScreenerBestRankBucket | "";
  matchedScanCodes: string[];
}

const emptyFilterForm: FilterFormState = { search: "", sector: [], minIv: "", minOpenInterest: "", bestRankBucket: "", matchedScanCodes: [] };

const bestRankBucketOptions: { value: ScreenerBestRankBucket; label: string }[] = [
  { value: "1-10", label: "1 – 10" },
  { value: "11-20", label: "11 – 20" },
  { value: "21-30", label: "21 – 30" },
  { value: "31-40", label: "31 – 40" },
  { value: "41-50", label: "41 – 50" },
  { value: "unmatched", label: "Unmatched (didn't clear this refresh)" },
];

// The 6 scan codes run-daily-screener-scan-job.ts queries — kept here as the
// filter's option list rather than fetched, since this set only ever changes
// alongside a job code change. Labels agreed 2026-09-27: IV badges name what
// each ranks by (absolute level / relative-to-own-history / rate of change);
// the option-liquidity badges likewise (today's unusual activity / today's
// raw volume / standing open interest — the last has no time window, unlike
// the other two, since open interest is a snapshot, not something
// accumulated over a period).
const scanCodeLabels: Record<string, string> = {
  HIGH_OPT_IMP_VOLAT: "IV: Highest",
  HIGH_OPT_IMP_VOLAT_OVER_HIST: "IV: Higher vs Hist",
  TOP_OPT_IMP_VOLAT_GAIN: "IV: Trending",
  HOT_BY_OPT_VOLUME: "Opt Volume: Trending",
  OPT_VOLUME_MOST_ACTIVE: "Opt Volume: Highest 1D",
  OPT_OPEN_INTEREST_MOST_ACTIVE: "Open Interest: Highest",
};

// Richness (IV-based) badges stay blue; liquidity (option-volume/OI-based)
// badges are purple, both with white text for contrast (agreed 2026-09-27).
const richnessScanCodes = new Set(["HIGH_OPT_IMP_VOLAT", "HIGH_OPT_IMP_VOLAT_OVER_HIST", "TOP_OPT_IMP_VOLAT_GAIN"]);
function scanCodeBadgeClass(code: string): string {
  return richnessScanCodes.has(code) ? "badge bg-blue text-white me-1 mb-1" : "badge bg-purple text-white me-1 mb-1";
}

const matchTypeOptions = Object.entries(scanCodeLabels).map(([value, label]) => ({ value, label }));

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
  const minOpenInterest = form.minOpenInterest.trim() === "" ? undefined : Number(form.minOpenInterest);
  return {
    search: form.search.trim() || undefined,
    sector: form.sector.length > 0 ? form.sector : undefined,
    minIv,
    minOpenInterest,
    bestRankBucket: form.bestRankBucket || undefined,
    matchedScanCodes: form.matchedScanCodes.length > 0 ? form.matchedScanCodes : undefined,
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
      header: "Match Type",
      render: (row) =>
        row.matchedScanCodes.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          row.matchedScanCodes.map((code) => (
            <span key={code} className={scanCodeBadgeClass(code)}>
              {scanCodeLabels[code] ?? code}
            </span>
          ))
        ),
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
      header: "SH VOL",
      headerTitle: "Average daily share volume (90-day, per IBKR)",
      align: "right",
      render: (row) => formatCompactNumber(row.avgShareVolume === null ? null : Number(row.avgShareVolume)),
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
      render: (row) => formatCompactNumber(row.callOpenInterest === null ? null : Number(row.callOpenInterest)),
    },
    {
      key: "putOpenInterest",
      header: "Put OI",
      align: "right",
      render: (row) => formatCompactNumber(row.putOpenInterest === null ? null : Number(row.putOpenInterest)),
    },
    {
      key: "bidAskSpreadPct",
      header: "Spread %",
      headerTitle: "Bid/Ask Spread",
      align: "right",
      render: (row) => formatPercentage(row.bidAskSpreadPct === null ? null : Number(row.bidAskSpreadPct)),
    },
    { key: "firstSeenAt", header: "First Seen", render: (row) => formatRelativeDate(row.firstSeenAt) },
    { key: "lastMatchedAt", header: "Matched", render: (row) => formatRelativeDate(row.lastMatchedAt) },
    { key: "lastRefreshedAt", header: "Refreshed", render: (row) => formatRelativeDate(row.lastRefreshedAt) },
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
            + Shortlist
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
              <MultiSelectDropdown
                label="All Sectors"
                options={sectorOptions.map((sector) => ({ value: sector, label: sector }))}
                selected={form.sector}
                onChange={(sector) => setForm((prev) => ({ ...prev, sector }))}
              />
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
              <label className="form-label">Min Open Interest</label>
              <input
                type="number"
                className="form-control"
                placeholder="e.g. 100"
                title="Filters on the lower of call and put open interest"
                value={form.minOpenInterest}
                onChange={(event) => setForm((prev) => ({ ...prev, minOpenInterest: event.target.value }))}
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
            <div>
              <label className="form-label">Match Type</label>
              <MultiSelectDropdown
                label="Any"
                options={matchTypeOptions}
                selected={form.matchedScanCodes}
                onChange={(matchedScanCodes) => setForm((prev) => ({ ...prev, matchedScanCodes }))}
              />
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
