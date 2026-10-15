import { useMemo } from "react";
import type { FrozenTicker } from "../api/environment";
import { useSharedEnvironmentStatus } from "./useEnvironmentStatus";

/**
 * The frozen tickers by symbol, from the top bar's environment poll (AppLayout shares it, no second poller). Empty until
 * the first answer: the badges are informative, the server refuses a frozen ticker's orders on its own.
 */
export function useFrozenTickers(): Map<string, FrozenTicker> {
  const frozenTickers = useSharedEnvironmentStatus()?.details?.frozenTickers;
  return useMemo(() => new Map((frozenTickers ?? []).map((ticker) => [ticker.symbol, ticker])), [frozenTickers]);
}

/** The sentence every Frozen badge, disabled button and blocked form shows. */
export function describeFrozenTicker(ticker: FrozenTicker): string {
  return `${ticker.symbol} is frozen: ${ticker.reason}. No orders, no Pluto, and the position sync leaves it alone until its records are rewritten to the new basis and it is unfrozen.`;
}
