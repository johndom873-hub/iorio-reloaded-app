import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { ApexChart } from "../components/charts/ApexChart";
import { ApiError } from "../api/client";
import { fetchDashboardSummary, fetchPnlHistory, type DashboardSummary, type PnlHistoryPoint } from "../api/dashboard";
import { formatCurrency, formatDate, formatSignedPnl } from "../lib/formatters";

const strategyLabels: Record<string, string> = {
  covered_call: "Covered Calls",
  cash_secured_put: "Cash-Secured Puts",
};

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
          <div className={`fw-bold ${numericValue === null ? "" : numericValue >= 0 ? "text-success" : "text-danger"}`}>
            {formatSignedPnl(numericValue)}
          </div>
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

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(err instanceof ApiError ? err.message : "Failed to load dashboard summary."))
      .finally(() => setSummaryLoading(false));
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
                    <div className="fw-bold">{formatSignedPnl(Number(summary.cumulativeRealizedPnl))}</div>
                  </div>
                  <div className="col-12 col-sm-4">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                      Unrealized P&L (cumulative)
                    </div>
                    <div className="fw-bold">{formatSignedPnl(Number(summary.cumulativeUnrealizedPnl))}</div>
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
                        Realized {formatSignedPnl(Number(row.realizedPnl))} &middot; Unrealized{" "}
                        {formatSignedPnl(Number(row.unrealizedPnl))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

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
                  data: history.map((point) => ({ x: point.snapshotDate, y: Number(point.dailyPnl ?? 0) })),
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
