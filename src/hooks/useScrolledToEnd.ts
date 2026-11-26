import { useLayoutEffect, useRef } from "react";

/**
 * A horizontally scrolling box that starts at its right end, where a time grid keeps its newest column (on a phone the
 * By day and By month grids are wider than the screen). It scrolls back there whenever `contentKey` changes.
 */
export function useScrolledToEnd<T extends HTMLElement>(contentKey: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (box) box.scrollLeft = box.scrollWidth;
  }, [contentKey]);
  return ref;
}
