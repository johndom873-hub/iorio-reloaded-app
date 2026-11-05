import type { PlutoVolFarmerV4Option, PlutoVolFarmerV4Ticker } from "../api/pluto";
import { browserLocalIsoDate, daysToExpiry, formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatOptionContractLabel, pluralize } from "./formatters";

// The Live tab's Vol Farmer v4 card (approved mockup, 2026-10-28): each v4 ticker's positions, LEAPS, working orders and
// last round in plain words, and its warnings (Marcelo 2026-10-28) from the figures its last round read.

/** "$114 Call · 30 Oct (3DTE) · 4×", "· working" while its order works. */
export function describeVolFarmerV4Option(option: PlutoVolFarmerV4Option, right: "C" | "P", todayIso: string): string {
  const label = formatOptionContractLabel({ strike: option.strike, right, expiry: option.expiry, dte: daysToExpiry(option.expiry, todayIso) });
  return `${label} · ${option.contracts}×${option.working ? " · working" : ""}`;
}

const workingOrderVerbs = { covered_call: "Sell", cash_secured_put: "Sell", buy_leaps: "Buy", sell_leaps: "Sell", buy_shares: "Buy", sell_shares: "Sell" } as const;

/** "Sell $95 Put · 6 Nov (9DTE) · 2× at the mid"; a share order "Buy 900 shares at the mid". */
export function describeVolFarmerV4WorkingOrder(order: PlutoVolFarmerV4Ticker["workingOrders"][number], todayIso: string): string {
  if (order.kind === "buy_shares" || order.kind === "sell_shares") return `${workingOrderVerbs[order.kind]} ${order.shares ?? "?"} shares at the mid`;
  const right = order.kind === "cash_secured_put" ? "P" : "C";
  const label = formatOptionContractLabel({ strike: order.strike, right, expiry: order.expiry, dte: daysToExpiry(order.expiry, todayIso) });
  return `${workingOrderVerbs[order.kind]} ${order.kind === "buy_leaps" || order.kind === "sell_leaps" ? "LEAPS " : ""}${label} · ${order.contracts}× at the mid`;
}

/** What the last round noted about the ticker; a round that noted nothing planned nothing (an order it sent shows as the last order). */
export function volFarmerV4LastRoundLines(ticker: PlutoVolFarmerV4Ticker): string[] {
  if (ticker.lastRoundNotes.length > 0) return ticker.lastRoundNotes.map((note) => note.charAt(0).toUpperCase() + note.slice(1));
  if (ticker.lastRoundAt === null) return ["Not looked at yet"];
  return ["Nothing planned"];
}

/** "Last order Nov 5 12:47 AM: Sell 10 × $46 Call · 4 Nov (0DTE), limit $0.27, filled at $0.37", in the viewer's clock (today: the time alone). */
export function describeVolFarmerV4LastOrder(lastOrder: NonNullable<PlutoVolFarmerV4Ticker["lastOrder"]>): string {
  const sentOnAnotherDay = browserLocalIsoDate(lastOrder.at) !== browserLocalIsoDate(new Date());
  const when = `${sentOnAnotherDay ? `${formatBrowserDayMonth(lastOrder.at)} ` : ""}${formatBrowserClockTime(lastOrder.at)}`;
  return `Last order ${when}: ${lastOrder.text}`;
}

/** "5 orders sent today were cancelled unfilled". */
export function describeVolFarmerV4CancelledToday(count: number): string {
  return `${pluralize(count, "order")} sent today ${count === 1 ? "was" : "were"} cancelled unfilled`;
}

/**
 * The ticker's warnings, from its last round's figures (Marcelo 2026-10-28):
 * - Puts: v4 sells them on the rest of the pot after the First position's share, and the pot check refuses an order
 *   taking what the ticker commits above the pot, so they would be refused once it commits more than the pot less that
 *   rest. COIN commits $40,000 of a $64,007 pot with the Puts on half: $40,000 + $32,004 = $72,004 > $64,007.
 * - LEAPS: once both positions hold shares and a LEAPS may still be bought, less free cash than the LEAPS cap buys it
 *   short of its count.
 */
export function volFarmerV4Warnings(ticker: PlutoVolFarmerV4Ticker): { symbol: string; text: string }[] {
  const figures = ticker.lastRoundFigures;
  if (figures === null) return [];
  // Each text follows the ticker's symbol, which the card shows as its ticker button.
  const warnings: { symbol: string; text: string }[] = [];
  const putsDollars = figures.putsDollars ?? figures.potDollars / 2;
  if (figures.committedDollars > figures.potDollars - putsDollars) {
    warnings.push({ symbol: ticker.symbol, text: ` commits ${formatCurrency(figures.committedDollars, 0)} of its ${formatCurrency(figures.potDollars, 0)} pot: a v4 Put on the rest of the pot (${formatCurrency(putsDollars, 0)}) would be refused by the pot check.` });
  }
  const bothPositionsHoldShares = (ticker.first?.shares ?? 0) > 0 && (ticker.second?.shares ?? 0) > 0;
  const leapsComplete = ticker.leaps !== null && ticker.leaps.heldContracts >= ticker.leaps.intendedContracts;
  if (bothPositionsHoldShares && !leapsComplete && figures.freeCashDollars < figures.leapsCapDollars) {
    warnings.push({ symbol: ticker.symbol, text: `'s two positions hold shares and ${formatCurrency(figures.freeCashDollars, 0)} of Pluto's budget is free, less than its ${formatCurrency(figures.leapsCapDollars, 0)} LEAPS cap: a LEAPS would be bought short of its count.` });
  }
  return warnings;
}

/** "3 of 5 held · topping up", "5 held". */
export function describeVolFarmerV4LeapsHeld(leaps: NonNullable<PlutoVolFarmerV4Ticker["leaps"]>): string {
  return leaps.heldContracts < leaps.intendedContracts ? `${leaps.heldContracts} of ${leaps.intendedContracts} held · topping up` : `${pluralize(leaps.heldContracts, "contract")} held`;
}
