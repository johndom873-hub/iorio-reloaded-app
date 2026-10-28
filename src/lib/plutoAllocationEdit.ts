import { formatCurrency, formatInputNumber, formatPercentageValueTrimmed } from "./formatters";
import { allocationTextProblem, excessAllowanceTextProblem, parseAllocationText, summarizeAllocations, tickerPotDollars, type AllocationSummary } from "./tickerAllocation";

// The Pluto Tickers tab's Edit allocations (mockup approved 2026-10-28): each enabled ticker's allocation typed in its row
// and the excess allowance in the strip, checked as PUT /pluto/allocations checks them (a set allocation above 0 and at
// most 100, rounded to 2 decimals; every set allocation, a switched-off ticker's too, at most 100% in all; the allowance
// 0 to 1,000, 4 decimals) and saved together.

export interface PlutoAllocationTicker {
  symbol: string;
  enabled: boolean;
  /** The saved allocation; null: an equal share. */
  savedPct: number | null;
}

export interface PlutoAllocationDraft {
  /** Each ticker's allocation as typed (empty: an equal share); a ticker not in it keeps its saved one. */
  textBySymbol: Record<string, string>;
  allowanceText: string;
}

/** An allocation as the screen shows it, "9.09%"; the allowance keeps its 4 decimals, "26.3158%". */
export const allocationPercentText = (pct: number) => formatPercentageValueTrimmed(pct, 2);
export const allowancePercentText = (pct: number) => formatPercentageValueTrimmed(pct, 4);
const roundedAllocation = (pct: number) => Math.round(pct * 100) / 100;
const roundedAllowance = (pct: number) => Math.round(pct * 10_000) / 10_000;

/** Edit allocations opens on the saved values: every enabled ticker, and a switched-off one that holds a set allocation. */
export function allocationDraftOf(tickers: PlutoAllocationTicker[], savedAllowancePct: number): PlutoAllocationDraft {
  return {
    textBySymbol: Object.fromEntries(tickers.filter((ticker) => ticker.enabled || ticker.savedPct !== null).map((ticker) => [ticker.symbol, ticker.savedPct === null ? "" : formatInputNumber(ticker.savedPct, 2)])),
    allowanceText: formatInputNumber(savedAllowancePct, 4),
  };
}

export interface PlutoAllocationRow {
  /** The set allocation as typed (or saved); null: an equal share. An unusable value counts as empty in the figures. */
  setPct: number | null;
  /** The allocation the ticker gets; null while it is switched off. */
  effectivePct: number | null;
  savedEffectivePct: number | null;
  potDollars: number | null;
  /** Why its typed value cannot be saved. */
  problem: string | null;
  changed: boolean;
}

export interface PlutoAllocationView {
  /** The enabled tickers' allocations as typed, with the allowance typed. */
  summary: AllocationSummary;
  allowancePct: number;
  allowanceProblem: string | null;
  rowBySymbol: Map<string, PlutoAllocationRow>;
  /** Set allocations on switched-off tickers: they count toward the 100% (so switching one on never takes it past 100%). */
  switchedOffSet: { symbol: string; pct: number }[];
  /** Every set allocation, a switched-off ticker's too. */
  setTotalAllPct: number;
  overFull: boolean;
  problems: string[];
  /** Each change: its ticker (null for the allowance) and what changed, "9.09% → 15%" or "excess allowance 0% → 20%". */
  changes: { symbol: string | null; detail: string }[];
  /** What the tickers left on an equal share get instead; null when nothing changes for them. */
  knockOn: string | null;
  potsTotalDollars: number | null;
  /** What Save sends; null while nothing changed or something cannot be saved. */
  request: { allocations: Record<string, number | null>; excessAllowancePct?: number } | null;
}

export function buildPlutoAllocationView(tickers: PlutoAllocationTicker[], draft: PlutoAllocationDraft | null, budgetDollars: number | null, savedAllowancePct: number): PlutoAllocationView {
  const typedText = (ticker: PlutoAllocationTicker) => draft?.textBySymbol[ticker.symbol];
  const problemOf = (ticker: PlutoAllocationTicker) => {
    const text = typedText(ticker);
    return text === undefined ? null : allocationTextProblem(text);
  };
  const setPctOf = (ticker: PlutoAllocationTicker): number | null => {
    const text = typedText(ticker);
    if (text === undefined) return ticker.savedPct;
    const typed = parseAllocationText(text);
    return typed === null || allocationTextProblem(text) !== null ? null : roundedAllocation(typed);
  };
  const allowanceProblem = draft ? excessAllowanceTextProblem(draft.allowanceText) : null;
  const allowancePct = draft && allowanceProblem === null ? roundedAllowance(Number(draft.allowanceText.trim())) : savedAllowancePct;
  const allowanceChanged = allowancePct !== savedAllowancePct;

  const enabled = tickers.filter((ticker) => ticker.enabled);
  const summary = summarizeAllocations(enabled.map((ticker) => ({ symbol: ticker.symbol, setPct: setPctOf(ticker) })), allowancePct);
  const savedSummary = summarizeAllocations(enabled.map((ticker) => ({ symbol: ticker.symbol, setPct: ticker.savedPct })), savedAllowancePct);
  const switchedOffSet = tickers.filter((ticker) => !ticker.enabled && setPctOf(ticker) !== null).map((ticker) => ({ symbol: ticker.symbol, pct: setPctOf(ticker)! }));
  const setTotalAllPct = summary.setTotalPct + switchedOffSet.reduce((sum, entry) => sum + entry.pct, 0);
  const overFull = setTotalAllPct > 100 + 1e-9;

  const rowBySymbol = new Map<string, PlutoAllocationRow>();
  const problems: string[] = [];
  const changes: PlutoAllocationView["changes"] = [];
  const changedAllocations: Record<string, number | null> = {};
  for (const ticker of tickers) {
    const setPct = setPctOf(ticker);
    const problem = problemOf(ticker);
    const effectivePct = ticker.enabled ? (summary.allocationBySymbol.get(ticker.symbol) ?? 0) : null;
    const savedEffectivePct = ticker.enabled ? (savedSummary.allocationBySymbol.get(ticker.symbol) ?? 0) : null;
    const changed = typedText(ticker) !== undefined && (problem !== null || setPct !== ticker.savedPct);
    rowBySymbol.set(ticker.symbol, { setPct, effectivePct, savedEffectivePct, potDollars: budgetDollars !== null && effectivePct !== null ? tickerPotDollars(budgetDollars, effectivePct, allowancePct) : null, problem, changed });
    if (problem !== null) problems.push(`${ticker.symbol}: ${problem}.`);
    else if (changed) {
      changedAllocations[ticker.symbol] = setPct;
      if (ticker.enabled) changes.push({ symbol: ticker.symbol, detail: `${allocationPercentText(savedEffectivePct!)} → ${setPct === null ? `an equal share, ${allocationPercentText(effectivePct!)}` : allocationPercentText(setPct)}` });
      else changes.push({ symbol: ticker.symbol, detail: `(switched off) ${ticker.savedPct === null ? "equal share" : allocationPercentText(ticker.savedPct)} → ${setPct === null ? "equal share" : allocationPercentText(setPct)}` });
    }
  }
  if (allowanceProblem !== null) problems.push(`Excess allowance: ${allowanceProblem}.`);
  else if (allowanceChanged) changes.push({ symbol: null, detail: `excess allowance ${allowancePercentText(savedAllowancePct)} → ${allowancePercentText(allowancePct)}` });

  return {
    summary,
    allowancePct,
    allowanceProblem,
    rowBySymbol,
    switchedOffSet,
    setTotalAllPct,
    overFull,
    problems,
    changes,
    knockOn: draft ? describeKnockOn(enabled.filter((ticker) => ticker.savedPct === null && setPctOf(ticker) === null).map((ticker) => ticker.symbol), savedSummary.equalSharePct, summary.equalSharePct, budgetDollars, savedAllowancePct, allowancePct) : null,
    potsTotalDollars: budgetDollars === null ? null : (budgetDollars * summary.potsTotalPct) / 100,
    request: draft && problems.length === 0 && !overFull && changes.length > 0 ? { allocations: changedAllocations, ...(allowanceChanged ? { excessAllowancePct: allowancePct } : {}) } : null,
  };
}

/** "The 9 tickers on an equal share go from 9.09% to 8.11% each; with the allowance their pots go from $47,128 to $50,459."
 *  About the tickers on an equal share before and after; null when neither their share nor their pot changes. */
function describeKnockOn(symbols: string[], shareBefore: number | null, shareAfter: number | null, budgetDollars: number | null, allowanceBefore: number, allowanceAfter: number): string | null {
  if (symbols.length === 0 || shareBefore === null || shareAfter === null) return null;
  const shareChanged = allocationPercentText(shareBefore) !== allocationPercentText(shareAfter);
  const allowanceChanged = allowanceBefore !== allowanceAfter;
  if (!shareChanged && !allowanceChanged) return null;
  const one = symbols.length === 1;
  const subject = one ? `${symbols[0]}, on an equal share,` : `The ${symbols.length} tickers on an equal share`;
  const each = one ? "" : " each";
  const share = shareChanged ? `${subject} ${one ? "goes" : "go"} from ${allocationPercentText(shareBefore)} to ${allocationPercentText(shareAfter)}${each}` : `${subject} ${one ? "keeps" : "keep"} ${allocationPercentText(shareAfter)}${each}`;
  if (budgetDollars === null) return `${share}.`;
  const pots = `${one ? "its pot goes" : "their pots go"} from ${formatCurrency(tickerPotDollars(budgetDollars, shareBefore, allowanceBefore), 0)} to ${formatCurrency(tickerPotDollars(budgetDollars, shareAfter, allowanceAfter), 0)}`;
  return `${share}; ${allowanceChanged ? `with the allowance ${pots}` : pots}.`;
}
