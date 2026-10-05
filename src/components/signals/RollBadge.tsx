import { IconRefresh } from "@tabler/icons-react";
import type { SignalsScreenRow } from "../../api/signals";
import { useTooltip } from "../../hooks/useTooltip";
import { formatCurrency, formatSignedPnl, formatVolatilityPoints } from "../../lib/formatters";
import { describeRoll, gradeBadgeClass, gradeLabel, signalsColumnExplanation } from "../../lib/signalsPresentation";

/**
 * Roll Signals badge (variant B, approved 2026-09-24): solid, in the best roll's grade colour, counting the
 * held legs with a roll above Avoid. Click opens the Signals modal on that roll. Used by the Signals screen
 * and the Positions page, both fed by the Signals screen rows.
 */
export function RollBadge({ row, onClick }: { row: Pick<SignalsScreenRow, "bestRoll" | "heldLegs" | "rollCount">; onClick: (legId: string) => void }) {
  const best = row.bestRoll;
  const held = best ? row.heldLegs.find((leg) => leg.legId === best.legId) : undefined;
  const tooltip = best && held ? `${signalsColumnExplanation.roll} Best: ${describeRoll(best, held)} · ${formatVolatilityPoints(best.netRollEdge)} (${formatSignedPnl(best.netRollEdgeDollars, 0)}) · net credit ${formatCurrency(best.netCreditPerShare)}/sh.` : "";
  const ref = useTooltip<HTMLButtonElement>(tooltip);
  if (!best || row.rollCount === 0) return null;
  return (
    <button ref={ref} type="button" className={`badge border-0 d-inline-flex align-items-center gap-1 px-2 py-1 text-nowrap ${gradeBadgeClass[best.grade]}`} style={{ fontSize: "0.72rem", cursor: "pointer" }} onClick={() => onClick(best.legId)}>
      <IconRefresh size={12} />
      {row.rollCount} roll{row.rollCount === 1 ? "" : "s"} · {gradeLabel[best.grade]}
    </button>
  );
}
