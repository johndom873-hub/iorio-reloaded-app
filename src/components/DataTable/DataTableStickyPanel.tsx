import { useRef, type ReactNode } from "react";
import { useScrollParentWidth } from "../../hooks/useScrollParentWidth";

/** The content of a DataTable extra row, as wide as the table's visible box and pinned to its left edge: it stays in view while a wide table scrolls sideways (a phone). */
export function DataTableStickyPanel({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useScrollParentWidth(ref);
  return (
    <div ref={ref} className={["data-table-sticky-panel", className].filter(Boolean).join(" ")} style={width === null ? undefined : { width: `${width}px` }}>
      {children}
    </div>
  );
}
