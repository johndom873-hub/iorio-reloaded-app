// What a trader (the non-admin access level) is told where a control is admin-only. The screens mirror the API's 403
// refusals (routes/positions.ts, routes/shortlist.ts) so a trader never meets one; the open/roll text is the API's own.

export const adminOnlyPlutoSwitchReason = "Only an admin can switch Pluto on or off for a ticker.";

export const adminOnlyShortlistRemoveReason = "Only an admin can remove a ticker from the Shortlist.";

export function plutoTickerSignalsOffAdminOnlyReason(symbol: string): string {
  return `Pluto trades ${symbol}: turning Signals off would switch Pluto off. Only an admin can do that.`;
}

/** Why a trader cannot open or roll on this ticker (Pluto trades it), or null when they can. Closing is never blocked. */
export function plutoTickerOpenOrRollRefusal(symbol: string, { isAdmin, plutoTradesSymbol }: { isAdmin: boolean; plutoTradesSymbol: boolean }): string | null {
  return !isAdmin && plutoTradesSymbol ? `Pluto trades ${symbol}, so only an admin can open or roll on it.` : null;
}
