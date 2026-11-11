import { useState } from "react";
import { Link } from "react-router-dom";
import type { AnalysisSessionRow } from "../../../api/backtestAnalysis";
import { analysisSignedClass } from "../../../lib/analysisPresentation";
import { browserLocalIsoDate, formatDayMonthYear, formatPercentage, formatSignedPercentage } from "../../../lib/formatters";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { Spinner } from "../../Spinner";
import { BacktestCardTitle } from "../backtestBits";

// Backtest results (mockup approved 2026-10-15; Vol Farmer v4's, 2026-11-01): the ticker's sessions of two years or more
// on it alone, read live (new sessions appear without updating the analysis), best CAGR first, every header sortable.

const shownLimit = 8;

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
          {row.id === analysisSessionId && (
            <span className="badge bg-blue text-blue-fg" style={{ fontSize: "0.72rem" }}>
              This analysis's backtest
            </span>
          )}
        </span>
      ),
    },
    { key: "cagr", header: "CAGR", align: "right", sortValue: (row) => row.cagr, render: (row) => <span className={analysisSignedClass(row.cagr)}>{formatPercentage(row.cagr)}</span> },
    { key: "maxDrawdown", header: "Max drawdown", align: "right", sortValue: (row) => row.maxDrawdown, render: (row) => formatPercentage(row.maxDrawdown) },
    { key: "totalReturn", header: "Total return", align: "right", sortValue: (row) => row.totalReturn, render: (row) => <span className={analysisSignedClass(row.totalReturn)}>{formatSignedPercentage(row.totalReturn, 0)}</span> },
    { key: "created", header: "Created", sortValue: (row) => row.createdAt, cellClassName: "font-mono text-secondary text-nowrap", render: (row) => formatDayMonthYear(browserLocalIsoDate(row.createdAt)) },
  ];
}

interface AnalysisSessionsCardProps {
  symbol: string;
  sessions: AnalysisSessionRow[] | null;
  loadError: string | null;
  analysisSessionId: string | null;
}

export function AnalysisSessionsCard({ symbol, sessions, loadError, analysisSessionId }: AnalysisSessionsCardProps) {
  const [showAll, setShowAll] = useState(false);
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
  const shown = showAll ? sessions : [...sessions].sort((a, b) => b.cagr - a.cagr).slice(0, shownLimit);
  const description = (
    <>
      Sessions of 2 years or more on {symbol} alone, best CAGR first{sessions.length > shownLimit && !showAll ? `: the best ${shownLimit} of ${sessions.length}` : ""}.
      {sessions.length > shownLimit && (
        <>
          {" "}
          <button type="button" className="analysis-link" onClick={() => setShowAll(!showAll)}>
            {showAll ? `Show the best ${shownLimit}` : `Show all ${sessions.length}`}
          </button>
        </>
      )}
    </>
  );
  return (
    <DataTable
      tableId="analysis-v4-backtest-results"
      columns={columns}
      rows={shown}
      rowKey={(row) => row.id}
      toolbar={<BacktestCardTitle title="Backtest results" description={description} />}
      emptyMessage={`No session of 2 years or more runs ${symbol} alone.`}
      defaultSort={{ key: "cagr", direction: "desc" }}
      dense
    />
  );
}
