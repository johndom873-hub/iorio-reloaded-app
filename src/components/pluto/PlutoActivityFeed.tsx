import type { PlutoEvent } from "../../api/pluto";
import { browserLocalIsoDate, browserUsesTwelveHourClock, formatBrowserClockTime, formatBrowserDateTimeWithZone, formatDayMonth } from "../../lib/formatters";
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

/** Events newest first, in the viewer's own time and clock style, with a day label wherever the local day changes (today has none). */
export function PlutoActivityFeed({ events, loading, error, emptyMessage, scroll = false, context }: PlutoActivityFeedProps) {
  if (error) return <div className="alert alert-danger pm-error mb-0">{error}</div>;
  if (loading) return <div className="pm-empty"><Spinner size="sm" label="Loading activity" /></div>;
  if (events.length === 0) return <div className="pm-empty">{emptyMessage}</div>;
  const today = browserLocalIsoDate(new Date());
  let currentDay: string | null = null;
  return (
    <ul className={`pm-feed${scroll ? " scroll" : ""}${browserUsesTwelveHourClock() ? " h12" : ""}`}>
      {events.map((event) => {
        const entry = describeFeedEvent(event, context);
        const day = browserLocalIsoDate(event.occurredAt);
        const showDay = day !== today && day !== currentDay;
        currentDay = day;
        return (
          <li key={event.id}>
            {showDay && <span className="ev-day">{formatDayMonth(day)}</span>}
            <time dateTime={event.occurredAt} title={formatBrowserDateTimeWithZone(event.occurredAt)}>{formatBrowserClockTime(event.occurredAt)}</time>
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
