import { useEffect, useState, type RefObject } from "react";

// Live IBKR lines only for prices actually on screen (Marcelo 2026-09-29): every element that shows a live
// option price carries `data-live-contracts="key,key"` (keys expiry|strike|right). This hook watches every such
// element under `rootRef` and returns the contracts of the visible ones — at least half shown, no extra rows
// either side (Marcelo 2026-09-30: the half-row rule already covers a small scroll). "Visible" is the browser's
// own intersection test against the viewport, which already accounts for clipping by scroll containers (a row
// scrolled out of its table, or a table scrolled out of the modal, is not visible).

const liveContractsSelector = "[data-live-contracts]";
const visibleShareThreshold = 0.5;

function contractsOf(element: Element): string[] {
  return (element.getAttribute("data-live-contracts") ?? "").split(",").filter(Boolean);
}

/** Pure: the contracts of the visible elements. Sorted, no duplicates. */
export function collectVisibleLiveContracts(elements: Element[], isVisible: (element: Element) => boolean): string[] {
  const keys = new Set<string>();
  for (const element of elements) if (isVisible(element)) for (const key of contractsOf(element)) keys.add(key);
  return [...keys].sort();
}

/** The live contracts currently on screen under `rootRef` (see above). Only changes when the set itself changes. */
export function useVisibleLiveContracts(rootRef: RefObject<HTMLElement | null>): string[] {
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<Element>();
    let observed = new Set<Element>();
    let frame = 0;

    const publish = () => {
      frame = 0;
      const next = collectVisibleLiveContracts([...observed], (element) => visible.has(element));
      setVisibleKeys((current) => (current.length === next.length && current.every((key, index) => key === next[index]) ? current : next));
    };
    const schedulePublish = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };

    // At least half shown counts as visible; a sliver at the edge of a scrolled list is covered by the one-row offset instead.
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= visibleShareThreshold) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        schedulePublish();
      },
      { threshold: [0, visibleShareThreshold, 1] },
    );

    // Rows come and go (expiry switch, filters, phone side): re-sync the observed set on any DOM change.
    const syncObserved = () => {
      const current = new Set(root.querySelectorAll(liveContractsSelector));
      for (const element of observed) {
        if (!current.has(element)) {
          intersectionObserver.unobserve(element);
          visible.delete(element);
        }
      }
      for (const element of current) if (!observed.has(element)) intersectionObserver.observe(element);
      observed = current;
      schedulePublish();
    };
    const mutationObserver = new MutationObserver(syncObserved);
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-live-contracts"] });
    syncObserved();

    return () => {
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  return visibleKeys;
}
