import { useCallback, useMemo, useState } from "react";
import type { PlutoAction, PlutoPass, PlutoScoreboard, PlutoState } from "../../api/pluto";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { easternIsoDate, formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatDate, formatNumber, formatSignedPnl } from "../../lib/formatters";
import { buildFeedContext, describeChosenAction, formatModelCost, describeTopPickComparison, describeTrigger, passVerdict, plutoEventCategoryOptions, plutoOrderColumns, verdictKind } from "../../lib/plutoPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { PlutoCheckboxFilter } from "./PlutoCheckboxFilter";
import { PlutoEventLog } from "./PlutoEventLog";
import { usePlutoEventCategories } from "./usePlutoEventCategories";
import { DecisionDetails, VerdictTag } from "./PlutoDecisionBody";
import { PlutoOrdersTable } from "./PlutoOrdersTable";
import { CheckIcon, CollapseButton, SearchIcon, StrategyBadge, ToggleHeader } from "./plutoBits";

export type PlutoHistoryView = "orders" | "decisions" | "events";
type Period = "today" | "7d" | "30d" | "all";
type OutcomeFilter = "all" | "filled" | "working" | "blocked" | "cancelled" | "rejected";
type VerdictFilter = "all" | "order" | "no_order" | "failed";

interface PlutoHistoryTabProps {
  view: PlutoHistoryView;
  onViewChange: (view: PlutoHistoryView) => void;
  scoreboard: PlutoScoreboard | null;
  scoreboardError: string | null;
  actions: PlutoAction[];
  actionsLoading: boolean;
  actionsError: string | null;
  passes: PlutoPass[];
  passesLoading: boolean;
  passesError: string | null;
  /** Bumped by the screen when a new event arrives, so the Event log reloads its first page. */
  eventLogRefreshToken: number;
  state: PlutoState | null;
  now: Date;
  isPhone: boolean;
  onOpenTicker: (symbol: string) => void;
  /** Ask the page for more rows of the current view (the API is paged by limit). */
  onLoadMore: (view: "orders" | "decisions") => void;
  loadingMore: boolean;
}

const pageSize = 10;

interface EventPageInfo {
  page: number;
  pageCount: number;
  total: number;
  firstShown: number;
  lastShown: number;
  goToPage: (page: number) => void;
  loading: boolean;
}

function periodStart(period: Period, now: Date): number {
  if (period === "all") return 0;
  if (period === "today") return new Date(`${easternIsoDate(now)}T00:00:00`).getTime() - 12 * 3_600_000;
  return now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000;
}

function outcomeMatches(action: PlutoAction, filter: OutcomeFilter): boolean {
  switch (filter) {
    case "filled":
      return action.outcome === "filled" || action.outcome === "partially_filled" || action.outcome === "cancelled_partially_filled";
    case "working":
      return action.outcome === "confirmed" || action.outcome === "order_built" || action.outcome === "validated";
    case "blocked":
      return action.outcome === "blocked";
    case "cancelled":
      return action.outcome === "cancelled";
    case "rejected":
      return action.outcome === "rejected" || action.outcome === "error";
    default:
      return true;
  }
}

function TrackRecordCard({ scoreboard, error }: { scoreboard: PlutoScoreboard | null; error: string | null }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("pluto-track-record", true);
  const outcomes = scoreboard?.outcomes ?? {};
  const count = (...keys: string[]) => keys.reduce((sum, key) => sum + (outcomes[key] ?? 0), 0);
  const filled = count("filled", "partially_filled", "cancelled_partially_filled");
  const sent = filled + count("order_built", "confirmed", "cancelled", "rejected", "error");
  const blocked = count("blocked");
  const decided = scoreboard ? scoreboard.modelVsTopPick.agree + scoreboard.modelVsTopPick.disagree : 0;
  const agreePct = decided > 0 && scoreboard ? Math.round((scoreboard.modelVsTopPick.agree / decided) * 100) : null;
  const hitRate = scoreboard && scoreboard.closedActions > 0 ? Math.round((scoreboard.winningActions / scoreboard.closedActions) * 100) : null;
  return (
    <section className="pm-card pm-mb-20">
      <ToggleHeader className={`pm-card-h${isOpen ? "" : " flat"}`} onToggle={() => setIsOpen(!isOpen)}>
        <h2 className="pm-card-t">Track record</h2>
        <div className="pm-card-meta">
          {scoreboard?.since ? <span>Since Pluto started on {formatDate(scoreboard.since)}</span> : <span>No analyses yet</span>}
          <CollapseButton open={isOpen} onToggle={() => setIsOpen(!isOpen)} label="the track record" />
        </div>
      </ToggleHeader>
      {isOpen && error && <div className="alert alert-danger pm-error">{error}</div>}
      {isOpen && scoreboard && (
        <div className="pm-stats">
          <div className="pm-stat">
            <div className="pm-kpi-l">Realized P&amp;L</div>
            <div className={`pm-kpi-v ${scoreboard.realizedPnl > 0 ? "t-ok" : scoreboard.realizedPnl < 0 ? "t-bad" : ""}`}>{formatSignedPnl(scoreboard.realizedPnl, 0)}</div>
            <div className="pm-kpi-s">{scoreboard.closedActions} closed · {scoreboard.openActions} still open</div>
          </div>
          <div className="pm-stat">
            <div className="pm-kpi-l">Hit rate</div>
            <div className="pm-kpi-v">{hitRate === null ? "—" : `${hitRate}%`}</div>
            <div className="pm-kpi-s">{scoreboard.closedActions === 0 ? "Nothing closed yet" : `${scoreboard.winningActions} of ${scoreboard.closedActions} closed made money`}</div>
          </div>
          <div className="pm-stat">
            <div className="pm-kpi-l">Pessimistic</div>
            <div className={`pm-kpi-v ${scoreboard.pessimisticPnl > 0 ? "t-ok" : scoreboard.pessimisticPnl < 0 ? "t-bad" : ""}`}>{formatSignedPnl(scoreboard.pessimisticPnl, 0)}</div>
            <div className="pm-kpi-s">Fills vs the worse side of the market</div>
          </div>
          <div className="pm-stat">
            <div className="pm-kpi-l">Orders filled</div>
            <div className="pm-kpi-v">
              {filled} <small>/ {sent} sent</small>
            </div>
            <div className="pm-kpi-s">{blocked === 0 ? "None blocked by the gates" : `${blocked} more blocked by the gates`}</div>
          </div>
          <div className="pm-stat">
            <div className="pm-kpi-l">Model vs Edge $</div>
            <div className="pm-kpi-v">{agreePct === null ? "—" : `${agreePct}%`}</div>
            <div className="pm-kpi-s">
              {decided === 0 ? "No orders decided yet" : `Same pick on ${scoreboard.modelVsTopPick.agree} of ${decided} orders`} · {scoreboard.modelVsTopPick.noTrade} no-order
            </div>
          </div>
          <div className="pm-stat">
            <div className="pm-kpi-l">Model cost</div>
            <div className="pm-kpi-v">{formatCurrency(scoreboard.costUsd, 2)}</div>
            <div className="pm-kpi-s">{scoreboard.modelCalls} model calls</div>
          </div>
        </div>
      )}
    </section>
  );
}

function DecisionRow({ pass, state, open, onToggle }: { pass: PlutoPass; state: PlutoState | null; open: boolean; onToggle: () => void }) {
  const kind = verdictKind(pass);
  const { action, output, error } = passVerdict(pass);
  const comparison = describeTopPickComparison(pass);
  const confidence = output?.confidence !== undefined ? ` · conf. ${output.confidence.toFixed(2)}` : "";
  return (
    <div className={`pm-dec${open ? " open" : ""}`}>
      <ToggleHeader className="pm-dec-row" onToggle={onToggle}>
        <span className="when">
          <span className="medium">{formatBrowserDayMonth(pass.startedAt)}</span> <span className="muted">{formatBrowserClockTime(pass.startedAt)}</span>
        </span>
        <span className="what">{describeTrigger(pass, "short")}</span>
        <span>
          <VerdictTag pass={pass} size="sm" />
        </span>
        <span className={`what ${kind === "order" ? "medium" : kind === "failed" ? "t-bad" : "muted"}`}>
          {kind === "order" && action && <StrategyBadge kind={action.kind} contract={action.contract} />} {kind === "failed" ? error : describeChosenAction(pass)}
          {kind !== "failed" && <span className="muted pm-regular">{confidence}</span>}
        </span>
        <span className={`vs ${comparison.tone === "ok" ? "t-ok" : comparison.tone === "warn" ? "t-warn" : "muted"}`}>
          {comparison.tone === "ok" && <CheckIcon />}
          {kind === "failed" ? "—" : comparison.text}
        </span>
        <span className="num cost">{formatModelCost(pass.costUsd)}</span>
        <CollapseButton open={open} onToggle={onToggle} label="this decision" />
      </ToggleHeader>
      {open && <DecisionDetails pass={pass} state={state} />}
    </div>
  );
}

export function PlutoHistoryTab({ view, onViewChange, scoreboard, scoreboardError, actions, actionsLoading, actionsError, passes, passesLoading, passesError, eventLogRefreshToken, state, now, isPhone, onOpenTicker, onLoadMore, loadingMore }: PlutoHistoryTabProps) {
  const [ticker, setTicker] = useState("");
  const [period, setPeriod] = useState<Period>("30d");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [shown, setShown] = useState(pageSize);
  const [session, setSession] = useState("");
  const { categories: eventCategories, toggleCategory: toggleEventCategory } = usePlutoEventCategories();
  const [eventPage, setEventPage] = useState<EventPageInfo | null>(null);
  const [openPassId, setOpenPassId] = useState<string | null>(null);
  const orderColumns = plutoOrderColumns.history;
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-orders-history", orderColumns.map((column) => column.key));

  const since = periodStart(period, now);
  const feedContext = useMemo(() => buildFeedContext(actions), [actions]);
  const tickerFilter = ticker.trim().toUpperCase();
  const orderRows = useMemo(() => actions.filter((action) => action.kind !== "no_trade" && new Date(action.createdAt).getTime() >= since && (!tickerFilter || action.symbol.toUpperCase().includes(tickerFilter)) && outcomeMatches(action, outcomeFilter)), [actions, since, tickerFilter, outcomeFilter]);
  const decisionRows = useMemo(
    () =>
      passes.filter((pass) => {
        if (!pass.modelCalled || new Date(pass.startedAt).getTime() < since) return false;
        if (tickerFilter) {
          const symbols = [...(Array.isArray(pass.triggerDetail?.symbols) ? (pass.triggerDetail.symbols as string[]) : []), ...pass.actions.map((action) => action.symbol)];
          if (!symbols.some((symbol) => symbol.toUpperCase().includes(tickerFilter))) return false;
        }
        return verdictFilter === "all" || verdictKind(pass) === verdictFilter;
      }),
    [passes, since, tickerFilter, verdictFilter],
  );
  const debouncedTicker = useDebouncedValue(tickerFilter, 300);
  const eventFilters = useMemo(() => ({ categories: eventCategories, ticker: debouncedTicker, session }), [eventCategories, debouncedTicker, session]);
  const handleEventPageInfo = useCallback((info: EventPageInfo) => setEventPage(info), []);

  const total = view === "orders" ? orderRows.length : decisionRows.length;
  const visibleCount = Math.min(shown, total);
  const loadedAll = view === "orders" ? actions.length < 100 : passes.length < 30;

  function switchView(next: PlutoHistoryView) {
    onViewChange(next);
    setShown(pageSize);
  }

  function showMore() {
    if (shown < total) setShown((count) => count + pageSize);
    else if (!loadedAll && view !== "events") {
      onLoadMore(view);
      setShown((count) => count + pageSize);
    }
  }

  const footNote =
    view === "orders"
      ? `Showing ${visibleCount} of ${total} · Realized counts the legs each order opened, net of closing commissions`
      : view === "decisions"
        ? `Showing ${visibleCount} of ${total} · only analyses where the model was asked; routine analyses are in the Event log`
        : eventPage === null
          ? "Loading events…"
          : `Showing ${formatNumber(eventPage.firstShown)}–${formatNumber(eventPage.lastShown)} of ${formatNumber(eventPage.total)} events`;

  return (
    <>
      <TrackRecordCard scoreboard={scoreboard} error={scoreboardError} />
      <section className="pm-card">
        <div className="pm-toolbar">
          <div className="pm-seg" role="tablist" aria-label="History view">
            <button type="button" role="tab" aria-selected={view === "orders"} className={view === "orders" ? "on" : ""} onClick={() => switchView("orders")}>
              Orders <span className="cnt">{orderRows.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "decisions"} className={view === "decisions" ? "on" : ""} onClick={() => switchView("decisions")}>
              Model decisions <span className="cnt">{decisionRows.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "events"} className={view === "events" ? "on" : ""} onClick={() => switchView("events")}>
              Event log
            </button>
          </div>
          <span className="pm-spacer" />
          <label className="pm-search">
            <SearchIcon />
            <input type="text" placeholder="Ticker" aria-label="Filter by ticker" value={ticker} onChange={(event) => { setTicker(event.target.value); setShown(pageSize); }} />
          </label>
          {view === "events" && (
            <>
              <PlutoCheckboxFilter label="Categories" options={plutoEventCategoryOptions} selectedKeys={eventCategories} onToggle={toggleEventCategory} />
              <span className="pm-session-filter">
                <input type="date" className="pm-date" aria-label="Session date (Eastern trading day)" title="Session: an Eastern (market) trading day" value={session} onChange={(event) => setSession(event.target.value)} />
                <button type="button" className={`pm-btn sm${session === "" ? " primary" : ""}`} aria-pressed={session === ""} onClick={() => setSession("")}>
                  All sessions
                </button>
              </span>
            </>
          )}
          {view === "orders" && (
            <select className="pm-select" aria-label="Outcome" value={outcomeFilter} onChange={(event) => { setOutcomeFilter(event.target.value as OutcomeFilter); setShown(pageSize); }}>
              <option value="all">All outcomes</option>
              <option value="filled">Filled</option>
              <option value="working">Working</option>
              <option value="blocked">Blocked</option>
              <option value="cancelled">Cancelled</option>
              <option value="rejected">Rejected or errored</option>
            </select>
          )}
          {view === "decisions" && (
            <select className="pm-select" aria-label="Verdict" value={verdictFilter} onChange={(event) => { setVerdictFilter(event.target.value as VerdictFilter); setShown(pageSize); }}>
              <option value="all">All verdicts</option>
              <option value="order">Order</option>
              <option value="no_order">No order</option>
              <option value="failed">Failed</option>
            </select>
          )}
          {view !== "events" && <select className="pm-select" aria-label="Period" value={period} onChange={(event) => { setPeriod(event.target.value as Period); setShown(pageSize); }}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>}
          {view === "orders" && !isPhone && <ColumnVisibilityPopover variant="toolbar" columns={orderColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
        </div>

        {view === "orders" && <PlutoOrdersTable variant="history" rows={orderRows.slice(0, shown)} now={now} state={state} loading={actionsLoading} error={actionsError} emptyMessage="No orders match." isColumnVisible={isColumnVisible} onOpenTicker={onOpenTicker} isPhone={isPhone} />}

        {view === "decisions" && (
          <>
            {!isPhone && (
              <div className="pm-th-row">
                <span>When</span>
                <span>Asked because</span>
                <span>Decision</span>
                <span>Model chose</span>
                <span className="vs">Vs Edge $ top pick</span>
                <span className="r">Cost</span>
                <span />
              </div>
            )}
            {passesError ? (
              <div className="alert alert-danger pm-error mb-0">{passesError}</div>
            ) : passesLoading ? (
              <div className="pm-empty">Loading…</div>
            ) : decisionRows.length === 0 ? (
              <div className="pm-empty">No model decisions match.</div>
            ) : (
              decisionRows.slice(0, shown).map((pass) => <DecisionRow key={pass.id} pass={pass} state={state} open={openPassId === pass.id} onToggle={() => setOpenPassId((current) => (current === pass.id ? null : pass.id))} />)
            )}
          </>
        )}

        {view === "events" && <PlutoEventLog filters={eventFilters} refreshToken={eventLogRefreshToken} context={feedContext} onPageInfo={handleEventPageInfo} />}

        <div className="pm-card-foot">
          <span>{footNote}</span>
          {view === "events" && eventPage !== null && eventPage.pageCount > 1 && (
            <span className="pm-pager">
              <button type="button" className="pm-btn sm" disabled={eventPage.page <= 1 || eventPage.loading} onClick={() => eventPage.goToPage(eventPage.page - 1)}>
                Previous
              </button>
              <span className="pm-pager-status">Page {formatNumber(eventPage.page)} of {formatNumber(eventPage.pageCount)}</span>
              <button type="button" className="pm-btn sm" disabled={eventPage.page >= eventPage.pageCount || eventPage.loading} onClick={() => eventPage.goToPage(eventPage.page + 1)}>
                Next
              </button>
            </span>
          )}
          {view !== "events" && (shown < total || !loadedAll) && (
            <button type="button" className="pm-btn sm" disabled={loadingMore} onClick={showMore}>
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
