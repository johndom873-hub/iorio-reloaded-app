import { useEffect, useRef, useState } from "react";

/**
 * Tracks a numeric value across renders and returns true for one animation
 * cycle whenever it changes, false otherwise. Pair with the .flash-changed
 * CSS class (theme.css) on the element displaying the value. Only meant for
 * values that already update live (SSE-driven quotes) — it has no polling
 * or fetching of its own. Neutral (not directional green/up red/down) since
 * a changed IV/theta/vega isn't inherently good or bad (Marcelo, 2026-08-31).
 */
export function useFlashOnChange(value: number | null | undefined, durationMs = 1200): boolean {
  const previousValueRef = useRef(value);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = value;
    if (previousValue == null || value == null || value === previousValue) return;

    setFlashing(true);
    const timeoutId = window.setTimeout(() => setFlashing(false), durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, durationMs]);

  return flashing;
}

export function flashClassName(flashing: boolean): string {
  return flashing ? "flash-changed" : "";
}
