import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchBacktestSessionsPage, type BacktestSessionListItem, type BacktestSessionsPageQuery, type BacktestSessionStatusFilter } from "../../api/backtest";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePollWhileVisible } from "../../hooks/usePollWhileVisible";
import { formatBrowserClockTime, formatBrowserDayMonth, formatNumber, formatPercentage, formatRatio, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import {
  backtestCycleMetricExplanation,
  backtestMetricExplanation,
  describeOpenCyclesShort,
  describeOverrideCount,
  edgeCaptureEitherBasisExplanation,
  fastPollIntervalMs,
  idlePollIntervalMs,
  jobProgressFraction,
  jobStatusLabel,
} from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { BacktestCard, BacktestCardTitle, BacktestJobStatusBadge, SignedPercent } from "./backtestBits";
import { useBacktestBookPage } from "./useBacktestBookPage";

const minimumSessionsToCompare = 2;
const sessionsPerPage = 50;
/** The search box asks the API once typing has paused this long. */
const searchPauseMs = 300;
const statusFilters: BacktestSessionStatusFilter[] = ["succeeded", "running", "failed", "cancelled"];

/** Sessions, read page by page from the API (50 a page, newest first) and filtered by name, symbol and status: each keeps its
 *  settings, period and every day's result; tick two or more finished ones, on any page, to compare. */
export function BacktestSessionsTable() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<BacktestSessionStatusFilter | "">("");
  const searchAsked = useDebouncedValue(search.trim(), searchPauseMs);
  // The page offset belongs to the filters it was picked under: changing a filter starts again from the first page.
  const filtersKey = `${searchAsked}|${symbolFilter}|${statusFilter}`;
  const [pagePosition, setPagePosition] = useState({ filtersKey, offset: 0 });
  const offset = pagePosition.filtersKey === filtersKey ? pagePosition.offset : 0;
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchPage = useCallback(() => {
    const query: BacktestSessionsPageQuery = { limit: sessionsPerPage, offset };
    if (searchAsked) query.search = searchAsked;
    if (symbolFilter) query.symbol = symbolFilter;
    if (statusFilter) query.status = statusFilter;
    return fetchBacktestSessionsPage(query);
  }, [searchAsked, symbolFilter, statusFilter, offset]);
  const { page, error } = useBacktestBookPage(fetchPage, true, "Could not load the sessions.", refreshTick);
  // Every 2 s while a session on the page runs, every 15 s otherwise (new sessions come in on the first page).
  const pageRuns = page?.sessions.some((session) => session.latestRun?.displayStatus === "running" || session.latestRun?.displayStatus === "queued") ?? false;
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  usePollWhileVisible(refresh, pageRuns ? fastPollIntervalMs : idlePollIntervalMs);

  // A page past the end (sessions deleted meanwhile) moves back to the last one.
  useEffect(() => {
    if (page && page.total > 0 && offset >= page.total) setPagePosition({ filtersKey, offset: Math.floor((page.total - 1) / sessionsPerPage) * sessionsPerPage });
  }, [page, offset, filtersKey]);

  const sessions = page?.sessions ?? [];
  const selectedFinishedIds = [...selectedIds];

  const toggleSelected = (sessionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

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
      cellClassName: "backtest-session-name-cell",
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
      key: "cyclePnl",
      header: "Cycle P&L",
      headerTitle: `${backtestCycleMetricExplanation.cyclePnl} "—" until the run finishes, and on a session measured per option.`,
      align: "right",
      render: (session) => (session.wheelCycles ? <span className={`fw-semibold ${pnlTextClass(session.wheelCycles.totalPnlDollars)}`}>{formatSignedPnl(session.wheelCycles.totalPnlDollars, 0)}</span> : "—"),
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
    { key: "trades", header: "Options sold", headerTitle: backtestCycleMetricExplanation.optionsSold, align: "right", render: (session) => formatNumber(session.metrics?.tradeCount) },
    {
      key: "cycles",
      header: "Cycles",
      headerTitle: `${backtestCycleMetricExplanation.cycles} "—" on a session measured per option (run before cycles carried the P&L).`,
      align: "right",
      cellClassName: "text-nowrap",
      render: (session) => (session.wheelCycles ? `${formatNumber(session.wheelCycles.cycleCount)} · ${formatNumber(session.wheelCycles.openCycleCount)} open` : "—"),
    },
    {
      key: "winRate",
      header: "Win rate",
      headerTitle: `${backtestCycleMetricExplanation.winRate} Beside it: the open cycles and their P&L at the last marks. On a session measured per option: trades with P&L > 0 ÷ all closed trades.`,
      align: "right",
      cellClassName: "text-nowrap",
      render: (session) => (
        <div className="d-flex flex-column align-items-end">
          <span>{formatPercentage(session.metrics?.winRate, 0)}</span>
          {session.wheelCycles && (
            <span className="text-secondary" style={{ fontSize: "0.72rem" }}>
              {describeOpenCyclesShort(session.wheelCycles)}
            </span>
          )}
        </div>
      ),
    },
    { key: "edgeCapture", header: "Edge capture", headerTitle: edgeCaptureEitherBasisExplanation, align: "right", render: (session) => formatRatio(session.metrics?.edgeCapture, 2) },
    {
      key: "run",
      header: "Run",
      render: (session) => {
        const run = session.latestRun;
        const status = run?.displayStatus ?? session.status;
        const progress = run && (status === "running" || status === "stopped") ? formatPercentage(jobProgressFraction(run), 0) : null;
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
  const description = "Each keeps its settings, its period and every day's result. Tick two or more finished sessions, on any page, to compare.";
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

  // No table without rows: a wide table's centred empty message lands off screen on a phone. That is only when there is no
  // session at all; with a filter on, the table and its filters stay so the filter can be changed.
  const filtering = search.trim() !== "" || symbolFilter !== "" || statusFilter !== "";
  if (page !== null && page.total === 0 && !filtering) {
    return (
      <BacktestCard title={title} description={description} actions={actions}>
        <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
          No sessions yet. Start one with New session.
        </div>
      </BacktestCard>
    );
  }

  const filters = (
    <div className="d-flex flex-wrap align-items-center gap-2 w-100">
      <input type="search" className="form-control" style={{ width: "16rem" }} placeholder="Search names" aria-label="Search session names" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="form-select w-auto" aria-label="Symbol" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
        <option value="">All symbols</option>
        {(page?.symbols ?? []).map((symbol) => (
          <option key={symbol} value={symbol}>
            {symbol}
          </option>
        ))}
      </select>
      <select className="form-select w-auto" aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BacktestSessionStatusFilter | "")}>
        <option value="">All statuses</option>
        {statusFilters.map((status) => (
          <option key={status} value={status}>
            {jobStatusLabel[status]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <DataTable
      tableId="backtest-sessions"
      columns={columns}
      rows={sessions}
      rowKey={(session) => session.id}
      loading={page === null && error === null}
      emptyMessage={error ?? "No session matches the filters."}
      dense
      toolbar={
        <>
          <BacktestCardTitle title={title} description={description} />
          {actions}
          {filters}
        </>
      }
      afterTable={
        <>
          {page !== null && page.total > sessionsPerPage && (
            <div className="px-3 pb-3">
              <Pagination page={Math.floor(offset / sessionsPerPage) + 1} pageSize={sessionsPerPage} totalRows={page.total} onPageChange={(next) => setPagePosition({ filtersKey, offset: (next - 1) * sessionsPerPage })} />
            </div>
          )}
          <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
            <strong>Total return</strong>: the account's growth over the period, after costs. <strong>CAGR</strong>: the same as a yearly rate on calendar time. <strong>Sortino</strong>: average daily return over the downside wobble, yearly. <strong>Max drawdown</strong>: the deepest fall from a peak. <strong>Cycle P&amp;L</strong>: what the wheel cycles made, as the platform counts it. <strong>Edge capture</strong>: what the closed cycles made ÷ the Edge $ the model predicted for their options; the shares' gains count on purpose, so it can run above 1.0.
          </div>
        </>
      }
    />
  );
}
