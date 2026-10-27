import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchVolatilityScreen, type BestCallYield, type DeltaBand, type ExpiryWindowKey, type VolatilityRow, type VolatilityScreen } from "../api/volatility";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { FrozenTickerBadge } from "../components/FrozenTickerBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { PlutoManagedMark } from "../components/PlutoManagedMark";
import { TooltipSpan } from "../components/TooltipSpan";
import { useFrozenTickers } from "../hooks/useFrozenTickers";
import { usePlutoEnabledSymbols } from "../hooks/usePlutoEnabledSymbols";
import { useTickerModal } from "../hooks/useTickerModal";
import { daysToExpiry, formatCurrency, formatDate, formatDaysToExpiry, formatNumber, formatPercentage, formatPercentageValue, formatSignedPercentageValue, formatVolatilityPoints, pnlTextClass } from "../lib/formatters";

// The Volatility screen (mockup approved 2026-10-27, replacing Signals): how volatility and option premiums stand right
// now on every Shortlist ticker and every ticker with an open position, so the trader can judge for himself. Polls
// GET /volatility every few seconds; each poll keeps the market quote loop quoting the Calls for this screen's delta band.

const pollIntervalMs = 5_000;
const deltaBandStorageKey = "iorio-volatility-delta-band";

const expiryWindowColumns: { key: ExpiryWindowKey; header: string }[] = [
  { key: "upTo7", header: "≤7 DTE" },
  { key: "from8To21", header: "8–21 DTE" },
  { key: "from22To45", header: "22–45 DTE" },
];

export const volatilityColumnExplanation = {
  price: "Live stock price; the last close (and that session's change) while the market is shut.",
  atmImpliedVolatility: "IBKR's 30-day implied volatility for the stock, live; the last close's value while the market is shut. The same series IV Rank and IV %ile rank.",
  forecast21: "Realized volatility of the last 21 trading days (Yang-Zhang), to the last close.",
  forecast63: "Realized volatility of the last 63 trading days (Yang-Zhang), to the last close. Blank with under 64 daily bars.",
  ivMinusForecast: "ATM IV − FV 21d in volatility points: how much richer (green) or cheaper (red) options are priced than the stock has recently moved.",
  ivRank: "Where IBKR's 30-day IV at the last close sits between its low (0) and high (100) of the last 252 trading days.",
  ivPercentile: "Share of the last 252 trading days whose IV closed below the last close's.",
  bestCallYield: "The highest yield a year after costs among Calls inside the delta band above with this many days to expiry: (mid − costs) ÷ (spot − mid) × 365 ÷ days to expiry, a same-day expiry counted as 1 day. Costs: the Risk & Limits spread cost share of the half-spread plus $0.68 commission per contract. Amber when earnings fall before that Call's expiry. Live only while the market is open.",
  earnings: "The next earnings report.",
};

function readStoredBand(): DeltaBand | null {
  try {
    const raw = localStorage.getItem(deltaBandStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeltaBand>;
    return typeof parsed.min === "number" && typeof parsed.max === "number" && parsed.min >= 0 && parsed.max <= 1 && parsed.min < parsed.max ? { min: parsed.min, max: parsed.max } : null;
  } catch {
    return null;
  }
}

function storeBand(band: DeltaBand): void {
  try {
    localStorage.setItem(deltaBandStorageKey, JSON.stringify(band));
  } catch {
    // private window or blocked storage: the band just isn't remembered
  }
}

function BestYieldCell({ best }: { best: BestCallYield | null }) {
  if (!best) return <span className="font-mono text-secondary">—</span>;
  return (
    <TooltipSpan className={`font-mono ${best.earningsBeforeExpiry ? "iorio-note-amber" : ""}`} text={best.earningsBeforeExpiry ? "Earnings fall before this Call's expiry: its premium includes the earnings move." : undefined}>
      {formatPercentage(best.yield, 0)}
    </TooltipSpan>
  );
}

/** A 0–100 figure (IV Rank, IV percentile) with a bar of the same length. */
function ZeroToHundredBarCell({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="font-mono text-secondary">—</span>;
  return (
    <span className="d-inline-flex align-items-center gap-2 justify-content-end">
      <span className="font-mono">{label}</span>
      <span className="volatility-rank-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
    </span>
  );
}

function ivMinusForecastOf(row: VolatilityRow): number | null {
  return row.atmImpliedVolatility !== null && row.forecast21 !== null ? row.atmImpliedVolatility - row.forecast21 : null;
}

function EarningsCell({ dateIso }: { dateIso: string | null }) {
  if (!dateIso) return <span className="text-secondary">—</span>;
  return (
    <span className="text-nowrap">
      {formatDate(dateIso)} <span className="text-secondary">({formatDaysToExpiry(daysToExpiry(dateIso))})</span>
    </span>
  );
}

export function VolatilityPage() {
  const { open: openTickerModal } = useTickerModal();
  const plutoEnabledSymbols = usePlutoEnabledSymbols();
  const frozenTickers = useFrozenTickers();
  const [screen, setScreen] = useState<VolatilityScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<DeltaBand | null>(readStoredBand);
  const [minInput, setMinInput] = useState(band ? String(band.min) : "");
  const [maxInput, setMaxInput] = useState(band ? String(band.max) : "");
  const [bandError, setBandError] = useState<string | null>(null);
  const bandRef = useRef(band);
  bandRef.current = band;

  // First load without a stored band takes the Risk & Limits one, so the inputs start from it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(load, pollIntervalMs);
        return;
      }
      fetchVolatilityScreen(bandRef.current)
        .then((result) => {
          if (cancelled) return;
          setScreen(result);
          setError(null);
          if (bandRef.current === null) {
            setBand(result.deltaBand);
            setMinInput(String(result.deltaBand.min));
            setMaxInput(String(result.deltaBand.max));
          }
        })
        .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the Volatility screen."))
        .finally(() => {
          if (!cancelled) timer = setTimeout(load, pollIntervalMs);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [band]);

  function applyBand(nextMinInput: string, nextMaxInput: string) {
    setMinInput(nextMinInput);
    setMaxInput(nextMaxInput);
    const min = Number(nextMinInput);
    const max = Number(nextMaxInput);
    if (nextMinInput.trim() === "" || nextMaxInput.trim() === "" || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min >= max) {
      setBandError("Delta min and max must be between 0 and 1, with min below max.");
      return;
    }
    setBandError(null);
    const next = { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 };
    storeBand(next);
    setBand(next);
  }

  const rows = useMemo(() => screen?.rows ?? [], [screen]);
  const marketLive = rows.some((row) => row.priceSource === "live");

  const tickerCell = (row: VolatilityRow) => (
    <span className="d-inline-flex align-items-center text-nowrap">
      <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold iorio-symbol-link" onClick={() => openTickerModal(row.symbol)}>
        {row.symbol}
        <PlutoManagedMark symbol={row.symbol} managed={plutoEnabledSymbols.has(row.symbol)} />
      </button>
      <FrozenTickerBadge frozen={frozenTickers.get(row.symbol)} />
    </span>
  );

  const columns = useMemo<DataTableColumn<VolatilityRow>[]>(
    () => [
      { key: "ticker", header: "Ticker", group: { label: "Stock" }, sortValue: (row) => row.symbol, freezeOnPhone: true, render: tickerCell },
      {
        key: "price",
        header: "Price",
        align: "right",
        group: { label: "Stock" },
        headerTitle: volatilityColumnExplanation.price,
        sortValue: (row) => row.price,
        render: (row) => <span className={`font-mono ${row.priceSource === "close" ? "text-secondary" : ""}`}>{formatCurrency(row.price)}</span>,
      },
      { key: "day", header: "Day", align: "right", group: { label: "Stock" }, sortValue: (row) => row.dayChangePercent, render: (row) => <span className={`font-mono ${pnlTextClass(row.dayChangePercent)}`}>{formatSignedPercentageValue(row.dayChangePercent, 1)}</span> },
      { key: "atmIv", header: "ATM IV", align: "right", group: { label: "Volatility" }, headerTitle: volatilityColumnExplanation.atmImpliedVolatility, sortValue: (row) => row.atmImpliedVolatility, render: (row) => <span className="font-mono">{formatPercentage(row.atmImpliedVolatility, 1)}</span> },
      { key: "fv21", header: "FV 21d", align: "right", group: { label: "Volatility" }, headerTitle: volatilityColumnExplanation.forecast21, sortValue: (row) => row.forecast21, render: (row) => <span className="font-mono">{formatPercentage(row.forecast21, 1)}</span> },
      { key: "fv63", header: "FV 63d", align: "right", group: { label: "Volatility" }, headerTitle: volatilityColumnExplanation.forecast63, sortValue: (row) => row.forecast63, render: (row) => <span className="font-mono">{formatPercentage(row.forecast63, 1)}</span> },
      {
        key: "ivMinusForecast",
        header: "IV − FV 21d",
        align: "right",
        group: { label: "Volatility" },
        headerTitle: volatilityColumnExplanation.ivMinusForecast,
        sortValue: ivMinusForecastOf,
        render: (row) => {
          const gap = ivMinusForecastOf(row);
          return <span className={`font-mono ${pnlTextClass(gap)}`}>{gap === null ? "—" : formatVolatilityPoints(gap)}</span>;
        },
      },
      { key: "ivRank", header: "IV Rank", align: "right", group: { label: "Volatility" }, headerTitle: volatilityColumnExplanation.ivRank, sortValue: (row) => row.ivRank, render: (row) => <ZeroToHundredBarCell value={row.ivRank} label={formatNumber(row.ivRank, 0)} /> },
      { key: "ivPercentile", header: "IV %ile", align: "right", group: { label: "Volatility" }, headerTitle: volatilityColumnExplanation.ivPercentile, sortValue: (row) => row.ivPercentile, render: (row) => <ZeroToHundredBarCell value={row.ivPercentile} label={formatPercentageValue(row.ivPercentile, 0)} /> },
      ...expiryWindowColumns.map(
        (window): DataTableColumn<VolatilityRow> => ({
          key: window.key,
          header: window.header,
          align: "right",
          group: { label: "Best Call yield now · inside the delta band" },
          headerTitle: volatilityColumnExplanation.bestCallYield,
          sortValue: (row) => row.bestCallYields[window.key]?.yield ?? null,
          render: (row) => <BestYieldCell best={row.bestCallYields[window.key]} />,
        }),
      ),
      { key: "earnings", header: "Earnings", align: "right", group: { label: "Events" }, headerTitle: volatilityColumnExplanation.earnings, sortValue: (row) => row.nextEarningsDateIso, render: (row) => <EarningsCell dateIso={row.nextEarningsDateIso} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plutoEnabledSymbols, frozenTickers],
  );

  const bandControls = (
    <div className="d-flex flex-wrap align-items-end gap-2">
      <div>
        <label htmlFor="volatility-delta-min" className="form-label text-secondary mb-1" style={{ fontSize: "0.75rem" }}>
          Delta min
        </label>
        <input id="volatility-delta-min" type="number" min={0} max={1} step={0.01} className="form-control font-mono" style={{ width: "5.5rem" }} value={minInput} onChange={(event) => applyBand(event.target.value, maxInput)} />
      </div>
      <div>
        <label htmlFor="volatility-delta-max" className="form-label text-secondary mb-1" style={{ fontSize: "0.75rem" }}>
          Delta max
        </label>
        <input id="volatility-delta-max" type="number" min={0} max={1} step={0.01} className="form-control font-mono" style={{ width: "5.5rem" }} value={maxInput} onChange={(event) => applyBand(minInput, event.target.value)} />
      </div>
      <span className="text-secondary pb-2" style={{ fontSize: "0.75rem" }}>
        {screen ? `Risk & Limits band ${screen.riskLimitsBand.min.toFixed(2)}–${screen.riskLimitsBand.max.toFixed(2)} · ` : ""}remembered on this device
      </span>
    </div>
  );

  const statusLine = (
    <span className="d-inline-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
      {marketLive ? <span className="iorio-pulse-dot" /> : <span className="iorio-still-dot" />}
      {marketLive ? "Live prices, IV and premiums" : "Market closed · last close"} · FV, IV Rank and IV %ile to the last close
    </span>
  );

  return (
    <>
      <PageHeader title="Volatility" subtitle="How volatility and option premiums stand right now on your Shortlist and held tickers. Click a ticker for its chain and to trade." />
      {error && <div className="alert alert-danger">{error}</div>}
      {bandError && <div className="alert alert-warning py-2">{bandError}</div>}

      <div className="d-none d-md-block">
        <DataTable
          tableId="volatility"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.tickerId}
          loading={!screen && !error}
          emptyMessage="No tickers on the Shortlist and no open positions."
          defaultSort={{ key: "ticker", direction: "asc" }}
          toolbar={
            <div className="d-flex flex-wrap align-items-end justify-content-between gap-3 w-100">
              {bandControls}
              {statusLine}
            </div>
          }
          afterTable={
            <div className="card-footer text-secondary" style={{ fontSize: "0.75rem" }}>
              FV = realized volatility (Yang-Zhang). IV − FV 21d in volatility points. Best Call yield: the highest yield a year after costs among Calls inside the delta band, per days-to-expiry window; amber when earnings fall before that Call's expiry. Hover a header for its definition.
            </div>
          }
        />
      </div>

      <div className="d-md-none">
        <div className="card mb-3">
          <div className="card-body py-2 d-flex flex-column gap-2">
            {bandControls}
            {statusLine}
          </div>
        </div>
        {!screen && !error && <div className="text-secondary">Loading…</div>}
        <div className="d-flex flex-column gap-2">
          {[...rows]
            .sort((a, b) => a.symbol.localeCompare(b.symbol))
            .map((row) => {
              const gap = ivMinusForecastOf(row);
              return (
                <div key={row.tickerId} className="card position-relative">
                  <div className="card-body py-2 d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-baseline gap-2">
                      <span className="d-inline-flex align-items-center">
                        <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold stretched-link position-static iorio-symbol-link" onClick={() => openTickerModal(row.symbol)}>
                          {row.symbol}
                          <PlutoManagedMark symbol={row.symbol} managed={plutoEnabledSymbols.has(row.symbol)} />
                        </button>
                        <span className="position-relative" style={{ zIndex: 2 }}>
                          <FrozenTickerBadge frozen={frozenTickers.get(row.symbol)} />
                        </span>
                      </span>
                      <span className="font-mono" style={{ fontSize: "0.85rem" }}>
                        {formatCurrency(row.price)} <span className={pnlTextClass(row.dayChangePercent)}>{formatSignedPercentageValue(row.dayChangePercent, 1)}</span>
                      </span>
                    </div>
                    <div className="volatility-mobile-grid font-mono">
                      <MobileFigure label="ATM IV" value={formatPercentage(row.atmImpliedVolatility, 1)} />
                      <MobileFigure label="FV 21d" value={formatPercentage(row.forecast21, 1)} />
                      <MobileFigure label="IV − FV 21d" value={gap === null ? "—" : formatVolatilityPoints(gap)} tone={pnlTextClass(gap)} />
                      <MobileFigure label="FV 63d" value={formatPercentage(row.forecast63, 1)} />
                      <MobileFigure label="IV Rank" value={row.ivRank === null ? "—" : formatNumber(row.ivRank, 0)} />
                      <MobileFigure label="IV %ile" value={row.ivPercentile === null ? "—" : formatPercentageValue(row.ivPercentile, 0)} />
                    </div>
                    <div className="border-top pt-2">
                      <div className="text-secondary" style={{ fontSize: "0.7rem" }}>
                        Best Call yield
                      </div>
                      <div className="volatility-mobile-grid font-mono">
                        {expiryWindowColumns.map((window) => {
                          const best = row.bestCallYields[window.key];
                          return <MobileFigure key={window.key} label={window.header} value={best ? formatPercentage(best.yield, 0) : "—"} tone={best?.earningsBeforeExpiry ? "iorio-note-amber" : undefined} />;
                        })}
                      </div>
                    </div>
                    {row.nextEarningsDateIso && (
                      <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
                        Earnings <EarningsCell dateIso={row.nextEarningsDateIso} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}

function MobileFigure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="d-flex flex-column">
      <span className="text-secondary" style={{ fontSize: "0.7rem" }}>
        {label}
      </span>
      <span className={tone}>{value}</span>
    </span>
  );
}
