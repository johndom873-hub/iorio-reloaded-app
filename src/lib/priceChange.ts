import type { MarketSessionState } from "../api/systemHealth";

// Percent move of a price against a reference close — the one formula behind
// every change column on Price Performance. The backend computes the same thing
// for the static (last-close) values with the identical rule
// (pricePerformanceSnapshot.ts's percentChange); the browser applies it to the
// live price once one arrives, using the reference closes the page loaded.
// Null when there is no reference close or it is zero.
export function percentChange(currentPrice: number, referenceClose: number | null): number | null {
  if (referenceClose === null || referenceClose === 0) return null;
  return ((currentPrice - referenceClose) / referenceClose) * 100;
}

export interface ExtendedSessionPriceChange {
  sessionLabel: "Pre-market" | "After hours";
  livePrice: number;
  change: number;
  changePercent: number | null;
}

// The live price outside the regular session against the official close of the newest finished one, e.g. IREN after
// hours: 24.84 against 26.25 is -1.41 (-5.37%). Null while the regular session is open, or when either price is
// missing. After hours the close must be today's: a modal left open across 16:00 ET still holds the day before's.
export function extendedSessionPriceChange(
  marketState: MarketSessionState | null,
  livePrice: number | null,
  lastRegularSessionClose: { tradingDate: string; close: number } | null,
  todayEasternIso: string,
): ExtendedSessionPriceChange | null {
  if (marketState === null || marketState === "open" || livePrice === null || !lastRegularSessionClose) return null;
  if (marketState === "after-hours" && lastRegularSessionClose.tradingDate !== todayEasternIso) return null;
  return {
    sessionLabel: marketState === "pre-market" ? "Pre-market" : "After hours",
    livePrice,
    change: livePrice - lastRegularSessionClose.close,
    changePercent: percentChange(livePrice, lastRegularSessionClose.close),
  };
}
