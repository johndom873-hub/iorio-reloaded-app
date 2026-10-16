import type { OrderLeg, OrderRequest } from "../../api/positions";
import { daysToExpiry, formatOptionContractShort, formatOrderLegPriceText, ibkrExpiryToIsoDate } from "../../lib/formatters";

/** What Latest Events reads of an order: GET /positions/orders/:id, or the order the backfill resolves server-side. */
export type LatestEventsOrder = Pick<OrderRequest, "status" | "cancellationReason" | "legFills"> & { payload: { symbol: string; legs: OrderLeg[] } };

// Latest Events only has room for a short per-leg summary (stock: price;
// option: strike/DTE/price) — the full per-fill detail already lives in
// the Trades panel. A leg shows its average fill price once a fill is
// recorded, else its limit, and a part-filled leg how much filled ("1 of 2").
// DTE is relative to asOf (the event's own time), not
// "today" — a backfilled historical event for an expiry that's since
// passed should show the DTE it actually had then, not a confusing
// negative countdown (mirrors daysToExpiry's asOf convention).
export function formatOrderLegsSummary(legs: OrderLeg[], asOf: string, legFills: LatestEventsOrder["legFills"]): string {
  return legs
    .map((leg, index) => {
      const fill = legFills?.[index];
      const filledQuantity = fill?.filledQuantity ?? 0;
      const quantity = filledQuantity > 0 && filledQuantity < leg.quantity ? `${filledQuantity} of ${leg.quantity}` : `${leg.quantity}`;
      const price = formatOrderLegPriceText(leg.unitPrice, fill?.averageFillPrice);
      if (leg.role === "stock") {
        return `${leg.action} ${quantity} ${price}`;
      }
      const expiryIsoDate = leg.expiry ? (leg.expiry.length === 8 ? ibkrExpiryToIsoDate(leg.expiry) : leg.expiry) : null;
      const contract = leg.strike !== undefined && leg.right ? formatOptionContractShort(leg.strike, leg.right, expiryIsoDate ? daysToExpiry(expiryIsoDate, asOf) : null) : "";
      return `${leg.action} ${quantity} ${contract} ${price}`;
    })
    .join(" + ");
}

/**
 * Whether a filled order's row still lacks fill prices: its trades can land after its "filled" event (a new contract's
 * fill is recorded once the reconciliation creates its leg). Filled: any leg without one; part-filled: no leg with one.
 */
export function orderAwaitsFillPrices(order: LatestEventsOrder): boolean {
  const fillPriceKnown = order.payload.legs.map((_, index) => order.legFills?.[index]?.averageFillPrice != null);
  if (order.status === "filled") return fillPriceKnown.some((known) => !known);
  if (order.status === "partially_filled") return !fillPriceKnown.some((known) => known);
  return false;
}
