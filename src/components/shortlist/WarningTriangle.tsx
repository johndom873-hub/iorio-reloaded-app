import { IconAlertTriangle } from "@tabler/icons-react";
import { useTooltip } from "../../hooks/useTooltip";

interface WarningTriangleProps {
  /** What's wrong and how to fix it (e.g. which Actions-menu item clears it). Shown on hover. */
  reason: string;
}

// Approved mockup convention (2026-09-23): a metric with nothing wrong shows as plain text; this only
// ever renders when there's an actual issue, so its mere presence is the signal -- no color-coded "ok"
// badge needed alongside it.
export function WarningTriangle({ reason }: WarningTriangleProps) {
  const ref = useTooltip<HTMLSpanElement>(reason);
  return (
    <span ref={ref} tabIndex={0} style={{ color: "var(--tblr-warning)", display: "inline-flex", cursor: "help" }}>
      <IconAlertTriangle size={15} />
    </span>
  );
}
