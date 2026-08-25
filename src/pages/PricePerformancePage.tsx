import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import { fetchPricePerformance, type PricePerformanceRow } from "../api/pricePerformance";
import { formatCurrency, formatDate, pnlBadgeClass } from "../lib/formatters";

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <span className={`badge ${pnlBadgeClass(value)}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function PricePerformancePage() {
  const [rows, setRows] = useState<PricePerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

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
    { key: "change24h", header: "24hr", headerTitle: "vs. 1 trading day back", align: "right", render: (row) => <ChangeBadge value={row.change24h} /> },
    { key: "change48h", header: "48hr", headerTitle: "vs. 2 trading days back", align: "right", render: (row) => <ChangeBadge value={row.change48h} /> },
    { key: "change72h", header: "72hr", headerTitle: "vs. 3 trading days back", align: "right", render: (row) => <ChangeBadge value={row.change72h} /> },
    { key: "change1w", header: "1W", headerTitle: "vs. ~7 calendar days back", align: "right", render: (row) => <ChangeBadge value={row.change1w} /> },
    { key: "change1m", header: "1M", headerTitle: "vs. ~30 calendar days back", align: "right", render: (row) => <ChangeBadge value={row.change1m} /> },
    {
      key: "dailyRange",
      header: "Daily Lo/Hi",
      headerTitle: "Daily Low / High",
      align: "right",
      render: (row) =>
        `${formatCurrency(row.dailyLow == null ? null : Number(row.dailyLow))} / ${formatCurrency(row.dailyHigh == null ? null : Number(row.dailyHigh))}`,
    },
    {
      key: "weeklyRange",
      header: "Wkly Lo/Hi",
      headerTitle: "Weekly Low / High — rolling 7 calendar days",
      align: "right",
      render: (row) =>
        `${formatCurrency(row.weeklyLow == null ? null : Number(row.weeklyLow))} / ${formatCurrency(row.weeklyHigh == null ? null : Number(row.weeklyHigh))}`,
    },
    {
      key: "monthlyRange",
      header: "Mthly Lo/Hi",
      headerTitle: "Monthly Low / High — rolling 30 calendar days",
      align: "right",
      render: (row) =>
        `${formatCurrency(row.monthlyLow == null ? null : Number(row.monthlyLow))} / ${formatCurrency(row.monthlyHigh == null ? null : Number(row.monthlyHigh))}`,
    },
    { key: "latestDate", header: "As Of", render: (row) => formatDate(row.latestDate) },
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
