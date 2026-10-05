import { useEffect, useState } from "react";

const secondTickMs = 1000;
const minuteTickMs = 10_000;
const freshAgeMs = 60_000;

/** The current time, kept fresh for relative labels ("12s ago"): ticks every second while the newest timestamp is under a minute old, every 10s after. */
export function useTickingNow(newestTimestamp: string | null | undefined): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const scheduleNextTick = () => {
      const currentTime = new Date();
      setNow(currentTime);
      const newestAgeMs = newestTimestamp ? currentTime.getTime() - new Date(newestTimestamp).getTime() : Infinity;
      timeoutHandle = setTimeout(scheduleNextTick, newestAgeMs < freshAgeMs ? secondTickMs : minuteTickMs);
    };
    scheduleNextTick();
    return () => clearTimeout(timeoutHandle);
  }, [newestTimestamp]);

  return now;
}
