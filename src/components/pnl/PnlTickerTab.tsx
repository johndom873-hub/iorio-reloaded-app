import { useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { errorMessage } from "../../api/client";
import { fetchTickerCycles, type AnalysisBook, type AnalysisDays, type PnlAnalysis, type TickerCycleAnalysis } from "../../api/pnlAnalysis";
import type { CycleBucketKey } from "../../api/positions";
import { useTickerModal } from "../../hooks/useTickerModal";
import { daysAgo, formatCurrency, formatDayMonth, formatSignedPercentageValue, formatSignedPnl, pnlTextClass, showsAsZeroDollars } from "../../lib/formatters";
import { strategyBadgeClass, strategyAbbrev, strategyKeyOfCycleBucket } from "../../lib/positionPnl";
import { analysisBuckets, bookChoiceLabels, tickerRows, type TickerAnalysisRow } from "../../lib/pnlAnalysisPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { PlutoManagedMark } from "../PlutoManagedMark";
import { Spinner } from "../Spinner";

function moneyColumn(key: string, header: string, headerTitle: string, valueOf: (row: TickerAnalysisRow) => number, bold = false): DataTableColumn<TickerAnalysisRow> {
  return {
    key,
    header,
    headerTitle,
    align: "right",
    sortValue: valueOf,
    render: (row) => {
      const value = valueOf(row);
      if (!bold && showsAsZeroDollars(value)) return "";
      return <span className={`${bold ? "fw-bold " : ""}${pnlTextClass(value)}`}>{formatSignedPnl(value, 0)}</span>;
    },
  };
}

// One ticker's cycles over the range, each strategy's share, a row per book for a cycle that changed book.
function TickerCycles({ symbol, book, days }: { symbol: string; book: AnalysisBook; days: AnalysisDays }) {
  const { open: openTickerModal } = useTickerModal();
  const [state, setState] = useState<{ analysis: TickerCycleAnalysis | null; error: string | null }>({ analysis: null, error: null });
  useEffect(() => {
    let current = true;
    fetchTickerCycles(symbol, book, { from: days.from, to: days.to })
      .then((analysis) => current && setState({ analysis, error: null }))
      .catch((error: unknown) => current && setState({ analysis: null, error: errorMessage(error, "Couldn't load the cycles.") }));
    return () => {
      current = false;
    };
  }, [symbol, book, days.from, days.to]);
  if (state.error) return <div className="alert alert-danger mb-0">{state.error}</div>;
  if (!state.analysis) return <Spinner size="sm" label={`Loading the cycles of ${symbol}`} />;
  const cycles = new Map<string, { startedAt: string; endedAt: string | null; status: "open" | "closed"; book: string; totals: Partial<Record<CycleBucketKey, number>>; total: number; flagReasons: string[] }>();
  for (const row of state.analysis.rows) {
    const key = `${row.cycleStartedAt}|${row.book}`;
    const cycle = cycles.get(key) ?? { startedAt: row.cycleStartedAt, endedAt: row.cycleEndedAt, status: row.status, book: bookChoiceLabels[row.book], totals: {}, total: 0, flagReasons: [] };
    cycle.totals[row.bucket] = (cycle.totals[row.bucket] ?? 0) + row.total + row.flaggedChange;
    cycle.total += row.total + row.flaggedChange;
    cycle.flagReasons = [...new Set([...cycle.flagReasons, ...row.flagReasons])];
    cycles.set(key, cycle);
  }
  const list = [...cycles.values()].sort((first, second) => second.startedAt.localeCompare(first.startedAt));
  if (list.length === 0) return <div className="text-secondary">No cycle of {symbol} had P&amp;L in this period.</div>;
  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0" style={{ background: "transparent" }}>
        <thead>
          <tr>
            <th>Cycle</th>
            <th>Book</th>
            {analysisBuckets.map((bucket) => (
              <th key={bucket} className="text-end">{strategyAbbrev(strategyKeyOfCycleBucket(bucket))}</th>
            ))}
            <th className="text-end">P&amp;L</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((cycle) => (
            <tr key={`${cycle.startedAt}-${cycle.book}`}>
              <td className="text-nowrap">
                {formatDayMonth(cycle.startedAt.slice(0, 10))} → {cycle.endedAt ? formatDayMonth(cycle.endedAt.slice(0, 10)) : "today"} · {daysAgo(cycle.startedAt) - (cycle.endedAt ? daysAgo(cycle.endedAt) : 0)} d{" "}
                <span className={`badge ${cycle.status === "open" ? "bg-green-lt" : "bg-secondary-lt"}`} style={{ fontSize: "0.72rem" }}>{cycle.status}</span>
                {cycle.flagReasons.length > 0 && <div className="text-secondary" style={{ fontSize: "0.72rem" }}>Incomplete data: {cycle.flagReasons.join("; ")}</div>}
              </td>
              <td>{cycle.book}</td>
              {analysisBuckets.map((bucket) => {
                const value = cycle.totals[bucket];
                return <td key={bucket} className={`text-end ${value === undefined ? "" : pnlTextClass(value)}`}>{value === undefined || showsAsZeroDollars(value) ? "" : formatSignedPnl(value, 0)}</td>;
              })}
              <td className={`text-end fw-bold ${pnlTextClass(cycle.total)}`}>{formatSignedPnl(cycle.total, 0)}</td>
              <td className="text-end">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => openTickerModal(symbol)} title="Opens the Ticker modal; its Cycle card has each cycle's timeline">
                  Timeline
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The P&L Analyser's By ticker tab (mockup approved 2026-11-13): each ticker's strategies by component, expanding to its cycles.
export function PnlTickerTab({ analysis, book, days }: { analysis: PnlAnalysis; book: AnalysisBook; days: AnalysisDays }) {
  const [search, setSearch] = useState("");
  const [strategyFilter, setStrategyFilter] = useState<Set<CycleBucketKey>>(new Set());
  const [openOnly, setOpenOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { open: openTickerModal } = useTickerModal();
  const bookAnalysis = analysis.books[book];
  const allRows = useMemo(() => tickerRows(analysis, bookAnalysis), [analysis, bookAnalysis]);
  const query = search.trim().toUpperCase();
  const rows = allRows.filter((row) => (!query || row.symbol.includes(query)) && (strategyFilter.size === 0 || row.strategies.some((bucket) => strategyFilter.has(bucket))) && (!openOnly || row.hasOpenCycle));
  const calendarDays = bookAnalysis.risk?.calendarDays ?? 0;
  const toggleExpanded = (symbol: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });

  const columns: DataTableColumn<TickerAnalysisRow>[] = [
    {
      key: "symbol",
      header: "Ticker",
      headerTitle: "Expand a row for its cycles",
      sortValue: (row) => row.symbol,
      freezeOnPhone: true,
      render: (row) => (
        <span className="text-nowrap">
          <button type="button" className="pnl-row-toggle me-1" aria-expanded={expanded.has(row.symbol)} aria-label={`${expanded.has(row.symbol) ? "Hide" : "Show"} the cycles of ${row.symbol}`} onClick={() => toggleExpanded(row.symbol)}>
            {expanded.has(row.symbol) ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold iorio-symbol-link" onClick={() => openTickerModal(row.symbol)}>
            {row.symbol}
          </button>
          <PlutoManagedMark symbol={row.symbol} managed={row.plutoTrades} />
        </span>
      ),
    },
    { key: "book", header: "Book", headerTitle: "The book the ticker was in on the nights counted", sortValue: (row) => row.bookLabel, render: (row) => row.bookLabel },
    { key: "strategies", header: "Strategies", headerTitle: "Strategies with P&L in the period", render: (row) => <span className="d-inline-flex gap-1">{row.strategies.map((bucket) => <CycleBucketBadge key={bucket} bucket={bucket} />)}</span> },
    moneyColumn("total", "P&L", "Strategies plus dividends; commissions included", (row) => row.total, true),
    moneyColumn("putPremium", "Put premium", "Puts sold less bought back, before commissions", (row) => row.putPremium),
    moneyColumn("callPremium", "Call premium", "Calls sold less bought back, before commissions", (row) => row.callPremium),
    moneyColumn("stock", "Stock", "Shares, including the assignment charge of an assigned put", (row) => row.stock),
    moneyColumn("leaps", "LEAPS", "Bought calls of a LEAPS position", (row) => row.leaps),
    moneyColumn("hedge", "Hedge", "Bought puts", (row) => row.hedge),
    moneyColumn("commissions", "Commissions", "IBKR commissions on the fills", (row) => row.commissions),
    moneyColumn("dividends", "Dividends", "Dividends less withholding tax", (row) => row.dividends),
    moneyColumn("realized", "Realised", "Closed: P&L less the change in what is still open", (row) => row.realized),
    moneyColumn("unrealized", "Unrealised", "Change in the marks of what is still open", (row) => row.unrealized),
    { key: "averageCapital", header: "Avg capital", headerTitle: "Capital in use, averaged over the calendar days", align: "right", sortValue: (row) => row.averageCapital, render: (row) => (row.averageCapital === null ? "" : formatCurrency(row.averageCapital, 0)) },
    {
      key: "returnOnCapital",
      header: "RoC (ann.)",
      headerTitle: "P&L ÷ (Σ daily capital ÷ 365), from 90 days",
      align: "right",
      sortValue: (row) => row.returnOnCapital,
      render: (row) => (row.capitalDays <= 0 ? "" : row.returnOnCapital === null ? <span className="text-secondary" title={`${calendarDays} of 90 days`}>—</span> : <span className={pnlTextClass(row.returnOnCapital)}>{formatSignedPercentageValue(row.returnOnCapital, 1)}</span>),
    },
    { key: "cycleCount", header: "Cycles", headerTitle: "Cycles held during the period", align: "right", sortValue: (row) => row.cycleCount, render: (row) => row.cycleCount },
  ];
  const sum = (pick: (row: TickerAnalysisRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const moneyFooter = (value: number) => <span className={pnlTextClass(value)}>{formatSignedPnl(value, 0)}</span>;

  return (
    <>
      <DataTable
        embedded
        tableId="pnl-analysis-tickers"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.symbol}
        defaultSort={{ key: "total", direction: "desc" }}
        emptyMessage={allRows.length === 0 ? `No ticker had P&L in the ${bookChoiceLabels[book]} book in this period.` : "No ticker matches the filters."}
        toolbar={
          <div className="d-flex flex-wrap align-items-center gap-2">
            <label className="visually-hidden" htmlFor="pnl-ticker-search">Search tickers</label>
            <input id="pnl-ticker-search" className="form-control" style={{ width: "11rem" }} placeholder="Search ticker" value={search} onChange={(event) => setSearch(event.target.value)} />
            <span className="text-secondary" style={{ fontSize: "0.8rem" }}>Strategies</span>
            {analysisBuckets.map((bucket) => {
              const active = strategyFilter.has(bucket);
              return (
                <button
                  key={bucket}
                  type="button"
                  className={`btn btn-sm ${active ? strategyBadgeClass(strategyKeyOfCycleBucket(bucket)) : "btn-outline-secondary"}`}
                  aria-pressed={active}
                  style={{ fontSize: "0.72rem" }}
                  onClick={() =>
                    setStrategyFilter((current) => {
                      const next = new Set(current);
                      if (active) next.delete(bucket);
                      else next.add(bucket);
                      return next;
                    })
                  }
                >
                  {strategyAbbrev(strategyKeyOfCycleBucket(bucket))}
                </button>
              );
            })}
            <label className="form-check mb-0 ms-2" style={{ fontSize: "0.85rem" }}>
              <input className="form-check-input" type="checkbox" checked={openOnly} onChange={() => setOpenOnly((value) => !value)} />
              <span className="form-check-label">Open cycles only</span>
            </label>
          </div>
        }
        extraRows={(row) => (expanded.has(row.symbol) ? { after: [{ key: `${row.symbol}-cycles`, className: "pnl-cycles-row", content: <TickerCycles symbol={row.symbol} book={book} days={days} /> }] } : null)}
        footerCells={{
          symbol: `${rows.length} tickers`,
          total: moneyFooter(sum((row) => row.total)),
          putPremium: moneyFooter(sum((row) => row.putPremium)),
          callPremium: moneyFooter(sum((row) => row.callPremium)),
          stock: moneyFooter(sum((row) => row.stock)),
          leaps: moneyFooter(sum((row) => row.leaps)),
          hedge: moneyFooter(sum((row) => row.hedge)),
          commissions: moneyFooter(sum((row) => row.commissions)),
          dividends: moneyFooter(sum((row) => row.dividends)),
          realized: moneyFooter(sum((row) => row.realized)),
          unrealized: moneyFooter(sum((row) => row.unrealized)),
          cycleCount: sum((row) => row.cycleCount),
        }}
      />
      <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
        The ticker rows add up to the strategies' total; interest, fees and Unexplained are not any ticker's (see Attribution).
      </div>
    </>
  );
}
