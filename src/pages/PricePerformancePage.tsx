import { useCallback, useEffect, useState } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { FlashingNumber } from "../components/FlashingNumber";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import { openNotificationStream } from "../api/notifications";
import {
  fetchPricePerformance,
  openPricePerformanceStream,
  requestPriceDataRefresh,
  type MacdSignal,
  type MaTrend,
  type PricePerformanceData,
  type PricePerformanceLivePrices,
  type PricePerformanceRow,
  type ReferenceCloses,
} from "../api/pricePerformance";
import { formatCurrency, formatDate, formatNumber, formatPercentage, formatPercentageValue, pnlBadgeClass } from "../lib/formatters";
import { percentChange } from "../lib/priceChange";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import { useTooltip } from "../hooks/useTooltip";
import { TooltipSpan } from "../components/TooltipSpan";

// Flashes on every live-streamed update, same mechanism as Positions'
// P&L/Greeks columns — see FlashingNumber's own comment for why it's a
// component (not a bare useFlashOnChange call) here in a DataTable render().
function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <FlashingNumber value={value} precision={2} className={`badge ${pnlBadgeClass(value)}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </FlashingNumber>
  );
}

const macdBadgeClass: Record<MacdSignal, string> = {
  Bullish: "badge-change-pos",
  Bearish: "badge-change-neg",
  Neutral: "badge-change-flat",
};

const trendUnavailableTitle = "Not enough daily history yet (needs about 99 trading days of closes)";

function MacdTrendBadge({ trend }: { trend: MacdSignal | null }) {
  const tooltipText = trend === null ? trendUnavailableTitle : "As of the last completed close: EMA12/EMA26 MACD line vs. its 9-period signal line";
  const ref = useTooltip<HTMLSpanElement>(tooltipText);
  if (trend === null)
    return (
      <span ref={ref} className="text-muted" tabIndex={0}>
        —
      </span>
    );
  return (
    <span ref={ref} className={`badge ${macdBadgeClass[trend]}`} style={{ fontSize: "0.72rem" }} tabIndex={0}>
      {trend}
    </span>
  );
}

const maTrendBadgeClass: Record<MaTrend, string> = {
  uptrend: "badge-change-pos",
  downtrend: "badge-change-neg",
  mixed: "badge-change-flat",
};
const maTrendBadgeLabel: Record<MaTrend, string> = {
  uptrend: "Uptrend",
  downtrend: "Downtrend",
  mixed: "Mixed",
};

function MaTrendBadge({ trend }: { trend: MaTrend | null }) {
  const tooltipText = trend === null ? trendUnavailableTitle : "As of the last completed close: that close vs. the 25-day and 99-day moving averages";
  const ref = useTooltip<HTMLSpanElement>(tooltipText);
  if (trend === null)
    return (
      <span ref={ref} className="text-muted" tabIndex={0}>
        —
      </span>
    );
  return (
    <span ref={ref} className={`badge ${maTrendBadgeClass[trend]} text-nowrap`} style={{ fontSize: "0.72rem" }} tabIndex={0}>
      {maTrendBadgeLabel[trend]}
    </span>
  );
}

// How long to wait for the first live price before saying so, instead of an
// endless spinner (market closed, IBKR slow or unreachable).
const LIVE_PRICE_WAIT_MS = 8_000;
// While a refresh is running, re-check this often in addition to the
// job_completed notification (which is what normally ends it instantly).
const REFRESH_POLL_MS = 3_000;
const REFRESH_JOB_NAMES = new Set(["price_bars_refresh", "daily_market_data_capture"]);

type LiveConnection = "connecting" | "live" | "unavailable";

// The live change against a reference close if a live price is known, else the
// static change vs. the last completed close the server computed.
function changeFor(row: PricePerformanceRow, livePrice: number | null | undefined, key: keyof ReferenceCloses, staticChange: number | null): number | null {
  if (livePrice === undefined || livePrice === null) return staticChange;
  return percentChange(livePrice, row.referenceCloses[key]);
}

export function PricePerformancePage() {
  const [data, setData] = useState<PricePerformanceData | null>(null);
  // The server reports the refresh cooldown as "N seconds left" at the moment
  // it answered; the page turns that into an end time and ticks against it, so
  // the button re-enables by itself instead of waiting for the next reload.
  const [cooldownEndsAtMs, setCooldownEndsAtMs] = useState(0);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useTickerDetailSymbol();
  // Live prices arrive separately from the table (which renders at once from
  // stored daily bars), so the table never waits on IBKR.
  const [livePrices, setLivePrices] = useState<PricePerformanceLivePrices>({});
  const [liveConnection, setLiveConnection] = useState<LiveConnection>("connecting");
  const [liveWaitExpired, setLiveWaitExpired] = useState(false);
  const [isRequestingRefresh, setIsRequestingRefresh] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const loaded = await fetchPricePerformance();
      setClockMs(Date.now());
      setCooldownEndsAtMs(Date.now() + loaded.meta.refresh.cooldownRemainingSeconds * 1000);
      setData(loaded);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load price performance.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // One stream for the page's lifetime, reopened only if the set of shortlisted
  // tickers itself changes — reloading the same table must not restart it.
  const symbolsKey = data ? data.tickers.map((row) => row.symbol).join(",") : "";
  useEffect(() => {
    if (symbolsKey === "") return;
    setLivePrices({});
    setLiveConnection("connecting");
    setLiveWaitExpired(false);
    const waitTimer = window.setTimeout(() => setLiveWaitExpired(true), LIVE_PRICE_WAIT_MS);
    const closeStream = openPricePerformanceStream(
      (prices) => {
        window.clearTimeout(waitTimer);
        setLiveWaitExpired(false);
        setLiveConnection("live");
        setLivePrices(prices);
      },
      () => {
        window.clearTimeout(waitTimer);
        setLiveConnection("unavailable");
      },
    );
    return () => {
      window.clearTimeout(waitTimer);
      closeStream();
    };
  }, [symbolsKey]);

  // The nightly capture or a manual refresh finished: reload the stored data.
  useEffect(() => {
    return openNotificationStream((notification) => {
      if (notification.type === "job_completed" && REFRESH_JOB_NAMES.has(notification.jobName)) void load();
    });
  }, [load]);

  useEffect(() => {
    if (cooldownEndsAtMs <= Date.now()) return;
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
      if (Date.now() >= cooldownEndsAtMs) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownEndsAtMs]);

  const isRefreshRunning = data?.meta.refresh.isRunning ?? false;
  useEffect(() => {
    if (!isRefreshRunning) return;
    const timer = window.setInterval(() => void load(), REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isRefreshRunning, load]);

  async function handleRefreshClick() {
    setIsRequestingRefresh(true);
    setRefreshMessage(null);
    try {
      const result = await requestPriceDataRefresh();
      if (result.status === "cooldown") setRefreshMessage(`Just refreshed — try again in ${result.retryAfterSeconds}s.`);
      if (result.status === "upToDate") setRefreshMessage("Daily data is already current.");
      await load();
    } catch (err) {
      setRefreshMessage(err instanceof ApiError ? err.message : "Could not start the refresh.");
    } finally {
      setIsRequestingRefresh(false);
    }
  }

  const rows = data?.tickers ?? [];
  const meta = data?.meta ?? null;
  const refreshableCount = meta?.refresh.refreshableSymbolCount ?? 0;
  const refreshCooldown = Math.max(0, Math.ceil((cooldownEndsAtMs - clockMs) / 1000));
  const refreshBusy = isRefreshRunning || isRequestingRefresh;
  const refreshDisabled = refreshBusy || refreshableCount === 0 || refreshCooldown > 0;
  const refreshTitle = refreshableCount === 0
    ? "Every ticker already has the latest completed session — nothing to fetch."
    : refreshCooldown > 0
      ? `Refreshed moments ago — available again in ${refreshCooldown}s.`
      : `Fetch the missing daily bars for ${refreshableCount} ticker${refreshableCount === 1 ? "" : "s"} from IBKR.`;

  const liveStatus =
    liveConnection === "live"
      ? { label: "Live prices streaming", className: "bg-success-lt" }
      : liveConnection === "unavailable"
        ? { label: "Live prices unavailable", className: "bg-warning-lt" }
        : liveWaitExpired
          ? { label: "No live prices yet — market may be closed", className: "bg-secondary-lt" }
          : { label: "Waiting for live prices…", className: "bg-secondary-lt" };

  const columns: DataTableColumn<PricePerformanceRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link p-0 text-decoration-none fw-bold"
          onClick={() => setDetailSymbol(row.symbol)}
        >
          {row.symbol}
        </button>
      ),
    },
    { key: "companyName", header: "Company", render: (row) => row.companyName ?? "—" },
    {
      key: "latestClose",
      header: "Last Close",
      headerTitle: "Most recent completed trading day's close",
      align: "right",
      render: (row) => (
        <span>
          {formatCurrency(row.latestClose == null ? null : Number(row.latestClose))}
          {row.isBehind && (
            <TooltipSpan className="ms-1 text-warning" text={`Out of date — this ticker's latest daily bar is ${formatDate(row.latestDate)}`}>
              <IconAlertTriangle size={14} aria-hidden="true" />
            </TooltipSpan>
          )}
        </span>
      ),
    },
    {
      key: "currentPrice",
      header: "Current",
      headerTitle: "Live streamed price — blank when markets are closed or a live quote isn't available right now",
      align: "right",
      render: (row) => {
        const price = livePrices[row.symbol];
        if (price === undefined) {
          // Nothing has arrived for this ticker: still connecting, or it will not.
          if (liveConnection === "unavailable")
            return (
              <TooltipSpan className="text-muted" text="Live prices are unavailable right now">
                —
              </TooltipSpan>
            );
          if (liveWaitExpired)
            return (
              <TooltipSpan className="text-muted" text="No live price yet — the market may be closed, or IBKR is slow to respond">
                —
              </TooltipSpan>
            );
          return <Spinner size="sm" label="Loading current price" />;
        }
        if (price === null)
          return (
            <TooltipSpan className="text-muted" text="No live quote for this ticker right now (outside market hours or no market data)">
              —
            </TooltipSpan>
          );
        return (
          <TickColoredPrice
            value={price}
            initialReference={row.latestClose == null ? null : Number(row.latestClose)}
            precision={2}
            title="Colored vs. the previous tick, not the last daily close"
          >
            {formatCurrency(price)}
          </TickColoredPrice>
        );
      },
    },
    {
      key: "change24h",
      header: "24hr",
      headerTitle: "vs. 1 trading day back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={changeFor(row, livePrices[row.symbol], "close24hAgo", row.change24h)} />,
    },
    {
      key: "change48h",
      header: "48hr",
      headerTitle: "vs. 2 trading days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={changeFor(row, livePrices[row.symbol], "close48hAgo", row.change48h)} />,
    },
    {
      key: "change72h",
      header: "72hr",
      headerTitle: "vs. 3 trading days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={changeFor(row, livePrices[row.symbol], "close72hAgo", row.change72h)} />,
    },
    {
      key: "change1w",
      header: "1W",
      headerTitle: "vs. ~7 calendar days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={changeFor(row, livePrices[row.symbol], "close1wAgo", row.change1w)} />,
    },
    {
      key: "change1m",
      header: "1M",
      headerTitle: "vs. ~30 calendar days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={changeFor(row, livePrices[row.symbol], "close1mAgo", row.change1m)} />,
    },
    {
      key: "macdTrend",
      header: "MACD Trend",
      headerTitle: "As of the last completed close: EMA12/EMA26 MACD line vs. its 9-period signal line",
      align: "right",
      render: (row) => <MacdTrendBadge trend={row.macdTrend} />,
    },
    {
      key: "maTrend",
      header: "MA Trend",
      headerTitle: "As of the last completed close: that close vs. the 25-day and 99-day moving averages",
      align: "right",
      render: (row) => <MaTrendBadge trend={row.maTrend} />,
    },
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
  ];

  return (
    <>
      <PageHeader
        title="Price Performance"
        subtitle="Recent price moves across every shortlisted ticker"
        actions={
          <TooltipSpan text={refreshTitle} style={{ display: "inline-block" }}>
            <button type="button" className="btn btn-outline-primary" disabled={refreshDisabled} onClick={() => void handleRefreshClick()}>
              {refreshBusy ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Refreshing…
                </>
              ) : (
                <>
                  <IconRefresh size={18} className="me-2" />
                  Refresh daily data
                </>
              )}
            </button>
          </TooltipSpan>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {meta && !meta.isDataCurrent && (
        <div className="alert alert-warning" role="alert">
          {/* One element: .alert is a flex container, so loose text and <strong> would become separately spaced flex items. */}
          <div>
            Daily data is out of date for {meta.behindSymbols.length} ticker{meta.behindSymbols.length === 1 ? "" : "s"} ({meta.behindSymbols.join(", ")}) —
            the nightly capture may have missed them. Use <strong>Refresh daily data</strong> to fetch what is missing.
          </div>
        </div>
      )}

      {meta && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3 text-muted small">
          <span>Daily data as of the {formatDate(meta.completedThroughDate)} close</span>
          <span className={`badge ${liveStatus.className}`} style={{ fontSize: "0.72rem" }} role="status">
            {liveStatus.label}
          </span>
          {refreshMessage && <span>{refreshMessage}</span>}
        </div>
      )}

      <DataTable
        tableId="price-performance"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.symbol}
        loading={loading}
        emptyMessage="No shortlisted tickers yet."
      />

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
