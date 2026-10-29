import { useCallback, useEffect, useState } from "react";
import { fetchTradingSessions } from "../api/systemHealth";
import type { TradingSessions } from "../lib/tradingSessions";
import { usePollWhileVisible } from "./usePollWhileVisible";

const TRADING_SESSIONS_POLL_INTERVAL_MS = 5 * 60_000;

// The sessions the screens' premium yields count (lib/tradingSessions.ts), from the server's market calendar. The session
// an order would fill in moves on at each close, so the list is fetched again every 5 minutes while the tab is visible.
// Null until the first answer: the yields show "—" until then.
export function useTradingSessions(): TradingSessions | null {
  const [sessions, setSessions] = useState<TradingSessions | null>(null);
  const refresh = useCallback(() => {
    fetchTradingSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);
  usePollWhileVisible(refresh, TRADING_SESSIONS_POLL_INTERVAL_MS);

  return sessions;
}
