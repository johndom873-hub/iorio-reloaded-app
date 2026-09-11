import { useEffect, useRef, useState } from "react";
import { pnlTextClass } from "../lib/formatters";

/**
 * Colors a live-streamed price by comparison to its own previous tick, not a
 * fixed reference like the last daily close — green when the new tick is
 * higher, red when lower. Deliberately does NOT recolor or flash when the
 * value rounds to the same number at `precision` as the previous tick (a
 * sub-cent/sub-display move the user can't actually see shouldn't repaint
 * the cell). `initialReference` seeds the very first comparison (e.g. the
 * last completed daily close) since there's no prior tick yet when the
 * stream's first value arrives; pass null when there's no such reference —
 * the cell then stays uncolored until a second tick gives it something to
 * compare against.
 */
export function useTickDirectionColor(value: number | null, initialReference: number | null, precision = 2): { colorClass: string; flashing: boolean } {
  const previousRoundedRef = useRef<number | null>(initialReference == null ? null : Number(initialReference.toFixed(precision)));
  const [colorClass, setColorClass] = useState("");
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (value === null) return;
    const rounded = Number(value.toFixed(precision));
    const previous = previousRoundedRef.current;
    if (previous !== null && rounded === previous) return; // no visible move at this precision -- leave color/flash as-is
    previousRoundedRef.current = rounded;
    if (previous === null) return; // first-ever tick, nothing to compare against yet

    setColorClass(pnlTextClass(rounded - previous));
    setFlashing(true);
    const timeoutId = window.setTimeout(() => setFlashing(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [value, precision]);

  return { colorClass, flashing };
}
