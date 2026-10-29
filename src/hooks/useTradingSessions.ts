import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTradingSessions } from "../api/systemHealth";
import type { TradingSessions } from "../lib/tradingSessions";
import { usePollWhileVisible } from "./usePollWhileVisible";

const TRADING_SESSIONS_POLL_INTERVAL_MS = 5 * 60_000;
const TRADING_SESSIONS_RETRY_MS = 15_000;

// The sessions the screens' premium yields count (lib/tradingSessions.ts), from the server's market calendar. The session
// an order would fill in moves on at each close, so the list is fetched again every 5 minutes while the tab is visible.
// Null until the first answer: the yields show "—" until then, so a failed fetch (the API restarting, say) is tried again
// after 15 seconds rather than at the next poll.
export function useTradingSessions(): TradingSessions | null {
  const [sessions, setSessions] = useState<TradingSessions | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(false);
  const refresh = useCallback(() => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    fetchTradingSessions()
      .then(setSessions)
      .catch(() => {
        if (!isMounted.current) return;
        if (retryTimer.current !== null) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(refresh, TRADING_SESSIONS_RETRY_MS);
      });
  }, []);

  useEffect(() => {
    isMounted.current = true;
    refresh();
    return () => {
      isMounted.current = false;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [refresh]);
  usePollWhileVisible(refresh, TRADING_SESSIONS_POLL_INTERVAL_MS);

  return sessions;
}
