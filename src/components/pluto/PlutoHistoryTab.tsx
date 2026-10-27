import { useCallback, useMemo, useState } from "react";
import { fetchPlutoOrdersPage, type PlutoAction, type PlutoHistoryFilters, type PlutoOrderOutcomeFilter, type PlutoScoreboard, type PlutoState } from "../../api/pluto";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { easternIsoDate, formatDate, formatDayMonthYear, formatNumber, formatSignedPnl } from "../../lib/formatters";
import { buildFeedContext, plutoEventCategoryOptions, plutoOrderColumns } from "../../lib/plutoPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { PlutoCheckboxFilter } from "./PlutoCheckboxFilter";
import { PlutoEventLog } from "./PlutoEventLog";
import { usePlutoEventCategories } from "./usePlutoEventCategories";
import { usePlutoHistoryPage, type PlutoHistoryPageInfo } from "./usePlutoHistoryPage";
import { PlutoOrdersTable } from "./PlutoOrdersTable";
import { CollapseButton, SearchIcon, ToggleHeader } from "./plutoBits";

export type PlutoHistoryView = "orders" | "events";
type Period = "today" | "7d" | "30d" | "all";

interface PlutoHistoryTabProps {
  view: PlutoHistoryView;
  onViewChange: (view: PlutoHistoryView) => void;
  scoreboard: PlutoScoreboard | null;
  scoreboardError: string | null;
  /** The newest actions, for the Event log's order descriptions; the Orders view pages its own. */
  actions: PlutoAction[];
  /** Bumped by the screen when a new event arrives, so the Event log reloads its first page. */
  eventLogRefreshToken: number;
  /** Bumped when an event can have changed an order, so the Orders view reloads its first page. */
  historyListsRefreshToken: number;
  state: PlutoState | null;
  now: Date;
  isPhone: boolean;
  onOpenTicker: (symbol: string) => void;
}

/** The period's start as an ISO time, taken when a page is fetched; null for all time. */
function periodStartIso(period: Period, now: Date): string | null {
  if (period === "all") return null;
  if (period === "today") return new Date(new Date(`${easternIsoDate(now)}T00:00:00`).getTime() - 12 * 3_600_000).toISOString();
  return new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000).toISOString();
}

function TrackRecordCard({ scoreboard, error }: { scoreboard: PlutoScoreboard | null; error: string | null }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("pluto-track-record", true);
  const outcomes = scoreboard?.outcomes ?? {};
  const count = (...keys: string[]) => keys.reduce((sum, key) => sum + (outcomes[key] ?? 0), 0);
  const filled = count("filled", "partially_filled", "cancelled_partially_filled");
  const sent = filled + count("order_built", "confirmed", "cancelled", "rejected", "error");
  const blocked = count("blocked");
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
            <div className="pm-kpi-l">Orders filled</div>
            <div className="pm-kpi-v">
              {filled} <small>/ {sent} sent</small>
            </div>
            <div className="pm-kpi-s">{blocked === 0 ? "None blocked by the gates" : `${blocked} more blocked by the gates`}</div>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlutoHistoryTab({ view, onViewChange, scoreboard, scoreboardError, actions, eventLogRefreshToken, historyListsRefreshToken, state, now, isPhone, onOpenTicker }: PlutoHistoryTabProps) {
  const [ticker, setTicker] = useState("");
  const [period, setPeriod] = useState<Period>("30d");
  const [outcomeFilter, setOutcomeFilter] = useState<PlutoOrderOutcomeFilter>("all");
  const [session, setSession] = useState("");
  const { categories: eventCategories, toggleCategory: toggleEventCategory, selectCategories: selectEventCategories } = usePlutoEventCategories();
  const [eventPage, setEventPage] = useState<PlutoHistoryPageInfo | null>(null);
  const orderColumns = plutoOrderColumns.history;
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-orders-history", orderColumns.map((column) => column.key));

  const feedContext = useMemo(() => buildFeedContext(actions), [actions]);
  const tickerFilter = ticker.trim().toUpperCase();
  const debouncedTicker = useDebouncedValue(tickerFilter, 300);
  // The period's start is taken when a page is fetched, so the ticking clock does not reload the lists.
  const historyFilters = (): PlutoHistoryFilters => ({ since: periodStartIso(period, new Date()), ticker: debouncedTicker });
  const orders = usePlutoHistoryPage<PlutoAction>(
    (limit, offset) => fetchPlutoOrdersPage(historyFilters(), outcomeFilter, limit, offset).then((page) => ({ rows: page.actions, total: page.total })),
    `${period}|${debouncedTicker}|${outcomeFilter}`,
    historyListsRefreshToken,
    "Could not load the orders.",
  );
  const eventFilters = useMemo(() => ({ categories: eventCategories, ticker: debouncedTicker, session }), [eventCategories, debouncedTicker, session]);
  const handleEventPageInfo = useCallback((info: PlutoHistoryPageInfo) => setEventPage(info), []);

  const pageInfo = view === "orders" ? orders.pageInfo : eventPage;
  const shownRange = (info: PlutoHistoryPageInfo, noun: string) => `Showing ${formatNumber(info.firstShown)}–${formatNumber(info.lastShown)} of ${formatNumber(info.total)} ${noun}`;
  const footNote =
    view === "orders"
      ? `${shownRange(orders.pageInfo, "orders")} · Realized counts the legs each order opened, net of closing commissions`
      : eventPage === null
        ? "Loading events…"
        : `${shownRange(eventPage, "events")}${session !== "" ? ` · session ${formatDayMonthYear(session)} is an Eastern trading day; rows show your local date and time` : ""}`;

  return (
    <>
      <TrackRecordCard scoreboard={scoreboard} error={scoreboardError} />
      <section className="pm-card">
        <div className="pm-toolbar">
          <div className="pm-seg" role="tablist" aria-label="History view">
            <button type="button" role="tab" aria-selected={view === "orders"} className={view === "orders" ? "on" : ""} onClick={() => onViewChange("orders")}>
              Orders <span className="cnt">{formatNumber(orders.pageInfo.total)}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "events"} className={view === "events" ? "on" : ""} onClick={() => onViewChange("events")}>
              Event log
            </button>
          </div>
          <span className="pm-spacer" />
          <label className="pm-search">
            <SearchIcon />
            <input type="text" placeholder="Ticker" aria-label="Filter by ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} />
          </label>
          {view === "events" && (
            <>
              <PlutoCheckboxFilter label="Categories" options={plutoEventCategoryOptions} selectedKeys={eventCategories} onToggle={toggleEventCategory} onSelectKeys={selectEventCategories} />
              <span className="pm-session-filter">
                <input type="date" className="pm-date" aria-label="Session date (Eastern trading day)" title="Session: an Eastern (market) trading day" value={session} onChange={(event) => setSession(event.target.value)} />
                <button type="button" className={`pm-btn sm${session === "" ? " primary" : ""}`} aria-pressed={session === ""} onClick={() => setSession("")}>
                  All sessions
                </button>
              </span>
            </>
          )}
          {view === "orders" && (
            <select className="pm-select" aria-label="Outcome" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value as PlutoOrderOutcomeFilter)}>
              <option value="all">All outcomes</option>
              <option value="filled">Filled</option>
              <option value="working">Working</option>
              <option value="blocked">Blocked</option>
              <option value="cancelled">Cancelled</option>
              <option value="rejected">Rejected or errored</option>
            </select>
          )}
          {view !== "events" && <select className="pm-select" aria-label="Period" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>}
          {view === "orders" && !isPhone && <ColumnVisibilityPopover variant="toolbar" columns={orderColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
        </div>

        {view === "orders" && <PlutoOrdersTable variant="history" rows={orders.rows} now={now} state={state} loading={orders.pageInfo.loading && orders.rows.length === 0} error={orders.error} emptyMessage="No orders match." isColumnVisible={isColumnVisible} onOpenTicker={onOpenTicker} isPhone={isPhone} />}

        {view === "events" && <PlutoEventLog filters={eventFilters} refreshToken={eventLogRefreshToken} context={feedContext} onPageInfo={handleEventPageInfo} />}

        <div className="pm-card-foot">
          <span>{footNote}</span>
          {pageInfo !== null && pageInfo.pageCount > 1 && (
            <span className="pm-pager">
              <button type="button" className="pm-btn sm" disabled={pageInfo.page <= 1 || pageInfo.loading} onClick={() => pageInfo.goToPage(pageInfo.page - 1)}>
                Previous
              </button>
              <span className="pm-pager-status">Page {formatNumber(pageInfo.page)} of {formatNumber(pageInfo.pageCount)}</span>
              <button type="button" className="pm-btn sm" disabled={pageInfo.page >= pageInfo.pageCount || pageInfo.loading} onClick={() => pageInfo.goToPage(pageInfo.page + 1)}>
                Next
              </button>
            </span>
          )}
        </div>
      </section>
    </>
  );
}
