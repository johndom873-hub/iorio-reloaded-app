// P(Δ): chance the position ends the way we want, read from the short option's delta (0..1, 1 = success).
// Frontend mirror of the backend's computeLegSuccessProbabilities (positionSuccessProbability.ts, approved
// 2026-09-19; re-approved 2026-10-03 for the Positions table and Pulse). IBKR reports the contract's own delta
// (call positive, put negative, not flipped for a short position), so the magnitude is used.
//
//   short call (covered call):    success = assigned,     P(Δ) = |Δ|
//   short put (cash-secured put): success = not assigned, P(Δ) = 1 - |Δ|
//
// Only a short option leg has a success probability; a long leg (e.g. the TLT hedge) or a non-option leg is null.

export const SUCCESS_PROBABILITY_HEADER = "P(Δ)";

export const SUCCESS_PROBABILITY_HEADER_TITLE =
  "Chance of success from the short option's delta, 0.00–1.00 (1 = success): covered call = assigned, |Δ|; cash-secured put = not assigned, 1 − |Δ|";

export interface SuccessProbabilityLegShape {
  legType: string;
  side: string;
  optionType: string | null;
}

export function successProbabilityFromDelta(leg: SuccessProbabilityLegShape, delta: number | null | undefined): number | null {
  if (delta === null || delta === undefined) return null;
  if (leg.legType !== "option" || leg.side !== "short") return null;
  const deltaMagnitude = Math.abs(delta);
  if (leg.optionType === "call") return deltaMagnitude;
  if (leg.optionType === "put") return 1 - deltaMagnitude;
  return null;
}

export function formatSuccessProbability(probability: number | null | undefined): string {
  return probability === null || probability === undefined ? "—" : probability.toFixed(2);
}
