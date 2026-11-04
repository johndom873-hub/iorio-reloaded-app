import type { PortfolioLibraryStatus, PortfolioSuggestion, PortfolioSuggestions } from "../../../api/backtestPortfolio";
import { formatDateTime, formatDayMonthYear, formatSignedNumber, pluralizeCount } from "../../../lib/formatters";
import { formatSignedPoints } from "../../../lib/portfolioSimulatorPresentation";
import { useTickingNow } from "../../../hooks/useTickingNow";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { BacktestCardTitle, BacktestJobProgress, BacktestSymbolLink } from "../backtestBits";
import { Spinner } from "../../Spinner";

interface PortfolioSuggestionsCardProps {
  library: PortfolioLibraryStatus | null;
  suggestions: PortfolioSuggestions | null;
  /** Suggestions are being worked out (the library's scores, then the exact confirmations). */
  running: boolean;
  error: string | null;
  rebuilding: boolean;
  onRebuild: () => void;
  onApply: (suggestion: PortfolioSuggestion) => void;
}

const kindLabel: Record<PortfolioSuggestion["kind"], string> = { drop: "Drop", add: "Add", halve: "Halve", double: "Double" };

function PlusMinus({ change, plusMinus, format }: { change: number; plusMinus: number; format: (value: number) => string }) {
  return (
    <span className="text-nowrap">
      {format(change)} <span className="text-secondary">± {format(plusMinus).replace(/^[+-]/, "")}</span>
    </span>
  );
}

const points = (fraction: number) => formatSignedPoints(fraction).replace(" pts", "");
const ratio = (value: number) => formatSignedNumber(value, 4);

/** The library's state: built for what, rebuilding with its progress, or not built; and Rebuild. */
function LibraryLine({ library, rebuilding, onRebuild }: { library: PortfolioLibraryStatus | null; rebuilding: boolean; onRebuild: () => void }) {
  const job = library?.rebuild ?? null;
  const now = useTickingNow(job?.heartbeatAt ?? null);
  const active = job !== null && (job.status === "queued" || job.status === "running");
  return (
    <div className="portfolio-library">
      <div className="portfolio-library-state">
        <strong>Library</strong>{" "}
        {library === null ? (
          <Spinner size="sm" label="Loading the library's state" />
        ) : library.built === null ? (
          <span className="text-secondary">not built yet</span>
        ) : (
          <span className="text-secondary">
            {pluralizeCount(library.built.tickers, "ticker")} · data to {formatDayMonthYear(library.built.asOf)} · built {formatDateTime(library.built.builtAt)}
            {library.current === false && <span className="iorio-note-amber"> · for other data, lab settings or code</span>}
            {library.updatedSince.length > 0 && <span className="iorio-note-amber"> · updated since: {library.updatedSince.join(", ")}</span>}
          </span>
        )}
      </div>
      {active && job && (
        <div className="portfolio-library-job">
          <BacktestJobProgress job={job} now={now} />
        </div>
      )}
      <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={active || rebuilding} onClick={onRebuild}>
        {rebuilding && <Spinner size="sm" />}
        {active ? "Rebuilding…" : "Rebuild"}
      </button>
    </div>
  );
}

/** One change at a time, scored on the library, the best 5 confirmed exactly; Apply puts a change's allocations in the book. */
export function PortfolioSuggestionsCard({ library, suggestions, running, error, rebuilding, onRebuild, onApply }: PortfolioSuggestionsCardProps) {
  const columns: DataTableColumn<PortfolioSuggestion>[] = [
    {
      key: "change",
      header: "Change",
      render: (row) => (
        <span className="d-inline-flex flex-wrap align-items-center gap-1">
          <span className="fw-semibold">{kindLabel[row.kind]}</span>
          <BacktestSymbolLink symbol={row.symbol} />
          {row.kind === "add" && row.allocationsPct[row.symbol] !== undefined && <span className="text-secondary">at {row.allocationsPct[row.symbol]!.toFixed(2)}%</span>}
          {(row.exact ?? row).withinNoise && <span className="badge bg-secondary-lt">within noise</span>}
        </span>
      ),
    },
    { key: "score", header: "Score (Δ Excess Calmar)", align: "right", render: (row) => <PlusMinus change={row.score.change} plusMinus={row.score.plusMinus} format={ratio} />, sortValue: (row) => row.score.change },
    { key: "cagr", header: "Δ CAGR (pts)", align: "right", render: (row) => <PlusMinus change={row.cagr.change} plusMinus={row.cagr.plusMinus} format={points} />, sortValue: (row) => row.cagr.change },
    { key: "maxDrawdown", header: "Δ Max drawdown (pts)", align: "right", render: (row) => <PlusMinus change={row.maxDrawdown.change} plusMinus={row.maxDrawdown.plusMinus} format={points} />, sortValue: (row) => row.maxDrawdown.change },
    {
      key: "exact",
      header: "Exact score",
      headerTitle: "The change projected exactly (500 paths, the shared account): the best 5 only",
      align: "right",
      render: (row) => (row.exact ? <PlusMinus change={row.exact.score.change} plusMinus={row.exact.score.plusMinus} format={ratio} /> : <span className="text-secondary">—</span>),
      sortValue: (row) => row.exact?.score.change ?? null,
    },
    {
      key: "apply",
      header: "",
      align: "right",
      render: (row) => (
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => onApply(row)}>
          Apply
        </button>
      ),
    },
  ];
  const stale = suggestions?.library.staleReasons ?? [];
  return (
    <DataTable
      tableId="portfolio-simulator-suggestions"
      columns={columns}
      rows={suggestions?.suggestions ?? []}
      rowKey={(row) => `${row.kind}-${row.symbol}`}
      loading={running && suggestions === null}
      emptyMessage={error ? "No suggestions: see the message above." : "Suggestions appear after a projection."}
      maxVisibleRows={12}
      toolbar={<BacktestCardTitle title="Suggestions · one change each" description="each change scored on the library, the best 5 then projected exactly; ± is 2 standard errors; within noise: the score is inside its ±" />}
      beforeTable={
        <div className="card-body py-2 border-bottom d-flex flex-column gap-2">
          <LibraryLine library={library} rebuilding={rebuilding} onRebuild={onRebuild} />
          {stale.length > 0 && <div className="iorio-note-amber" style={{ fontSize: "0.8rem" }}>Not current for this book: {stale.join("; ")}.</div>}
          {error && <div className="alert alert-danger mb-0">{error}</div>}
          {running && suggestions !== null && (
            <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
              <Spinner size="sm" />
              Confirming the best changes exactly
            </div>
          )}
        </div>
      }
    />
  );
}
