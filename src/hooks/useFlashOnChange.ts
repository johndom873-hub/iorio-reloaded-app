import { useEffect, useRef, useState } from "react";

/**
 * Tracks a numeric value across renders and returns true for one animation
 * cycle whenever it changes, false otherwise. Pair with the .flash-changed
 * CSS class (theme.css) on the element displaying the value. Only meant for
 * values that already update live (SSE-driven quotes) — it has no polling
 * or fetching of its own. Neutral (not directional green/up red/down) since
 * a changed IV/theta/vega isn't inherently good or bad (Marcelo, 2026-08-31).
 *
 * `precision`, if given, rounds the value to that many decimal places before
 * comparing — for a field like live delta that recomputes with sub-display
 * jitter on nearly every tick, comparing raw values flashes on changes the
 * user can't actually see in the rendered (rounded) number. Match this to
 * the precision the value is displayed at.
 */
export function useFlashOnChange(value: number | null | undefined, durationMs = 1200, precision?: number): boolean {
  const comparableValue = value != null && precision != null ? Number(value.toFixed(precision)) : value;
  const previousValueRef = useRef(comparableValue);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = comparableValue;
    if (previousValue == null || comparableValue == null || comparableValue === previousValue) return;

    setFlashing(true);
    const timeoutId = window.setTimeout(() => setFlashing(false), durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [comparableValue, durationMs]);

  return flashing;
}

export function flashClassName(flashing: boolean): string {
  return flashing ? "flash-changed" : "";
}
