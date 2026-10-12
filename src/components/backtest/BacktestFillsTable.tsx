import { useCallback, useMemo, useState } from "react";
import { fetchBacktestSessionFills, type BacktestBookPageQuery, type BacktestFill, type BacktestPosition, type BacktestPositionLeg } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatCurrency, formatEasternTime, formatNumber, formatQuotePrice, pluralizeCount } from "../../lib/formatters";
import { describeFillInstrument, emptyBookFilters, fillDollars, priceScaleNote, type BacktestBookFilterValues } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { Spinner } from "../Spinner";
import { BacktestBookFilters } from "./BacktestBookFilters";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";
import { useBacktestBookPage } from "./useBacktestBookPage";

const fillsPerPage = 50;

interface BacktestFillsTableProps {
  sessionId: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  fillCount: number;
  /** The session's book: a fill names only its leg, so the option's contract comes from here. */
  positions: BacktestPosition[];
}

/** Every simulated fill (options sold or bought back, shares bought or sold, shares put to the book at the strike), read page by
 *  page from the session's fills endpoint (50 a page), filtered by symbol and dates. Collapsible (remembered in this browser);
 *  nothing is read while collapsed. */
export function BacktestFillsTable({ sessionId, symbols, startDate, endDate, fillCount, positions }: BacktestFillsTableProps) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-fills", true);
  const [filters, setFilters] = useState<BacktestBookFilterValues>(emptyBookFilters);
  const [offset, setOffset] = useState(0);
  const legById = useMemo(() => new Map<string, BacktestPositionLeg>(positions.flatMap((position) => position.legs.map((leg) => [leg.legId, leg] as const))), [positions]);

  const fetchPage = useCallback(() => {
    const query: BacktestBookPageQuery = { limit: fillsPerPage, offset };
    if (filters.symbol) query.symbol = filters.symbol;
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
    return fetchBacktestSessionFills(sessionId, query);
  }, [sessionId, filters, offset]);
  const { page, loading, error } = useBacktestBookPage(fetchPage, isOpen && fillCount > 0, "Could not load the fills.", fillCount);

  const title = "Fills";
  const description = `${pluralizeCount(fillCount, "fill")} · in the order they executed`;
  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

  if (!isOpen || fillCount === 0) {
    return (
      <BacktestCard title={title} description={fillCount === 0 ? "no fill stored (a session run before fills were kept, or none yet)" : description} actions={fillCount === 0 ? undefined : toggle} className="mt-3">
        {null}
      </BacktestCard>
    );
  }

  const columns: DataTableColumn<BacktestFill>[] = [
    { key: "day", header: "Day", headerTitle: "The Eastern date it executed on (a settlement's is the expiry date).", cellClassName: "font-mono text-nowrap", render: (fill) => fill.tradingDate },
    { key: "time", header: "Time", cellClassName: "font-mono text-nowrap", render: (fill) => formatEasternTime(fill.executedAt) },
    { key: "symbol", header: "Symbol", cellClassName: "fw-semibold", render: (fill) => fill.symbol },
    {
      key: "type",
      header: "Type",
      render: (fill) => (fill.instrument === "stock" ? <span className="badge bg-teal text-teal-fg">Stock</span> : <span className="badge bg-pink text-pink-fg">Option</span>),
    },
    { key: "side", header: "Side", render: (fill) => (fill.side === "buy" ? "Buy" : "Sell") },
    {
      key: "contract",
      header: "Contract",
      cellClassName: "text-nowrap",
      render: (fill) => {
        const scaleNote = priceScaleNote(fill.priceScale);
        return (
          <>
            {describeFillInstrument(fill, legById.get(fill.legId))}
            {scaleNote && <span className="text-secondary"> · {scaleNote}</span>}
          </>
        );
      },
    },
    { key: "qty", header: "Qty", headerTitle: "Contracts or shares.", align: "right", render: (fill) => formatNumber(fill.quantity) },
    { key: "price", header: "Price", headerTitle: "Per share, on the price scale of the leg's wheel cycle (as traded unless a split fell inside the cycle before the fill).", align: "right", render: (fill) => formatQuotePrice(fill.price) },
    { key: "dollars", header: "Amount", headerTitle: "Price × quantity × shares per contract: what the fill traded, before its commission.", align: "right", render: (fill) => formatCurrency(fillDollars(fill), 0) },
    { key: "commission", header: "Commission", align: "right", render: (fill) => formatCurrency(fill.commissionDollars, 2) },
    { key: "opensOrCloses", header: "Opens / closes", render: (fill) => (fill.isClosing ? "Closes" : "Opens") },
    {
      key: "cause",
      header: "Cause",
      headerTitle: "Pluto's action, or a settlement at expiry (an option expiring or assigned, shares put to the book or called away).",
      render: (fill) => (fill.actionId === null ? <span className="text-secondary">Settlement</span> : "Action"),
    },
  ];

  const changeFilters = (next: BacktestBookFilterValues) => {
    setFilters(next);
    setOffset(0);
  };

  return (
    <div className="mt-3">
      <DataTable
        tableId="backtest-fills"
        columns={columns}
        rows={page?.fills ?? []}
        rowKey={(fill) => fill.fillId}
        loading={loading && page === null}
        emptyMessage={error ?? "No fill matches the filters."}
        dense
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            <div className="d-flex flex-wrap align-items-center gap-2">
              <BacktestBookFilters idPrefix="backtest-fills" values={filters} onChange={changeFilters} symbols={symbols} startDate={startDate} endDate={endDate} />
              {toggle}
            </div>
          </>
        }
        beforeTable={
          error && page !== null ? (
            <div className="alert alert-danger m-3 mb-0" role="alert">
              {error}
            </div>
          ) : null
        }
        afterTable={
          <div className="px-3 pb-3">
            {loading && page !== null && (
              <div className="pt-2">
                <Spinner size="sm" label="Loading the page" />
              </div>
            )}
            <Pagination page={Math.floor(offset / fillsPerPage) + 1} pageSize={fillsPerPage} totalRows={page?.total ?? 0} onPageChange={(next) => setOffset((next - 1) * fillsPerPage)} />
          </div>
        }
      />
    </div>
  );
}
