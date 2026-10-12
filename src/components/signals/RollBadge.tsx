import { IconRefresh } from "@tabler/icons-react";
import type { SignalsScreenRow } from "../../api/signals";
import { useTooltip } from "../../hooks/useTooltip";
import { formatCurrency, formatPercentage, formatSignedPnl } from "../../lib/formatters";
import { describeRoll, gradeBadgeClass, gradeLabel, signalsColumnExplanation } from "../../lib/signalsPresentation";

/**
 * Roll Signals badge (variant B, approved 2026-09-24): solid, in the best roll's grade colour, counting the
 * held legs with a roll above Avoid. Click opens the Signals modal on that roll. Used by the Signals screen
 * and the Positions page, both fed by the Signals screen rows. Graded by the valuation model since 2026-10-12
 * (mockup approved 2026-10-10): the best roll and the count are the model's, as Pluto acts on them.
 */
export function RollBadge({ row, onClick }: { row: Pick<SignalsScreenRow, "bestRoll" | "heldLegs" | "rollCount">; onClick: (legId: string) => void }) {
  const best = row.bestRoll;
  const held = best ? row.heldLegs.find((leg) => leg.legId === best.legId) : undefined;
  const model = best?.model ?? null;
  const tooltip =
    best && held && model
      ? `${signalsColumnExplanation.roll} Best: ${describeRoll(best, held)} · net roll ${formatSignedPnl(model.netExpectedPnl, 0)} (${formatSignedPnl(model.netExpectedPnlPerContract, 0)} per contract, roll margin ${formatPercentage(model.edgeMargin, 0)}) · net credit ${formatCurrency(best.netCreditPerShare)}/sh.`
      : "";
  const ref = useTooltip<HTMLButtonElement>(tooltip);
  if (!best || !model || row.rollCount === 0) return null;
  return (
    <button ref={ref} type="button" className={`badge border-0 d-inline-flex align-items-center gap-1 px-2 py-1 text-nowrap ${gradeBadgeClass[model.grade]}`} style={{ fontSize: "0.72rem", cursor: "pointer" }} onClick={() => onClick(best.legId)}>
      <IconRefresh size={12} />
      {row.rollCount} roll{row.rollCount === 1 ? "" : "s"} · {gradeLabel[model.grade]}
    </button>
  );
}
