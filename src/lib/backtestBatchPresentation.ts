import { backtestTickerBaselineKeys, type BacktestBatchRun, type BacktestMetrics, type BacktestSessionBatchRef, type BacktestSessionListItem, type BacktestTickerValueKey } from "../api/backtest";
import { backtestSeriesColorsByTheme, buyAndHoldColorByTheme, buyAndHoldLineStyle, formatAbsDelta, parseDollarAmountText, tickerValueTextProblem } from "./backtestPresentation";
import { formatCurrency } from "./formatters";

// Backtest batches (mockup approved by Marcelo 2026-10-17, https://claude.ai/artifact/9rs1PXZGBnkphdMu2wc6yf): up to 9 runs on
// one period and the same settings, each its own account with its own tickers and ticker values, compared with buy and hold
// and combinable into one portfolio. Pure.

/** A run's tickers and each one's values: what the New session form has typed or resolved, or what a stored run ran on. */
export interface BatchRunValues {
  symbols: string[];
  values: Record<string, Partial<Record<BacktestTickerValueKey, number | string | null>>>;
}

const describedKeys: BacktestTickerValueKey[] = ["potDollars", ...backtestTickerBaselineKeys];

/** The keys a ticker's values use: the fixed shock only with a fixed shock, the shock range only with the shock from history. */
function keysInUse(values: Partial<Record<BacktestTickerValueKey, number | string | null>>): BacktestTickerValueKey[] {
  const fixed = values.ladderShock === "fixed";
  return describedKeys.filter((key) => (key === "ladderShockPct" ? fixed : key === "ladderShockMinPct" || key === "ladderShockMaxPct" ? !fixed : true));
}

/** One value as a run's description words it: "pot $100,000", "share level 30%", "3 rungs", "|delta| to 0.30". */
export function describeTickerValue(key: BacktestTickerValueKey, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return `${key} —`;
  switch (key) {
    case "potDollars":
      return `pot ${formatCurrency(Number(value), 0)}`;
    case "ladderShock":
      return value === "fixed" ? "fixed shock" : "shock from history";
    case "ladderRungs":
      return `${value} rungs`;
    case "minAbsDelta":
      return `|delta| from ${formatAbsDelta(Number(value))}`;
    case "maxAbsDelta":
      return `|delta| to ${formatAbsDelta(Number(value))}`;
    case "ladderSharesPct":
      return `share level ${value}%`;
    case "ladderShockPct":
      return `fixed shock ${value}%`;
    case "ladderShockMinPct":
      return `shock at least ${value}%`;
    case "ladderShockMaxPct":
      return `shock at most ${value}%`;
  }
}

/**
 * What makes each run different from the others (D7): its tickers when the runs' tickers differ, then each value that differs
 * between the runs holding that ticker, named by ticker when the run has several ("CRWV, NBIS · CRWV share level 50%").
 * Runs alike in every way say so; a single run is its tickers. Beside a Tickers column (the Start confirmation), the tickers
 * are left out: a run that differs only by them says "only its tickers".
 */
export function describeRunDifferences(runs: BatchRunValues[], { includeTickers = true }: { includeTickers?: boolean } = {}): string[] {
  const tickerSets = runs.map((run) => [...run.symbols].sort().join(", "));
  const tickersDiffer = new Set(tickerSets).size > 1;
  return runs.map((run, index) => {
    const symbols = [...run.symbols].sort();
    const parts = tickersDiffer && includeTickers ? [tickerSets[index]!] : [];
    for (const symbol of symbols) {
      const values = run.values[symbol] ?? {};
      for (const key of keysInUse(values)) {
        const holding = runs.filter((other) => other.symbols.includes(symbol));
        const distinct = new Set(holding.map((other) => String(other.values[symbol]?.[key] ?? "")));
        if (distinct.size > 1) parts.push(`${symbols.length > 1 ? `${symbol} ` : ""}${describeTickerValue(key, values[key])}`);
      }
    }
    if (parts.length > 0) return parts.join(" · ");
    if (tickersDiffer && !includeTickers) return "only its tickers";
    return runs.length > 1 ? "the same values as another run" : symbols.join(", ");
  });
}

/** "Run 2", "Runs 1–3", "Runs 1, 3 and 5". */
export function describeRunList(runNumbers: number[]): string {
  const sorted = [...runNumbers].sort((a, b) => a - b);
  if (sorted.length === 1) return `Run ${sorted[0]}`;
  const consecutive = sorted.every((number, index) => index === 0 || number === sorted[index - 1]! + 1);
  if (consecutive && sorted.length > 2) return `Runs ${sorted[0]}–${sorted.at(-1)}`;
  return `Runs ${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

/** The values a stored run ran on (its symbolSettings), for describeRunDifferences. */
export function storedRunValues(run: Pick<BacktestBatchRun, "session" | "symbolSettings">): BatchRunValues {
  const values: BatchRunValues["values"] = {};
  for (const [symbol, settings] of Object.entries(run.symbolSettings ?? {})) values[symbol] = { potDollars: settings.potDollars, ...settings.baseline };
  return { symbols: run.session.symbols, values };
}

/** A batch's ninth run: the charts' palette holds eight colours. Cyan, apart from the palette's blue and green (light 5.4:1 on white, dark 5.1:1 on the dark card #2a3648). */
const ninthRunColorByTheme = { light: "#0e7490", dark: "#22b8cf" } as const;
/** The combined portfolio's line: a purple no run takes (light 4.9:1 on white, dark 4.6:1 on the dark card #2a3648). */
const combinedColorByTheme = { light: "#ae3ec9", dark: "#d27ee6" } as const;

/** A run's line colour: the charts' categorical palette in run order, then cyan for a ninth run. */
export function batchRunColor(theme: "light" | "dark", runNumber: number): string {
  const palette = backtestSeriesColorsByTheme[theme];
  return runNumber <= palette.length ? palette[runNumber - 1]! : ninthRunColorByTheme[theme];
}

export function batchCombinedColor(theme: "light" | "dark"): string {
  return combinedColorByTheme[theme];
}

/** One buy-and-hold row per distinct set of tickers and pots (D9), with the runs it is theirs and a finished run's figures and line. */
export interface BatchBuyAndHoldGroup {
  key: string;
  symbols: string[];
  runNumbers: number[];
  metrics: BacktestMetrics | null;
  points: { tradingDate: string; value: number }[];
}

export function buyAndHoldGroups(runs: BacktestBatchRun[]): BatchBuyAndHoldGroup[] {
  const groups: BatchBuyAndHoldGroup[] = [];
  for (const run of runs) {
    const key = [...run.session.symbols]
      .sort()
      .map((symbol) => `${symbol}:${run.symbolSettings?.[symbol]?.potDollars ?? run.session.startingValue / run.session.symbols.length}`)
      .join("|");
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, symbols: [...run.session.symbols].sort(), runNumbers: [], metrics: null, points: [] };
      groups.push(group);
    }
    group.runNumbers.push(run.runNumber);
    if (group.metrics === null && run.baselineMetrics && run.points.length > 0) {
      group.metrics = run.baselineMetrics;
      group.points = run.points.map((point) => ({ tradingDate: point.tradingDate, value: point.baselineValue }));
    }
  }
  return groups;
}

/** A buy-and-hold line's colour (Marcelo 2026-10-17): its run's colour, dashed, when it belongs to one run; buy and hold's
 *  grey when several runs share it, since no one run's colour would be right. */
export function batchBuyAndHoldColor(theme: "light" | "dark", group: Pick<BatchBuyAndHoldGroup, "runNumbers">): string {
  return group.runNumbers.length === 1 ? batchRunColor(theme, group.runNumbers[0]!) : buyAndHoldColorByTheme[theme];
}

/** Each buy-and-hold line's style, in the groups' order: one shared by several runs in the reference white, solid for the
 *  first and dashed after; one of a single run, in that run's colour, always dashed so it never reads as the run itself. */
export function batchBuyAndHoldLineStyles(groups: readonly Pick<BatchBuyAndHoldGroup, "runNumbers">[]): ("solid" | "dashed" | "dotted")[] {
  let shared = 0;
  return groups.map((group) => (group.runNumbers.length === 1 ? "dashed" : buyAndHoldLineStyle("symbols", shared++)));
}

/** Buy and hold of SPY for the batch: its % figures and line are the same whatever a run's capital, so a finished run's stand for all; null when none kept it. */
export function batchSpyBaseline(runs: BacktestBatchRun[]): { metrics: BacktestMetrics; points: { tradingDate: string; value: number }[] } | null {
  const run = runs.find((candidate) => candidate.spyBaselineMetrics && candidate.points.length > 0 && candidate.points.every((point) => point.spyBaselineValue !== null));
  return run ? { metrics: run.spyBaselineMetrics!, points: run.points.map((point) => ({ tradingDate: point.tradingDate, value: point.spyBaselineValue! })) } : null;
}

/** The ticks in the address (?combine=1,3): whole run numbers, each once, in order. */
export function parseTickedRuns(text: string | null): number[] {
  if (!text) return [];
  return [...new Set(text.split(",").map((part) => Number(part.trim())))].filter((number) => Number.isInteger(number) && number >= 1).sort((a, b) => a - b);
}

/** A Sessions list entry (D14): a session, or a batch of two or more runs with its runs the page holds (the API keeps them together). */
export type BacktestSessionsEntry = { kind: "session"; session: BacktestSessionListItem } | { kind: "batch"; batch: BacktestSessionBatchRef; runs: BacktestSessionListItem[] };

export function groupSessionEntries(sessions: BacktestSessionListItem[]): BacktestSessionsEntry[] {
  const entries: BacktestSessionsEntry[] = [];
  for (const session of sessions) {
    const batch = session.batch;
    if (!batch || batch.runCount < 2) {
      entries.push({ kind: "session", session });
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === "batch" && last.batch.id === batch.id) last.runs.push(session);
    else entries.push({ kind: "batch", batch, runs: [session] });
  }
  return entries;
}

/** An entry's newest creation time: what the Sessions list's "new sessions" watermark compares. */
export function sessionsEntryCreatedAt(entry: BacktestSessionsEntry): string {
  return entry.kind === "session" ? entry.session.createdAt : entry.runs.map((run) => run.createdAt).sort().at(-1)!;
}

/** A run's name under its batch: "Run 2 · share level 30%" from "CRWV ladder · Run 2 · share level 30%". */
export function runNameInBatch(session: BacktestSessionListItem): string {
  const batch = session.batch;
  if (!batch) return session.name;
  const prefix = `${batch.name} · `;
  return session.name.startsWith(prefix) ? session.name.slice(prefix.length) : `Run ${batch.runNumber}`;
}

/** A batch row's state: "4 finished", "2 running · 1 queued · 1 finished". */
export function describeBatchRunStates(runs: BacktestSessionListItem[]): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = run.latestRun?.displayStatus ?? run.status;
    const label = status === "succeeded" ? "finished" : status;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return ["running", "stopped", "queued", "finished", "failed", "cancelled"]
    .filter((label) => counts.has(label))
    .map((label) => `${counts.get(label)} ${label}`)
    .join(" · ");
}

// ---- Make runs from a list of values (D5) ----

export type BatchVaryKey = "potDollars" | "ladderSharesPct" | "ladderRungs" | "ladderShockMinPct" | "ladderShockMaxPct" | "ladderShockPct" | "minAbsDelta" | "maxAbsDelta";

export const batchVaryChoices: { key: BatchVaryKey; label: string }[] = [
  { key: "potDollars", label: "Pot $" },
  { key: "ladderSharesPct", label: "Share level" },
  { key: "ladderRungs", label: "Rungs" },
  { key: "ladderShockMinPct", label: "Shock at least" },
  { key: "ladderShockMaxPct", label: "Shock at most" },
  { key: "ladderShockPct", label: "Fixed shock" },
  { key: "minAbsDelta", label: "|delta| from" },
  { key: "maxAbsDelta", label: "|delta| to" },
];

/** What Make runs is set to: a value, a ticker or every ticker ("*"), and the list as typed. */
export interface BatchVary {
  key: BatchVaryKey;
  ticker: string;
  text: string;
}

/**
 * The typed list: values separated by commas ("30, 50, 70"); pots by a comma and a space, or a semicolon, since a pot's
 * thousands take commas ("100,000, 150,000"). Each value once, checked as a typed ticker value; a pot as a whole dollar
 * amount. The ranges are checked by the estimate, run by run.
 */
export function parseVaryValues(key: BatchVaryKey, text: string): { values: number[] } | { error: string } {
  const tokens = (key === "potDollars" ? text.split(/,\s+|;|\s+(?=\$?\d)/) : text.split(/[,;\s]+/)).map((token) => token.trim()).filter((token) => token !== "");
  if (tokens.length === 0) return { error: "Give one or more values, separated by commas." };
  const values: number[] = [];
  for (const token of tokens) {
    const problem = tickerValueTextProblem(key, token);
    if (problem) return { error: `${token}: ${problem}` };
    const value = key === "potDollars" ? parseDollarAmountText(token) : Number(token);
    if (!values.includes(value)) values.push(value);
  }
  return { values };
}

/** The run's tickers Make runs changes: the chosen one or every one, among those whose values use the key (the shock range only with the shock from history, the fixed shock only with a fixed shock). */
export function batchVaryTargets(run: BatchRunValues, vary: Pick<BatchVary, "key" | "ticker">): string[] {
  return [...run.symbols].sort().filter((symbol) => (vary.ticker === "*" || vary.ticker === symbol) && keysInUse(run.values[symbol] ?? {}).includes(vary.key));
}

/** What Make runs would do, before it is pressed: the button's label, a sentence, and whether it can (9 runs at most). */
export function describeVaryPreview(runs: BatchRunValues[], vary: BatchVary, maxRuns: number): { ok: boolean; label: string; text: string } {
  const parsed = parseVaryValues(vary.key, vary.text);
  const label = batchVaryChoices.find((choice) => choice.key === vary.key)!.label;
  if ("error" in parsed) return { ok: false, label: "Make runs", text: parsed.error };
  const affected = runs.filter((run) => batchVaryTargets(run, vary).length > 0).length;
  const withTicker = vary.ticker === "*" ? "" : ` with ${vary.ticker}`;
  if (affected === 0) return { ok: false, label: "Make runs", text: `No run${withTicker} uses ${label.toLowerCase()}.` };
  const count = parsed.values.length;
  const everyRun = affected === runs.length;
  if (count === 1) return { ok: true, label: "Set it", text: `Sets ${label.toLowerCase()} to ${vary.text.trim()} on ${everyRun ? (runs.length === 1 ? "the run" : "every run") : `${affected} runs`}${withTicker}.` };
  const total = runs.length - affected + affected * count;
  const sentence = `${everyRun ? (runs.length === 1 ? "The run" : "Each run") : `${affected} of the runs`}${withTicker} ${everyRun ? "becomes" : "become"} ${count} runs, one per value: ${runs.length} → ${total}.`;
  if (total > maxRuns) return { ok: false, label: `Make ${total} runs`, text: `${sentence} That is more than ${maxRuns}: remove runs or give fewer values.` };
  return { ok: true, label: `Make ${total} runs`, text: sentence };
}
