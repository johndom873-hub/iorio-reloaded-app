import { useMemo, useState } from "react";
import type { PlutoAction, PlutoEvent, PlutoPass, PlutoState } from "../../api/pluto";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { browserLocalIsoDate, formatBrowserClockTime, formatBrowserDayMonth } from "../../lib/formatters";
import { buildFeedContext, checksAndGatesSummary, describeChosenAction, describeOrderContract, describeTrigger, isTodaysOrder, passVerdict, plutoOrderColumns, verdictKind } from "../../lib/plutoPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { PlutoActivityFeed } from "./PlutoActivityFeed";
import { ChecksGrid, DecisionFacts, DecisionVerdictLine, ComparePanels, GatesList, ReasonsAndRisks, VerdictTag } from "./PlutoDecisionBody";
import { PlutoOrdersTable } from "./PlutoOrdersTable";
import { CardLink, CheckIcon, CollapseButton, CrossIcon, StrategyBadge, ToggleHeader } from "./plutoBits";

interface PlutoLiveTabProps {
  state: PlutoState | null;
  actions: PlutoAction[];
  actionsLoading: boolean;
  actionsError: string | null;
  /** The newest pass that asked the model, loaded on its own so skipped passes cannot bury it. */
  latestModelPass: PlutoPass | null;
  latestModelPassLoading: boolean;
  latestModelPassError: string | null;
  /** The newest events without the routine ones the Activity feed hides, loaded on their own for the same reason. */
  feedEvents: PlutoEvent[];
  feedEventsLoading: boolean;
  feedEventsError: string | null;
  now: Date;
  isPhone: boolean;
  onOpenTicker: (symbol: string) => void;
}

/** How many feed events the Live tab asks for and shows (a phone shows fewer). */
export const activityFeedLength = 40;
const activityFeedLengthPhone = 12;

function LatestDecisionCard({ pass, state, loading, error, isPhone }: { pass: PlutoPass | null; state: PlutoState | null; loading: boolean; error: string | null; isPhone: boolean }) {
  const [isOpen, setIsOpen] = useCollapsibleCard(isPhone ? "pluto-latest-decision-phone" : "pluto-latest-decision", !isPhone);
  const [showDetails, setShowDetails] = useState(false);
  if (error) return <section className="pm-card"><div className="pm-card-h flat"><h2 className="pm-card-t">Latest model decision</h2></div><div className="alert alert-danger pm-error">{error}</div></section>;
  if (loading) return <section className="pm-card"><div className="pm-card-h flat"><h2 className="pm-card-t">Latest model decision</h2></div><div className="pm-empty">Loading…</div></section>;
  if (!pass) {
    return (
      <section className="pm-card">
        <div className="pm-card-h flat">
          <h2 className="pm-card-t">Latest model decision</h2>
        </div>
        <div className="pm-empty">The model hasn't been asked anything yet.</div>
      </section>
    );
  }
  const { action } = passVerdict(pass);
  const summary = checksAndGatesSummary(pass);
  // The newest model call can be from an earlier day (weekend, holiday), so a day label appears whenever it is not today.
  const startedStamp = `${browserLocalIsoDate(pass.startedAt) === browserLocalIsoDate(new Date()) ? "" : `${formatBrowserDayMonth(pass.startedAt)} `}${formatBrowserClockTime(pass.startedAt)}`;
  const when = `${startedStamp} · ${describeTrigger(pass, "clause")}`;
  const kind = verdictKind(pass);
  return (
    <section className="pm-card">
      <ToggleHeader className={`pm-card-h${isOpen ? "" : " flat"}`} onToggle={() => setIsOpen(!isOpen)}>
        {isPhone && !isOpen ? (
          <div className="pm-min0">
            <h2 className="pm-card-t">Latest model decision</h2>
            <div className="pm-card-meta mt-1">
              <VerdictTag pass={pass} size="xs" />
              {kind === "order" && action && <StrategyBadge kind={action.kind} contract={action.contract} />}
              <span>{kind === "order" && action ? `${action.symbol} ${describeOrderContract(action).title}` : kind === "failed" ? "Model call failed" : describeChosenAction(pass)} · {startedStamp}</span>
            </div>
          </div>
        ) : (
          <>
            <h2 className="pm-card-t">Latest model decision</h2>
            <div className="pm-card-meta">
              {!isPhone && <span>{when}</span>}
              <CollapseButton open={isOpen} onToggle={() => setIsOpen(!isOpen)} label="the latest decision" />
            </div>
          </>
        )}
        {isPhone && !isOpen && <CollapseButton open={false} onToggle={() => setIsOpen(true)} label="the latest decision" />}
      </ToggleHeader>
      {isOpen && (
        <>
          <div className="pm-card-b">
            {isPhone && <div className="pm-card-meta mb-2">{when}</div>}
            <DecisionVerdictLine pass={pass} />
            <DecisionFacts pass={pass} state={state} />
            {(kind === "order" || passVerdict(pass).topPick) && <ComparePanels pass={pass} />}
            <ReasonsAndRisks pass={pass} />
            {showDetails && (
              <>
                <div className="pm-h4">Checks before the model · {summary.checks.passed} of {summary.checks.total} passed</div>
                <ChecksGrid pass={pass} columns={isPhone ? 2 : 3} />
                <div className="pm-h4">Gates after the model{summary.gates.total > 0 ? ` · ${summary.gates.passed} of ${summary.gates.total} passed` : ""}</div>
                <GatesList pass={pass} />
              </>
            )}
          </div>
          <div className="pm-card-foot">
            <span className="pm-foot-checks">
              <span className={summary.checks.passed === summary.checks.total ? "t-ok" : "t-bad"}>
                {summary.checks.passed === summary.checks.total ? <CheckIcon /> : <CrossIcon />}
                {summary.checks.passed} of {summary.checks.total} checks passed
              </span>
              {summary.gates.total > 0 && (
                <span className={summary.gates.passed === summary.gates.total ? "t-ok" : "t-warn"}>
                  {summary.gates.passed === summary.gates.total ? <CheckIcon /> : <CrossIcon />}
                  {summary.gates.passed} of {summary.gates.total} gates passed
                </span>
              )}
              <button type="button" className="pm-link" onClick={() => setShowDetails((open) => !open)}>
                {showDetails ? "Hide details" : "Show details"}
              </button>
            </span>
            <CardLink to="/pluto?tab=history&view=decisions">All decisions</CardLink>
          </div>
        </>
      )}
    </section>
  );
}

export function PlutoLiveTab({ state, actions, actionsLoading, actionsError, latestModelPass, latestModelPassLoading, latestModelPassError, feedEvents, feedEventsLoading, feedEventsError, now, isPhone, onOpenTicker }: PlutoLiveTabProps) {
  const todaysOrders = actions.filter(isTodaysOrder);
  const sent = todaysOrders.filter((action) => action.outcome !== "blocked" && action.outcome !== "validated").length;
  const blocked = todaysOrders.filter((action) => action.outcome === "blocked").length;
  const shownFeedEvents = feedEvents.slice(0, isPhone ? activityFeedLengthPhone : activityFeedLength);
  const feedContext = useMemo(() => buildFeedContext(actions), [actions]);
  const columns = plutoOrderColumns.today;
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-orders-today", columns.map((column) => column.key));

  const ordersCard = (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">Today's orders</h2>
        {isPhone ? (
          <CardLink to="/pluto?tab=history&view=orders" small>All</CardLink>
        ) : (
          <div className="pm-card-meta">
            <span>{sent} sent · {blocked} blocked</span>
            <CardLink to="/pluto?tab=history&view=orders">All orders</CardLink>
            <ColumnVisibilityPopover variant="toolbar" columns={columns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
          </div>
        )}
      </div>
      <PlutoOrdersTable variant="today" rows={todaysOrders} now={now} state={state} loading={actionsLoading} error={actionsError} emptyMessage="No orders yet today." isColumnVisible={isColumnVisible} onOpenTicker={onOpenTicker} isPhone={isPhone} />
    </section>
  );

  const activityCard = (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">
          Activity <span className="pm-live">Live</span>
        </h2>
        {isPhone ? <CardLink to="/pluto?tab=history&view=events" small>Full log</CardLink> : <div className="pm-card-meta"><CardLink to="/pluto?tab=history&view=events">Full log</CardLink></div>}
      </div>
      <PlutoActivityFeed events={shownFeedEvents} loading={feedEventsLoading} error={feedEventsError} emptyMessage="Nothing has happened yet." scroll={!isPhone} context={feedContext} />
    </section>
  );

  if (isPhone) {
    return (
      <div className="pm-stack tight">
        {ordersCard}
        <LatestDecisionCard pass={latestModelPass} state={state} loading={latestModelPassLoading} error={latestModelPassError} isPhone />
        {activityCard}
      </div>
    );
  }
  return (
    <div className="pm-grid-live">
      <div className="pm-stack">
        {ordersCard}
        <LatestDecisionCard pass={latestModelPass} state={state} loading={latestModelPassLoading} error={latestModelPassError} isPhone={false} />
      </div>
      {activityCard}
    </div>
  );
}
