import { useEffect, useState } from "react";
import { fetchPlutoEventsPage, type PlutoEvent, type PlutoEventFilters } from "../../api/pluto";
import { errorMessage } from "../../api/client";
import type { PlutoFeedContext } from "../../lib/plutoPresentation";
import { PlutoActivityFeed } from "./PlutoActivityFeed";

export const eventLogPageSize = 100;

interface PlutoEventLogProps {
  filters: PlutoEventFilters;
  /** Bumped by the screen when a new event arrives; page 1 reloads, a later page stays as the reader left it. */
  refreshToken: number;
  context: PlutoFeedContext;
  /** Hands the pager's pieces up so the card footer can show them. */
  onPageInfo: (info: { page: number; pageCount: number; total: number; firstShown: number; lastShown: number; goToPage: (page: number) => void; loading: boolean }) => void;
}

/** The Event log's list: one page of 100 events matching the filters, fetched from the API. */
export function PlutoEventLog({ filters, refreshToken, context, onPageInfo }: PlutoEventLogProps) {
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<PlutoEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = `${filters.categories.join(",")}|${filters.ticker.trim().toUpperCase()}|${filters.session}`;
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const pageCount = Math.max(1, Math.ceil(total / eventLogPageSize));
  // A reload for a new event only matters on the first page; later pages would shift under the reader. Keeping the token out
  // of a later page's dependencies also leaves that page's own fetch running when an event arrives mid-load.
  const liveRefreshToken = page === 1 ? refreshToken : null;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPlutoEventsPage(filters, eventLogPageSize, (page - 1) * eventLogPageSize)
      .then((result) => {
        if (cancelled) return;
        setEvents(result.events);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load the events."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // filterKey stands for the filters' content; liveRefreshToken re-runs page 1 for live events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, liveRefreshToken]);

  useEffect(() => {
    onPageInfo({ page, pageCount, total, firstShown: total === 0 ? 0 : (page - 1) * eventLogPageSize + 1, lastShown: Math.min(page * eventLogPageSize, total), goToPage: (next) => setPage(Math.min(Math.max(1, next), pageCount)), loading });
  }, [page, pageCount, total, loading, onPageInfo]);

  const emptyMessage = filters.categories.length === 0 ? "No categories selected. Tick one under Categories to see events." : "No events match these filters.";
  return <PlutoActivityFeed events={events} loading={loading && events.length === 0} error={error} emptyMessage={emptyMessage} context={context} showAllFields tickerFilter={filters.ticker} />;
}
