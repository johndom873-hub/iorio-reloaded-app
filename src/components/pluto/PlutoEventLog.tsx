import { useEffect, useRef, useState } from "react";
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
  const handledRefreshToken = useRef(refreshToken);
  useEffect(() => {
    let cancelled = false;
    // A reload for a new event only matters on the first page; later pages would shift under the reader.
    const isLiveRefresh = handledRefreshToken.current !== refreshToken;
    handledRefreshToken.current = refreshToken;
    if (isLiveRefresh && page !== 1) return;
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
    // filterKey stands for the filters' content; refreshToken re-runs this for live events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, refreshToken]);

  useEffect(() => {
    onPageInfo({ page, pageCount, total, firstShown: total === 0 ? 0 : (page - 1) * eventLogPageSize + 1, lastShown: Math.min(page * eventLogPageSize, total), goToPage: (next) => setPage(Math.min(Math.max(1, next), pageCount)), loading });
  }, [page, pageCount, total, loading, onPageInfo]);

  return <PlutoActivityFeed events={events} loading={loading && events.length === 0} error={error} emptyMessage="No events match these filters." context={context} showAllFields />;
}
