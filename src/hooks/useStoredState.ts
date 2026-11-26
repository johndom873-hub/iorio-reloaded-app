import { useEffect, useState } from "react";

/**
 * A screen preference remembered in this browser (localStorage, `iorio-` prefixed): the stored value when `accept` takes it,
 * else `initial`. Storage that is blocked or full only means the choice is not remembered.
 */
export function useStoredState<T>(key: string, initial: T, accept: (stored: unknown) => stored is T): [T, (value: T) => void] {
  const storageKey = `iorio-${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) return initial;
      const parsed: unknown = JSON.parse(stored);
      return accept(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Not remembered: the choice still applies for this visit.
    }
  }, [storageKey, value]);
  return [value, setValue];
}

/** `accept` for a value that must be one of `choices`. */
export function oneOf<T extends string>(choices: readonly T[]): (stored: unknown) => stored is T {
  return (stored: unknown): stored is T => typeof stored === "string" && (choices as readonly string[]).includes(stored);
}

/** `accept` for a boolean. */
export function isBoolean(stored: unknown): stored is boolean {
  return typeof stored === "boolean";
}
