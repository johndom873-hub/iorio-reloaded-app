import { useEffect, useState } from "react";
import { errorMessage } from "../../api/client";

/** One page of a session's actions or fills, read from its paged endpoint whenever `fetchPage` changes (the caller memoizes it
 *  on its filters and offset) or `refreshKey` does (the session's stored count, so a running session's new rows come in).
 *  Nothing is read while `enabled` is false (the card is collapsed). */
export function useBacktestBookPage<TPage>(fetchPage: () => Promise<TPage>, enabled: boolean, fallbackMessage: string, refreshKey: number) {
  const [page, setPage] = useState<TPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetchPage()
      .then((loaded) => {
        if (cancelled) return;
        setPage(loaded);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, fallbackMessage)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, enabled, fallbackMessage, refreshKey]);

  return { page, loading, error };
}
