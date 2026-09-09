import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

const QUERY_PARAM = "ticker";

/**
 * Same [value, setValue] shape as the useState<string | null> this replaces
 * on every page that opens TickerDetailModal — backed by a `?ticker=` query
 * param instead of local state, so a browser refresh with the modal open
 * reopens it on the same symbol instead of losing it. `replace: true` keeps
 * opening/closing the modal from spamming browser history.
 */
export function useTickerDetailSymbol(): [string | null, (symbol: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const symbol = searchParams.get(QUERY_PARAM);

  const setSymbol = useCallback(
    (next: string | null) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next) params.set(QUERY_PARAM, next);
          else params.delete(QUERY_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [symbol, setSymbol];
}
