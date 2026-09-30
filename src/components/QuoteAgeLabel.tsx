import { useEffect, useState } from "react";
import { quoteAgeCellLabel } from "../lib/signalsPresentation";

const secondsCountTickMs = 1000;
const minutesCountTickMs = 10_000;
const freshQuoteMaxAgeMs = 60_000;

/** A quote's age ("12s", "3m", "1h 05m") that keeps itself current: ticks every second while under a minute old, every 10s after. */
export function QuoteAgeLabel({ quotedAt }: { quotedAt: string | null | undefined }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!quotedAt) return;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const scheduleNextTick = () => {
      const currentTime = new Date();
      setNow(currentTime);
      const ageMs = currentTime.getTime() - new Date(quotedAt).getTime();
      timeoutHandle = setTimeout(scheduleNextTick, ageMs < freshQuoteMaxAgeMs ? secondsCountTickMs : minutesCountTickMs);
    };
    scheduleNextTick();
    return () => clearTimeout(timeoutHandle);
  }, [quotedAt]);

  return <>{quoteAgeCellLabel(quotedAt, now)}</>;
}
