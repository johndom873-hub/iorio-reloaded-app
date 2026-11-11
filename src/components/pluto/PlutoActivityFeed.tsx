import type { PlutoEvent } from "../../api/pluto";
import { easternIsoDate, formatDayMonth, formatDayMonthYear, formatEasternDateTime, formatEasternTime, formatEasternTimeWithSeconds } from "../../lib/formatters";
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
  /** The Event log: a date on every row, time to the second, under each entry its type, id and every stored field, and a model call's inputs on demand. */
  showAllFields?: boolean;
  /** The Event log's ticker filter: when set, events that apply to every ticker are muted and tagged as such. */
  tickerFilter?: string;
}

/** Events newest first, in US/Eastern time (Marcelo 2026-11-11: Pluto's events are trading events), with a day label wherever the ET day changes (today has none). */
export function PlutoActivityFeed({ events, loading, error, emptyMessage, scroll = false, context, showAllFields = false, tickerFilter = "" }: PlutoActivityFeedProps) {
  if (error) return <div className="alert alert-danger pm-error mb-0">{error}</div>;
  if (loading) return <div className="pm-empty"><Spinner size="sm" label="Loading activity" /></div>;
  if (events.length === 0) return <div className="pm-empty">{emptyMessage}</div>;
  const today = easternIsoDate(new Date());
  let currentDay: string | null = null;
  return (
    <ul className={`pm-feed${scroll ? " scroll" : ""}${showAllFields ? " seconds" : ""}`}>
      {events.map((event) => {
        const entry = describeFeedEvent(event, context);
        const day = easternIsoDate(event.occurredAt);
        // The Event log dates every row, so it needs no day separators.
        const showDay = !showAllFields && day !== today && day !== currentDay;
        currentDay = day;
        const forAllTickers = showAllFields && tickerFilter.trim() !== "" && event.appliesToAllTickers === true;
        const time = <time dateTime={event.occurredAt} title={formatEasternDateTime(event.occurredAt)}>{showAllFields ? formatEasternTimeWithSeconds(event.occurredAt) : formatEasternTime(event.occurredAt)}</time>;
        return (
          <li key={event.id} className={forAllTickers ? "ev-all-tickers" : undefined}>
            {showDay && <span className="ev-day">{formatDayMonth(day)}</span>}
            {showAllFields ? (
              <div className="ev-when">
                <span className="ev-date">{formatDayMonthYear(day)}</span>
                {time}
              </div>
            ) : (
              time
            )}
            <i className={`ev-dot ${entry.dot}`} aria-hidden="true" />
            <div>
              <div className="ev-t">
                <span className="ev-cat">{plutoEventCategoryLabel(event.category)}</span>
                {" · "}
                <b>{entry.title}</b>
                {entry.detail ? ` · ${entry.detail}` : ""}
                {forAllTickers && <span className="ev-tag">All tickers</span>}
              </div>
              {entry.sub && <div className="ev-s">{entry.sub}</div>}
              {showAllFields && (
                <dl className="ev-fields">
                  <div>
                    <dt>Event</dt>
                    <dd>{event.type} · #{event.id}</dd>
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
