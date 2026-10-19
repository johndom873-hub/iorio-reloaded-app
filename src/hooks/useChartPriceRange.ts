import { useState } from "react";
import { computeChartPriceRange, type ChartPriceRange } from "../lib/payoff";

// The payoff chart's price range, held while the chart is mounted: it widens when the current price nears an edge and never narrows,
// so ticks inside it leave the chart's points untouched. A new break-even (a roll, a new fill) starts again from its own range.
export function useChartPriceRange(breakeven: number | null, currentPrice: number | null): ChartPriceRange | null {
  const [held, setHeld] = useState<{ breakeven: number; range: ChartPriceRange } | null>(null);
  if (breakeven === null) return null;
  const heldRange = held?.breakeven === breakeven ? held.range : null;
  const range = computeChartPriceRange(breakeven, currentPrice, heldRange);
  // Stored during render (React's "information from previous renders" pattern): the next render gets it back unchanged and stops.
  if (range !== heldRange) setHeld({ breakeven, range });
  return range;
}
