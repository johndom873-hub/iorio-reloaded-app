import { useEffect } from "react";

/** Calls `callback` every `intervalMs` while the tab is visible, and once each time it becomes visible again. */
export function usePollWhileVisible(callback: () => void, intervalMs: number): void {
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") callback();
    }, intervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") callback();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [callback, intervalMs]);
}
