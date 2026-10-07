import type { PlutoEvent } from "../../api/pluto";
import { browserLocalIsoDate, browserUsesTwelveHourClock, formatBrowserClockTime, formatBrowserClockTimeWithSeconds, formatBrowserDateTimeWithZone, formatDayMonth } from "../../lib/formatters";
import { describeEventPayloadFields, describeFeedEvent, plutoEventCategoryLabel, type PlutoFeedContext } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";

interface PlutoActivityFeedProps {
  events: PlutoEvent[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  /** Scrolls inside the card past this many entries' worth of height (the Live tab); the Event log grows. */
  scroll?: boolean;
  context?: PlutoFeedContext;
  /** The Event log: time to the second, and under each entry its category, type, id and every stored field. */
  showAllFields?: boolean;
}

/** Events newest first, in the viewer's own time and clock style, with a day label wherever the local day changes (today has none). */
export function PlutoActivityFeed({ events, loading, error, emptyMessage, scroll = false, context, showAllFields = false }: PlutoActivityFeedProps) {
  if (error) return <div className="alert alert-danger pm-error mb-0">{error}</div>;
  if (loading) return <div className="pm-empty"><Spinner size="sm" label="Loading activity" /></div>;
  if (events.length === 0) return <div className="pm-empty">{emptyMessage}</div>;
  const today = browserLocalIsoDate(new Date());
  let currentDay: string | null = null;
  return (
    <ul className={`pm-feed${scroll ? " scroll" : ""}${browserUsesTwelveHourClock() ? " h12" : ""}${showAllFields ? " seconds" : ""}`}>
      {events.map((event) => {
        const entry = describeFeedEvent(event, context);
        const day = browserLocalIsoDate(event.occurredAt);
        const showDay = day !== today && day !== currentDay;
        currentDay = day;
        return (
          <li key={event.id}>
            {showDay && <span className="ev-day">{formatDayMonth(day)}</span>}
            <time dateTime={event.occurredAt} title={formatBrowserDateTimeWithZone(event.occurredAt)}>{showAllFields ? formatBrowserClockTimeWithSeconds(event.occurredAt) : formatBrowserClockTime(event.occurredAt)}</time>
            <i className={`ev-dot ${entry.dot}`} aria-hidden="true" />
            <div>
              <div className="ev-t">
                <b>{entry.title}</b>
                {entry.detail ? ` · ${entry.detail}` : ""}
              </div>
              {entry.sub && <div className="ev-s">{entry.sub}</div>}
              {showAllFields && (
                <dl className="ev-fields">
                  <div>
                    <dt>Event</dt>
                    <dd>{plutoEventCategoryLabel(event.category)} · {event.type} · #{event.id}</dd>
                  </div>
                  {describeEventPayloadFields(event.payload).map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd className={field.structured ? "mono" : undefined}>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
