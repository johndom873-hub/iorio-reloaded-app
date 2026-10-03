import { useCallback, useEffect, useRef, useState } from "react";

/** Length of one flash. Must match the animation duration of .flash-changed in theme.css. */
export const FLASH_DURATION_MS = 1500;

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
export function useFlashOnChange(value: number | null | undefined, durationMs = FLASH_DURATION_MS, precision?: number): boolean {
  const comparableValue = value != null && precision != null ? Number(value.toFixed(precision)) : value;
  const previousValueRef = useRef(comparableValue);
  const { flashing, triggerFlash } = useFlashCycle(durationMs);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    previousValueRef.current = comparableValue;
    if (previousValue == null || comparableValue == null || comparableValue === previousValue) return;
    triggerFlash();
  }, [comparableValue, triggerFlash]);

  return flashing;
}

/**
 * Same flash as useFlashOnChange for a value that is an identity rather than a number (the contract a row
 * currently shows): true for one animation cycle whenever `key` changes to a different non-null key.
 * A null on either side (nothing shown yet, or nothing to show) does not flash.
 */
export function useFlashOnKeyChange(key: string | null | undefined, durationMs = FLASH_DURATION_MS): boolean {
  const previousKeyRef = useRef(key);
  const { flashing, triggerFlash } = useFlashCycle(durationMs);

  useEffect(() => {
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = key;
    if (previousKey == null || key == null || key === previousKey) return;
    triggerFlash();
  }, [key, triggerFlash]);

  return flashing;
}

/**
 * Flash state for one fixed-length cycle (`durationMs`). A trigger that lands while a flash is
 * already showing is ignored: it neither restarts the animation nor extends the window, so a
 * value ticking every few milliseconds flashes once per cycle instead of strobing. The next
 * change after the cycle ends starts a new one. The timer lives in a ref and is only cleared on
 * unmount, so a re-rendering caller can't cancel it and leave the flag stuck on.
 */
export function useFlashCycle(durationMs: number): { flashing: boolean; triggerFlash: () => void } {
  const [flashing, setFlashing] = useState(false);
  const isFlashingRef = useRef(false);
  const clearTimeoutIdRef = useRef<number | null>(null);

  const triggerFlash = useCallback(() => {
    if (isFlashingRef.current) return;
    isFlashingRef.current = true;
    setFlashing(true);
    clearTimeoutIdRef.current = window.setTimeout(() => {
      clearTimeoutIdRef.current = null;
      isFlashingRef.current = false;
      setFlashing(false);
    }, durationMs);
  }, [durationMs]);

  useEffect(
    () => () => {
      if (clearTimeoutIdRef.current !== null) window.clearTimeout(clearTimeoutIdRef.current);
      clearTimeoutIdRef.current = null;
      isFlashingRef.current = false;
    },
    [],
  );

  return { flashing, triggerFlash };
}

export function flashClassName(flashing: boolean): string {
  return flashing ? "flash-changed" : "";
}
