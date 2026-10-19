/**
 * `next`, reusing `previous`'s objects and arrays wherever the two hold the same values, and `previous` itself when nothing
 * changed. A polled response that did not change then keeps every reference (React skips the re-render), and one that changed
 * in a single field keeps the rest (memoised charts and tables keep their inputs). JSON-shaped values only.
 */
export function reuseUnchangedValues<TValue>(previous: TValue, next: TValue): TValue {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let unchanged = previous.length === next.length;
    const merged = next.map((item, index) => {
      const kept = index < previous.length ? reuseUnchangedValues(previous[index], item) : item;
      if (kept !== previous[index]) unchanged = false;
      return kept;
    });
    return (unchanged ? previous : merged) as TValue;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    let unchanged = nextKeys.length === Object.keys(previous).length;
    const merged: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const kept = key in previous ? reuseUnchangedValues(previous[key], next[key]) : next[key];
      if (kept !== previous[key] || !(key in previous)) unchanged = false;
      merged[key] = kept;
    }
    return (unchanged ? previous : merged) as TValue;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
