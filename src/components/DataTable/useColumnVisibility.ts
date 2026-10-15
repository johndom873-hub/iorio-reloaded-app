import { useCallback, useEffect, useRef, useState } from "react";

function storageKeyFor(tableId: string): string {
  return `iorio-table-columns-${tableId}`;
}

// Fired on window after a toggle, so every mounted table sharing the tableId
// (e.g. the legs table in each position card) applies the change at once.
const columnVisibilityChangedEvent = "iorio-column-visibility-changed";

function readHiddenColumnKeys(tableId: string): Set<string> {
  try {
    const stored = localStorage.getItem(storageKeyFor(tableId));
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

// All columns visible by default. Once the user hides a column, that
// choice persists in localStorage per-table, per your column-visibility
// convention — no explicit save button, toggling a checkbox saves
// immediately.
export function useColumnVisibility(tableId: string, allColumnKeys: string[]) {
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() => readHiddenColumnKeys(tableId));
  const hiddenColumnKeysRef = useRef(hiddenColumnKeys);
  hiddenColumnKeysRef.current = hiddenColumnKeys;

  useEffect(() => {
    function onColumnVisibilityChanged(event: Event) {
      const detail = (event as CustomEvent<{ tableId: string; hiddenColumnKeys: string[] }>).detail;
      if (detail.tableId === tableId) setHiddenColumnKeys(new Set(detail.hiddenColumnKeys));
    }
    window.addEventListener(columnVisibilityChangedEvent, onColumnVisibilityChanged);
    return () => window.removeEventListener(columnVisibilityChangedEvent, onColumnVisibilityChanged);
  }, [tableId]);

  const toggleColumn = useCallback(
    (columnKey: string) => {
      const next = new Set(hiddenColumnKeysRef.current);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      try {
        localStorage.setItem(storageKeyFor(tableId), JSON.stringify([...next]));
      } catch {
        // Storage unavailable (private window, blocked site data): the choice still applies for this page view.
      }
      window.dispatchEvent(new CustomEvent(columnVisibilityChangedEvent, { detail: { tableId, hiddenColumnKeys: [...next] } }));
    },
    [tableId],
  );

  const isColumnVisible = useCallback((columnKey: string) => !hiddenColumnKeys.has(columnKey), [hiddenColumnKeys]);

  return { allColumnKeys, hiddenColumnKeys, isColumnVisible, toggleColumn };
}
