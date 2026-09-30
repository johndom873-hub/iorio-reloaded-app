import { useCallback, useEffect, useRef, useState } from "react";

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
  const { flashing, triggerFlash } = useRestartableFlash(durationMs);

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
export function useFlashOnKeyChange(key: string | null | undefined, durationMs = 1200): boolean {
  const previousKeyRef = useRef(key);
  const { flashing, triggerFlash } = useRestartableFlash(durationMs);

  useEffect(() => {
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = key;
    if (previousKey == null || key == null || key === previousKey) return;
    triggerFlash();
  }, [key, triggerFlash]);

  return flashing;
}

/**
 * Flash state that replays its CSS animation on every trigger, including one
 * that lands while a previous flash is still showing. Just setting the flag
 * true again is a no-op when it's already true, so the class never leaves the
 * element and the animation never restarts -- a value ticking faster than
 * `durationMs` would flash once and then stay visually silent. Instead the
 * flag is dropped, and raised again two animation frames later so the browser
 * has painted the class-less element in between. The timers live in refs and
 * are only cleared on unmount (not by the caller's effect re-running), so a
 * trigger that is ignored by the caller can't cancel a running flash's timer
 * and leave the flag stuck on.
 */
export function useRestartableFlash(durationMs: number): { flashing: boolean; triggerFlash: () => void } {
  const [flashing, setFlashing] = useState(false);
  const isFlashingRef = useRef(false);
  const clearTimeoutIdRef = useRef<number | null>(null);
  const restartFrameIdRef = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (clearTimeoutIdRef.current !== null) window.clearTimeout(clearTimeoutIdRef.current);
    if (restartFrameIdRef.current !== null) window.cancelAnimationFrame(restartFrameIdRef.current);
    clearTimeoutIdRef.current = null;
    restartFrameIdRef.current = null;
  }, []);

  const raiseFlag = useCallback(() => {
    isFlashingRef.current = true;
    setFlashing(true);
    clearTimeoutIdRef.current = window.setTimeout(() => {
      isFlashingRef.current = false;
      setFlashing(false);
    }, durationMs);
  }, [durationMs]);

  const triggerFlash = useCallback(() => {
    const wasFlashing = isFlashingRef.current;
    cancelPending();
    if (!wasFlashing) {
      raiseFlag();
      return;
    }
    isFlashingRef.current = false;
    setFlashing(false);
    restartFrameIdRef.current = window.requestAnimationFrame(() => {
      restartFrameIdRef.current = window.requestAnimationFrame(() => {
        restartFrameIdRef.current = null;
        raiseFlag();
      });
    });
  }, [cancelPending, raiseFlag]);

  useEffect(() => cancelPending, [cancelPending]);

  return { flashing, triggerFlash };
}

export function flashClassName(flashing: boolean): string {
  return flashing ? "flash-changed" : "";
}
