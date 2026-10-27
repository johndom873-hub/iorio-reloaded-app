import { formatMonthDay } from "./formatters";

// Presentation helpers for the Ticker modal's option chain (moved out of signalsPresentation.ts 2026-10-27).

/** "Nov 6 10D": an expiry tab. */
export function describeChainExpiryTab(expiry: { expiry: string; dte: number }): string {
  return `${formatMonthDay(expiry.expiry)} ${expiry.dte}D`;
}

/** In the money at the live spot: a call struck below it, a put struck above it. The chain sells out-of-the-money contracts, so it blanks these. */
export function isChainContractInTheMoney(right: "C" | "P", strike: number, spotPrice: number | null): boolean {
  if (spotPrice === null) return false;
  return right === "C" ? strike < spotPrice : strike > spotPrice;
}
