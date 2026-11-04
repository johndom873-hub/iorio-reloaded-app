// |Δ|: the short option's absolute delta, roughly the chance it finishes in the money (0..1). IBKR reports the
// contract's own delta (call positive, put negative, not flipped for a short position), so the magnitude is used.
// Calls and Puts read the same way: the higher it is, the more likely the option is assigned.
//
// Only a short option leg has one shown; a long leg (e.g. the TLT LEAPS) or a non-option leg is null.

export const ABSOLUTE_DELTA_HEADER = "|Δ|";

export const ABSOLUTE_DELTA_HEADER_TITLE = "Absolute delta of the short option, roughly the chance it finishes in the money (0.00–1.00)";

export interface ShortOptionLegShape {
  legType: string;
  side: string;
  optionType: string | null;
}

export function shortOptionAbsoluteDelta(leg: ShortOptionLegShape, delta: number | null | undefined): number | null {
  if (delta === null || delta === undefined) return null;
  if (leg.legType !== "option" || leg.side !== "short") return null;
  return Math.abs(delta);
}
