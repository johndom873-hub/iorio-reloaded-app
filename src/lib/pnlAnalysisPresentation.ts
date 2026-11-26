import type { AnalysisBook, AnalysisDays, BookAnalysis, GatedFigure, GatedTradeFigure, NightFigures, PnlAnalysis } from "../api/pnlAnalysis";
import { formatDayMonth, formatEasternTime } from "./formatters";
import type { BookKey } from "../api/books";
import type { CycleBucketKey } from "../api/positions";
import { strategyAbbrev, strategyColorVariable, strategyKeyOfCycleBucket } from "./positionPnl";

// The P&L Analyser's figures as the screens show them (mockup approved by Marcelo 2026-11-13): sums over the nights of a
// range from GET /pnl-analysis, so every table and chart adds up to the book's P&L. Unexplained (and for All books IBKR's
// own valuation) is its own line, never spread over the rest.

/** The live night the analysis ends with (today, taken at load time), or null when it ends at a close. */
export function liveNightOf(analysis: PnlAnalysis | null | undefined): string | null {
  return analysis?.live?.state === "live" ? analysis.live.night : null;
}

/** A night as a figure's note names it: "today (live)" for the live night, else "20 Nov". */
export function analysisNightNote(night: string, liveNight: string | null): string {
  return night === liveNight ? "today (live)" : formatDayMonth(night);
}

/** When the live night was taken: "11:08 ET"; null when the analysis ends at a close. */
export function liveTakenAt(analysis: PnlAnalysis | null | undefined): string | null {
  return analysis?.live?.state === "live" ? formatEasternTime(analysis.live.capturedAt) : null;
}

/**
 * The Positions card's as-of note (mockup approved 2026-11-24): "live as of 11:08 ET (today provisional)" with the legs
 * valued at their last close, "as of the 20 Nov close · live figures unavailable: IBKR is not answering", or "as of the 20 Nov close".
 */
export function analysisAsOfNote(analysis: PnlAnalysis): { text: string; legsAtLastClose: string[] } | null {
  const takenAt = liveTakenAt(analysis);
  if (takenAt !== null && analysis.live?.state === "live") return { text: `live as of ${takenAt} (today provisional)`, legsAtLastClose: analysis.live.legsAtLastClose };
  if (!analysis.lastNight) return null;
  const close = `as of the ${formatDayMonth(analysis.lastNight)} close`;
  return { text: analysis.live?.state === "unavailable" ? `${close} · live figures unavailable: ${analysis.live.reason}` : close, legsAtLastClose: [] };
}

/**
 * The charts' Live band: a shaded span from `fromTime` to `toTime` (ms) with its label at the top, in `textColor` on
 * `fillColor`. ApexCharts places the label at the span's start: `labelSide` "inside" runs it into the band (charts with room
 * on the right), "before" ends it just left of the band (a band at the plot's right edge), never centred over the start,
 * where it ran into the Books begin label.
 */
export function liveBandAnnotation(fromTime: number, toTime: number, label: string, textColor: string, fillColor: string, labelSide: "inside" | "before") {
  return {
    x: fromTime,
    x2: toTime,
    fillColor,
    opacity: 1,
    borderColor: "transparent",
    label: { text: label, orientation: "horizontal" as const, position: "top" as const, textAnchor: labelSide === "inside" ? ("start" as const) : ("end" as const), offsetX: labelSide === "inside" ? 4 : -4, borderWidth: 0, offsetY: -2, style: { color: textColor, background: "transparent", fontSize: "0.72rem", fontWeight: 600 } },
  };
}

/** The strategies in the order every table and chart lists them. */
export const analysisBuckets: readonly CycleBucketKey[] = ["csp", "cc", "unstructured", "leaps", "hedge"];

export const bookChoiceLabels: Record<AnalysisBook, string> = { all: "All books", pluto: "Pluto", manual: "Manual" };
export const analysisBooks: readonly AnalysisBook[] = ["all", "pluto", "manual"];

/** Each book's chart colour (theme.css). All books is drawn dashed. */
export const bookColorVariable: Record<AnalysisBook, string> = { pluto: "--iorio-book-pluto", manual: "--iorio-book-manual", all: "--iorio-book-all" };

export type AnalysisPreset = "mtd" | "qtd" | "ytd" | "inception" | "custom";

export const analysisPresetLabels: Record<Exclude<AnalysisPreset, "custom">, string> = { mtd: "MTD", qtd: "QTD", ytd: "YTD", inception: "Since inception" };

export interface AnalysisPeriod {
  preset: AnalysisPreset;
  days: AnalysisDays;
}

export const sinceInceptionPeriod: AnalysisPeriod = { preset: "inception", days: { from: null, to: null } };

/** A preset's days for today's Eastern date (YYYY-MM-DD): MTD from the 1st, QTD from the quarter's first day, YTD from Jan 1. */
export function analysisDaysForPreset(preset: Exclude<AnalysisPreset, "custom">, todayEastern: string): AnalysisDays {
  const year = todayEastern.slice(0, 4);
  const month = Number(todayEastern.slice(5, 7));
  if (preset === "mtd") return { from: `${todayEastern.slice(0, 7)}-01`, to: null };
  if (preset === "qtd") return { from: `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`, to: null };
  if (preset === "ytd") return { from: `${year}-01-01`, to: null };
  return { from: null, to: null };
}

export interface PnlComponents {
  putPremium: number;
  callPremium: number;
  stock: number;
  leaps: number;
  hedge: number;
  commissions: number;
  dividends: number;
  interest: number;
  fees: number;
  otherCash: number;
  /** Change of the cycles left out for incomplete data. */
  flagged: number;
  ibkrValuation: number;
  unexplained: number;
  bookPnl: number;
}

function emptyComponents(): PnlComponents {
  return { putPremium: 0, callPremium: 0, stock: 0, leaps: 0, hedge: 0, commissions: 0, dividends: 0, interest: 0, fees: 0, otherCash: 0, flagged: 0, ibkrValuation: 0, unexplained: 0, bookPnl: 0 };
}

/** The range's P&L by component; the components add up to bookPnl. */
export function sumComponents(nights: readonly NightFigures[]): PnlComponents {
  const total = emptyComponents();
  for (const night of nights) {
    const buckets = night.buckets;
    if (buckets) {
      total.putPremium += buckets.csp.premiumGross;
      total.callPremium += buckets.cc.premiumGross;
      total.stock += buckets.csp.stockGross + buckets.cc.stockGross + buckets.unstructured.stockGross;
      total.leaps += buckets.leaps.premiumGross + buckets.leaps.stockGross;
      total.hedge += buckets.hedge.premiumGross + buckets.hedge.stockGross;
      for (const bucket of analysisBuckets) {
        total.commissions += buckets[bucket].commissions;
        total.flagged += buckets[bucket].flaggedChange;
      }
    }
    total.dividends += night.cash.dividends;
    total.interest += night.cash.interest;
    total.fees += night.cash.fees;
    total.otherCash += night.cash.otherCash;
    total.ibkrValuation += night.ibkrValuationDifference ?? 0;
    total.unexplained += night.unexplained ?? 0;
    total.bookPnl += night.bookPnl ?? 0;
  }
  return total;
}

export function cashTotal(components: PnlComponents): number {
  return components.dividends + components.interest + components.fees + components.otherCash;
}

/** The waterfall's steps from $0 to the P&L, components at $0 left out. */
export function waterfallSteps(components: PnlComponents): { label: string; value: number }[] {
  const steps: [string, number][] = [
    ["Put premium", components.putPremium],
    ["Call premium", components.callPremium],
    ["Stock", components.stock],
    ["LEAPS", components.leaps],
    ["Hedge", components.hedge],
    ["Commissions", components.commissions],
    ["Interest", components.interest],
    ["Dividends", components.dividends],
    ["Fees & taxes", components.fees],
    ["Other cash", components.otherCash],
    ["Incomplete data", components.flagged],
    ["IBKR valuation", components.ibkrValuation],
    ["Unexplained", components.unexplained],
  ];
  return steps.filter(([, value]) => Math.round(value) !== 0).map(([label, value]) => ({ label, value }));
}

export interface StrategyRow {
  bucket: CycleBucketKey;
  /** Set only when split by book. */
  book: BookKey | null;
  putPremium: number | null;
  callPremium: number | null;
  stock: number | null;
  leaps: number | null;
  hedge: number | null;
  commissions: number;
  total: number;
  realized: number;
  unrealized: number;
  capitalDays: number;
}

/** The strategy × component rows from the range's ticker rows, optionally one row per book (they add up to the book's strategies). */
export function strategyRows(bookAnalysis: BookAnalysis, splitByBook: boolean): StrategyRow[] {
  const rows: StrategyRow[] = [];
  for (const bucket of analysisBuckets) {
    for (const book of splitByBook ? (["pluto", "manual"] as const) : [null]) {
      const tickers = bookAnalysis.tickers.filter((ticker) => ticker.bucket === bucket && (book === null || ticker.book === book));
      if (tickers.length === 0) continue;
      const sum = (pick: (ticker: (typeof tickers)[number]) => number) => tickers.reduce((total, ticker) => total + pick(ticker), 0);
      const premiumGross = sum((ticker) => ticker.premiumGross);
      const stockGross = sum((ticker) => ticker.stockGross);
      const total = sum((ticker) => ticker.total);
      const unrealized = sum((ticker) => ticker.unrealizedChange);
      const capitalDays = sum((ticker) => ticker.capitalDays);
      if (Math.round(total) === 0 && capitalDays === 0) continue;
      rows.push({
        bucket,
        book,
        putPremium: bucket === "csp" ? premiumGross : null,
        callPremium: bucket === "cc" ? premiumGross : null,
        stock: bucket === "csp" || bucket === "cc" || bucket === "unstructured" ? stockGross : null,
        leaps: bucket === "leaps" ? premiumGross + stockGross : null,
        hedge: bucket === "hedge" ? premiumGross + stockGross : null,
        commissions: sum((ticker) => ticker.commissions),
        total,
        realized: total - unrealized,
        unrealized,
        capitalDays,
      });
    }
  }
  return rows;
}

/** Return on capital, annualised: P&L ÷ (Σ daily capital ÷ 365); null below 90 calendar days or without capital. */
export function returnOnCapitalPercent(total: number, capitalDays: number, calendarDays: number): number | null {
  if (capitalDays <= 0 || calendarDays < 90) return null;
  return (total / (capitalDays / 365)) * 100;
}

export const minimumCalendarDaysForReturnOnCapital = 90;

export interface TickerAnalysisRow {
  symbol: string;
  /** "Pluto", "Manual" or "Both" (a ticker that changed book in the range). */
  bookLabel: string;
  strategies: CycleBucketKey[];
  total: number;
  putPremium: number;
  callPremium: number;
  stock: number;
  leaps: number;
  hedge: number;
  commissions: number;
  dividends: number;
  realized: number;
  unrealized: number;
  averageCapital: number | null;
  returnOnCapital: number | null;
  capitalDays: number;
  cycleCount: number;
  hasOpenCycle: boolean;
  plutoTrades: boolean;
}

/** One row per ticker: its strategies' P&L by component, plus its dividends. */
export function tickerRows(analysis: PnlAnalysis, bookAnalysis: BookAnalysis): TickerAnalysisRow[] {
  const calendarDays = bookAnalysis.risk?.calendarDays ?? 0;
  const plutoSymbols = new Set(analysis.books.pluto.tickers.map((ticker) => ticker.symbol));
  const bySymbol = new Map<string, TickerAnalysisRow & { books: Set<BookKey>; strategyTotal: number }>();
  for (const ticker of bookAnalysis.tickers) {
    let row = bySymbol.get(ticker.symbol);
    if (!row) {
      row = {
        symbol: ticker.symbol, bookLabel: "", strategies: [], total: 0, putPremium: 0, callPremium: 0, stock: 0, leaps: 0, hedge: 0, commissions: 0, dividends: 0,
        realized: 0, unrealized: 0, averageCapital: null, returnOnCapital: null, capitalDays: 0, cycleCount: analysis.cyclesBySymbol[ticker.symbol]?.inRange ?? 0,
        hasOpenCycle: analysis.cyclesBySymbol[ticker.symbol]?.hasOpenCycle ?? false, plutoTrades: plutoSymbols.has(ticker.symbol), books: new Set(), strategyTotal: 0,
      };
      bySymbol.set(ticker.symbol, row);
    }
    row.books.add(ticker.book);
    if ((Math.round(ticker.total) !== 0 || ticker.capitalDays > 0) && !row.strategies.includes(ticker.bucket)) row.strategies.push(ticker.bucket);
    if (ticker.bucket === "csp") row.putPremium += ticker.premiumGross;
    if (ticker.bucket === "cc") row.callPremium += ticker.premiumGross;
    if (ticker.bucket === "leaps") row.leaps += ticker.premiumGross + ticker.stockGross;
    else if (ticker.bucket === "hedge") row.hedge += ticker.premiumGross + ticker.stockGross;
    else row.stock += ticker.stockGross;
    row.commissions += ticker.commissions;
    row.strategyTotal += ticker.total;
    row.unrealized += ticker.unrealizedChange;
    row.capitalDays += ticker.capitalDays;
  }
  for (const cash of bookAnalysis.tickerCash) {
    const row = bySymbol.get(cash.symbol);
    if (row && cash.component === "dividends") row.dividends += cash.amount;
  }
  return [...bySymbol.values()].map(({ books, strategyTotal, ...row }) => {
    const total = strategyTotal + row.dividends;
    return {
      ...row,
      strategies: analysisBuckets.filter((bucket) => row.strategies.includes(bucket)),
      bookLabel: books.size > 1 ? "Both" : bookChoiceLabels[[...books][0]!],
      total,
      realized: total - row.unrealized,
      averageCapital: calendarDays > 0 && row.capitalDays > 0 ? row.capitalDays / calendarDays : null,
      returnOnCapital: returnOnCapitalPercent(strategyTotal, row.capitalDays, calendarDays),
    };
  });
}

export type OverTimeGroup = "strategy" | "component";
export type OverTimeGranularity = "day" | "week" | "month";

export interface OverTimeSeries {
  key: string;
  label: string;
  colorVariable: string;
}

export interface OverTimePeriod {
  /** Night (day), the Monday (week) or YYYY-MM (month). */
  key: string;
  values: Record<string, number>;
  bookPnl: number;
}

function overTimeDefinitions(group: OverTimeGroup): (OverTimeSeries & { value: (night: NightFigures) => number })[] {
  const cash = (night: NightFigures) => night.cash.dividends + night.cash.interest + night.cash.fees + night.cash.otherCash;
  const unexplained = (night: NightFigures) => night.unexplained ?? 0;
  // IBKR's own valuation of the account against the books' prices: All books only (zero, so left out, for Pluto and Manual).
  const ibkrValuation = { key: "ibkrValuation", label: "IBKR valuation", colorVariable: "--iorio-pnl-ibkr-valuation", value: (night: NightFigures) => night.ibkrValuationDifference ?? 0 };
  if (group === "strategy") {
    return [
      ...analysisBuckets.map((bucket) => ({
        key: bucket,
        label: strategyAbbrev(strategyKeyOfCycleBucket(bucket)),
        colorVariable: strategyColorVariable(strategyKeyOfCycleBucket(bucket)),
        value: (night: NightFigures) => (night.buckets ? night.buckets[bucket].total + night.buckets[bucket].flaggedChange : 0),
      })),
      { key: "cash", label: "Cash & other", colorVariable: "--iorio-pnl-cash", value: cash },
      ibkrValuation,
      { key: "unexplained", label: "Unexplained", colorVariable: "--iorio-pnl-unexplained", value: unexplained },
    ];
  }
  const component = (key: keyof PnlComponents) => (night: NightFigures) => sumComponents([night])[key];
  return [
    { key: "putPremium", label: "Put premium", colorVariable: strategyColorVariable("cash_secured_put"), value: component("putPremium") },
    { key: "callPremium", label: "Call premium", colorVariable: strategyColorVariable("covered_call"), value: component("callPremium") },
    { key: "stock", label: "Stock", colorVariable: "--iorio-pnl-stock", value: component("stock") },
    { key: "leaps", label: "LEAPS", colorVariable: strategyColorVariable("leaps"), value: component("leaps") },
    { key: "hedge", label: "Hedge", colorVariable: strategyColorVariable("hedge"), value: component("hedge") },
    { key: "commissions", label: "Commissions", colorVariable: "--iorio-pnl-commissions", value: component("commissions") },
    { key: "cash", label: "Cash & other", colorVariable: "--iorio-pnl-cash", value: (night) => cash(night) + component("flagged")(night) },
    ibkrValuation,
    { key: "unexplained", label: "Unexplained", colorVariable: "--iorio-pnl-unexplained", value: unexplained },
  ];
}

export function overTimePeriodKey(night: string, granularity: OverTimeGranularity): string {
  if (granularity === "day") return night;
  if (granularity === "month") return night.slice(0, 7);
  const date = new Date(`${night}T12:00:00Z`);
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** The range's P&L per day, week or month by strategy or component; a series at $0 throughout is left out. Each period's values add up to its bookPnl. */
export function overTimeSeries(nights: readonly NightFigures[], group: OverTimeGroup, granularity: OverTimeGranularity): { series: OverTimeSeries[]; periods: OverTimePeriod[] } {
  const definitions = overTimeDefinitions(group);
  const periods: OverTimePeriod[] = [];
  const byKey = new Map<string, OverTimePeriod>();
  for (const night of nights) {
    const key = overTimePeriodKey(night.night, granularity);
    let period = byKey.get(key);
    if (!period) {
      period = { key, values: Object.fromEntries(definitions.map((definition) => [definition.key, 0])), bookPnl: 0 };
      byKey.set(key, period);
      periods.push(period);
    }
    for (const definition of definitions) period.values[definition.key]! += definition.value(night);
    period.bookPnl += night.bookPnl ?? 0;
  }
  const used = definitions.filter((definition) => periods.some((period) => Math.round(period.values[definition.key]!) !== 0));
  return { series: used.map(({ key, label, colorVariable }) => ({ key, label, colorVariable })), periods };
}

export interface PeriodPnlRow {
  key: CycleBucketKey | "cash" | "ibkrValuation" | "unexplained";
  values: [number, number, number, number];
}

/**
 * The Dashboard's P&L by Period (Day, WTD, MTD, YTD) from the nights since inception, by strategy, then Cash & other, IBKR's
 * own valuation of the account (All books only: zero for Pluto and Manual, so the row is left out) and Unexplained.
 */
export function periodPnlRows(nights: readonly NightFigures[], lastNight: string): { rows: PeriodPnlRow[]; totals: [number, number, number, number] } {
  const lastDate = new Date(`${lastNight}T12:00:00Z`);
  const monday = new Date(lastDate.getTime() - ((lastDate.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  const windows = [
    nights.filter((night) => night.night === lastNight),
    nights.filter((night) => night.night >= monday),
    nights.filter((night) => night.night >= `${lastNight.slice(0, 7)}-01`),
    nights.filter((night) => night.night >= `${lastNight.slice(0, 4)}-01-01`),
  ];
  const four = (pick: (windowNights: readonly NightFigures[]) => number) => windows.map(pick) as [number, number, number, number];
  const rows: PeriodPnlRow[] = [];
  for (const bucket of ["cc", "csp", "unstructured", "leaps", "hedge"] as const) {
    const values = four((windowNights) => windowNights.reduce((sum, night) => sum + (night.buckets ? night.buckets[bucket].total + night.buckets[bucket].flaggedChange : 0), 0));
    if (values.some((value) => Math.round(value) !== 0)) rows.push({ key: bucket, values });
  }
  const components = windows.map(sumComponents);
  rows.push({ key: "cash", values: components.map(cashTotal) as [number, number, number, number] });
  const ibkrValuation = components.map((component) => component.ibkrValuation) as [number, number, number, number];
  if (ibkrValuation.some((value) => Math.round(value) !== 0)) rows.push({ key: "ibkrValuation", values: ibkrValuation });
  rows.push({ key: "unexplained", values: components.map((component) => component.unexplained) as [number, number, number, number] });
  return { rows, totals: components.map((component) => component.bookPnl) as [number, number, number, number] };
}

/**
 * A book's growth of $100 over every night of its range, starting at its baseline: a night without a return (the book held no
 * money yet) keeps the previous value, so a book funded later is flat until then rather than a straight line to its first return.
 */
export function bookLinePoints(bookAnalysis: BookAnalysis): { night: string; value: number }[] {
  const risk = bookAnalysis.risk;
  if (!risk) return [];
  const byNight = new Map(risk.series.map((point) => [point.night, point.growthIndex * 100]));
  let value = 100;
  const points = [{ night: risk.baselineNight, value }];
  for (const night of bookAnalysis.nights) {
    value = byNight.get(night.night) ?? value;
    points.push({ night: night.night, value });
  }
  return points;
}

/** What a held-back figure says instead of a value: "31 of 60 returns", "8 of 180 days", "7 of 10 closed", or, with enough
 *  history but a ratio over zero, why it has none ("no losing trades"). */
export function gatedNote(figure: GatedFigure | GatedTradeFigure | null | undefined, noDenominatorNote = "not defined"): string | null {
  if (!figure) return "no history";
  if (figure.value !== null) return null;
  if (figure.have >= figure.need) return noDenominatorNote;
  const unit = "unit" in figure ? (figure.unit === "daily returns" ? "returns" : "days") : "closed";
  return `${figure.have} of ${figure.need} ${unit}`;
}

/** A chart's y-axis bounds on a round step (0.5, 1, 5 or 10) around the values, so each value's place on the plot is known
 *  before the chart draws: [89.7, 109.6] → { min: 85, max: 110, step: 5 }. */
export function roundAxisBounds(values: readonly number[]): { min: number; max: number; step: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low;
  const step = range > 20 ? 10 : range > 8 ? 5 : range > 3 ? 1 : 0.5;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  return { min, max: max > min ? max : min + step, step };
}

/** Labels at the given heights (pixels from the top) moved down just enough to sit at least `gap` apart, keeping their order:
 *  the offset each one moves by. [40, 120, 128] with a gap of 15 → [0, 0, 7]. */
export function separatedLabelOffsets(pixelsFromTop: readonly number[], gap: number): number[] {
  const order = pixelsFromTop.map((pixel, index) => ({ pixel, index })).sort((a, b) => a.pixel - b.pixel);
  const offsets = new Array<number>(pixelsFromTop.length).fill(0);
  let previous = -Infinity;
  for (const { pixel, index } of order) {
    const placed = Math.max(pixel, previous + gap);
    offsets[index] = placed - pixel;
    previous = placed;
  }
  return offsets;
}

// ---------- Performance breakdown (formulas approved by Marcelo 2026-11-26) ----------
// The P&L and time-weighted Return split into Stock, Call premiums, Put premiums, LEAPS and Other, from the same components
// as the Attribution tab (sumComponents). Stock includes dividends; Other is the rest of the night's P&L (hedges,
// commissions, interest, fees, other cash, incomplete data, IBKR valuation, unexplained), so the five always add up. A night
// whose attribution was not computed puts its whole P&L into Other.
//   A night's component %: its dollars ÷ the night's return base (the previous night's value). Example: Stock −$9,732 on a
//   base of $780,000 → −1.25%.
//   A period's component points: Σ over its nights of the night's component % × the growth before that night, which adds up
//   to the chained Return exactly. Example: +1.00% then −0.50% of which Stock −0.40% → Stock −0.40 × 1.01 = −0.404 pp,
//   Return (1.01 × 0.995 − 1) = +0.495%.

/** How the performance grids show a figure: % of the return or dollars. */
export type PerformanceUnit = "percent" | "dollars";
export const performanceUnits: readonly PerformanceUnit[] = ["percent", "dollars"];

export type PerformanceComponentKey = "stock" | "calls" | "puts" | "leaps" | "other";

export const performanceComponents: { key: PerformanceComponentKey; label: string; colorVariable: string; hint: string }[] = [
  { key: "stock", label: "Stock", colorVariable: "--iorio-pnl-stock", hint: "Share price moves on shares held, assignment charges and dividends" },
  { key: "calls", label: "Call premiums", colorVariable: strategyColorVariable("covered_call"), hint: "Calls sold: premium kept, buybacks and open calls at their mark, before commissions" },
  { key: "puts", label: "Put premiums", colorVariable: strategyColorVariable("cash_secured_put"), hint: "Puts sold: premium kept, buybacks and open puts at their mark, before commissions" },
  { key: "leaps", label: "LEAPS", colorVariable: strategyColorVariable("leaps"), hint: "Long-dated calls bought: price moves and sales" },
  { key: "other", label: "Other", colorVariable: "--iorio-pnl-unexplained", hint: "Hedges, commissions, interest, fees, other cash, IBKR's valuation and the unexplained gap" },
];

export type PerformanceComponentValues = Record<PerformanceComponentKey, number>;

/** A night's P&L by component (adds up to bookPnl); null when the night has no P&L. */
export function nightPerformanceComponents(night: NightFigures): PerformanceComponentValues | null {
  if (night.bookPnl === null) return null;
  if (night.buckets === null) return { stock: 0, calls: 0, puts: 0, leaps: 0, other: night.bookPnl };
  const components = sumComponents([night]);
  const stock = components.stock + components.dividends;
  return { stock, calls: components.callPremium, puts: components.putPremium, leaps: components.leaps, other: night.bookPnl - stock - components.callPremium - components.putPremium - components.leaps };
}

export interface PerformanceDay {
  night: string;
  pnl: number;
  returnPercent: number;
  dollars: PerformanceComponentValues;
  percents: PerformanceComponentValues;
}

/** The nights that have a return, each with its components in dollars and in % of its return base. */
export function performanceDays(nights: readonly NightFigures[]): PerformanceDay[] {
  const days: PerformanceDay[] = [];
  for (const night of nights) {
    const dollars = nightPerformanceComponents(night);
    if (dollars === null || night.returnBase === null || night.returnBase <= 0) continue;
    const base = night.returnBase;
    const percents = Object.fromEntries(performanceComponents.map(({ key }) => [key, (dollars[key] / base) * 100])) as PerformanceComponentValues;
    days.push({ night: night.night, pnl: night.bookPnl!, returnPercent: (night.bookPnl! / base) * 100, dollars, percents });
  }
  return days;
}

export interface PerformanceBreakdown {
  pnl: number;
  returnPercent: number;
  dollars: PerformanceComponentValues;
  /** Percentage points of returnPercent; they add up to it. */
  points: PerformanceComponentValues;
}

/** A run of days' P&L and chained Return with both split by component; null when there are no days. */
export function performanceBreakdown(days: readonly PerformanceDay[]): PerformanceBreakdown | null {
  if (days.length === 0) return null;
  const dollars: PerformanceComponentValues = { stock: 0, calls: 0, puts: 0, leaps: 0, other: 0 };
  const points: PerformanceComponentValues = { stock: 0, calls: 0, puts: 0, leaps: 0, other: 0 };
  let growth = 1;
  let pnl = 0;
  for (const day of days) {
    for (const { key } of performanceComponents) {
      dollars[key] += day.dollars[key];
      points[key] += day.percents[key] * growth;
    }
    pnl += day.pnl;
    growth *= 1 + day.returnPercent / 100;
  }
  return { pnl, returnPercent: (growth - 1) * 100, dollars, points };
}

/** The days grouped by calendar month ("YYYY-MM") and by year ("YYYY"), each with its breakdown. */
export function performanceByMonth(days: readonly PerformanceDay[]): { months: Map<string, PerformanceBreakdown>; years: Map<string, PerformanceBreakdown> } {
  const group = (keyOf: (night: string) => string) => {
    const grouped = new Map<string, PerformanceDay[]>();
    for (const day of days) grouped.set(keyOf(day.night), [...(grouped.get(keyOf(day.night)) ?? []), day]);
    return new Map([...grouped].map(([key, groupDays]) => [key, performanceBreakdown(groupDays)!]));
  };
  return { months: group((night) => night.slice(0, 7)), years: group((night) => night.slice(0, 4)) };
}
