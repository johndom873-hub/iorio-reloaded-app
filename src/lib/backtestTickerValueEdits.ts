import {
  backtestTickerBaselineKeys,
  type BacktestSymbolResolution,
  type BacktestSymbolSettingSource,
  type BacktestSymbolSettings,
  type BacktestTickerValueKey,
  type BacktestTickerValues,
} from "../api/backtest";
import { parseDollarAmountText, tickerValueInputText, tickerValueTextProblem } from "./backtestPresentation";

// New session, per-ticker pots (mockup approved 2026-10-15): the Tickers card's typed values, what the estimate resolved,
// and the request's symbolSettings built from both. A typed value is an edit ("This session") only while it differs from
// the value under it; typing the value already there is not an edit.

/** Per symbol, per value: the input's text as typed. */
export type BacktestTickerEdits = Record<string, Partial<Record<BacktestTickerValueKey, string>>>;

/** "pots": each ticker's pot, the capital their sum; "split": one starting value split equally into the pots. */
export type BacktestCapitalMode = "pots" | "split";

/** The estimate's resolution of every ticker, and the capital. */
export interface BacktestTickerResolution {
  capital: number | null;
  bySymbol: Record<string, BacktestSymbolResolution>;
}

export const tickerValueKeys: BacktestTickerValueKey[] = ["potDollars", ...backtestTickerBaselineKeys];

/** The value a typed text sends. */
export function tickerEditValue(key: BacktestTickerValueKey, text: string): number | string {
  if (key === "ladderShock") return text;
  return key === "potDollars" ? parseDollarAmountText(text) : Number(text.trim());
}

function resolvedValue(resolution: BacktestSymbolResolution, key: BacktestTickerValueKey): number | string | null {
  return key === "potDollars" ? resolution.potDollars : resolution.baseline[key];
}

/** The value and source a ticker's value has without this session's edit; undefined while the ticker is not resolved yet. */
export function tickerValueBelowEdit(resolution: BacktestSymbolResolution | undefined, key: BacktestTickerValueKey): { value: number | string | null; source: BacktestSymbolSettingSource | null } | undefined {
  if (!resolution) return undefined;
  if (resolution.source[key] === "request") return resolution.fallback[key] ?? { value: null, source: null };
  return { value: resolvedValue(resolution, key), source: resolution.source[key] };
}

/** An edit that changes something: valid, and not the value already under it. */
export function isTickerEditActive(resolution: BacktestSymbolResolution | undefined, key: BacktestTickerValueKey, text: string): boolean {
  if (tickerValueTextProblem(key, text) !== null) return false;
  const below = tickerValueBelowEdit(resolution, key);
  return below === undefined || tickerEditValue(key, text) !== below.value;
}

/** What a ticker's cell shows for one value: the text, and where the value comes from (null for a pot not known yet). */
export interface TickerValueDisplay {
  text: string;
  value: number | string | null;
  source: BacktestSymbolSettingSource | null;
  /** The typed text, still being edited or not valid yet. */
  edited: boolean;
}

/**
 * A ticker's value as its cell shows it, before the next estimate confirms it: an active edit is "This session" at once,
 * a value just reset shows the value under it. With a starting value split equally the pot is that share ("Session").
 */
export function tickerValueDisplay(
  resolution: BacktestSymbolResolution | undefined,
  key: BacktestTickerValueKey,
  editText: string | undefined,
  capital: { mode: BacktestCapitalMode; splitPot: number | null },
): TickerValueDisplay {
  if (key === "potDollars" && capital.mode === "split") {
    const pot = capital.splitPot ?? resolution?.potDollars ?? null;
    return { text: tickerValueInputText(key, pot), value: pot, source: "session", edited: false };
  }
  if (editText !== undefined && (tickerValueTextProblem(key, editText) !== null || isTickerEditActive(resolution, key, editText))) {
    const valid = tickerValueTextProblem(key, editText) === null;
    return { text: editText, value: valid ? tickerEditValue(key, editText) : null, source: valid ? "request" : (resolution?.source[key] ?? null), edited: true };
  }
  const below = tickerValueBelowEdit(resolution, key);
  if (!below) return { text: editText ?? "", value: null, source: null, edited: editText !== undefined };
  return { text: editText ?? tickerValueInputText(key, below.value), value: below.value, source: below.source, edited: false };
}

/** The request's symbolSettings: each ticker's active edits (the pots only when they are not split from a starting value). */
export function buildTickerSymbolSettings(symbols: string[], edits: BacktestTickerEdits, resolution: BacktestTickerResolution | null, capitalMode: BacktestCapitalMode): Record<string, BacktestTickerValues> {
  const result: Record<string, BacktestTickerValues> = {};
  for (const symbol of symbols) {
    const symbolEdits = edits[symbol];
    if (!symbolEdits) continue;
    const values: BacktestTickerValues = {};
    for (const key of tickerValueKeys) {
      const text = symbolEdits[key];
      if (text === undefined || !isTickerEditActive(resolution?.bySymbol[symbol], key, text)) continue;
      if (key === "potDollars") {
        if (capitalMode === "pots") values.potDollars = tickerEditValue(key, text) as number;
      } else {
        values.baseline = { ...values.baseline, [key]: tickerEditValue(key, text) };
      }
    }
    if (values.potDollars !== undefined || values.baseline !== undefined) result[symbol] = values;
  }
  return result;
}

/** Typed values that cannot be sent ("HOOD: Rungs needs a whole number."), the pots only when they are used. */
export function tickerEditProblems(symbols: string[], edits: BacktestTickerEdits, capitalMode: BacktestCapitalMode): { symbol: string; key: BacktestTickerValueKey; message: string }[] {
  const problems: { symbol: string; key: BacktestTickerValueKey; message: string }[] = [];
  for (const symbol of [...symbols].sort()) {
    for (const key of tickerValueKeys) {
      const text = edits[symbol]?.[key];
      if (text === undefined || (key === "potDollars" && capitalMode === "split")) continue;
      const message = tickerValueTextProblem(key, text);
      if (message) problems.push({ symbol, key, message });
    }
  }
  return problems;
}

/** Whether any ticker has a typed value. */
export function hasTickerEdits(edits: BacktestTickerEdits): boolean {
  return Object.values(edits).some((symbolEdits) => Object.keys(symbolEdits).length > 0);
}

/** Run again: the values the copied session's request gave its tickers ("This session"); the rest come from the lab again. */
export function tickerEditsFromSession(symbolSettings: Record<string, BacktestSymbolSettings> | null, includePots: boolean): BacktestTickerEdits {
  const edits: BacktestTickerEdits = {};
  for (const [symbol, settings] of Object.entries(symbolSettings ?? {})) {
    const symbolEdits: Partial<Record<BacktestTickerValueKey, string>> = {};
    if (includePots && settings.source.potDollars === "request") symbolEdits.potDollars = tickerValueInputText("potDollars", settings.potDollars);
    for (const key of backtestTickerBaselineKeys) if (settings.source[key] === "request") symbolEdits[key] = tickerValueInputText(key, settings.baseline[key]);
    if (Object.keys(symbolEdits).length > 0) edits[symbol] = symbolEdits;
  }
  return edits;
}
