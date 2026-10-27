import type { AppNotification } from "../api/notifications";
import { formatOptionContractShort } from "./formatters";

/** "MU 135P 11DTE, Δ −0.52": an assignment-risk alert on a held short leg (the toast and Latest Events). */
export function describeAssignmentRisk(notification: Extract<AppNotification, { type: "assignment_risk" }>): string {
  const signedDelta = `${notification.delta < 0 ? "−" : ""}${Math.abs(notification.delta).toFixed(2)}`;
  return `${notification.symbol} ${formatOptionContractShort(notification.strike, notification.right, notification.dte)}, Δ ${signedDelta}`;
}
