// Used across positions/trade-alerts/risk-limits/shortlist/screener — not
// tied to any one feature. Extracted out of api/screener.ts (2026-09-05,
// screener -> discovery-tool redesign) when that file was renamed to
// api/shortlist.ts, so this platform-wide type didn't have to keep living
// inside a feature-specific api client.
export type StrategyKey = "covered_call" | "cash_secured_put";
