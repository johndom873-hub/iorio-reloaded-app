import { useMemo } from "react";
import type { PlutoAction, PlutoEvent, PlutoState } from "../../api/pluto";
import { buildFeedContext, isTodaysOrder, plutoOrderColumns } from "../../lib/plutoPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { PlutoActivityFeed } from "./PlutoActivityFeed";
import { PlutoOrdersTable } from "./PlutoOrdersTable";
import { PlutoVolFarmerV2Card } from "./PlutoVolFarmerV2Card";
import { CardLink } from "./plutoBits";

interface PlutoLiveTabProps {
  state: PlutoState | null;
  actions: PlutoAction[];
  actionsLoading: boolean;
  actionsError: string | null;
  /** The newest events without the routine ones the Activity feed hides, loaded on their own so routine ones cannot bury them. */
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

export function PlutoLiveTab({ state, actions, actionsLoading, actionsError, feedEvents, feedEventsLoading, feedEventsError, now, isPhone, onOpenTicker }: PlutoLiveTabProps) {
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

  const volFarmerV2Card = <PlutoVolFarmerV2Card lastPassAt={state?.lastPassAt ?? null} isPhone={isPhone} onOpenTicker={onOpenTicker} />;

  if (isPhone) {
    return (
      <div className="pm-stack tight">
        {ordersCard}
        {volFarmerV2Card}
        {activityCard}
      </div>
    );
  }
  return (
    <div className="pm-stack">
      <div className="pm-grid-live">
        <div className="pm-stack">{ordersCard}</div>
        {activityCard}
      </div>
      {volFarmerV2Card}
    </div>
  );
}
