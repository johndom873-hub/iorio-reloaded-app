import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { fetchBacktestSessionActions, type BacktestAction, type BacktestBookPageQuery } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatNumber, formatQuotePrice } from "../../lib/formatters";
import { actionKindLabel, describeActionLook, describeGateSummary, emptyBookFilters, failedGateOf, flattenCandidateScores, type BacktestBookFilterValues } from "../../lib/backtestPresentation";
import { gateLabel, sentenceCase } from "../../lib/plutoPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { Spinner } from "../Spinner";
import { BacktestBookFilters } from "./BacktestBookFilters";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";
import { useBacktestBookPage } from "./useBacktestBookPage";

const actionsPerPage = 50;

type OutcomeFilter = "" | "filled" | "blocked";

function OutcomeBadge({ outcome }: { outcome: BacktestAction["outcome"] }) {
  return outcome === "filled" ? <span className="badge bg-success text-success-fg">Filled</span> : <span className="badge bg-danger text-danger-fg">Blocked</span>;
}

/** One action in full: what it was, why it was chosen, every gate it went through, and the figures Pluto had on it.
 *  Informational: closes on Escape, the backdrop or the close button. */
function BacktestActionDetailsModal({ action, onClose }: { action: BacktestAction; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const scores = flattenCandidateScores(action.candidateScores);
  const closeOnBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} onClick={closeOnBackdrop} />
      <div className="modal show d-block" style={{ zIndex: 1050 }} role="dialog" aria-modal="true" aria-labelledby="backtest-action-title" onClick={closeOnBackdrop}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 id="backtest-action-title" className="modal-title d-inline-flex flex-wrap align-items-center gap-2">
                {actionKindLabel[action.kind]} · {action.symbol}
                <OutcomeBadge outcome={action.outcome} />
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body" style={{ fontSize: "0.85rem" }}>
              <div className="text-secondary mb-2 font-mono" style={{ fontSize: "0.8rem" }}>
                {action.tradingDate} · look at {describeActionLook(action)}
                {action.automatic ? " · automatic" : ""}
              </div>
              <p className="mb-2">{action.description}</p>
              <p className="mb-2">
                <span className="text-secondary">Chosen because: </span>
                {action.chosenBecause}
              </p>
              {action.blockReason && (
                <p className="mb-2 text-danger">
                  <span className="fw-semibold">Refused: </span>
                  {action.blockReason}
                </p>
              )}
              {(action.quantity !== null || action.fillPrice !== null) && (
                <p className="mb-2 font-mono">
                  {action.quantity !== null && <>Qty {formatNumber(action.quantity)}</>}
                  {action.limitPrice !== null && <> · limit {formatQuotePrice(action.limitPrice)}</>}
                  {action.fillPrice !== null && <> · filled at {formatQuotePrice(action.fillPrice)}</>}
                </p>
              )}
              <h4 className="subheader mt-3 mb-2">
                Gates · {action.gateResults.filter((gate) => gate.ok).length} of {action.gateResults.length} passed
              </h4>
              {action.gateResults.length === 0 ? (
                <div className="text-secondary">No gate ran.</div>
              ) : (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  {action.gateResults.map((gate) => (
                    <li key={gate.gate} className="d-flex gap-2 align-items-start">
                      {gate.ok ? <IconCheck size={16} className="text-success flex-shrink-0 mt-1" aria-label="passed" /> : <IconX size={16} className="text-danger flex-shrink-0 mt-1" aria-label="refused" />}
                      <span>
                        <span className={`fw-semibold${gate.ok ? "" : " text-danger"}`}>{gateLabel(gate.gate)}</span>
                        <span className="text-secondary text-break"> {sentenceCase(gate.detail)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {scores.length > 0 && (
                <>
                  <h4 className="subheader mt-3 mb-2">What Pluto had on it</h4>
                  <dl className="row mb-0 font-mono" style={{ fontSize: "0.75rem" }}>
                    {scores.map((line) => (
                      <div key={line.label} className="col-12 col-md-6 d-flex justify-content-between gap-2 border-bottom py-1">
                        <dt className="fw-normal text-secondary text-break">{line.label}</dt>
                        <dd className="mb-0 text-end text-break">{line.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

interface BacktestActionsLogProps {
  sessionId: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  filledCount: number;
  blockedCount: number;
}

/** What Pluto did or tried at each look, filled and blocked, with the gate that refused each blocked one; read page by page
 *  from the session's actions endpoint (50 a page), filtered by outcome, symbol and dates. A row's gates open its details.
 *  Collapsible (remembered in this browser); nothing is read while collapsed. */
export function BacktestActionsLog({ sessionId, symbols, startDate, endDate, filledCount, blockedCount }: BacktestActionsLogProps) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-actions-log", true);
  const [outcome, setOutcome] = useState<OutcomeFilter>("");
  const [filters, setFilters] = useState<BacktestBookFilterValues>(emptyBookFilters);
  const [offset, setOffset] = useState(0);
  const [openedAction, setOpenedAction] = useState<BacktestAction | null>(null);
  const storedCount = filledCount + blockedCount;

  const fetchPage = useCallback(() => {
    const query: BacktestBookPageQuery = { limit: actionsPerPage, offset };
    if (outcome) query.outcome = outcome;
    if (filters.symbol) query.symbol = filters.symbol;
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
    return fetchBacktestSessionActions(sessionId, query);
  }, [sessionId, outcome, filters, offset]);
  const { page, loading, error } = useBacktestBookPage(fetchPage, isOpen && storedCount > 0, "Could not load the actions.", storedCount);

  const title = "Actions log";
  const description = `${formatNumber(filledCount)} filled · ${formatNumber(blockedCount)} blocked · every look, in order`;
  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

  if (!isOpen || storedCount === 0) {
    return (
      <BacktestCard title={title} description={storedCount === 0 ? "no action stored (a session run before actions were kept, or none yet)" : description} actions={storedCount === 0 ? undefined : toggle} className="mt-3">
        {null}
      </BacktestCard>
    );
  }

  const columns: DataTableColumn<BacktestAction>[] = [
    { key: "day", header: "Day", cellClassName: "font-mono text-nowrap", render: (action) => action.tradingDate },
    { key: "look", header: "Look", headerTitle: "The look's time (Eastern), and the pass inside it when the look made several.", cellClassName: "font-mono text-nowrap", render: (action) => describeActionLook(action) },
    { key: "symbol", header: "Symbol", cellClassName: "fw-semibold", render: (action) => action.symbol },
    {
      key: "kind",
      header: "Action",
      cellClassName: "text-nowrap",
      render: (action) => (
        <div className="d-flex flex-column">
          <span>{actionKindLabel[action.kind]}</span>
          {action.automatic && (
            <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
              automatic
            </span>
          )}
        </div>
      ),
    },
    { key: "outcome", header: "Outcome", render: (action) => <OutcomeBadge outcome={action.outcome} /> },
    {
      key: "gates",
      header: "Gates",
      headerTitle: "The gate that refused a blocked action, or how many passed. Opens every gate's result.",
      cellClassName: "text-nowrap",
      render: (action) => (
        <button type="button" className={`btn btn-link px-2 py-1 text-start${failedGateOf(action) ? " text-danger fw-semibold" : ""}`} style={{ fontSize: "inherit" }} onClick={() => setOpenedAction(action)}>
          {describeGateSummary(action)}
        </button>
      ),
    },
    { key: "description", header: "What", headerTitle: "The contract in the platform's label, the size and price, and what the model had on it.", cellClassName: "backtest-decision-cell", render: (action) => action.description },
    { key: "why", header: "Chosen because", cellClassName: "backtest-decision-cell", render: (action) => action.chosenBecause },
    { key: "qty", header: "Qty", align: "right", render: (action) => formatNumber(action.quantity) },
    { key: "limit", header: "Limit", align: "right", render: (action) => formatQuotePrice(action.limitPrice) },
    { key: "fill", header: "Fill", headerTitle: "The simulated fill per share of the chosen leg; — when blocked.", align: "right", render: (action) => formatQuotePrice(action.fillPrice) },
  ];

  const changeFilters = (next: BacktestBookFilterValues) => {
    setFilters(next);
    setOffset(0);
  };

  return (
    <div className="mt-3">
      <DataTable
        tableId="backtest-actions-log"
        columns={columns}
        rows={page?.actions ?? []}
        rowKey={(action) => action.actionId}
        loading={loading && page === null}
        emptyMessage={error ?? "No action matches the filters."}
        dense
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            <div className="d-flex flex-wrap align-items-center gap-2">
              <BacktestBookFilters idPrefix="backtest-actions" values={filters} onChange={changeFilters} symbols={symbols} startDate={startDate} endDate={endDate}>
                <select
                  className="form-select w-auto"
                  aria-label="Outcome"
                  value={outcome}
                  onChange={(event) => {
                    setOutcome(event.target.value as OutcomeFilter);
                    setOffset(0);
                  }}
                >
                  <option value="">Filled and blocked</option>
                  <option value="filled">Filled</option>
                  <option value="blocked">Blocked</option>
                </select>
              </BacktestBookFilters>
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
            <Pagination page={Math.floor(offset / actionsPerPage) + 1} pageSize={actionsPerPage} totalRows={page?.total ?? 0} onPageChange={(next) => setOffset((next - 1) * actionsPerPage)} />
          </div>
        }
      />
      {openedAction && <BacktestActionDetailsModal action={openedAction} onClose={() => setOpenedAction(null)} />}
    </div>
  );
}
