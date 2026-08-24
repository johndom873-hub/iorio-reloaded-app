import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { PositionDetailModal } from "../components/PositionDetailModal";
import { OrderReviewPanel } from "../components/OrderReviewPanel";
import { ApiError } from "../api/client";
import {
  buildOpenOrder,
  fetchGreeks,
  fetchPositions,
  fetchUnrealizedPnl,
  type Greeks,
  type OrderRequest,
  type Position,
  type PositionStatus,
  type UnrealizedPnlResult,
} from "../api/positions";
import { searchTickers, type StrategyKey, type TickerSearchResult } from "../api/screener";
import { openPositionQuoteStream, type OptionQuote, type TickerPricing } from "../api/tickerDetail";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercentageValue,
  formatSignedPnl,
  ibkrExpiryToIsoDate,
  pnlBadgeClass,
} from "../lib/formatters";
import { positionPnlAsOfDate, positionTotalPnl, positionTotalPnlPercent, strategyBadgeClass, strategyLabel } from "../lib/positionPnl";

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

interface NewPositionFormState {
  strategyKey: StrategyKey;
  symbol: string;
  notes: string;
  priceTarget: string;
  stockLimitPrice: string;
  stockQuantity: string;
  optionStrike: string;
  optionExpiry: string;
  optionLimitPrice: string;
  optionQuantity: string;
}

function initialFormState(): NewPositionFormState {
  return {
    strategyKey: "covered_call",
    symbol: "",
    notes: "",
    priceTarget: "",
    stockLimitPrice: "",
    stockQuantity: "100",
    optionStrike: "",
    optionExpiry: "",
    optionLimitPrice: "",
    optionQuantity: "1",
  };
}

export function PositionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [status, setStatus] = useState<PositionStatus>("open");
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});
  const [detailPositionId, setDetailPositionId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewPositionFormState>(initialFormState());
  const [sourceAlertId, setSourceAlertId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef<number | null>(null);

  // Live quote lookup, driven off a confirmed symbol pick (from the search
  // dropdown, not free-typed — restricted to tickers already in the tickers
  // table so there's always a real IBKR contract behind it). Populates
  // Stock Entry Price, and turns Expiry/Strike/Premium into data-driven
  // pickers instead of free-text fields the user could mistype into an
  // expiry or strike that doesn't exist.
  const [symbolConfirmed, setSymbolConfirmed] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<TickerPricing | null>(null);
  const [optionChain, setOptionChain] = useState<OptionQuote[]>([]);
  const closeQuoteStreamRef = useRef<(() => void) | null>(null);

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

  const startQuoteStream = useCallback((symbol: string) => {
    closeQuoteStreamRef.current?.();
    setPricing(null);
    setOptionChain([]);
    setQuoteError(null);
    setQuoteLoading(true);
    closeQuoteStreamRef.current = openPositionQuoteStream(symbol, (event) => {
      if (event.type === "overview") {
        setPricing(event.data.pricing);
        const livePrice = event.data.pricing.last ?? event.data.pricing.previousClose;
        if (livePrice) {
          setForm((prev) => (prev.stockLimitPrice ? prev : { ...prev, stockLimitPrice: String(livePrice) }));
        }
      } else if (event.type === "optionChain") {
        setOptionChain(event.data);
      } else if (event.type === "error") {
        setQuoteError(`Couldn't load ${event.section === "overview" ? "live price" : "option chain"}: ${event.message}`);
      } else if (event.type === "streamError") {
        setQuoteError(event.message);
        setQuoteLoading(false);
      } else if (event.type === "done") {
        setQuoteLoading(false);
      }
    });
  }, []);

  useEffect(() => () => closeQuoteStreamRef.current?.(), []);

  // Arriving from Screener's "Trade" button (?symbol=X&strategy=Y&new=1) or
  // Trade Alerts' "Trade" button (same, plus &strike=&expiry=&premium=&alertId=)
  // — pre-fill and open the New Position form, then clear the params so a
  // page refresh doesn't reopen it. A Trade Alert always suggests a single
  // short option leg (the strategy's own convention — sell a covered call
  // or a cash-secured put), so only optionQuantity defaults to 1, matching
  // the suggestion; the user still fills in stock entry price themselves
  // for a covered call, same as any other new position, since the alert's
  // spotPrice was only ever a scan-time estimate, not a real fill — the
  // live quote stream started below will prefill a fresher one, still
  // editable to match the actual fill. Also starts the same live-quote
  // lookup a manual symbol pick does, so Strike/Expiry render as pickers
  // backed by the live chain (with the alert's suggested strike/expiry
  // injected as a selectable option even if it falls just outside the
  // chain's near-the-money window, so the pre-fill is never stranded on a
  // value the picker can't show).
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    const paramSymbol = searchParams.get("symbol");
    const paramStrategy = searchParams.get("strategy");
    const paramStrike = searchParams.get("strike");
    const paramExpiry = searchParams.get("expiry");
    const paramPremium = searchParams.get("premium");
    const paramAlertId = searchParams.get("alertId");
    setForm((prev) => ({
      ...prev,
      symbol: paramSymbol ?? prev.symbol,
      strategyKey: paramStrategy === "cash_secured_put" ? "cash_secured_put" : "covered_call",
      optionStrike: paramStrike ?? prev.optionStrike,
      optionExpiry: paramExpiry ?? prev.optionExpiry,
      optionLimitPrice: paramPremium ?? prev.optionLimitPrice,
    }));
    if (paramAlertId) setSourceAlertId(paramAlertId);
    if (paramSymbol) {
      setSymbolConfirmed(true);
      startQuoteStream(paramSymbol);
    }
    setShowForm(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, startQuoteStream]);

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
    const openPositionIds = positions.filter((position) => position.status === "open").map((position) => position.id);
    if (openPositionIds.length === 0) return;
    fetchUnrealizedPnl(openPositionIds)
      .then(setUnrealizedPnlByPositionId)
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
    if (!symbolConfirmed) {
      setFormError("Pick a symbol from the dropdown list — free-typed symbols aren't allowed.");
      return;
    }
    if (form.strategyKey === "covered_call" && (!form.stockLimitPrice || !form.stockQuantity)) {
      setFormError("Stock limit price and quantity are required.");
      return;
    }
    if (!form.optionStrike || !form.optionExpiry || !form.optionLimitPrice || !form.optionQuantity) {
      setFormError("Strike, expiry, limit price, and contract quantity are required.");
      return;
    }
    const optionQuantity = Number(form.optionQuantity);
    // Mirrors the server-side guard in positions.ts (validateCoveredCallCoverage)
    // — catches the mistake before a round-trip, but the server check is the
    // real safety net since it can't be bypassed.
    if (form.strategyKey === "covered_call") {
      const shortCallCoveredShares = optionQuantity * 100;
      const stockShares = Number(form.stockQuantity);
      if (shortCallCoveredShares > stockShares) {
        setFormError(
          `${optionQuantity} contract${optionQuantity === 1 ? "" : "s"} covers ${shortCallCoveredShares} shares, but only ${stockShares} shares are held — this would leave the position naked.`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const order = await buildOpenOrder({
        symbol: form.symbol.trim(),
        strategyKey: form.strategyKey,
        stock:
          form.strategyKey === "covered_call"
            ? { quantity: Number(form.stockQuantity), limitPrice: Number(form.stockLimitPrice) }
            : undefined,
        option: {
          quantity: optionQuantity,
          limitPrice: Number(form.optionLimitPrice),
          strikePrice: Number(form.optionStrike),
          expiryDate: form.optionExpiry,
        },
        notes: form.notes.trim() || undefined,
        priceTarget: form.priceTarget ? Number(form.priceTarget) : undefined,
        sourceAlertId: sourceAlertId ?? undefined,
      });
      setPendingOrder(order);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to build order.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetNewPositionForm() {
    setPendingOrder(null);
    setForm(initialFormState());
    setSourceAlertId(null);
    setShowForm(false);
    closeQuoteStreamRef.current?.();
    setSymbolConfirmed(false);
    setPricing(null);
    setOptionChain([]);
    setQuoteError(null);
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
        <span className={`badge ${strategyBadgeClass(row.strategyKey)}`} style={{ fontSize: "0.72rem" }}>
          {strategyLabel(row.strategyKey)}
        </span>
      ),
    },
    { key: "structure", header: "Structure", render: (row) => structureSummary(row) },
    {
      key: "pnl",
      header: "P&L $",
      align: "right",
      render: (row) => {
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") return <Spinner size="sm" label="Loading P&L" />;
        if (pnl === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <span className={`badge ${pnlBadgeClass(pnl)}`} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {formatSignedPnl(pnl)}
          </span>
        );
      },
    },
    {
      key: "pnlPercent",
      header: "P&L %",
      align: "right",
      render: (row) => {
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") return <Spinner size="sm" label="Loading P&L" />;
        const pct = positionTotalPnlPercent(row, pnl);
        if (pct === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <span className={`badge ${pnlBadgeClass(pct)}`} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {pct > 0 ? "+" : ""}
            {formatPercentageValue(pct)}
          </span>
        );
      },
    },
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

  // Option chain scoped to the leg the current Strategy actually trades
  // (calls for covered calls, puts for CSPs) — quoteOptionChain fetches
  // both rights per strike/expiry up front so switching Strategy doesn't
  // need a refetch, just a re-filter.
  const optionRight = form.strategyKey === "covered_call" ? "C" : "P";
  const chainForRight = optionChain.filter((quote) => quote.right === optionRight);
  const expiryOptions = Array.from(new Set(chainForRight.map((quote) => ibkrExpiryToIsoDate(quote.expiry)))).sort();
  if (form.optionExpiry && !expiryOptions.includes(form.optionExpiry)) expiryOptions.push(form.optionExpiry);

  const strikeQuotesForExpiry = chainForRight
    .filter((quote) => ibkrExpiryToIsoDate(quote.expiry) === form.optionExpiry)
    .sort((a, b) => a.strike - b.strike);
  const strikeOptions = strikeQuotesForExpiry.map((quote) => quote.strike);
  const selectedStrikeNumber = form.optionStrike ? Number(form.optionStrike) : null;
  if (selectedStrikeNumber !== null && !strikeOptions.includes(selectedStrikeNumber)) strikeOptions.push(selectedStrikeNumber);
  strikeOptions.sort((a, b) => a - b);

  function selectOptionExpiry(expiry: string) {
    setForm((prev) => ({ ...prev, optionExpiry: expiry, optionStrike: "", optionLimitPrice: "" }));
  }

  function selectOptionStrike(strike: string) {
    const matchingQuote = strikeQuotesForExpiry.find((quote) => quote.strike === Number(strike));
    const midPremium =
      matchingQuote?.bid != null && matchingQuote?.ask != null
        ? (matchingQuote.bid + matchingQuote.ask) / 2
        : matchingQuote?.last ?? null;
    setForm((prev) => ({
      ...prev,
      optionStrike: strike,
      optionLimitPrice: midPremium !== null ? midPremium.toFixed(2) : prev.optionLimitPrice,
    }));
  }

  return (
    <>
      <PageHeader
        title="Positions"
        subtitle="Open and closed positions across all strategies"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setShowForm((prev) => !prev);
              setSourceAlertId(null);
              closeQuoteStreamRef.current?.();
              setSymbolConfirmed(false);
              setPricing(null);
              setOptionChain([]);
              setQuoteError(null);
            }}
          >
            + New Position
          </button>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {showForm && (
        <div className="card mb-3">
          <div className="card-body">
            {formError && <div className="alert alert-danger">{formError}</div>}
            {quoteError && <div className="alert alert-warning">{quoteError}</div>}

            {pendingOrder && (
              <OrderReviewPanel
                order={pendingOrder}
                onCancelled={resetNewPositionForm}
                onFilled={() => {
                  resetNewPositionForm();
                  loadPositions();
                }}
              />
            )}

            {!pendingOrder && (
            <div className="row g-3">
              <div className="col-12 col-sm-6 col-md-4">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Strategy
                </label>
                <select
                  className="form-select"
                  value={form.strategyKey}
                  onChange={(event) => {
                    // Strikes/premiums differ between calls and puts even for the
                    // same expiry, so a strategy switch invalidates whatever was
                    // already picked — clear it rather than leaving a call's
                    // strike/premium silently attached to a put leg.
                    const strategyKey = event.target.value as StrategyKey;
                    setForm((prev) => ({ ...prev, strategyKey, optionStrike: "", optionExpiry: "", optionLimitPrice: "" }));
                  }}
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
                  onChange={(event) => {
                    updateForm("symbol", event.target.value);
                    if (symbolConfirmed) {
                      setSymbolConfirmed(false);
                      closeQuoteStreamRef.current?.();
                      setPricing(null);
                      setOptionChain([]);
                      setQuoteError(null);
                      setForm((prev) => ({ ...prev, optionStrike: "", optionExpiry: "", optionLimitPrice: "" }));
                    }
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => window.setTimeout(() => setShowDropdown(false), 150)}
                />
                {form.symbol.trim() && !symbolConfirmed && !showDropdown && (
                  <div className="form-text text-warning">Pick a symbol from the list below.</div>
                )}
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
                                setSymbolConfirmed(true);
                                startQuoteStream(result.symbol);
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
                      value={form.stockLimitPrice}
                      onChange={(event) => updateForm("stockLimitPrice", event.target.value)}
                    />
                    {symbolConfirmed && quoteLoading && !pricing && (
                      <div className="form-text">
                        <Spinner size="sm" label="Fetching live price" />
                      </div>
                    )}
                    {pricing?.last != null && (
                      <div className="form-text text-muted">Live: {formatCurrency(pricing.last)} (editable — confirm your fill)</div>
                    )}
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
                  Expiry
                </label>
                <select
                  className="form-select"
                  value={form.optionExpiry}
                  disabled={!symbolConfirmed || expiryOptions.length === 0}
                  onChange={(event) => selectOptionExpiry(event.target.value)}
                >
                  <option value="">
                    {!symbolConfirmed ? "Pick a symbol first" : expiryOptions.length === 0 ? "Loading expiries…" : "Select expiry"}
                  </option>
                  {expiryOptions.map((expiry) => (
                    <option key={expiry} value={expiry}>
                      {formatDate(expiry)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  {form.strategyKey === "covered_call" ? "Call Strike" : "Put Strike"}
                </label>
                <select
                  className="form-select"
                  value={form.optionStrike}
                  disabled={!form.optionExpiry || strikeOptions.length === 0}
                  onChange={(event) => selectOptionStrike(event.target.value)}
                >
                  <option value="">{!form.optionExpiry ? "Pick an expiry first" : "Select strike"}</option>
                  {strikeOptions.map((strike) => (
                    <option key={strike} value={strike}>
                      {formatCurrency(strike)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Premium (per share)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="form-control"
                  value={form.optionLimitPrice}
                  onChange={(event) => updateForm("optionLimitPrice", event.target.value)}
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
            )}

            {!pendingOrder && (
              <button
                type="button"
                className="btn btn-primary mt-3 d-inline-flex align-items-center gap-1"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting && <Spinner size="sm" />}
                Review Order
              </button>
            )}
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
