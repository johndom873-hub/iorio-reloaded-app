import type { PortfolioBookTicker, PortfolioDrift, PortfolioHorizonYears, PortfolioWarning, PortfolioYearSource, SavedPortfolio } from "../api/backtestPortfolio";
import { formatSignedNumber } from "./formatters";

// The portfolio simulator screen's presentation (Marcelo 2026-11-04, mockup approved): saved portfolios and unsaved
// changes, the view settings this browser keeps, the warnings' wording, and the figures' signed differences.

/** The book being edited: a saved portfolio's id and name, or null for a new one not saved yet. */
export interface EditedPortfolio {
  id: string | null;
  name: string | null;
  tickers: PortfolioBookTicker[];
  accountDollars: number;
}

export const defaultAccountDollars = 1_000_000;

export const emptyPortfolio: EditedPortfolio = { id: null, name: null, tickers: [], accountDollars: defaultAccountDollars };

export function editedPortfolioOf(saved: SavedPortfolio): EditedPortfolio {
  return { id: saved.id, name: saved.name, tickers: saved.tickers.map((ticker) => ({ ...ticker })), accountDollars: saved.accountDollars };
}

/** Whether the book differs from what was saved: its tickers (order included), allocations or account. A new book counts as changed once it has a ticker. */
export function hasUnsavedChanges(edited: EditedPortfolio, saved: SavedPortfolio | null): boolean {
  if (saved === null) return edited.tickers.length > 0;
  if (edited.accountDollars !== saved.accountDollars || edited.tickers.length !== saved.tickers.length) return true;
  return edited.tickers.some((ticker, index) => ticker.symbol !== saved.tickers[index]!.symbol || (ticker.allocationPct ?? null) !== (saved.tickers[index]!.allocationPct ?? null));
}

export const maxPortfolioNameLength = 60;

/** Why a name can't be saved: empty, too long, or another portfolio's (whatever its case); null when it can. `exceptId`: the portfolio being saved over. */
export function portfolioNameProblem(name: string, portfolios: readonly SavedPortfolio[], exceptId: string | null = null): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Give the portfolio a name.";
  if (trimmed.length > maxPortfolioNameLength) return `A name may be at most ${maxPortfolioNameLength} characters.`;
  const taken = portfolios.find((portfolio) => portfolio.id !== exceptId && portfolio.name.toLowerCase() === trimmed.toLowerCase());
  return taken ? `A portfolio named "${taken.name}" already exists. Choose another name.` : null;
}

/**
 * Allocations rounded to 2 decimals (as the boxes show them) keeping their total: each is rounded down to the cent of a
 * percent, then the cents the rounding lost go one each to the largest remainders. Example: three thirds of 100% become
 * 33.34, 33.33 and 33.33, adding up to 100.00 rather than 99.99.
 */
export function roundAllocationsKeepingTotal(allocations: readonly { symbol: string; allocationPct: number }[]): Map<string, number> {
  const cents = allocations.map((entry) => ({ symbol: entry.symbol, exact: entry.allocationPct * 100, floor: Math.floor(entry.allocationPct * 100 + 1e-9) }));
  let missing = Math.round(cents.reduce((sum, entry) => sum + entry.exact, 0)) - cents.reduce((sum, entry) => sum + entry.floor, 0);
  for (const entry of [...cents].sort((a, b) => b.exact - b.floor - (a.exact - a.floor))) {
    if (missing <= 0) break;
    entry.floor += 1;
    missing -= 1;
  }
  return new Map(cents.map((entry) => [entry.symbol, entry.floor / 100]));
}

// ---- View settings (this browser only) ----

export interface PortfolioViewSettings {
  horizonYears: PortfolioHorizonYears;
  /** The drift the year-end chart, the average year and each ticker's year are shown at (both are always projected). */
  chartDrift: PortfolioDrift;
  pathCount: number;
  compareWithId: string | null;
}

export const projectionPathChoices = [100, 500, 1000, 2000] as const;
const viewSettingsKey = "iorio-portfolio-simulator-view";
const lastOpenedKey = "iorio-portfolio-simulator-last-opened";
const defaultViewSettings: PortfolioViewSettings = { horizonYears: 5, chartDrift: "neutral", pathCount: 500, compareWithId: null };

/** Both drifts, in the order they are projected and shown. */
export const driftOrder: readonly PortfolioDrift[] = ["neutral", "as_it_happened"];
export const driftLabels: Record<PortfolioDrift, string> = { neutral: "Neutral", as_it_happened: "As it happened" };

export function readPortfolioViewSettings(): PortfolioViewSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(viewSettingsKey) ?? "null") as Partial<PortfolioViewSettings> | null;
    return {
      horizonYears: stored?.horizonYears === 3 ? 3 : 5,
      chartDrift: stored?.chartDrift === "as_it_happened" ? "as_it_happened" : "neutral",
      pathCount: (projectionPathChoices as readonly number[]).includes(stored?.pathCount ?? 0) ? stored!.pathCount! : defaultViewSettings.pathCount,
      compareWithId: typeof stored?.compareWithId === "string" ? stored.compareWithId : null,
    };
  } catch {
    return defaultViewSettings;
  }
}

export function writePortfolioViewSettings(settings: PortfolioViewSettings): void {
  try {
    localStorage.setItem(viewSettingsKey, JSON.stringify(settings));
  } catch {
    // Private mode or storage full: the settings last until the page is left.
  }
}

/** The saved portfolio opened last in this browser (opening or saving one), or null. */
export function readLastOpenedPortfolioId(): string | null {
  try {
    return localStorage.getItem(lastOpenedKey);
  } catch {
    return null;
  }
}

export function writeLastOpenedPortfolioId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(lastOpenedKey);
    else localStorage.setItem(lastOpenedKey, id);
  } catch {
    // As above.
  }
}

// ---- A ticker's fit (its latest analysis's verdict, worded as the Analyse window words it) ----

export function fitLabel(verdict: string | null): string {
  if (verdict === "suits") return "Suits v4";
  if (verdict === "doesnt_suit") return "Doesn't suit v4";
  return "Not analysed";
}

/** The Analyse window's verdict badge classes (theme.css analysis-verdict-badge), grey when not analysed. */
export function fitBadgeClass(verdict: string | null): string {
  if (verdict === "suits") return "badge analysis-verdict-badge is-good";
  if (verdict === "doesnt_suit") return "badge analysis-verdict-badge is-poor";
  return "badge bg-secondary-lt";
}

// ---- Warnings ----

const warningCodeLabels: Record<PortfolioWarning["code"], string> = {
  doesnt_suit: "W1",
  lot_too_large: "W2",
  group_too_large: "W3",
  short_history: "W4",
  no_bear_market_in_backtest: "W5",
  allocations_not_100: "W6",
};

export interface PortfolioWarningLine {
  code: string;
  text: string;
}

/**
 * One line per warning, the lots too large for their pot (W2, one per ticker from the API) joined into one: "16 tickers: one
 * lot (100 shares) is over 80% of the pot. One lot as a share of the pot: AAPL 121%, AMD 167%."
 */
export function warningLinesOf(warnings: readonly PortfolioWarning[]): PortfolioWarningLine[] {
  const lots = warnings.filter((warning) => warning.code === "lot_too_large");
  const lines: PortfolioWarningLine[] = [];
  if (lots.length === 1) lines.push({ code: warningCodeLabels.lot_too_large, text: lots[0]!.text });
  else if (lots.length > 1) {
    const shares = lots.map((warning) => `${warning.symbols[0]} ${/is (\d+)% of/.exec(warning.text)?.[1] ?? "?"}%`);
    lines.push({ code: warningCodeLabels.lot_too_large, text: `${lots.length} tickers: one lot (100 shares) is over 80% of the pot. One lot as a share of the pot: ${shares.join(", ")}.` });
  }
  for (const warning of warnings) if (warning.code !== "lot_too_large") lines.push({ code: warningCodeLabels[warning.code], text: warning.text });
  return lines;
}

/** Each ticker's warning codes, for its row ("W2", "W5"). */
export function warningCodesBySymbol(warnings: readonly PortfolioWarning[]): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const warning of warnings) for (const symbol of warning.symbols) codes.set(symbol, [...(codes.get(symbol) ?? []), warningCodeLabels[warning.code]]);
  return codes;
}

// ---- Figures ----

export const yearSourceLabels: Record<PortfolioYearSource, string> = {
  calls: "Calls sold",
  puts: "Puts sold",
  leaps: "LEAPS",
  interest: "T-bills",
  dividends: "Dividends",
  shares: "Shares (price moves)",
};

export const yearSourceOrder: PortfolioYearSource[] = ["calls", "puts", "leaps", "interest", "dividends", "shares"];

/** A difference in percentage points: 0.0123 → "+1.2 pts", −0.0371 → "-3.7 pts". */
export function formatSignedPoints(fraction: number): string {
  return `${formatSignedNumber(fraction * 100, 1)} pts`;
}

/** A difference against the compared portfolio, coloured when it shows: higher is better for every figure the screen compares (a Max drawdown nearer 0 is higher). */
export function comparisonInk(difference: number, kind: "points" | "ratio"): string {
  const shown = kind === "points" ? Math.round(difference * 1000) / 1000 : Math.round(difference * 100) / 100;
  if (shown === 0) return "text-secondary";
  return shown > 0 ? "analysis-ink-good" : "analysis-ink-poor";
}

/** The heatmap's order: the groups' tickers first, group by group, then the rest in the book's order. */
export function tickersInGroupOrder(symbols: readonly string[], groups: readonly { symbols: string[] }[]): string[] {
  const grouped = groups.flatMap((group) => group.symbols);
  return [...grouped, ...symbols.filter((symbol) => !grouped.includes(symbol))];
}

/** "G1"… for each grouped ticker. */
export function groupLabelBySymbol(groups: readonly { symbols: string[] }[]): Map<string, string> {
  const labels = new Map<string, string>();
  groups.forEach((group, index) => group.symbols.forEach((symbol) => labels.set(symbol, `G${index + 1}`)));
  return labels;
}

/** A projection's book key, to tell whether the figures on screen are for the book as it is now. */
export function projectionKeyOf(tickers: readonly PortfolioBookTicker[], accountDollars: number, view: Pick<PortfolioViewSettings, "horizonYears" | "pathCount">): string {
  return JSON.stringify({ tickers: tickers.map((ticker) => [ticker.symbol, ticker.allocationPct ?? null]), accountDollars, horizonYears: view.horizonYears, pathCount: view.pathCount });
}
