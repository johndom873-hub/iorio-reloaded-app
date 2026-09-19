// Green/amber/red status for Iorio Pulse's node stats. Returns the existing
// `.sub-value` colour modifier classes in PulsePage.css: "ok" (green), "warn"
// (amber), "err" (red), or "" when there is no value to judge.
export type StatusClass = "ok" | "warn" | "err" | "";

/** Higher is worse: below greenBelow is green, up to and including amberUpTo is amber, above that is red. */
export function higherIsWorseStatus(value: number | null | undefined, greenBelow: number, amberUpTo: number): StatusClass {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (value < greenBelow) return "ok";
  return value <= amberUpTo ? "warn" : "err";
}
