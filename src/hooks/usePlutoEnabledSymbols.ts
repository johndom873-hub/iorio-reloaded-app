import { useEffect, useState } from "react";
import { openNotificationStream } from "../api/notifications";
import { fetchPlutoTickers } from "../api/pluto";

/**
 * The tickers Pluto may trade (the Pluto switch on), for the "P" marks on Signals and Pulse and the ticker modal's Pluto badge.
 * Read once, then again whenever a ticker's Pluto switch changes (the ticker_enabled / ticker_disabled Pluto events). Empty
 * until loaded or when the read fails: the marks are informative, never blocking.
 */
export function usePlutoEnabledSymbols(): Set<string> {
  const [symbols, setSymbols] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPlutoTickers()
        .then(({ tickers }) => {
          if (!cancelled) setSymbols(new Set(tickers.filter((ticker) => ticker.botEnabled).map((ticker) => ticker.symbol)));
        })
        .catch(() => {});
    };
    load();
    const close = openNotificationStream((notification) => {
      if (notification.type === "pluto_event" && (notification.eventType === "ticker_enabled" || notification.eventType === "ticker_disabled")) load();
    });
    return () => {
      cancelled = true;
      close();
    };
  }, []);
  return symbols;
}
