import { useCallback, useEffect, useState } from "react";
import { setHiddenTabPauseDisabled } from "../api/streamMultiplexer";

const storageKey = "pulse.keepLiveInBackground";

function readStoredSetting(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

/**
 * Pulse's "keep live in background" setting: off by default, remembered in localStorage. While Pulse is
 * mounted and the setting is on, the stream multiplexer keeps its market-data streams open in a hidden tab;
 * leaving Pulse restores the normal hidden-tab pause for whatever page comes next.
 */
export function useKeepLiveInBackground(): { isKeepingLive: boolean; setIsKeepingLive: (isKeepingLive: boolean) => void } {
  const [isKeepingLive, setIsKeepingLiveState] = useState(readStoredSetting);

  useEffect(() => {
    setHiddenTabPauseDisabled(isKeepingLive);
    return () => setHiddenTabPauseDisabled(false);
  }, [isKeepingLive]);

  const setIsKeepingLive = useCallback((nextValue: boolean) => {
    setIsKeepingLiveState(nextValue);
    try {
      window.localStorage.setItem(storageKey, String(nextValue));
    } catch {
      // Storage unavailable — the setting just won't persist.
    }
  }, []);

  return { isKeepingLive, setIsKeepingLive };
}
