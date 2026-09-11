import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { FlashingNumber } from "../components/FlashingNumber";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import {
  fetchPricePerformance,
  fetchPricePerformanceTrends,
  openPricePerformanceStream,
  type MacdSignal,
  type MaTrend,
  type PricePerformanceLiveRow,
  type PricePerformanceRow,
  type PricePerformanceTrend,
} from "../api/pricePerformance";
import { formatCurrency, formatNumber, formatPercentage, formatPercentageValue, pnlBadgeClass } from "../lib/formatters";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";

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

function MacdTrendBadge({ trend, loading }: { trend: MacdSignal | null | undefined; loading: boolean }) {
  if (trend === undefined) return loading ? <Spinner size="sm" label="Loading MACD trend" /> : <span className="text-muted">—</span>;
  if (trend === null) return <span className="text-muted">—</span>;
  return (
    <span className={`badge ${macdBadgeClass[trend]}`} style={{ fontSize: "0.72rem" }} title="EMA12/EMA26 MACD line vs. its 9-period signal line">
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

function MaTrendBadge({ trend, loading }: { trend: MaTrend | null | undefined; loading: boolean }) {
  if (trend === undefined) return loading ? <Spinner size="sm" label="Loading MA trend" /> : <span className="text-muted">—</span>;
  if (trend === null) return <span className="text-muted">—</span>;
  return (
    <span className={`badge ${maTrendBadgeClass[trend]} text-nowrap`} style={{ fontSize: "0.72rem" }} title="Spot vs. 25-day and 99-day moving averages">
      {maTrendBadgeLabel[trend]}
    </span>
  );
}

export function PricePerformancePage() {
  const [rows, setRows] = useState<PricePerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useTickerDetailSymbol();
  // Loaded separately from `rows` (undefined = still loading) so the table
  // itself keeps rendering instantly from stored daily bars while the live
  // stream fills in current price + recomputed % changes — see
  // openPricePerformanceStream.
  const [liveBySymbol, setLiveBySymbol] = useState<Record<string, PricePerformanceLiveRow>>({});
  const [liveStreamFailed, setLiveStreamFailed] = useState(false);
  // Same "loaded separately, undefined = still loading" pattern as
  // liveBySymbol above — MACD/MA trend can fall through to a live
  // IBKR call, so it fills in after the table's already showing.
  const [trendBySymbol, setTrendBySymbol] = useState<Record<string, PricePerformanceTrend>>({});
  const [trendFetchFailed, setTrendFetchFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchPricePerformance());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load price performance.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (rows.length === 0) return;
    setLiveStreamFailed(false);
    return openPricePerformanceStream(
      (result) => {
        setLiveStreamFailed(false);
        setLiveBySymbol(result);
      },
      () => setLiveStreamFailed(true),
    );
  }, [rows]);

  useEffect(() => {
    setTrendFetchFailed(false);
    fetchPricePerformanceTrends()
      .then(setTrendBySymbol)
      .catch(() => setTrendFetchFailed(true));
  }, [rows]);

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
      render: (row) => formatCurrency(row.latestClose == null ? null : Number(row.latestClose)),
    },
    {
      key: "currentPrice",
      header: "Current",
      headerTitle: "Live streamed price — blank when markets are closed or a live quote isn't available right now",
      align: "right",
      render: (row) => {
        const live = liveBySymbol[row.symbol];
        if (!live) {
          if (liveStreamFailed) {
            return (
              <span className="text-muted" title="Failed to load live prices">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading current price" />;
        }
        if (live.currentPrice === null)
          return (
            <span className="text-muted" title="Live price unavailable right now (outside market hours or IBKR pacing)">
              —
            </span>
          );
        return (
          <TickColoredPrice
            value={live.currentPrice}
            initialReference={row.latestClose == null ? null : Number(row.latestClose)}
            precision={2}
            title="Colored vs. the previous tick, not the last daily close"
          >
            {formatCurrency(live.currentPrice)}
          </TickColoredPrice>
        );
      },
    },
    {
      key: "change24h",
      header: "24hr",
      headerTitle: "vs. 1 trading day back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={liveBySymbol[row.symbol]?.change24h ?? row.change24h} />,
    },
    {
      key: "change48h",
      header: "48hr",
      headerTitle: "vs. 2 trading days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={liveBySymbol[row.symbol]?.change48h ?? row.change48h} />,
    },
    {
      key: "change72h",
      header: "72hr",
      headerTitle: "vs. 3 trading days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={liveBySymbol[row.symbol]?.change72h ?? row.change72h} />,
    },
    {
      key: "change1w",
      header: "1W",
      headerTitle: "vs. ~7 calendar days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={liveBySymbol[row.symbol]?.change1w ?? row.change1w} />,
    },
    {
      key: "change1m",
      header: "1M",
      headerTitle: "vs. ~30 calendar days back — live once the price stream connects",
      align: "right",
      render: (row) => <ChangeBadge value={liveBySymbol[row.symbol]?.change1m ?? row.change1m} />,
    },
    {
      key: "macdTrend",
      header: "MACD Trend",
      headerTitle: "EMA12/EMA26 MACD line vs. its 9-period signal line",
      align: "right",
      render: (row) => <MacdTrendBadge trend={trendBySymbol[row.symbol]?.macdTrend} loading={!trendFetchFailed} />,
    },
    {
      key: "maTrend",
      header: "MA Trend",
      headerTitle: "Spot vs. 25-day and 99-day moving averages",
      align: "right",
      render: (row) => <MaTrendBadge trend={trendBySymbol[row.symbol]?.maTrend} loading={!trendFetchFailed} />,
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
      <PageHeader title="Price Performance" subtitle="Recent price moves across every shortlisted ticker" />

      {error && <div className="alert alert-danger">{error}</div>}

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
