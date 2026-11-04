import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";
import type { PortfolioBookTicker, PortfolioTickerListing } from "../../../api/backtestPortfolio";
import { formatPercentageValueTrimmed, pluralizeCount } from "../../../lib/formatters";
import { fitBadgeClass, fitLabel } from "../../../lib/portfolioSimulatorPresentation";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { BacktestCardTitle, BacktestSymbolLink } from "../backtestBits";
import { PortfolioAddTickerPicker } from "./PortfolioAddTickerPicker";

interface PortfolioBookCardProps {
  tickers: PortfolioBookTicker[];
  listing: PortfolioTickerListing[];
  /** Each ticker's allocation as the simulator counts it (an empty one as its equal share); null until known. */
  effectiveAllocationPct: Map<string, number> | null;
  allocationTotalPct: number | null;
  groupLabels: Map<string, string>;
  maxAllocationPct: number | null;
  /** Tickers Suggested allocations left out (too large for this account), after it was applied. */
  leftOut: string[];
  onChange: (tickers: PortfolioBookTicker[]) => void;
  onSuggestedAllocations: () => void;
  suggestedAvailable: boolean;
}

/** An allocation box: typed freely, applied on leaving it or Enter; empty means an equal share. */
function AllocationInput({ symbol, value, placeholder, onCommit }: { symbol: string; value: number | null; placeholder: number | null; onCommit: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const parsed = text.trim() === "" ? null : Number(text);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100);
  const commit = () => {
    if (invalid) return setText(value === null ? "" : String(value));
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <div className="input-group input-group-sm portfolio-allocation-input">
      <input
        className={`form-control text-end ${invalid ? "is-invalid" : ""}`}
        inputMode="decimal"
        aria-label={`${symbol} allocation`}
        placeholder={placeholder === null ? "" : placeholder.toFixed(2)}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
      <span className="input-group-text">%</span>
    </div>
  );
}

/** The book being edited: each ticker, its group, its fit and its allocation; tickers added and removed here. */
export function PortfolioBookCard({ tickers, listing, effectiveAllocationPct, allocationTotalPct, groupLabels, maxAllocationPct, leftOut, onChange, onSuggestedAllocations, suggestedAvailable }: PortfolioBookCardProps) {
  const verdictOf = new Map(listing.map((ticker) => [ticker.symbol, ticker.verdict]));
  const setAllocation = (symbol: string, allocationPct: number | null) => onChange(tickers.map((ticker) => (ticker.symbol === symbol ? { ...ticker, allocationPct } : ticker)));
  const columns: DataTableColumn<PortfolioBookTicker>[] = [
    { key: "ticker", header: "Ticker", render: (row) => <BacktestSymbolLink symbol={row.symbol} />, sortValue: (row) => row.symbol },
    {
      key: "group",
      header: "Group",
      render: (row) => (groupLabels.get(row.symbol) ? <span className="portfolio-group-chip">{groupLabels.get(row.symbol)}</span> : <span className="text-secondary">—</span>),
      sortValue: (row) => groupLabels.get(row.symbol) ?? null,
    },
    {
      key: "fit",
      header: "Fit",
      render: (row) => {
        const verdict = verdictOf.get(row.symbol) ?? null;
        return <span className={fitBadgeClass(verdict)}>{fitLabel(verdict)}</span>;
      },
      sortValue: (row) => verdictOf.get(row.symbol) ?? null,
    },
    {
      key: "allocation",
      header: "Allocation",
      render: (row) => <AllocationInput symbol={row.symbol} value={row.allocationPct} placeholder={effectiveAllocationPct?.get(row.symbol) ?? null} onCommit={(value) => setAllocation(row.symbol, value)} />,
      sortValue: (row) => effectiveAllocationPct?.get(row.symbol) ?? row.allocationPct,
    },
    {
      key: "remove",
      header: "",
      align: "right",
      render: (row) => (
        <button type="button" className="btn btn-ghost-secondary btn-icon btn-sm" aria-label={`Remove ${row.symbol}`} onClick={() => onChange(tickers.filter((ticker) => ticker.symbol !== row.symbol))}>
          <IconX size={16} aria-hidden="true" />
        </button>
      ),
    },
  ];
  const title = `Book · ${pluralizeCount(tickers.length, "ticker")}${allocationTotalPct !== null ? ` · ${formatPercentageValueTrimmed(allocationTotalPct, 1)} allocated` : ""}`;
  return (
    <DataTable
        tableId="portfolio-simulator-book"
        columns={columns}
        rows={tickers}
        rowKey={(row) => row.symbol}
        emptyMessage="No tickers yet: add the tickers to simulate."
        maxVisibleRows={16}
        toolbar={
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 w-100">
            <BacktestCardTitle title={title} />
            <div className="d-flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline-secondary" disabled={!suggestedAvailable} onClick={onSuggestedAllocations}>
                Suggested allocations
              </button>
              <PortfolioAddTickerPicker tickers={listing} inBook={tickers.map((ticker) => ticker.symbol)} onAdd={(symbol) => onChange([...tickers, { symbol, allocationPct: null }])} />
            </div>
          </div>
        }
        afterTable={
          <div className="card-footer text-secondary" style={{ fontSize: "0.8rem" }}>
            Empty: an equal share of what the set allocations leave. Suggested allocations: each ticker at the smallest share whose pot lets its rebalancing band act, or an equal share if larger
            {maxAllocationPct !== null ? `, at most ${maxAllocationPct}%` : ""}.
            {leftOut.length > 0 && <div className="iorio-note-amber mt-1">Left out as too large for this account: {leftOut.join(", ")}.</div>}
          </div>
        }
      />
  );
}
