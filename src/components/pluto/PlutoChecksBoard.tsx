import type { PlutoSystemCheck } from "../../api/pluto";
import { humanizeKey } from "../../lib/plutoPresentation";
import { TooltipSpan } from "../TooltipSpan";

interface PlutoChecksBoardProps {
  checks: Record<string, PlutoSystemCheck> | null;
}

/** The pre-model system checks of one pass, all of them, green or red, detail on hover. */
export function PlutoChecksBoard({ checks }: PlutoChecksBoardProps) {
  if (!checks || Object.keys(checks).length === 0) return <span className="text-muted" style={{ fontSize: "0.8rem" }}>No checks recorded.</span>;
  return (
    <div className="d-flex flex-wrap gap-1">
      {Object.entries(checks).map(([name, check]) => (
        <TooltipSpan key={name} text={check.detail}>
          <span className={`badge ${check.ok ? "bg-success-lt" : "bg-danger text-white"}`} style={{ fontSize: "0.72rem", cursor: "help" }}>
            {check.ok ? "✓" : "✗"} {humanizeKey(name).toLowerCase()}
          </span>
        </TooltipSpan>
      ))}
    </div>
  );
}
