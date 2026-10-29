// The trading sessions a sold option ties up its capital, every premium yield a year being × 252 ÷ that (Marcelo
// 2026-10-29), as the server counts them (iorio-reloaded-api src/lib/tradingSessionsHeld.ts): from the session an order
// placed now fills in (today's until the close, else the next one) to the expiry's, both counted in full. Weekends and
// holidays count for nothing: a Friday 0DTE is held 1 session, Thursday for Friday 2, Monday for Friday 5.

/** Trading sessions in a year. */
export const tradingSessionsPerYear = 252;

/** The server's session list (GET /system-health/trading-sessions). */
export interface TradingSessions {
  /** The session an order placed now fills in. */
  saleSessionIso: string;
  /** Every session from it on, ascending ISO dates. */
  openDays: readonly string[];
}

/** The sessions an option expiring on `expiryIso` (ISO date) is held if sold now, at least 1. */
export function sessionsHeldToExpiry(sessions: TradingSessions, expiryIso: string): number {
  let low = 0;
  let high = sessions.openDays.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sessions.openDays[middle]! <= expiryIso) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}
