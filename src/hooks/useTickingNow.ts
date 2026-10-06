import { useEffect, useState } from "react";

const secondTickMs = 1000;
const minuteTickMs = 10_000;
const freshAgeMs = 60_000;

/**
 * The current time, kept fresh for relative labels ("12s ago") and countdowns ("opens in 45s"): ticks every second while the
 * newest timestamp is under a minute old or an upcoming one is under a minute (plus one slow tick) away, every 10s otherwise.
 */
export function useTickingNow(newestTimestamp: string | null | undefined, upcomingTimestamps: (string | null | undefined)[] = []): Date {
  const [now, setNow] = useState(() => new Date());
  // A string key, so a new array with the same timestamps on every render doesn't restart the timer.
  const upcomingKey = upcomingTimestamps.filter(Boolean).join("|");

  useEffect(() => {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const scheduleNextTick = () => {
      const currentTime = new Date();
      setNow(currentTime);
      const newestAgeMs = newestTimestamp ? currentTime.getTime() - new Date(newestTimestamp).getTime() : Infinity;
      const upcomingSoon = upcomingKey
        .split("|")
        .filter(Boolean)
        .some((timestamp) => {
          const untilMs = new Date(timestamp).getTime() - currentTime.getTime();
          return untilMs > -secondTickMs && untilMs < freshAgeMs + minuteTickMs;
        });
      timeoutHandle = setTimeout(scheduleNextTick, newestAgeMs < freshAgeMs || upcomingSoon ? secondTickMs : minuteTickMs);
    };
    scheduleNextTick();
    return () => clearTimeout(timeoutHandle);
  }, [newestTimestamp, upcomingKey]);

  return now;
}
