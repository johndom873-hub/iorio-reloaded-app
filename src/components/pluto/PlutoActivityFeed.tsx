import type { PlutoEvent } from "../../api/pluto";
import { easternIsoDate, formatDayMonth, formatEasternTime, todayInEasternIso } from "../../lib/formatters";
import { describeFeedEvent, type PlutoFeedContext } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";

interface PlutoActivityFeedProps {
  events: PlutoEvent[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  /** Scrolls inside the card past this many entries' worth of height (the Live tab); the Event log grows. */
  scroll?: boolean;
  context?: PlutoFeedContext;
}

/** Events newest first, with a day label wherever the day changes (today has none). */
export function PlutoActivityFeed({ events, loading, error, emptyMessage, scroll = false, context }: PlutoActivityFeedProps) {
  if (error) return <div className="alert alert-danger pm-error mb-0">{error}</div>;
  if (loading) return <div className="pm-empty"><Spinner size="sm" label="Loading activity" /></div>;
  if (events.length === 0) return <div className="pm-empty">{emptyMessage}</div>;
  const today = todayInEasternIso();
  let currentDay: string | null = null;
  return (
    <ul className={`pm-feed${scroll ? " scroll" : ""}`}>
      {events.map((event) => {
        const entry = describeFeedEvent(event, context);
        const day = easternIsoDate(event.occurredAt);
        const showDay = day !== today && day !== currentDay;
        currentDay = day;
        return (
          <li key={event.id}>
            {showDay && <span className="ev-day">{formatDayMonth(day)}</span>}
            <time dateTime={event.occurredAt} title={formatEasternTime(event.occurredAt)}>{formatEasternTime(event.occurredAt).replace(" ET", "")}</time>
            <i className={`ev-dot ${entry.dot}`} aria-hidden="true" />
            <div>
              <div className="ev-t">
                <b>{entry.title}</b>
                {entry.detail ? ` · ${entry.detail}` : ""}
              </div>
              {entry.sub && <div className="ev-s">{entry.sub}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
