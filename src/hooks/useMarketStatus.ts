import { useCallback, useEffect, useState } from "react";
import { fetchMarketStatus, type MarketStatus } from "../api/systemHealth";
import { usePollWhileVisible } from "./usePollWhileVisible";

const MARKET_STATUS_POLL_INTERVAL_MS = 60_000;
const SESSION_CHANGE_REFETCH_DELAY_MS = 1000;
const LONGEST_TIMEOUT_MS = 2_147_483_647;

// Server-computed from the real exchanges the book actually trades on
// (tickers.primary_exchange) plus market_calendar's holiday coverage — see
// src/lib/marketSessionStatus.ts in the API repo. Polled rather than
// computed client-side since it depends on that DB state, not just the
// current time. Also refetched right after the session boundary it counts
// down to, so the state flips without waiting for the next poll.
export function useMarketStatus(): MarketStatus | null {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const refresh = useCallback(() => {
    fetchMarketStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);
  usePollWhileVisible(refresh, MARKET_STATUS_POLL_INTERVAL_MS);

  useEffect(() => {
    if (!status) return;
    const delayMs = new Date(status.nextChangeAt).getTime() - Date.now() + SESSION_CHANGE_REFETCH_DELAY_MS;
    if (delayMs <= 0 || delayMs > LONGEST_TIMEOUT_MS) return;
    const timeoutHandle = setTimeout(refresh, delayMs);
    return () => clearTimeout(timeoutHandle);
  }, [status, refresh]);

  return status;
}
