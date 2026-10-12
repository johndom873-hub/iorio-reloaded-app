import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BacktestJobView, BacktestSessionListItem } from "../../api/backtest";
import { formatBrowserClockTime, formatBrowserDayMonth, formatNumber, formatPercentage, formatRatio } from "../../lib/formatters";
import { backtestMetricExplanation, describeOverrideCount, jobProgressFraction } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCard, BacktestCardTitle, BacktestJobStatusBadge, SignedPercent } from "./backtestBits";

interface BacktestSessionsTableProps {
  sessions: BacktestSessionListItem[];
  jobs: BacktestJobView[];
}

const minimumSessionsToCompare = 2;

/** Sessions: each keeps its settings, period and every day's result; tick two or more finished ones to compare. */
export function BacktestSessionsTable({ sessions, jobs }: BacktestSessionsTableProps) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedFinishedIds = sessions.filter((session) => session.status === "succeeded" && selectedIds.has(session.id)).map((session) => session.id);

  const toggleSelected = (sessionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const jobForSession = (sessionId: string) => jobs.find((job) => job.sessionId === sessionId) ?? null;

  const columns: DataTableColumn<BacktestSessionListItem>[] = [
    {
      key: "select",
      header: "",
      render: (session) => (
        <label className="backtest-checkbox-hit">
          <input
            type="checkbox"
            className="form-check-input m-0"
            aria-label={`Select ${session.name} to compare`}
            disabled={session.status !== "succeeded"}
            checked={selectedIds.has(session.id) && session.status === "succeeded"}
            onChange={() => toggleSelected(session.id)}
          />
        </label>
      ),
    },
    {
      key: "session",
      header: "Session",
      render: (session) => (
        <span>
          <Link to={`/backtest/sessions/${session.id}`} className="fw-semibold text-decoration-none">
            {session.name}
          </Link>{" "}
          <span className="text-secondary">{session.symbol}</span>
        </span>
      ),
    },
    { key: "period", header: "Period", cellClassName: "font-mono text-secondary text-nowrap", render: (session) => `${session.startDate} → ${session.endDate}` },
    {
      key: "changes",
      header: "Changed vs Pluto",
      headerTitle: "How many of Pluto's settings the session changed for itself; the session's page lists them.",
      render: (session) => (
        <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
          {describeOverrideCount(session.overrideCount)}
        </span>
      ),
    },
    {
      key: "totalReturn",
      header: "Total return",
      headerTitle: backtestMetricExplanation.totalReturn,
      align: "right",
      render: (session) => <SignedPercent fraction={session.metrics?.totalReturn} />,
    },
    { key: "cagr", header: "CAGR", headerTitle: backtestMetricExplanation.cagr, align: "right", render: (session) => <SignedPercent fraction={session.metrics?.cagr} /> },
    { key: "sortino", header: "Sortino", headerTitle: backtestMetricExplanation.sortino, align: "right", render: (session) => formatRatio(session.metrics?.sortino, 2) },
    {
      key: "maxDrawdown",
      header: "Max drawdown",
      headerTitle: backtestMetricExplanation.maxDrawdown,
      align: "right",
      render: (session) => <SignedPercent fraction={session.metrics?.maxDrawdown} />,
    },
    { key: "trades", header: "Trades", headerTitle: "Trades opened in the period.", align: "right", render: (session) => formatNumber(session.metrics?.tradeCount) },
    { key: "winRate", header: "Win rate", headerTitle: backtestMetricExplanation.winRate, align: "right", render: (session) => formatPercentage(session.metrics?.winRate, 0) },
    { key: "edgeCapture", header: "Edge capture", headerTitle: backtestMetricExplanation.edgeCapture, align: "right", render: (session) => formatRatio(session.metrics?.edgeCapture, 2) },
    {
      key: "run",
      header: "Run",
      render: (session) => {
        const job = jobForSession(session.id);
        const status = job?.displayStatus ?? session.status;
        const progress = job && (status === "running" || status === "stopped") ? formatPercentage(jobProgressFraction(job), 0) : null;
        return (
          <span className="d-inline-flex align-items-center gap-2 text-nowrap">
            <BacktestJobStatusBadge status={status} />
            <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
              {progress ?? `${formatBrowserDayMonth(session.createdAt)} ${formatBrowserClockTime(session.createdAt)}`}
            </span>
          </span>
        );
      },
    },
  ];

  const canCompare = selectedFinishedIds.length >= minimumSessionsToCompare;
  const title = "Sessions";
  const description = "Each keeps its settings, its period and every day's result. Tick two or more finished sessions to compare.";
  const actions = (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <button type="button" className="btn btn-outline-secondary" disabled={!canCompare} onClick={() => navigate(`/backtest/compare?ids=${selectedFinishedIds.join(",")}`)}>
        Compare selected ({selectedFinishedIds.length})
      </button>
      <Link to="/backtest/new" className="btn btn-primary">
        New session
      </Link>
    </div>
  );

  // No table without rows: a wide table's centred empty message lands off screen on a phone.
  if (sessions.length === 0) {
    return (
      <BacktestCard title={title} description={description} actions={actions}>
        <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
          No sessions yet. Start one with New session.
        </div>
      </BacktestCard>
    );
  }

  return (
    <DataTable
      tableId="backtest-sessions"
      columns={columns}
      rows={sessions}
      rowKey={(session) => session.id}
      dense
      toolbar={
        <>
          <BacktestCardTitle title={title} description={description} />
          {actions}
        </>
      }
      afterTable={
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          <strong>Total return</strong>: the account's growth over the period, after costs. <strong>CAGR</strong>: the same as a yearly rate on calendar time. <strong>Sortino</strong>: average daily return over the downside wobble, yearly. <strong>Max drawdown</strong>: the deepest fall from a peak. <strong>Edge capture</strong>: what the trades made ÷ the Edge $ the model predicted for them.
        </div>
      }
    />
  );
}
