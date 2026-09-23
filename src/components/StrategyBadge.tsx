import { strategyAbbrev, strategyBadgeClass, strategyTooltip } from "../lib/positionPnl";
import type { PositionStrategyKey } from "../api/positions";
import { useTooltip } from "../hooks/useTooltip";

// THE badge for a strategy — CC / CSP / N/S in the strategy palette
// (positionPnl.ts's strategyBadgeClass). Use this everywhere a strategy is
// shown as a badge instead of hand-writing a `badge bg-…` span, so the
// colours, the codes, the 0.72rem size and the tooltip can never drift.
export function StrategyBadge({ strategyKey, className = "" }: { strategyKey: PositionStrategyKey; className?: string }) {
  const ref = useTooltip<HTMLSpanElement>(strategyTooltip(strategyKey));
  return (
    <span ref={ref} className={`badge ${strategyBadgeClass(strategyKey)} ${className}`.trim()} style={{ fontSize: "0.72rem" }} tabIndex={0}>
      {strategyAbbrev(strategyKey)}
    </span>
  );
}
