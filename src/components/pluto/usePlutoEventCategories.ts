import { useCallback, useEffect, useState } from "react";
import type { PlutoEventCategory } from "../../api/pluto";
import { defaultPlutoEventCategories, plutoEventCategoryOptions } from "../../lib/plutoPresentation";

const storageKey = "iorio-pluto-event-log-categories";

function loadStoredCategories(): PlutoEventCategory[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return defaultPlutoEventCategories;
    const known = new Set<string>(plutoEventCategoryOptions.map((option) => option.key));
    return (JSON.parse(stored) as string[]).filter((key): key is PlutoEventCategory => known.has(key));
  } catch {
    return defaultPlutoEventCategories;
  }
}

/** Which Event log categories are ticked: Info starts unticked, and every change is saved to localStorage as it is made. */
export function usePlutoEventCategories() {
  const [categories, setCategories] = useState<PlutoEventCategory[]>(loadStoredCategories);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(categories));
    } catch {
      // Storage unavailable (private window, blocked site data): the choice just lasts until the page is closed.
    }
  }, [categories]);

  const toggleCategory = useCallback((key: string) => {
    setCategories((previous) => (previous.includes(key as PlutoEventCategory) ? previous.filter((category) => category !== key) : plutoEventCategoryOptions.map((option) => option.key).filter((category) => category === key || previous.includes(category))));
  }, []);

  return { categories, toggleCategory };
}
