import { useCallback, useEffect, useRef } from "react";

// Deliberate input only: mouse movement is excluded because a bumped desk or a mouse jiggler is not a person using the app.
const activityEventNames = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Tracks the last click / key press / scroll / touch in this tab. Returns `isUserActive`, true while the last
 * input was within `inactivityLimitMs`. `onBecameActive` fires on the first input after that limit had passed,
 * so a caller that paused its work while the user was away can resume it at once. Nothing re-renders on input.
 */
export function useUserActivity(inactivityLimitMs: number, onBecameActive: () => void): () => boolean {
  const lastActivityAtMs = useRef(Date.now());
  const onBecameActiveRef = useRef(onBecameActive);

  useEffect(() => {
    onBecameActiveRef.current = onBecameActive;
  }, [onBecameActive]);

  useEffect(() => {
    const handleActivity = () => {
      const wasInactive = Date.now() - lastActivityAtMs.current > inactivityLimitMs;
      lastActivityAtMs.current = Date.now();
      if (wasInactive) onBecameActiveRef.current();
    };
    // Capture phase: scroll events do not bubble, so this is the only way to see scrolling inside any element.
    for (const eventName of activityEventNames) window.addEventListener(eventName, handleActivity, { passive: true, capture: true });
    return () => {
      for (const eventName of activityEventNames) window.removeEventListener(eventName, handleActivity, { capture: true });
    };
  }, [inactivityLimitMs]);

  return useCallback(() => Date.now() - lastActivityAtMs.current <= inactivityLimitMs, [inactivityLimitMs]);
}
