import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { fetchBacktestOverview, type BacktestOverview } from "../../api/backtest";
import { usePollWhileVisible } from "../../hooks/usePollWhileVisible";
import { reuseUnchangedValues } from "../../lib/structuralSharing";
import { fastPollIntervalMs, idlePollIntervalMs, isBacktestJobActive } from "../../lib/backtestPresentation";

// Progress lives in the API's database (each job runs in its own process), so the screens only poll: every 2 s while a job
// can still move, every 15 s otherwise. A failed poll (the API restarting, a dropped connection) keeps the last data on
// screen and tries again on the next tick; the "cannot reach the API" note waits until the polls have failed for
// refreshFailureNoticeAfterMs, as the local API restarts in a few seconds whenever its code changes and a note that comes
// and goes moves the whole page.

const refreshFailureNoticeAfterMs = 15_000;

export const backtestRoutesMissingMessage =
  "This API has no backtest routes. They run only on the Mac with the ThetaData files: set BACKTEST_DATA_DIR in the API's .env and restart it.";

/** The API's catch-all answer for a route it does not have (app.ts), as opposed to a route's own 404 (a deleted session). */
export function isBacktestRoutesMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.message === "Not found.";
}

export interface PolledResource<TData> {
  data: TData | null;
  /** Set while there is nothing to show yet and the last attempt failed. */
  loadError: string | null;
  /** The refreshes have failed for refreshFailureNoticeAfterMs or longer while older data is still on screen. */
  refreshFailing: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads `fetcher` once, then polls it while the tab is visible: fast while `isActive(data)` says it can still change, slow
 * otherwise, and not at all when `isActive` returns null (finished, nothing left to change).
 */
export function usePolledBacktestResource<TData>(fetcher: () => Promise<TData>, isActive: (data: TData) => boolean | null, fallbackMessage: string): PolledResource<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshFailing, setRefreshFailing] = useState(false);
  const [pollMode, setPollMode] = useState<"fast" | "idle" | "off">("fast");
  const failingSinceMsRef = useRef<number | null>(null);
  const fetcherRef = useRef(fetcher);
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    fetcherRef.current = fetcher;
    isActiveRef.current = isActive;
  });

  const reload = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      // An unchanged poll keeps the previous object (no re-render); a changed one keeps every unchanged part's reference.
      setData((previous) => (previous === null ? next : reuseUnchangedValues<TData>(previous, next)));
      setLoadError(null);
      failingSinceMsRef.current = null;
      setRefreshFailing(false);
      const active = isActiveRef.current(next);
      setPollMode(active === null ? "off" : active ? "fast" : "idle");
    } catch (err) {
      failingSinceMsRef.current ??= Date.now();
      setRefreshFailing(Date.now() - failingSinceMsRef.current >= refreshFailureNoticeAfterMs);
      // A request the API refuses (a deleted session, a bad id) will not fix itself: stop. A dropped connection or a
      // restarting API (no response, 5xx) keeps the current pace and recovers on the next tick.
      if (isBacktestRoutesMissing(err)) setPollMode("idle");
      else if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) setPollMode("off");
      setLoadError(isBacktestRoutesMissing(err) ? backtestRoutesMissingMessage : errorMessage(err, fallbackMessage));
    }
  }, [fallbackMessage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const poll = useCallback(() => {
    if (pollMode !== "off") void reload();
  }, [pollMode, reload]);
  usePollWhileVisible(poll, pollMode === "fast" ? fastPollIntervalMs : idlePollIntervalMs);

  return { data, loadError: data === null ? loadError : null, refreshFailing, reload };
}

export function useBacktestOverview(): PolledResource<BacktestOverview> {
  const isActive = useCallback((overview: BacktestOverview) => overview.jobs.some((job) => isBacktestJobActive(job, new Date())), []);
  return usePolledBacktestResource(fetchBacktestOverview, isActive, "Could not load the backtesting overview.");
}
