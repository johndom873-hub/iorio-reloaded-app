import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { ApiError } from "../../api/client";
import {
  addScreenerResultToShortlist,
  fetchScreenerResults,
  fetchScreenerSectors,
  type ScreenerFilters,
  type ScreenerScanRow,
} from "../../api/screener";
import { formatDate, formatNumber, formatPercentage } from "../../lib/formatters";

interface FilterFormState {
  maxPrice: string;
  minIvRatio: string;
  maxIvRatio: string;
  minAvgOptionVolume: string;
  minAvgShareVolume: string;
  maxBidAskSpreadPct: string;
  sector: string;
}

const emptyFilterForm: FilterFormState = {
  maxPrice: "",
  minIvRatio: "",
  maxIvRatio: "",
  minAvgOptionVolume: "",
  minAvgShareVolume: "",
  maxBidAskSpreadPct: "",
  sector: "",
};

// Hint text only — never applied unless the user actually types a value.
const filterPlaceholders: Record<keyof FilterFormState, string> = {
  maxPrice: "e.g. 200",
  minIvRatio: "e.g. 1.0",
  maxIvRatio: "e.g. 3.0",
  minAvgOptionVolume: "e.g. 500",
  minAvgShareVolume: "e.g. 1,000,000",
  maxBidAskSpreadPct: "e.g. 5",
  sector: "",
};

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
  const num = (value: string) => (value.trim() === "" ? undefined : Number(value));
  return {
    maxPrice: num(form.maxPrice),
    minIvRatio: num(form.minIvRatio),
    maxIvRatio: num(form.maxIvRatio),
    minAvgOptionVolume: num(form.minAvgOptionVolume),
    minAvgShareVolume: num(form.minAvgShareVolume),
    maxBidAskSpreadPct: num(form.maxBidAskSpreadPct) === undefined ? undefined : Number(form.maxBidAskSpreadPct) / 100,
    sector: form.sector.trim() || undefined,
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
      key: "lastPrice",
      header: "Price",
      align: "right",
      render: (row) => (row.lastPrice === null ? "—" : `$${Number(row.lastPrice).toFixed(2)}`),
    },
    {
      key: "ivVsHistRatio",
      header: "IV vs Hist",
      headerTitle: "IBKR's own IV-vs-historical-IV ratio (High Option IV vs. Historical scan) — a stand-in for our 252-day IV Rank until this ticker is shortlisted and accumulates its own price history.",
      align: "right",
      render: (row) => (row.ivVsHistRatio === null ? "—" : Number(row.ivVsHistRatio).toFixed(2)),
    },
    {
      key: "impliedVolatility",
      header: "IV %",
      headerTitle: "Implied Volatility",
      align: "right",
      render: (row) => formatPercentage(row.impliedVolatility === null ? null : Number(row.impliedVolatility)),
    },
    {
      key: "avgOptionVolume",
      header: "Avg Opt Vol",
      align: "right",
      render: (row) => formatNumber(row.avgOptionVolume),
    },
    {
      key: "avgShareVolume",
      header: "Avg Share Vol",
      align: "right",
      render: (row) => formatNumber(row.avgShareVolume),
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
    { key: "scanCodes", header: "Matched", render: (row) => row.scanCodes.map((code) => <span key={code} className="badge bg-blue-lt me-1">{code}</span>) },
    { key: "firstSeenDate", header: "First Seen", render: (row) => formatDate(row.firstSeenDate) },
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
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "1rem",
            }}
          >
            <div>
              <label className="form-label">Max Price</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.maxPrice}
                value={form.maxPrice}
                onChange={(event) => setForm((prev) => ({ ...prev, maxPrice: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Min IV vs Hist</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.minIvRatio}
                value={form.minIvRatio}
                onChange={(event) => setForm((prev) => ({ ...prev, minIvRatio: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Max IV vs Hist</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.maxIvRatio}
                value={form.maxIvRatio}
                onChange={(event) => setForm((prev) => ({ ...prev, maxIvRatio: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Min Avg Opt Vol</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.minAvgOptionVolume}
                value={form.minAvgOptionVolume}
                onChange={(event) => setForm((prev) => ({ ...prev, minAvgOptionVolume: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Min Avg Share Vol</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.minAvgShareVolume}
                value={form.minAvgShareVolume}
                onChange={(event) => setForm((prev) => ({ ...prev, minAvgShareVolume: event.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Max Spread %</label>
              <input
                type="number"
                className="form-control"
                placeholder={filterPlaceholders.maxBidAskSpreadPct}
                value={form.maxBidAskSpreadPct}
                onChange={(event) => setForm((prev) => ({ ...prev, maxBidAskSpreadPct: event.target.value }))}
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
        emptyMessage={hasSearched ? "No candidates match these filters." : "Apply filters to search today's screener candidates."}
      />
    </>
  );
}
