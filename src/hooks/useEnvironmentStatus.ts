import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchEnvironmentDetails, fetchPublicEnvironment, type EnvironmentDetails, type PublicEnvironment } from "../api/environment";
import { openNotificationStream } from "../api/notifications";

const pollIntervalMs = 30_000;
/** One failed poll is noise; two in a row means the badge can no longer be trusted. */
const consecutiveFailuresBeforeUnknown = 2;

export interface EnvironmentStatus {
  details: EnvironmentDetails | null;
  /** True until the first answer arrives, and again after repeated failures: the badge must then say "unknown", never nothing. */
  unknown: boolean;
}

/**
 * Polls the authenticated environment status every 30 s while the tab is visible, and again when it regains focus.
 * A market-data refusal is also pushed over the notification stream and applied at once, not on the next poll.
 */
export function useEnvironmentStatus(): EnvironmentStatus {
  const [details, setDetails] = useState<EnvironmentDetails | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const isMounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const latest = await fetchEnvironmentDetails();
      if (!isMounted.current) return;
      setDetails(latest);
      setFailureCount(0);
    } catch {
      if (isMounted.current) setFailureCount((count) => count + 1);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const closeNotificationStream = openNotificationStream((notification) => {
      // The kill switch must show in the top bar the moment anyone flips it, not up to 30 s later.
      if (notification.type === "trading_halt_changed") void load();
      if (notification.type !== "market_data_feed") return;
      setDetails((current) => (current ? { ...current, marketDataFeedRefusal: notification.refusal } : current));
    });
    return () => {
      isMounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      closeNotificationStream();
    };
  }, [load]);

  return { details, unknown: details === null || failureCount >= consecutiveFailuresBeforeUnknown };
}

/** AppLayout's EnvironmentStatus, shared with the pages it renders so they don't start a second poller. */
export const EnvironmentStatusContext = createContext<EnvironmentStatus | null>(null);

export function useSharedEnvironmentStatus(): EnvironmentStatus | null {
  return useContext(EnvironmentStatusContext);
}

/** Login page: fetched once, no login required. `null` while loading or if it failed. */
export function usePublicEnvironment(): PublicEnvironment | null | "failed" {
  const [value, setValue] = useState<PublicEnvironment | null | "failed">(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublicEnvironment()
      .then((result) => !cancelled && setValue(result))
      .catch(() => !cancelled && setValue("failed"));
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}
