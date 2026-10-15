import { useState } from "react";
import { Link } from "react-router-dom";
import type { AnalysisSessionRow } from "../../../api/backtestAnalysis";
import { analysisSignedClass } from "../../../lib/analysisPresentation";
import { formatDayMonthYear, formatPercentage, formatSignedPercentage } from "../../../lib/formatters";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { Spinner } from "../../Spinner";
import { BacktestCardTitle } from "../backtestBits";

// Backtest results (mockup approved 2026-10-15): the ticker's sessions of two years or more, read live (new sessions
// appear without updating the analysis), the ticker alone and with other tickers, best CAGR first, every header sortable.

const groupLimits = { single: 8, multi: 4 };

function sessionColumns(analysisSessionId: string | null): DataTableColumn<AnalysisSessionRow>[] {
  return [
    {
      key: "name",
      header: "Session",
      sortValue: (row) => row.name,
      cellClassName: "analysis-session-cell",
      render: (row) => (
        <span className="d-inline-flex flex-wrap align-items-center gap-1">
          <Link to={`/backtest/sessions/${row.id}`} className="analysis-link">
            {row.name}
          </Link>
          {row.ladder && (
            <span className="badge bg-azure text-azure-fg" style={{ fontSize: "0.72rem" }}>
              CC + Put Ladder
            </span>
          )}
          {row.id === analysisSessionId && (
            <span className="badge bg-success text-success-fg" style={{ fontSize: "0.72rem" }}>
              This analysis's backtest
            </span>
          )}
          {row.symbols.length > 1 && (
            <span className="badge bg-secondary text-secondary-fg" style={{ fontSize: "0.72rem" }}>
              {row.symbols.length} tickers
            </span>
          )}
        </span>
      ),
    },
    { key: "period", header: "Period", sortValue: (row) => `${row.startDate}${row.endDate}`, cellClassName: "font-mono text-secondary text-nowrap", render: (row) => `${row.startDate} → ${row.endDate}` },
    { key: "shares", header: "Shares", align: "right", sortValue: (row) => row.sharesPct, render: (row) => (row.sharesPct === null ? "—" : `${row.sharesPct}%`) },
    { key: "cagr", header: "CAGR", align: "right", sortValue: (row) => row.cagr, render: (row) => <span className={analysisSignedClass(row.cagr)}>{formatSignedPercentage(row.cagr)}</span> },
    { key: "maxDrawdown", header: "Max drawdown", align: "right", sortValue: (row) => row.maxDrawdown, render: (row) => formatPercentage(row.maxDrawdown) },
    { key: "totalReturn", header: "Total return", align: "right", sortValue: (row) => row.totalReturn, render: (row) => <span className={analysisSignedClass(row.totalReturn)}>{formatSignedPercentage(row.totalReturn, 0)}</span> },
    { key: "buyAndHoldCagr", header: "Buy-and-hold CAGR", align: "right", sortValue: (row) => row.buyAndHoldCagr, render: (row) => formatSignedPercentage(row.buyAndHoldCagr) },
    { key: "buyAndHoldMaxDrawdown", header: "Buy-and-hold Max drawdown", align: "right", sortValue: (row) => row.buyAndHoldMaxDrawdown, render: (row) => formatPercentage(row.buyAndHoldMaxDrawdown) },
    { key: "excessCalmar", header: "Excess Calmar", align: "right", sortValue: (row) => row.excessCalmar, render: (row) => (row.excessCalmar === null ? "—" : row.excessCalmar.toFixed(2)) },
    { key: "created", header: "Created", sortValue: (row) => row.createdAt, cellClassName: "font-mono text-secondary text-nowrap", render: (row) => formatDayMonthYear(row.createdAt.slice(0, 10)) },
  ];
}

interface AnalysisSessionsCardProps {
  symbol: string;
  sessions: AnalysisSessionRow[] | null;
  loadError: string | null;
  analysisSessionId: string | null;
}

export function AnalysisSessionsCard({ symbol, sessions, loadError, analysisSessionId }: AnalysisSessionsCardProps) {
  const [showAll, setShowAll] = useState({ single: false, multi: false });
  const columns = sessionColumns(analysisSessionId);
  if (loadError) return <div className="alert alert-danger mb-0">{loadError}</div>;
  if (!sessions) {
    return (
      <div className="card">
        <div className="card-body d-flex justify-content-center py-4">
          <Spinner label="Loading the backtests" />
        </div>
      </div>
    );
  }
  const group = (which: "single" | "multi") => {
    const rows = sessions.filter((row) => (which === "single" ? row.symbols.length === 1 : row.symbols.length > 1));
    const limit = groupLimits[which];
    const all = showAll[which];
    const shown = all ? rows : [...rows].sort((a, b) => b.cagr - a.cagr).slice(0, limit);
    const title = which === "single" ? `${symbol} alone` : "With other tickers";
    const description = (
      <>
        {rows.length === 0 ? "none" : all ? `all ${rows.length}` : `the best ${shown.length} by CAGR of ${rows.length}`}
        {which === "multi" && " · the whole session's figures, not this ticker's share"}
        {rows.length > limit && (
          <>
            {" "}
            <button type="button" className="analysis-link" onClick={() => setShowAll({ ...showAll, [which]: !all })}>
              {all ? `Show the best ${limit}` : `Show all ${rows.length}`}
            </button>
          </>
        )}
      </>
    );
    return (
      <DataTable
        key={which}
        tableId="analysis-backtest-results"
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        toolbar={<BacktestCardTitle title={title} description={description} />}
        emptyMessage={which === "single" ? `No session of 2 years or more runs ${symbol} alone.` : `No session of 2 years or more runs ${symbol} with other tickers.`}
        defaultSort={{ key: "cagr", direction: "desc" }}
        dense
      />
    );
  };
  return (
    <div className="d-flex flex-column gap-2">
      <BacktestCardTitle title="Backtest results" description={`Sessions of 2 years or more that include ${symbol}, best CAGR first. Click a column to sort.`} />
      {group("single")}
      {group("multi")}
      <p className="text-secondary mb-0" style={{ fontSize: "0.75rem" }}>
        Read live from the Sessions list, so new sessions appear without updating the analysis. Excess Calmar = (CAGR − the period's T-bill CAGR) ÷ |Max drawdown|, the T-bill compounded as the engine credits interest. CC + Put Ladder: a new Covered Call entry with Puts on the reserve.
      </p>
    </div>
  );
}
