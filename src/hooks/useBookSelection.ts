import { useEffect, useState } from "react";
import type { BookSelection } from "../api/books";

const storageKey = "iorio-dashboard-book";

/** The Dashboard's book switch (Marcelo 2026-11-05): everyone starts on All books; a choice is remembered in this browser. */
export function useBookSelection(): [BookSelection, (selection: BookSelection) => void] {
  const [selection, setSelection] = useState<BookSelection>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === "pluto" || stored === "manual" ? stored : "all";
    } catch {
      return "all";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, selection);
    } catch {
      // Not remembered: the switch still works for this visit.
    }
  }, [selection]);
  return [selection, setSelection];
}
