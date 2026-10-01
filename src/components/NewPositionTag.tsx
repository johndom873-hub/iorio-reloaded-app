import { useTooltip } from "../hooks/useTooltip";

/** The small superscript "new" after a ticker (inside the ticker's button, so it takes no focus of its own; the tooltip is hover-only) on a position opened or rolled today (US/Eastern); see positionHasLegEnteredTodayEastern. */
export function NewPositionTag() {
  const ref = useTooltip<HTMLSpanElement>("Opened or rolled today (ET)");
  return (
    <span ref={ref} className="iorio-new-tag">
      new
    </span>
  );
}
