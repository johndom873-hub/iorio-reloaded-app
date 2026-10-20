import {
  backtestTickerBaselineKeys,
  type BacktestSettingRow,
  type BacktestSymbolResolution,
  type BacktestSymbolSettingSource,
  type BacktestSymbolSettings,
  type BacktestTickerValueKey,
  type BacktestTickerValues,
} from "../api/backtest";
import {
  backtestValueSourceTitle,
  describeTickerProblem,
  describeTickerResetTarget,
  mostSpecificValueSource,
  parseDollarAmountText,
  settingInputText,
  tickerValueGroupKeys,
  tickerValueInputText,
  tickerValueTextProblem,
  type BacktestTickerValueGroup,
} from "./backtestPresentation";
import { differingAnalysisKeys, type AnalysisPanelValues } from "./analysisPresentation";

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

// ---- The Tickers card's rows (the one-run Tickers card and the several-runs Runs card share them) ----

/** The table's columns: the ticker, its pot and weight, then each group of values. */
export const tickerValueColumns: { key: "ticker" | "weight" | BacktestTickerValueGroup; header: string; title?: string }[] = [
  { key: "ticker", header: "Ticker" },
  { key: "pot", header: "Pot $", title: "The ticker's money. Its weight is its pot ÷ the sum of the pots." },
  { key: "weight", header: "Weight", title: "Pot ÷ the sum of the pots: the ticker's share of the account for its ladder's base, fixed for the session." },
  { key: "share", header: "Share level", title: "The ladder's shares at most, at cost, as a % of the ticker's base; the rest is its puts' reserve." },
  { key: "rungs", header: "Rungs", title: "The reserve is spent in this many puts." },
  { key: "shock", header: "Shock", title: "The fall at which the reserve is fully committed: the stock's Max drawdown in the years before the cycle, within the range, or a fixed %." },
  { key: "delta", header: "|delta| range", title: "The |delta| range of the Calls and Puts sold." },
];
/** The gear lists every column but the ticker's. */
export const hideableTickerValueColumns = tickerValueColumns.filter((column) => column.key !== "ticker");

/** One ticker's values as its cells show them, with its problems. */
export interface TickerRowModel {
  symbol: string;
  resolution: BacktestSymbolResolution | undefined;
  display: Record<BacktestTickerValueKey, TickerValueDisplay>;
  weight: number | null;
  problems: { key: string | null; text: string }[];
}

export function tickerRowGroupKeys(row: TickerRowModel, group: BacktestTickerValueGroup): BacktestTickerValueKey[] {
  return tickerValueGroupKeys(group, String(row.display.ladderShock.value ?? "history"));
}

/** Where a column's values come from: the most specific source among its keys. */
export function tickerRowGroupSource(row: TickerRowModel, group: BacktestTickerValueGroup): BacktestSymbolSettingSource | null {
  return mostSpecificValueSource(tickerRowGroupKeys(row, group).map((key) => row.display[key].source));
}

/** The values a column's Reset returns to: for each of its keys, the value under this session's edit. */
export function tickerRowResetTarget(row: TickerRowModel, group: BacktestTickerValueGroup): { text: string; title: string } {
  const below: Partial<Record<BacktestTickerValueKey, number | string | null>> = {};
  const sources: (BacktestSymbolSettingSource | null)[] = [];
  // The shock's numbers follow the mode it returns to.
  const shockBelow = tickerValueBelowEdit(row.resolution, "ladderShock")?.value ?? row.display.ladderShock.value;
  const keys = group === "shock" ? tickerValueGroupKeys("shock", String(shockBelow ?? "history")) : tickerRowGroupKeys(row, group);
  for (const key of keys) {
    const under = row.display[key].source === "request" ? tickerValueBelowEdit(row.resolution, key) : { value: row.display[key].value, source: row.display[key].source };
    below[key] = under?.value ?? null;
    sources.push(under?.source ?? null);
  }
  const text = describeTickerResetTarget(group, below);
  const source = mostSpecificValueSource(sources);
  return { text, title: text === "Clear" || !source ? "Remove this session's pot: the ticker has no other" : `Back to ${backtestValueSourceTitle[source]}` };
}

const displayedKeys: BacktestTickerValueKey[] = ["potDollars", "minAbsDelta", "maxAbsDelta", "ladderSharesPct", "ladderRungs", "ladderShock", "ladderShockPct", "ladderShockMinPct", "ladderShockMaxPct"];

/** Each ticker's row, in turn order (alphabetical): what its cells show and its problems (typed values, then the estimate's). */
export function buildTickerRowModels(input: { symbols: string[]; edits: BacktestTickerEdits; resolution: BacktestTickerResolution | null; capitalMode: BacktestCapitalMode; splitStartingValue: number; settingRows: BacktestSettingRow[] }): TickerRowModel[] {
  const orderedSymbols = [...input.symbols].sort();
  const splitPot = input.capitalMode === "split" && input.splitStartingValue > 0 && orderedSymbols.length > 0 ? input.splitStartingValue / orderedSymbols.length : null;
  const localProblems = tickerEditProblems(orderedSymbols, input.edits, input.capitalMode);
  return orderedSymbols.map((symbol) => {
    const symbolResolution = input.resolution?.bySymbol[symbol];
    const display = Object.fromEntries(displayedKeys.map((key) => [key, tickerValueDisplay(symbolResolution, key, input.edits[symbol]?.[key], { mode: input.capitalMode, splitPot })])) as Record<BacktestTickerValueKey, TickerValueDisplay>;
    const problems = [
      ...localProblems.filter((problem) => problem.symbol === symbol).map((problem) => ({ key: problem.key as string | null, text: problem.message })),
      ...(symbolResolution?.problems ?? []).map((problem) => ({ key: problem.key, text: describeTickerProblem(symbol, problem, input.settingRows) })),
    ];
    return { symbol, resolution: symbolResolution, display, weight: symbolResolution?.weight ?? null, problems };
  });
}

/**
 * What the Analyse window's Backtest button hands the New session form (Marcelo 2026-10-20): the values on screen (a trial's,
 * else the ticker's saved ones) that differ from the ticker's saved values, as this session's typed edits: the ticker's
 * own values on its Tickers row, the global-only ones (days to expiry, spread) as the session's settings.
 */
export interface AnalysisSessionValues {
  symbol: string;
  tickerEdits: Partial<Record<BacktestTickerValueKey, string>>;
  /** Setting path ("baseline.minDte") → the setting input's text. */
  settingValues: Record<string, string>;
}

export function analysisSessionValues(symbol: string, shown: AnalysisPanelValues, saved: AnalysisPanelValues): AnalysisSessionValues {
  const tickerEdits: AnalysisSessionValues["tickerEdits"] = {};
  const settingValues: Record<string, string> = {};
  for (const key of differingAnalysisKeys(shown, saved)) {
    if (key === "ladderShockPct") {
      // No fixed shock on screen: the shock from history, at the lab's range.
      if (shown.ladderShockPct === null) tickerEdits.ladderShock = "history";
      else Object.assign(tickerEdits, { ladderShock: "fixed", ladderShockPct: tickerValueInputText("ladderShockPct", shown.ladderShockPct) });
    } else if (key === "minDte" || key === "maxDte" || key === "maxSpreadPctOfMid") settingValues[`baseline.${key}`] = settingInputText(shown[key]);
    else tickerEdits[key] = tickerValueInputText(key, shown[key]);
  }
  return { symbol, tickerEdits, settingValues };
}
