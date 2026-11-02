import type { AnalysisBacktestFigures, AnalysisBarRow, AnalysisFallOfAStep, AnalysisMaxDrawdown, SessionLeapsEvent } from "../../../api/backtestAnalysis";
import { maxDrawdownOfBars } from "../../../lib/analysisPresentation";
import { formatAxisDollars, formatCurrency, formatDayMonthYear, formatNumber, formatPercentage } from "../../../lib/formatters";
import { describeLeapsEvent, leapsEventGlyph } from "./priceDrawdownChartModel";

// The Analyse window's "Price, holding and trades" chart (Vol Farmer v4, mockup approved 2026-11-01): IBKR's daily bars
// drawn at each week's close, with the analysis backtest's call-aways, top-ups and trims; under them the shares' value ÷
// the pot against its band (F24), the 30-day IV with the Calls' own IV at their sale (F26), the Step (F9) and B-E lines
// when Puts happened, and the cash available; a navigator of the whole history; a hover per week.

export type HoldingChartRange = "All" | "10Y" | "5Y" | "2Y" | "1Y" | "Backtest";
export const holdingChartRanges: readonly HoldingChartRange[] = ["All", "10Y", "5Y", "2Y", "1Y", "Backtest"];
const yearsOfRange: Partial<Record<HoldingChartRange, number>> = { "10Y": 10, "5Y": 5, "2Y": 2, "1Y": 1 };

/** F9: a Step = the volatility × √(21 ÷ 252) (the API's analysisStepFalls.ts stepFactor). */
const stepFactor = Math.sqrt(21 / 252);

/** The chart's events at their week: a call-away, a top-up, a trim or a LEAPS bought, sold or expired. */
export interface HoldingEvent {
  date: string;
  kind: "calledAway" | "topUp" | "trim" | "leaps";
  glyph: string | null;
  text: string;
}

/** One point a week: the week's last bar, and the analysis backtest's last day of that week. */
export interface HoldingWeek {
  date: string;
  close: number;
  /** IBKR's IV on the week's last bar, else F9's 63-day stand-in (fromIv false); null with neither. */
  volatility: number | null;
  fromIv: boolean;
  /** Shares' value ÷ the pot at the week's last 10:00 mark; null outside the backtest. */
  sharesShare: number | null;
  /** Free cash ÷ the account just before the week's last close; null outside the backtest. */
  cashShare: number | null;
  /** The IV of the week's Calls sold, by contracts; null without one. */
  callIv: number | null;
  breakEven: number | null;
  breakEven2: number | null;
}

const mondayOf = (dateIso: string) => {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

const lotsText = (before: number | null, after: number | null) => (before === null || after === null ? "" : `${formatNumber(before)} → ${formatNumber(after)} lots`);

/** The backtest's events as the chart's marks and hover lines. */
export function holdingEventsOf(symbol: string, backtest: AnalysisBacktestFigures | null, leapsEvents: readonly SessionLeapsEvent[]): HoldingEvent[] {
  if (!backtest) return [];
  const events: HoldingEvent[] = [];
  for (const [date, before, after, price] of backtest.events.topUps) events.push({ date, kind: "topUp", glyph: null, text: `Top-up ${formatDayMonthYear(date)}: ${lotsText(before, after)} at ${formatCurrency(price)}` });
  for (const [date, before, after, price] of backtest.events.trims) events.push({ date, kind: "trim", glyph: null, text: `Trim ${formatDayMonthYear(date)}: ${lotsText(before, after)} at ${formatCurrency(price)}` });
  for (const [date, strike, contracts] of backtest.events.calledAway) events.push({ date, kind: "calledAway", glyph: null, text: `Called away ${formatDayMonthYear(date)}: ${formatNumber(contracts)} lots at ${formatCurrency(strike)}` });
  for (const event of leapsEvents) events.push({ date: event.date, kind: "leaps", glyph: leapsEventGlyph[event.kind], text: `${leapsEventGlyph[event.kind]} ${formatDayMonthYear(event.date)}, ${describeLeapsEvent(symbol, event)}` });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** The weekly points over every bar. */
export function holdingWeeksOf(input: { bars: readonly AnalysisBarRow[]; realisedStandIn: readonly (number | null)[]; backtest: AnalysisBacktestFigures | null; breakEvenLevels: readonly [string, number | null, number | null][] }): HoldingWeek[] {
  const lastBarOfWeek = new Map<string, number>();
  input.bars.forEach((bar, index) => lastBarOfWeek.set(mondayOf(bar[0]), index));
  const lastDayOfWeek = new Map<string, AnalysisBacktestFigures["days"][number]>();
  for (const day of input.backtest?.days ?? []) lastDayOfWeek.set(mondayOf(day[0]), day);
  const callIvByWeek = new Map<string, { weighted: number; contracts: number }>();
  for (const [date, , contracts, , impliedVolatility] of input.backtest?.callSales ?? []) {
    if (impliedVolatility === null) continue;
    const entry = callIvByWeek.get(mondayOf(date)) ?? { weighted: 0, contracts: 0 };
    entry.weighted += impliedVolatility * contracts;
    entry.contracts += contracts;
    callIvByWeek.set(mondayOf(date), entry);
  }
  const breakEvenByWeek = new Map<string, [number | null, number | null]>();
  for (const [date, breakEven, breakEven2] of input.breakEvenLevels) breakEvenByWeek.set(mondayOf(date), [breakEven, breakEven2]);
  return [...lastBarOfWeek.entries()].map(([week, index]) => {
    const bar = input.bars[index]!;
    const day = lastDayOfWeek.get(week) ?? null;
    const callIv = callIvByWeek.get(week);
    const implied = bar[5] !== null && bar[5] > 0 ? bar[5] : null;
    return {
      date: bar[0],
      close: bar[4],
      volatility: implied ?? input.realisedStandIn[index] ?? null,
      fromIv: implied !== null,
      sharesShare: day ? day[6] : null,
      cashShare: day ? day[5] : null,
      callIv: callIv && callIv.contracts > 0 ? callIv.weighted / callIv.contracts : null,
      breakEven: breakEvenByWeek.get(week)?.[0] ?? null,
      breakEven2: breakEvenByWeek.get(week)?.[1] ?? null,
    };
  });
}

/** The range's first date: the backtest's start, the first bar, or that many years before the last bar. */
export function holdingRangeStart(range: HoldingChartRange, bars: readonly AnalysisBarRow[], backtestStartDate: string | null): string {
  const lastDate = bars.at(-1)?.[0] ?? "";
  if (range === "Backtest" && backtestStartDate) return backtestStartDate;
  const years = yearsOfRange[range];
  if (years === undefined) return bars[0]?.[0] ?? "";
  return `${Number(lastDate.slice(0, 4)) - years}${lastDate.slice(4)}`;
}

/** "1, 2, 2.5, 5 × 10ⁿ": the step that gives about `lines` grid lines over the span. */
export function niceStep(span: number, lines: number): number {
  const rough = span / lines;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
}

export interface HoldingPane {
  key: "shares" | "iv" | "step" | "cash";
  label: string;
  top: number;
  height: number;
}

export interface HoldingGridLine {
  y: number;
  label: string;
}

export interface HoldingChart {
  width: number;
  height: number;
  left: number;
  right: number;
  priceTop: number;
  priceBottom: number;
  panes: HoldingPane[];
  priceGrid: HoldingGridLine[];
  priceLine: string;
  breakEvenLines: string[];
  breakEven2Lines: string[];
  maxDrawdown: AnalysisMaxDrawdown | null;
  drawdownBand: { x: number; width: number; label: string } | null;
  fallShades: { x: number; width: number }[];
  calledAway: { cx: number; cy: number }[];
  topUps: string[];
  trims: string[];
  leaps: { x: number; y: number; glyph: string }[];
  shares: { band: { top: number; height: number }; targetY: number; targetLabel: string; grid: HoldingGridLine[]; lines: string[] } | null;
  iv: { grid: HoldingGridLine[]; implied: string[]; realised: string[]; dots: { cx: number; cy: number }[] };
  step: { grid: HoldingGridLine[]; implied: string[]; realised: string[] } | null;
  cash: { top: number; bottom: number; area: string } | null;
  ticks: { x: number; label: string }[];
  ticksY: number;
  navigator: { top: number; height: number; line: string; windowX: number; windowWidth: number };
  targets: { x: number; width: number }[];
  xOf: (index: number) => number;
  priceYOf: (value: number) => number;
  weeks: HoldingWeek[];
  eventsByWeek: Map<number, HoldingEvent[]>;
  counts: { calledAway: number; topUps: number; trims: number; leaps: number };
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Splits a series into polylines where it has no value (or `keep` says no). */
function segmentsOf(weeks: readonly HoldingWeek[], valueOf: (week: HoldingWeek) => number | null, xOf: (index: number) => number, yOf: (value: number) => number, keep: (week: HoldingWeek) => boolean = () => true, stepped = false): string[] {
  const segments: string[] = [];
  let points: string[] = [];
  let previousY: string | null = null;
  weeks.forEach((week, index) => {
    const value = valueOf(week);
    if (value === null || !keep(week)) {
      if (points.length > 1) segments.push(points.join(" "));
      points = [];
      previousY = null;
      return;
    }
    const x = xOf(index).toFixed(1);
    const y = yOf(value).toFixed(1);
    if (stepped && previousY !== null) points.push(`${x},${previousY}`);
    points.push(`${x},${y}`);
    previousY = y;
  });
  if (points.length > 1) segments.push(points.join(" "));
  return segments;
}

/** Log-scale grid values: 1, 2 and 5 × 10ⁿ inside the range (fewer when they would crowd). */
function logGridValues(low: number, high: number): number[] {
  const values: number[] = [];
  for (let exponent = Math.floor(Math.log10(low)); exponent <= Math.ceil(Math.log10(high)); exponent += 1) for (const multiple of [1, 2, 5]) values.push(multiple * 10 ** exponent);
  const inside = values.filter((value) => value >= low && value <= high);
  return inside.length > 8 ? inside.filter((value) => String(value).startsWith("1")) : inside;
}

export interface BuildHoldingChartInput {
  allWeeks: readonly HoldingWeek[];
  bars: readonly AnalysisBarRow[];
  events: readonly HoldingEvent[];
  falls: readonly AnalysisFallOfAStep[];
  range: HoldingChartRange;
  rangeStart: string;
  logScale: boolean;
  /** The analysis backtest ran: the shares and cash panes show. */
  hasBacktest: boolean;
  /** Puts happened in the backtest: the Step pane and the B-E lines show. */
  putsHappened: boolean;
  /** F24's target and band, as fractions of the pot (0.8 and 0.05). */
  targetShare: number;
  bandShare: number;
}

export function buildHoldingChart(input: BuildHoldingChartInput): HoldingChart | null {
  const startIndex = Math.max(0, input.allWeeks.findIndex((week) => week.date >= input.rangeStart));
  const weeks = input.allWeeks.slice(startIndex);
  if (weeks.length < 2) return null;
  const width = 1300;
  const left = 56;
  const plotWidth = 1228;
  const right = left + plotWidth;
  const count = weeks.length;
  const xOf = (index: number) => left + (index / (count - 1)) * plotWidth;

  // The price pane, linear or log, padded 6% of its range.
  const priceTop = 16;
  const priceBottom = 296;
  const closes = weeks.flatMap((week) => [week.close, ...(input.putsHappened ? [week.breakEven, week.breakEven2].filter((value): value is number => value !== null) : [])]);
  const lowest = Math.min(...closes);
  const highest = Math.max(...closes);
  let priceYOf: (value: number) => number;
  let priceGrid: HoldingGridLine[];
  if (input.logScale && lowest > 0) {
    const low = lowest / 1.06;
    const high = highest * 1.06;
    priceYOf = (value) => priceTop + (1 - (Math.log(value) - Math.log(low)) / (Math.log(high) - Math.log(low))) * (priceBottom - priceTop);
    priceGrid = logGridValues(low, high).map((value) => ({ y: priceYOf(value), label: formatAxisDollars(value) }));
  } else {
    const pad = (highest - lowest) * 0.06 || highest * 0.06 || 1;
    const low = Math.max(0, lowest - pad);
    const high = highest + pad;
    priceYOf = (value) => priceTop + (1 - (value - low) / (high - low)) * (priceBottom - priceTop);
    const step = niceStep(high - low, 5);
    priceGrid = [];
    for (let value = Math.ceil(low / step) * step; value <= high; value += step) priceGrid.push({ y: priceYOf(value), label: formatAxisDollars(value) });
  }

  // The panes under the price, each 22 px under the one above it, its label 6 px above its top.
  const panes: HoldingPane[] = [];
  let bottom = priceBottom;
  const addPane = (key: HoldingPane["key"], label: string, height: number) => {
    panes.push({ key, label, top: bottom + 22, height });
    bottom += 22 + height;
  };
  if (input.hasBacktest) addPane("shares", "Shares ÷ pot", 76);
  addPane("iv", "IV", 76);
  if (input.putsHappened) addPane("step", "Step", 76);
  if (input.hasBacktest) addPane("cash", "Cash available", 60);
  const paneOf = (key: HoldingPane["key"]) => panes.find((pane) => pane.key === key) ?? null;

  // The range's Max drawdown, on the daily closes in it (the API's formula), shaded from its peak to its trough.
  const maxDrawdown = maxDrawdownOfBars(input.bars.filter((bar) => bar[0] >= input.rangeStart), input.bars as AnalysisBarRow[]);
  const weekIndexOn = (dateIso: string) => {
    const found = weeks.findIndex((week) => week.date >= dateIso);
    return found === -1 ? count - 1 : found;
  };
  const drawdownBand = maxDrawdown && maxDrawdown.depth > 0 ? { x: xOf(weekIndexOn(maxDrawdown.peakDate)), width: Math.max(2, xOf(weekIndexOn(maxDrawdown.troughDate)) - xOf(weekIndexOn(maxDrawdown.peakDate))), label: `Max drawdown ${formatPercentage(-maxDrawdown.depth)}` } : null;

  // Falls that reached 2 Steps, on the long ranges (10Y and All).
  const fallShades =
    input.range === "All" || input.range === "10Y"
      ? input.falls
          .filter((fall) => fall.steps >= 2 && (fall.backDate === null || fall.backDate >= weeks[0]!.date))
          .map((fall) => {
            const from = fall.peakDate < weeks[0]!.date ? 0 : weekIndexOn(fall.peakDate);
            const to = fall.backDate ? weekIndexOn(fall.backDate) : count - 1;
            return { x: xOf(from), width: Math.max(2, xOf(to) - xOf(from)) };
          })
      : [];

  // The events at their week's close: call-aways on the line, top-ups under it, trims over it, LEAPS badges above.
  // An event after the last bar's week (the file's last option day past the bars) goes on the last week.
  const weekIndexByMonday = new Map(weeks.map((week, index) => [mondayOf(week.date), index]));
  const lastMonday = mondayOf(weeks.at(-1)!.date);
  const eventsByWeek = new Map<number, HoldingEvent[]>();
  for (const event of input.events) {
    const monday = mondayOf(event.date);
    const index = monday > lastMonday ? count - 1 : weekIndexByMonday.get(monday);
    if (index === undefined) continue;
    eventsByWeek.set(index, [...(eventsByWeek.get(index) ?? []), event]);
  }
  const calledAway: HoldingChart["calledAway"] = [];
  const topUps: string[] = [];
  const trims: string[] = [];
  const leaps: HoldingChart["leaps"] = [];
  const placedBadges: { x: number; y: number }[] = [];
  const counts = { calledAway: 0, topUps: 0, trims: 0, leaps: 0 };
  for (const [index, events] of eventsByWeek) {
    const x = xOf(index);
    const y = priceYOf(weeks[index]!.close);
    for (const event of events) {
      if (event.kind === "calledAway") {
        calledAway.push({ cx: x, cy: y });
        counts.calledAway += 1;
      } else if (event.kind === "topUp") {
        topUps.push(`${x},${y + 5} ${x + 5},${y + 14} ${x - 5},${y + 14}`);
        counts.topUps += 1;
      } else if (event.kind === "trim") {
        trims.push(`${x - 5},${y - 14} ${x + 5},${y - 14} ${x},${y - 5}`);
        counts.trims += 1;
      } else {
        let top = y - 19;
        while (placedBadges.some((other) => Math.abs(other.x - x) < 17 && Math.abs(other.y - top) < 16)) top -= 16;
        placedBadges.push({ x, y: top });
        leaps.push({ x, y: top, glyph: event.glyph ?? "▲" });
        counts.leaps += 1;
      }
    }
  }

  // F24: shares' value ÷ the pot against its target and band, on a 0–100% scale.
  const sharesPane = paneOf("shares");
  const shares = sharesPane
    ? (() => {
        const yOf = (share: number) => sharesPane.top + (1 - Math.min(1, Math.max(0, share))) * sharesPane.height;
        return {
          band: { top: yOf(input.targetShare + input.bandShare), height: yOf(input.targetShare - input.bandShare) - yOf(input.targetShare + input.bandShare) },
          targetY: yOf(input.targetShare),
          targetLabel: `target ${formatPercentage(input.targetShare, 0)} · band ${formatNumber((input.targetShare - input.bandShare) * 100)}–${formatPercentage(input.targetShare + input.bandShare, 0)}`,
          grid: [0, 1].map((share) => ({ y: yOf(share), label: formatPercentage(share, 0) })),
          lines: segmentsOf(weeks, (week) => week.sharesShare, xOf, yOf),
        };
      })()
    : null;

  // F26: the axis reaches the 30-day IV's highest and the 95th percentile of the Calls' IV, rounded up to 50%; a dot above
  // it sits on the top edge.
  const ivPane = paneOf("iv")!;
  const lineVolatilities = weeks.flatMap((week) => (week.volatility === null ? [] : [week.volatility]));
  const dotVolatilities = weeks.flatMap((week) => (week.callIv === null ? [] : [week.callIv])).sort((a, b) => a - b);
  const dotCeiling = dotVolatilities.length > 0 ? dotVolatilities[Math.floor((dotVolatilities.length - 1) * 0.95)]! : 0;
  const ivMax = Math.max(0.5, Math.ceil((Math.max(dotCeiling, ...lineVolatilities, 0) * 100) / 50) * 0.5);
  const ivYOf = (value: number) => ivPane.top + (1 - Math.min(value, ivMax) / ivMax) * ivPane.height;
  const iv = {
    grid: [0, ivMax / 2, ivMax].map((value) => ({ y: ivYOf(value), label: formatPercentage(value, 0) })),
    implied: segmentsOf(weeks, (week) => week.volatility, xOf, ivYOf, (week) => week.fromIv),
    realised: segmentsOf(weeks, (week) => week.volatility, xOf, ivYOf, (week) => !week.fromIv),
    dots: weeks.flatMap((week, index) => (week.callIv === null ? [] : [{ cx: xOf(index), cy: ivYOf(week.callIv) }])),
  };

  // F9's Step when Puts happened: from the IV, dashed from the 63-day stand-in.
  const stepPane = paneOf("step");
  const step = stepPane
    ? (() => {
        const steps = weeks.flatMap((week) => (week.volatility === null ? [] : [week.volatility * stepFactor]));
        const stepMax = Math.max(0.1, Math.ceil((Math.max(...steps, 0) * 100) / 5) * 0.05);
        const yOf = (value: number) => stepPane.top + (1 - value / stepMax) * stepPane.height;
        const stepOf = (week: HoldingWeek) => (week.volatility === null ? null : week.volatility * stepFactor);
        return {
          grid: [0, stepMax / 2, stepMax].map((value) => ({ y: yOf(value), label: formatPercentage(value, 0) })),
          implied: segmentsOf(weeks, stepOf, xOf, yOf, (week) => week.fromIv),
          realised: segmentsOf(weeks, stepOf, xOf, yOf, (week) => !week.fromIv),
        };
      })()
    : null;

  // Cash available: free cash ÷ the account, 0–100%.
  const cashPane = paneOf("cash");
  const cash = cashPane
    ? (() => {
        const cashBottom = cashPane.top + cashPane.height;
        const yOf = (share: number) => cashPane.top + (1 - Math.min(1, Math.max(0, share))) * cashPane.height;
        const indexes = weeks.flatMap((week, index) => (week.cashShare === null ? [] : [index]));
        const area = indexes.length < 2 ? "" : [`${xOf(indexes[0]!).toFixed(1)},${cashBottom}`, ...indexes.map((index) => `${xOf(index).toFixed(1)},${yOf(weeks[index]!.cashShare!).toFixed(1)}`), `${xOf(indexes.at(-1)!).toFixed(1)},${cashBottom}`].join(" ");
        return { top: cashPane.top, bottom: cashBottom, area };
      })()
    : null;

  // Ticks: every other January over 12 years or more, each January over 3, else each quarter.
  const spanYears = Number(weeks.at(-1)!.date.slice(0, 4)) - Number(weeks[0]!.date.slice(0, 4));
  const ticks: HoldingChart["ticks"] = [];
  weeks.forEach((week, index) => {
    if (index === 0 || week.date.slice(5, 7) === weeks[index - 1]!.date.slice(5, 7)) return;
    const month = Number(week.date.slice(5, 7));
    const year = Number(week.date.slice(0, 4));
    if (spanYears >= 12 ? month === 1 && year % 2 === 0 : spanYears >= 3 ? month === 1 : [1, 4, 7, 10].includes(month)) ticks.push({ x: xOf(index), label: month === 1 ? String(year) : months[month - 1]! });
  });
  const ticksY = bottom + 20;

  // The navigator: the whole history, the range's window on it.
  const navigatorTop = bottom + 34;
  const navigatorHeight = 40;
  const allLow = Math.min(...input.allWeeks.map((week) => week.close));
  const allHigh = Math.max(...input.allWeeks.map((week) => week.close));
  const navigatorX = (index: number) => left + (index / Math.max(1, input.allWeeks.length - 1)) * plotWidth;
  const navigatorLine = input.allWeeks.map((week, index) => `${navigatorX(index).toFixed(1)},${(navigatorTop + navigatorHeight - 4 - ((week.close - allLow) / (allHigh - allLow || 1)) * (navigatorHeight - 8)).toFixed(1)}`).join(" ");

  const targets = weeks.map((_, index) => {
    const from = index === 0 ? left : (xOf(index - 1) + xOf(index)) / 2;
    const to = index === count - 1 ? right : (xOf(index) + xOf(index + 1)) / 2;
    return { x: from, width: Math.max(0.5, to - from) };
  });

  return {
    width,
    height: navigatorTop + navigatorHeight + 12,
    left,
    right,
    priceTop,
    priceBottom,
    panes,
    priceGrid,
    priceLine: weeks.map((week, index) => `${xOf(index).toFixed(1)},${priceYOf(week.close).toFixed(1)}`).join(" "),
    breakEvenLines: input.putsHappened ? segmentsOf(weeks, (week) => week.breakEven, xOf, priceYOf, () => true, true) : [],
    breakEven2Lines: input.putsHappened ? segmentsOf(weeks, (week) => week.breakEven2, xOf, priceYOf, () => true, true) : [],
    maxDrawdown,
    drawdownBand,
    fallShades,
    calledAway,
    topUps,
    trims,
    leaps,
    shares,
    iv,
    step,
    cash,
    ticks,
    ticksY,
    navigator: { top: navigatorTop, height: navigatorHeight, line: navigatorLine, windowX: navigatorX(startIndex), windowWidth: Math.max(4, navigatorX(input.allWeeks.length - 1) - navigatorX(startIndex)) },
    targets,
    xOf,
    priceYOf,
    weeks,
    eventsByWeek,
    counts,
  };
}

/** The hover's lines for a week. */
export function holdingHoverLines(chart: HoldingChart, index: number, targetShare: number): { text: string; strong: boolean }[] {
  const week = chart.weeks[index]!;
  const lines = [
    { text: formatDayMonthYear(week.date), strong: true },
    { text: `Close ${formatCurrency(week.close)}`, strong: false },
  ];
  if (week.breakEven !== null || week.breakEven2 !== null) lines.push({ text: `B-E ${formatCurrency(week.breakEven)} · B-E2 ${formatCurrency(week.breakEven2)}`, strong: false });
  if (week.sharesShare !== null) lines.push({ text: `Shares ${formatPercentage(week.sharesShare, 0)} of the pot (target ${formatPercentage(targetShare, 0)})`, strong: false });
  if (week.volatility !== null) lines.push({ text: `${week.fromIv ? "IV" : "63-day realised"} ${formatPercentage(week.volatility)}${week.callIv !== null ? ` · Calls sold at ${formatPercentage(week.callIv)}` : ""}`, strong: false });
  if (chart.step && week.volatility !== null) lines.push({ text: `Step ${formatPercentage(week.volatility * stepFactor)}`, strong: false });
  if (week.cashShare !== null) lines.push({ text: `Cash available ${formatPercentage(week.cashShare, 0)}`, strong: false });
  const events = chart.eventsByWeek.get(index) ?? [];
  for (const event of events.slice(0, 3)) lines.push({ text: event.text, strong: false });
  if (events.length > 3) lines.push({ text: `… and ${events.length - 3} more that week`, strong: false });
  return lines;
}
