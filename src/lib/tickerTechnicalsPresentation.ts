/**
 * Support/resistance line for the Technicals card. With no qualifying zone the backend falls back to the
 * lowest low / highest high of its hourly window (touches 0, quality 0) — named as that, not as a zero-quality level.
 */
export function describeSupportResistanceLevel(side: "support" | "resistance", level: { touches: number; qualityPct: number }): { label: string; detail: string } {
  if (level.touches === 0) {
    return side === "support" ? { label: "Recent low", detail: "no clear support level" } : { label: "Recent high", detail: "no clear resistance level" };
  }
  return { label: side === "support" ? "Support" : "Resistance", detail: `${level.touches} touches, ${level.qualityPct.toFixed(1)}% quality` };
}
