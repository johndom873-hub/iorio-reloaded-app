import { useEffect, useRef, useState } from "react";

function storageKeyFor(storageKey: string): string {
  return `iorio-card-collapsed-${storageKey}`;
}

// Shared open/closed state for collapsible sections, persisted under the
// same `iorio-card-collapsed-*` localStorage convention CollapsibleCard
// already used for the Dashboard. Pulled out into its own hook so chart
// components that render their own .card chrome (TickerPriceChart,
// IvHistoryChart) can drive their existing card-header's collapse toggle
// directly instead of being wrapped in a second, nested CollapsibleCard.
export function useCollapsibleCard(storageKey: string | undefined, defaultOpen = true, forceOpenSignal?: number) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const stored = localStorage.getItem(storageKeyFor(storageKey));
      return stored === null ? defaultOpen : stored === "open";
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKeyFor(storageKey), isOpen ? "open" : "closed");
  }, [storageKey, isOpen]);

  // Forces open only on a genuine change in forceOpenSignal's value, not on
  // every render/effect invocation that happens to see it -- a "skip the
  // first run" ref flag looked equivalent but breaks under StrictMode's
  // double-invoked mount effects (dev-only): the second invocation sees the
  // flag already cleared and force-opens the card immediately, even with no
  // real signal change and even though the user had it collapsed.
  const previousForceOpenSignal = useRef(forceOpenSignal);
  useEffect(() => {
    if (forceOpenSignal !== undefined && forceOpenSignal !== previousForceOpenSignal.current) {
      setIsOpen(true);
    }
    previousForceOpenSignal.current = forceOpenSignal;
  }, [forceOpenSignal]);

  return [isOpen, setIsOpen] as const;
}
