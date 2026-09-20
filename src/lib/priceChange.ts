// Percent move of a price against a reference close — the one formula behind
// every change column on Price Performance. The backend computes the same thing
// for the static (last-close) values with the identical rule
// (pricePerformanceSnapshot.ts's percentChange); the browser applies it to the
// live price once one arrives, using the reference closes the page loaded.
// Null when there is no reference close or it is zero.
export function percentChange(currentPrice: number, referenceClose: number | null): number | null {
  if (referenceClose === null || referenceClose === 0) return null;
  return ((currentPrice - referenceClose) / referenceClose) * 100;
}
