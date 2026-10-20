import { useEffect, useState, type RefObject } from "react";

/**
 * The visible width of the element's nearest ancestor matching `selector` (a table's sideways-scrolling box), kept up
 * to date as it resizes; null until measured.
 */
export function useScrollParentWidth(ref: RefObject<HTMLElement | null>, selector = ".table-responsive"): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const container = ref.current?.closest<HTMLElement>(selector);
    if (!container) return;
    const measure = () => setWidth(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref, selector]);
  return width;
}
