import type { FrozenTicker } from "../api/environment";
import { describeFrozenTicker } from "../hooks/useFrozenTickers";
import { useTooltip } from "../hooks/useTooltip";

/** The red "Frozen" badge after a ticker frozen by a stock split (Positions, Signals, Shortlist, Pluto); nothing otherwise. */
export function FrozenTickerBadge({ frozen }: { frozen: FrozenTicker | undefined }) {
  const ref = useTooltip<HTMLSpanElement>(frozen ? describeFrozenTicker(frozen) : null);
  if (!frozen) return null;
  return (
    <span ref={ref} className="badge bg-danger text-white ms-1 frozen-tap-target" tabIndex={0} aria-label={describeFrozenTicker(frozen)}>
      Frozen
    </span>
  );
}
