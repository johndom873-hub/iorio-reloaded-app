import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";

export const historyPageSize = 50;

export interface PlutoHistoryPageInfo {
  page: number;
  pageCount: number;
  total: number;
  firstShown: number;
  lastShown: number;
  goToPage: (page: number) => void;
  loading: boolean;
}

/**
 * One page of a History list (Orders, Model decisions) fetched from the API, as the Event log pages: a filter change goes
 * back to page 1, and the refresh token reloads page 1 only, so a later page does not shift under the reader.
 * `filterKey` stands for the filters' content; `fetchPage` is read at fetch time, so it may be a new function every render.
 */
export function usePlutoHistoryPage<Row>(fetchPage: (limit: number, offset: number) => Promise<{ rows: Row[]; total: number }>, filterKey: string, refreshToken: number, errorText: string) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const pageCount = Math.max(1, Math.ceil(total / historyPageSize));
  const liveRefreshToken = page === 1 ? refreshToken : null;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPageRef
      .current(historyPageSize, (page - 1) * historyPageSize)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, errorText));
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

  const pageInfo: PlutoHistoryPageInfo = {
    page,
    pageCount,
    total,
    firstShown: total === 0 ? 0 : (page - 1) * historyPageSize + 1,
    lastShown: Math.min(page * historyPageSize, total),
    goToPage: (next) => setPage(Math.min(Math.max(1, next), pageCount)),
    loading,
  };
  return { rows, error, pageInfo };
}
