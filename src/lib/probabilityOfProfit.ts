// Frontend port of the backend's src/lib/blackScholesPop.ts — same formula,
// same "pending validation" status (see PROGRESS.md's POP entry, 2026-08-30).
// Duplicated rather than shared because Order Review's payoff/breakeven math
// (payoff.ts) is already computed client-side against the live quote stream
// (no spot-price/IV round trip through the backend for those numbers) — this
// keeps POP on the same "pure math against already-streamed data" path
// instead of adding a second live data source just for one more number.
// Surfaced on Order Review 2026-09-02 per Juan's ask (item 4/6 in his
// feedback doc) using the exact same inputs already on screen: live IV from
// the quote stream, strike/premium/DTE from the order itself.

// Abramowitz & Stegun 7.1.26 approximation of the error function, accurate
// to ~1.5e-7 -- standard-normal CDF then follows directly from erf.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function standardNormalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface ProbabilityOfProfitInput {
  spotPrice: number;
  strike: number;
  premium: number;
  impliedVolatility: number;
  daysToExpiry: number;
  right: "call" | "put";
}

/**
 * Probability the short option finishes at or beyond its breakeven price
 * (accounts for the credit received, not raw "expires OTM"). Null when an
 * input is missing or non-physical.
 */
export function computeProbabilityOfProfit(input: ProbabilityOfProfitInput): number | null {
  const { spotPrice, strike, premium, impliedVolatility, daysToExpiry, right } = input;
  if (spotPrice <= 0 || strike <= 0 || impliedVolatility <= 0 || daysToExpiry <= 0) return null;

  const breakeven = right === "call" ? strike + premium : strike - premium;
  if (breakeven <= 0) return null;

  const t = daysToExpiry / 365;
  const d2 = (Math.log(spotPrice / breakeven) - 0.5 * impliedVolatility * impliedVolatility * t) / (impliedVolatility * Math.sqrt(t));

  return right === "call" ? standardNormalCdf(-d2) : standardNormalCdf(d2);
}
