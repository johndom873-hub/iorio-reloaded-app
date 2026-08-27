import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { ApexChart } from "../components/charts/ApexChart";
import { useTheme } from "../contexts/ThemeContext";
import { ApiError } from "../api/client";
import { fetchAvailableCash, fetchDashboardSummary, fetchPnlHistory, type AvailableCash, type DashboardSummary, type PnlHistoryPoint } from "../api/dashboard";
import { fetchExposure, type ConcentrationRow, type ExposureData, type StrategyAllocationRow, type TopPositionRow } from "../api/riskLimits";
import { formatCurrency, formatDate, formatPercentage, formatSignedPnl, pnlTextClass } from "../lib/formatters";

const strategyLabels: Record<string, string> = {
  covered_call: "Covered Calls",
  cash_secured_put: "Cash-Secured Puts",
  unallocated: "Unallocated (cash)",
};

// Fixed-order categorical palette (blue, orange, aqua, yellow, magenta,
// green, violet, red) — validated for adjacent-pair colorblind safety in
// this exact order; assigned in sequence, never cycled or reordered per
// chart. "Unallocated" isn't a real category (it's the absence of one) so
// it never takes a slot — it always renders as the same neutral gray.
const categoricalByTheme = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;
const unallocatedGrayByTheme = { light: "#9099ab", dark: "#8b96a8" } as const;

// Shared row shape for the three allocation lists below — a plain label
// (ticker/sector/strategy) plus a $ value, rendered as $ + % of total
// account value with an "Unallocated" row styled as muted rather than a
// real holding.
interface AllocationListProps {
  title: string;
  emptyMessage: string;
  totalAccountValue: number | null;
  rows: { key: string; label: string; sublabel?: string; notionalValue: string; isUnallocated?: boolean }[];
}

// Assigns the fixed-order categorical palette to each real row (skipping
// "Unallocated", which always gets the neutral gray) — computed once and
// shared between the donut's slices and the list's swatches below it, so
// identity is never color-alone: every slice has a same-colored dot next
// to its label and $ value.
function allocationColors(rows: AllocationListProps["rows"], theme: "light" | "dark"): string[] {
  const categorical = categoricalByTheme[theme];
  let nextSlot = 0;
  return rows.map((row) => (row.isUnallocated ? unallocatedGrayByTheme[theme] : categorical[nextSlot++ % categorical.length]));
}

function AllocationDonut({ rows, colors }: { rows: AllocationListProps["rows"]; colors: string[] }) {
  const series = rows.map((row) => Number(row.notionalValue));
  const total = series.reduce((sum, value) => sum + value, 0);

  return (
    <ApexChart
      type="donut"
      height={200}
      series={series}
      options={{
        labels: rows.map((row) => row.label),
        colors,
        stroke: { show: true, width: 2 }, // surface gap between slices
        dataLabels: { enabled: rows.length <= 4, formatter: (val: number) => `${val.toFixed(0)}%` },
        legend: { show: false }, // the list below doubles as the legend (label + swatch)
        tooltip: { y: { formatter: (val: number) => formatCurrency(val, 0) } },
        plotOptions: {
          pie: {
            donut: {
              size: "68%",
              labels: {
                show: true,
                total: { show: true, label: "Total", formatter: () => formatCurrency(total, 0) },
                value: { formatter: (val: string) => formatCurrency(Number(val), 0) },
              },
            },
          },
        },
      }}
    />
  );
}

function AllocationList({ title, emptyMessage, totalAccountValue, rows }: AllocationListProps) {
  const { theme } = useTheme();
  const colors = allocationColors(rows, theme);
  return (
    <div className="col-12 col-md-4">
      <h4 style={{ fontSize: "0.9rem" }}>{title}</h4>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
          {emptyMessage}
        </div>
      ) : (
        <>
          <AllocationDonut rows={rows} colors={colors} />
          <ul className="list-group list-group-flush">
            {rows.map((row, index) => {
              const fraction = totalAccountValue ? Number(row.notionalValue) / totalAccountValue : null;
              return (
                <li key={row.key} className="list-group-item d-flex justify-content-between align-items-center px-0">
                  <span className={`d-inline-flex align-items-center gap-2 ${row.isUnallocated ? "text-muted" : ""}`}>
                    <span
                      aria-hidden="true"
                      style={{ width: "0.6rem", height: "0.6rem", borderRadius: "50%", backgroundColor: colors[index], flexShrink: 0 }}
                    />
                    {row.label}
                    {row.sublabel && <span className="text-muted ms-1" style={{ fontSize: "0.72rem" }}>{row.sublabel}</span>}
                  </span>
                  <span className="text-muted text-nowrap" style={{ fontSize: "0.8rem" }}>
                    {formatCurrency(Number(row.notionalValue), 0)}
                    {fraction !== null && ` (${formatPercentage(fraction)})`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

interface PeriodCardProps {
  label: string;
  value: string | null;
}

function PeriodCard({ label, value }: PeriodCardProps) {
  const numericValue = value === null ? null : Number(value);
  return (
    <div className="col-12 col-sm-6 col-md-3">
      <div className="card">
        <div className="card-body">
          <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>
            {label}
          </div>
          <div className={`fw-bold ${pnlTextClass(numericValue)}`}>{formatSignedPnl(numericValue)}</div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [history, setHistory] = useState<PnlHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  const [exposureError, setExposureError] = useState<string | null>(null);

  const [cash, setCash] = useState<AvailableCash | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(err instanceof ApiError ? err.message : "Failed to load dashboard summary."))
      .finally(() => setSummaryLoading(false));
  }, []);

  // Live IBKR round trip (approved 2026-08-27, see fetchAvailableCash) --
  // same figure shown on Order Review, here as a plain breakdown rather than
  // netted against a specific pending order's capital requirement.
  useEffect(() => {
    fetchAvailableCash()
      .then(setCash)
      .catch((err) => setCashError(err instanceof ApiError ? err.message : "Failed to load available cash."))
      .finally(() => setCashLoading(false));
  }, []);

  useEffect(() => {
    fetchExposure()
      .then(setExposure)
      .catch((err) => setExposureError(err instanceof ApiError ? err.message : "Failed to load account allocation."))
      .finally(() => setExposureLoading(false));
  }, []);

  useEffect(() => {
    fetchPnlHistory()
      .then(setHistory)
      .catch((err) => setHistoryError(err instanceof ApiError ? err.message : "Failed to load P&L history."))
      .finally(() => setHistoryLoading(false));
  }, []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Aggregate P&L across all strategies" />

      {summaryError && <div className="alert alert-danger">{summaryError}</div>}

      {summaryLoading ? (
        <div className="d-flex justify-content-center py-3">
          <Spinner label="Loading dashboard" />
        </div>
      ) : (
        <>
          <div className="row g-3 mb-3">
            <PeriodCard label="Day" value={summary?.periods.day ?? null} />
            <PeriodCard label="Week to Date" value={summary?.periods.week ?? null} />
            <PeriodCard label="Month to Date" value={summary?.periods.month ?? null} />
            <PeriodCard label="Year to Date" value={summary?.periods.year ?? null} />
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h3 className="card-title" style={{ fontSize: "1rem" }}>
                Current State
                {summary?.asOf && (
                  <span className="text-muted fw-normal ms-2" style={{ fontSize: "0.75rem" }}>
                    as of {formatDate(summary.asOf)}
                  </span>
                )}
              </h3>

              {!summary?.asOf ? (
                <div className="text-muted">No P&L snapshots captured yet.</div>
              ) : (
                <div className="row">
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Net Liquidation Value
                    </div>
                    <div className="fw-bold">{formatCurrency(Number(summary.netLiquidationValue))}</div>
                  </div>
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Realized P&L (cumulative)
                    </div>
                    <div className={`fw-bold ${pnlTextClass(Number(summary.cumulativeRealizedPnl))}`}>
                      {formatSignedPnl(Number(summary.cumulativeRealizedPnl))}
                    </div>
                  </div>
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Unrealized P&L (cumulative)
                    </div>
                    <div className={`fw-bold ${pnlTextClass(Number(summary.cumulativeUnrealizedPnl))}`}>
                      {formatSignedPnl(Number(summary.cumulativeUnrealizedPnl))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h3 className="card-title" style={{ fontSize: "1rem" }}>
                Cash
              </h3>
              {cashError && <div className="alert alert-danger mb-0">{cashError}</div>}
              {!cashError && cashLoading && <Spinner size="sm" label="Loading cash" />}
              {!cashError && !cashLoading && (
                <div className="row">
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Total Cash
                    </div>
                    <div className="fw-bold font-mono">{formatCurrency(cash?.totalCashValue ?? null)}</div>
                  </div>
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Cash Locked in CSPs
                    </div>
                    <div className="fw-bold font-mono">{formatCurrency(cash?.cashLockedInCsps ?? null)}</div>
                  </div>
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Available Cash to Trade
                    </div>
                    <div className="fw-bold font-mono">{formatCurrency(cash?.availableCashToTrade ?? null)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h3 className="card-title" style={{ fontSize: "1rem" }}>
                Per-Strategy Breakdown
              </h3>
              {!summary?.strategyBreakdown.length ? (
                <div className="text-muted">No open positions with a snapshotted P&L yet.</div>
              ) : (
                <ul className="list-group list-group-flush">
                  {summary.strategyBreakdown.map((row) => (
                    <li key={row.strategyKey} className="list-group-item d-flex justify-content-between align-items-center px-0">
                      <span>{strategyLabels[row.strategyKey] ?? row.strategyKey}</span>
                      <span>
                        Realized <span className={pnlTextClass(Number(row.realizedPnl))}>{formatSignedPnl(Number(row.realizedPnl))}</span>
                        {" "}&middot; Unrealized{" "}
                        <span className={pnlTextClass(Number(row.unrealizedPnl))}>{formatSignedPnl(Number(row.unrealizedPnl))}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card mb-3">
        <div className="card-body">
          <h3 className="card-title" style={{ fontSize: "1rem" }}>
            Allocation
          </h3>

          {exposureLoading ? (
            <Spinner size="sm" label="Loading allocation" />
          ) : (
            <>
              {exposureError && <div className="alert alert-danger">{exposureError}</div>}
              {exposure?.accountDataError && (
                <div className="alert alert-warning">Live account data unavailable: {exposure.accountDataError}</div>
              )}
              <div className="row g-3">
                <AllocationList
                  title="By Strategy"
                  emptyMessage="No open positions yet."
                  totalAccountValue={exposure?.totalAccountValue ?? null}
                  rows={(exposure?.strategyAllocation ?? []).map((row: StrategyAllocationRow) => ({
                    key: row.strategyKey,
                    label: strategyLabels[row.strategyKey] ?? row.strategyKey,
                    notionalValue: row.notionalValue,
                    isUnallocated: row.strategyKey === "unallocated",
                  }))}
                />
                <AllocationList
                  title="Top Positions"
                  emptyMessage="No open positions yet."
                  totalAccountValue={exposure?.totalAccountValue ?? null}
                  rows={(exposure?.topPositions ?? []).map((row: TopPositionRow) => ({
                    key: row.positionId,
                    label: row.symbol,
                    sublabel: strategyLabels[row.strategyKey] ?? row.strategyKey,
                    notionalValue: row.notionalValue,
                  }))}
                />
                <AllocationList
                  title="By Industry"
                  emptyMessage="No open positions yet."
                  totalAccountValue={exposure?.totalAccountValue ?? null}
                  rows={(exposure?.concentrationBySector ?? []).map((row: ConcentrationRow) => ({
                    key: row.sector ?? "",
                    label: row.sector ?? "",
                    notionalValue: row.notionalValue,
                    isUnallocated: row.sector === "Unallocated",
                  }))}
                />
              </div>
              <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>
                % of total account value (net liquidation value, including cash). See Risk &amp; Limits for concentration limits.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h3 className="card-title" style={{ fontSize: "1rem" }}>
            P&L Over Time
          </h3>

          {historyError && <div className="alert alert-danger">{historyError}</div>}

          {historyLoading ? (
            <div className="d-flex justify-content-center py-3">
              <Spinner label="Loading history" />
            </div>
          ) : history.length < 2 ? (
            <div className="text-muted">Not enough snapshot history yet to chart a trend.</div>
          ) : (
            <ApexChart
              type="area"
              height={260}
              series={[
                {
                  name: "Daily P&L",
                  // null (not 0) for a missing snapshot day, so the chart
                  // shows a gap instead of a misleading flat zero day.
                  data: history.map((point) => ({
                    x: point.snapshotDate,
                    y: point.dailyPnl === null ? null : Number(point.dailyPnl),
                  })),
                },
              ]}
              options={{
                xaxis: {
                  type: "datetime",
                  tickAmount: Math.min(history.length - 1, 7),
                  labels: { datetimeUTC: false, format: "dd MMM" },
                },
                yaxis: { labels: { formatter: (value: number) => formatCurrency(value) } },
                tooltip: {
                  x: { format: "dd MMM yyyy" },
                  y: { formatter: (value: number) => formatSignedPnl(value) },
                },
                dataLabels: { enabled: false },
                stroke: { curve: "straight", width: 2 },
                responsive: [{ breakpoint: 768, options: { legend: { position: "bottom" }, chart: { height: 220 } } }],
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
