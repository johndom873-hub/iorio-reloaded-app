import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { PositionDetailModal } from "../components/PositionDetailModal";
import { ApiError } from "../api/client";
import {
  createPosition,
  fetchGreeks,
  fetchPositions,
  type Greeks,
  type LegInput,
  type Position,
  type PositionStatus,
} from "../api/positions";
import { searchTickers, type StrategyKey, type TickerSearchResult } from "../api/screener";
import { formatCurrency, formatDate, formatNumber } from "../lib/formatters";

const searchDebounceMs = 400;

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

function structureSummary(position: Position): string {
  return position.legs
    .map((leg) => {
      const sideLabel = leg.side === "long" ? "Long" : "Short";
      if (leg.legType === "stock") return `${sideLabel} ${leg.quantity} sh`;
      const strike = leg.strikePrice ? formatCurrency(Number(leg.strikePrice)) : "—";
      const rightLabel = leg.optionType === "call" ? "C" : "P";
      return `${sideLabel} ${leg.quantity}x ${strike}${rightLabel}`;
    })
    .join(" / ");
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface NewPositionFormState {
  strategyKey: StrategyKey;
  symbol: string;
  notes: string;
  priceTarget: string;
  entryDate: string;
  stockEntryPrice: string;
  stockQuantity: string;
  optionStrike: string;
  optionExpiry: string;
  optionPremium: string;
  optionQuantity: string;
}

function initialFormState(): NewPositionFormState {
  return {
    strategyKey: "covered_call",
    symbol: "",
    notes: "",
    priceTarget: "",
    entryDate: todayIsoDate(),
    stockEntryPrice: "",
    stockQuantity: "100",
    optionStrike: "",
    optionExpiry: "",
    optionPremium: "",
    optionQuantity: "1",
  };
}

export function PositionsPage() {
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [status, setStatus] = useState<PositionStatus>("open");
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [detailPositionId, setDetailPositionId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewPositionFormState>(initialFormState());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef<number | null>(null);

  const loadPositions = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchPositions({ status, strategyKey: strategy === "all" ? undefined : strategy });
      setPositions(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load positions.");
    }
  }, [status, strategy]);

  useEffect(() => {
    setLoading(true);
    loadPositions().finally(() => setLoading(false));
  }, [loadPositions]);

  useEffect(() => {
    const optionLegIds = positions
      .filter((position) => position.status === "open")
      .flatMap((position) => position.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id));
    if (optionLegIds.length === 0) return;
    fetchGreeks(optionLegIds)
      .then(setGreeksByLegId)
      .catch(() => {});
  }, [positions]);

  useEffect(() => {
    if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);

    const trimmed = form.symbol.trim();
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
  }, [form.symbol]);

  function updateForm<K extends keyof NewPositionFormState>(key: K, value: NewPositionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setFormError(null);

    if (!form.symbol.trim()) {
      setFormError("Symbol is required.");
      return;
    }

    const entryAt = new Date(`${form.entryDate}T00:00:00Z`).toISOString();
    const legs: LegInput[] = [];

    if (form.strategyKey === "covered_call") {
      if (!form.stockEntryPrice || !form.stockQuantity) {
        setFormError("Stock entry price and quantity are required.");
        return;
      }
      legs.push({
        legType: "stock",
        side: "long",
        quantity: Number(form.stockQuantity),
        multiplier: 1,
        entryPrice: Number(form.stockEntryPrice),
        entryAt,
      });
    }

    if (!form.optionStrike || !form.optionExpiry || !form.optionPremium || !form.optionQuantity) {
      setFormError("Strike, expiry, premium, and contract quantity are required.");
      return;
    }
    legs.push({
      legType: "option",
      side: "short",
      quantity: Number(form.optionQuantity),
      optionType: form.strategyKey === "covered_call" ? "call" : "put",
      strikePrice: Number(form.optionStrike),
      expiryDate: form.optionExpiry,
      multiplier: 100,
      entryPrice: Number(form.optionPremium),
      entryAt,
    });

    setSubmitting(true);
    try {
      await createPosition({
        symbol: form.symbol.trim(),
        strategyKey: form.strategyKey,
        notes: form.notes.trim() || undefined,
        priceTarget: form.priceTarget ? Number(form.priceTarget) : undefined,
        legs,
      });
      await loadPositions();
      setForm(initialFormState());
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create position.");
    } finally {
      setSubmitting(false);
    }
  }

  const columns: DataTableColumn<Position>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link p-0 text-decoration-none fw-bold"
          onClick={() => setDetailPositionId(row.id)}
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (row) => (
        <span className="badge bg-azure-lt text-dark" style={{ fontSize: "0.72rem" }}>
          {row.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
        </span>
      ),
    },
    { key: "structure", header: "Structure", render: (row) => structureSummary(row) },
    { key: "openedAt", header: "Opened", render: (row) => formatDate(row.openedAt) },
    {
      key: "delta",
      header: "Delta",
      align: "right",
      render: (row) => {
        const optionLeg = row.legs.find((leg) => leg.legType === "option");
        if (!optionLeg) return "—";
        // Closed positions never get greeks back from the API (the /greeks
        // endpoint only looks up open positions — a closed leg has no live
        // market data to show), so don't show a spinner that will never resolve.
        if (row.status === "closed") return "—";
        const greeks = greeksByLegId[optionLeg.id];
        if (!greeks) return <Spinner size="sm" label="Loading delta" />;
        return formatNumber(greeks.delta, 2);
      },
    },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];

  return (
    <>
      <PageHeader
        title="Positions"
        subtitle="Open and closed positions across all strategies"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((prev) => !prev)}>
            + New Position
          </button>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {showForm && (
        <div className="card mb-3">
          <div className="card-body">
            {formError && <div className="alert alert-danger">{formError}</div>}

            <div className="row g-3">
              <div className="col-12 col-sm-6 col-md-4">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Strategy
                </label>
                <select
                  className="form-select"
                  value={form.strategyKey}
                  onChange={(event) => updateForm("strategyKey", event.target.value as StrategyKey)}
                >
                  <option value="covered_call">Covered Call</option>
                  <option value="cash_secured_put">Cash-Secured Put</option>
                </select>
              </div>

              <div className="col-12 col-sm-6 col-md-4 position-relative">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Symbol
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. AAPL"
                  value={form.symbol}
                  onChange={(event) => updateForm("symbol", event.target.value)}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => window.setTimeout(() => setShowDropdown(false), 150)}
                />
                {showDropdown && form.symbol.trim() && (
                  <div
                    className="card position-absolute w-100 mt-1 shadow-sm"
                    style={{ zIndex: 20, maxHeight: "16rem", overflowY: "auto" }}
                  >
                    {isSearching ? (
                      <div className="p-3 text-center">
                        <Spinner size="sm" label="Searching" />
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-3 text-muted small">No optionable US tickers match "{form.symbol.trim()}".</div>
                    ) : (
                      <ul className="list-group list-group-flush">
                        {searchResults.map((result) => (
                          <li key={result.symbol} className="list-group-item p-0">
                            <button
                              type="button"
                              className="btn btn-link text-decoration-none text-body d-flex justify-content-between align-items-center w-100 px-3 py-2"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                updateForm("symbol", result.symbol);
                                setShowDropdown(false);
                              }}
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

              <div className="col-12 col-sm-6 col-md-4">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Opened On
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={form.entryDate}
                  onChange={(event) => updateForm("entryDate", event.target.value)}
                />
              </div>

              {form.strategyKey === "covered_call" && (
                <>
                  <div className="col-12 col-sm-6 col-md-3">
                    <label className="form-label" style={{ fontSize: "0.8rem" }}>
                      Stock Entry Price
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={form.stockEntryPrice}
                      onChange={(event) => updateForm("stockEntryPrice", event.target.value)}
                    />
                  </div>
                  <div className="col-12 col-sm-6 col-md-3">
                    <label className="form-label" style={{ fontSize: "0.8rem" }}>
                      Stock Quantity (shares)
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      value={form.stockQuantity}
                      onChange={(event) => updateForm("stockQuantity", event.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  {form.strategyKey === "covered_call" ? "Call Strike" : "Put Strike"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="form-control"
                  value={form.optionStrike}
                  onChange={(event) => updateForm("optionStrike", event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Expiry
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={form.optionExpiry}
                  onChange={(event) => updateForm("optionExpiry", event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Premium (per share)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="form-control"
                  value={form.optionPremium}
                  onChange={(event) => updateForm("optionPremium", event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Contracts
                </label>
                <input
                  type="number"
                  className="form-control"
                  value={form.optionQuantity}
                  onChange={(event) => updateForm("optionQuantity", event.target.value)}
                />
              </div>

              <div className="col-12 col-sm-6 col-md-4">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Price Target (optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="form-control"
                  value={form.priceTarget}
                  onChange={(event) => updateForm("priceTarget", event.target.value)}
                />
              </div>
              <div className="col-12 col-md-8">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Notes (optional)
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary mt-3 d-inline-flex align-items-center gap-1"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting && <Spinner size="sm" />}
              Create Position
            </button>
          </div>
        </div>
      )}

      <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mb-3">
        <ul className="nav nav-tabs">
          {strategyTabs.map((tabOption) => (
            <li className="nav-item" key={tabOption.key}>
              <button
                type="button"
                className={`nav-link ${strategy === tabOption.key ? "active" : ""}`}
                onClick={() => setStrategy(tabOption.key)}
              >
                {tabOption.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn ${status === "open" ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setStatus("open")}
          >
            Open
          </button>
          <button
            type="button"
            className={`btn ${status === "closed" ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setStatus("closed")}
          >
            Closed
          </button>
        </div>
      </div>

      <DataTable
        tableId="positions"
        columns={columns}
        rows={positions}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage={`No ${status} positions yet.`}
      />

      {detailPositionId && (
        <PositionDetailModal
          positionId={detailPositionId}
          onClose={() => setDetailPositionId(null)}
          onChanged={loadPositions}
        />
      )}
    </>
  );
}
