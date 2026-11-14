import type { OrderRequest } from "../api/positions";
import { formatTransactionPrice } from "./formatters";

// Follow the mid on a person's orders (Marcelo 2026-11-14): the API's manualFollowTheMidSide (lib/orderLimitPriceChanges.ts)
// decides which orders may follow; this mirrors it so Order Review offers the checkbox only where the confirm accepts it.

/** A single-leg Call or Put sale, or a LEAPS buy, not built by Pluto. */
export function canOrderFollowTheMid(order: Pick<OrderRequest, "requestType" | "payload"> & { plutoActionId?: string | null }): boolean {
  if (order.plutoActionId || order.payload.legs.length !== 1) return false;
  const leg = order.payload.legs[0]!;
  if (leg.role !== "option") return false;
  if (order.requestType === "open_covered_call" || order.requestType === "open_cash_secured_put") return leg.action === "SELL";
  return order.requestType === "open_leaps" && leg.action === "BUY";
}

/** "Following the mid · limit moved 2 times (1.50 → 1.42)", or "· limit not moved yet"; "Followed" once the order is done. */
export function describeFollowTheMid(order: Pick<OrderRequest, "payload">, stillWorking: boolean): string {
  const moves = (order.payload.limitPriceChanges ?? []).filter((change) => !change.refused);
  const lead = stillWorking ? "Following the mid" : "Followed the mid";
  if (moves.length === 0) return `${lead} · limit not moved${stillWorking ? " yet" : ""}`;
  const first = moves[0]!.from;
  const last = moves[moves.length - 1]!.to;
  return `${lead} · limit moved ${moves.length} time${moves.length === 1 ? "" : "s"} (${formatTransactionPrice(first)} → ${formatTransactionPrice(last)})`;
}
