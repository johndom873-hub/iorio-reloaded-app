import { useCallback, useEffect, useState } from "react";

function storageKeyFor(tableId: string): string {
  return `iorio-table-columns-${tableId}`;
}

// All columns visible by default. Once the user hides a column, that
// choice persists in localStorage per-table, per your column-visibility
// convention — no explicit save button, toggling a checkbox saves
// immediately.
export function useColumnVisibility(tableId: string, allColumnKeys: string[]) {
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(storageKeyFor(tableId));
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKeyFor(tableId), JSON.stringify([...hiddenColumnKeys]));
  }, [tableId, hiddenColumnKeys]);

  const toggleColumn = useCallback((columnKey: string) => {
    setHiddenColumnKeys((previous) => {
      const next = new Set(previous);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  }, []);

  const isColumnVisible = useCallback((columnKey: string) => !hiddenColumnKeys.has(columnKey), [hiddenColumnKeys]);

  return { allColumnKeys, hiddenColumnKeys, isColumnVisible, toggleColumn };
}
