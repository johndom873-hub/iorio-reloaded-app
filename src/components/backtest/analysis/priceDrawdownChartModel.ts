import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import type { ApexAxisChartSeries, ApexOptions } from "apexcharts";
import type { AnalysisBacktestFigures, AnalysisBarIndicators, AnalysisFigures, AnalysisMaxDrawdown, AnalysisPriceRange } from "../../../api/backtestAnalysis";
import { analysisChartColors, analysisLadderPutBlockText, maxDrawdownOfBars } from "../../../lib/analysisPresentation";
import { describeSplitRatio } from "../../../lib/backtestPresentation";
import { daysToExpiry, formatAxisDollars, formatCurrency, formatDayMonthYear, formatNumber, formatOptionContractLabel, formatOrderSize, formatPercentage } from "../../../lib/formatters";

// The "Price and Max drawdown" chart, shared by the Analyse window (its analysis backtest) and a session's results (that
// session): daily candles with their 50- and 200-day averages, the drawdown band, shaded runs of days, the ladder's next
// Put's cap and floor and the rungs sold, a log scale to switch on, and under the candles the account's cash available
// and the IV Percentile.
// This module: its ranges, the window a drag moves, the log scale preference and the chart's options (the components are in
// priceDrawdownChart.tsx).

/** A range button: one of the year ranges, or the option data's period (the Analyse window only). */
export type PriceChartRange = AnalysisPriceRange | "Options data";

/** The option data's first and last day. */
export interface OptionDataPeriod {
  from: string;
  to: string;
}

export const priceRanges: { key: AnalysisPriceRange; years: number | null }[] = [
  { key: "All", years: null },
  { key: "10Y", years: 10 },
  { key: "5Y", years: 5 },
  { key: "2Y", years: 2 },
  { key: "1Y", years: 1 },
];
const dayMilliseconds = 86_400_000;
export const timeOfDate = (dateIso: string) => Date.parse(`${dateIso}T00:00:00Z`);
export const yearsBefore = (dateIso: string, years: number) => `${Number(dateIso.slice(0, 4)) - years}${dateIso.slice(4)}`;
export const medianOf = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Years between the first and the last bar. */
export function historyYearsOf(bars: AnalysisFigures["bars"]): number {
  return bars.length > 1 ? (timeOfDate(bars.at(-1)![0]) - timeOfDate(bars[0]![0])) / (365.25 * dayMilliseconds) : 0;
}

const yearsAfter = (dateIso: string, years: number) => `${Number(dateIso.slice(0, 4)) + years}${dateIso.slice(4)}`;

/** The index of the first bar of a window ending at `end`: the bars after its date less the range's years (All: every bar). */
function windowStartIndex(bars: AnalysisFigures["bars"], end: number, years: number | null): number {
  if (years === null || bars.length === 0) return 0;
  const from = yearsBefore(bars[end]![0], years);
  return Math.max(0, bars.findIndex((bar) => bar[0] > from));
}

export interface PriceWindow {
  /** The window's first and last bar indexes (inclusive). */
  from: number;
  to: number;
  bars: AnalysisFigures["bars"];
  /** Max drawdown of the bars on screen. */
  drawdown: AnalysisMaxDrawdown | null;
  /** True when the range is shorter than the bars: the window can be dragged. */
  canMove: boolean;
  /** Moves the window to end at a bar (kept within the bars). */
  moveTo: (end: number) => void;
  /** Spread on the element the window is dragged on. */
  dragProps: HTMLAttributes<HTMLDivElement> & { ref: RefObject<HTMLDivElement | null> };
}

/** The y-axis labels and the plot's side paddings: the width beside the candles, for the pixels a day takes. */
const plotSideWidth = 58;

/**
 * The window of bars a price chart shows (approved 2026-10-20): the range's years ending at the last bar, which a drag
 * (mouse or one finger) or the arrow keys move across the timeline by whole days; the Max drawdown band and caption follow
 * the bars on screen. A new range or new bars go back to the latest. "Options data" (approved 2026-10-25) is fixed: the
 * bars from the option data's first day to its last.
 */
export function usePriceWindow(allBars: AnalysisFigures["bars"], range: PriceChartRange, optionData: OptionDataPeriod | null = null): PriceWindow {
  const years = range === "Options data" ? null : priceRanges.find((entry) => entry.key === range)!.years;
  const last = allBars.length - 1;
  const optionDataFrom = range === "Options data" ? (optionData?.from ?? null) : null;
  const optionDataTo = range === "Options data" ? (optionData?.to ?? null) : null;
  const optionDataBars = useMemo(() => {
    if (optionDataFrom === null || optionDataTo === null) return null;
    const first = allBars.findIndex((bar) => bar[0] >= optionDataFrom);
    let end = allBars.length - 1;
    while (end >= 0 && allBars[end]![0] > optionDataTo) end -= 1;
    return first === -1 || end < first ? null : { from: first, to: end };
  }, [allBars, optionDataFrom, optionDataTo]);
  // The earliest end: the first bar a whole range after the first bar (the window then starts at the first bar).
  const earliestEnd = useMemo(() => {
    if (years === null || allBars.length === 0) return last;
    const firstFull = allBars.findIndex((bar) => bar[0] >= yearsAfter(allBars[0]![0], years));
    return firstFull === -1 ? last : firstFull;
  }, [allBars, years, last]);
  const [chosenEnd, setChosenEnd] = useState<number | null>(null);
  useEffect(() => setChosenEnd(null), [allBars, range]);
  const to = optionDataBars ? optionDataBars.to : chosenEnd === null ? last : Math.min(last, Math.max(earliestEnd, chosenEnd));
  const from = optionDataBars ? optionDataBars.from : last < 0 ? 0 : windowStartIndex(allBars, to, years);
  const bars = useMemo(() => allBars.slice(from, to + 1), [allBars, from, to]);
  const drawdown = useMemo(() => maxDrawdownOfBars(bars, allBars), [bars, allBars]);
  const canMove = optionDataBars === null && earliestEnd < last;
  const moveTo = (end: number) => setChosenEnd(Math.min(last, Math.max(earliestEnd, end)));

  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startEnd: number; pixelsPerBar: number; pendingEnd: number | null; frame: number | null } | null>(null);
  useEffect(() => () => {
    if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame);
  }, []);
  const dragProps: PriceWindow["dragProps"] = {
    ref,
    tabIndex: canMove ? 0 : undefined,
    "aria-label": canMove ? "Price chart: drag, or use the left and right arrow keys, to move across the timeline" : undefined,
    className: canMove ? "price-chart-draggable" : undefined,
    onPointerDown: (event) => {
      if (!canMove || event.button !== 0) return;
      const width = ref.current?.clientWidth ?? 0;
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startEnd: to, pixelsPerBar: Math.max(1, width - plotSideWidth) / Math.max(1, to - from + 1), pendingEnd: null, frame: null };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.classList.add("is-dragging");
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      // Content follows the pointer: dragging right shows earlier days. One redraw per frame.
      current.pendingEnd = current.startEnd - Math.round((event.clientX - current.startX) / current.pixelsPerBar);
      if (current.frame === null)
        current.frame = requestAnimationFrame(() => {
          current.frame = null;
          if (current.pendingEnd !== null) moveTo(current.pendingEnd);
        });
    },
    onPointerUp: (event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.classList.remove("is-dragging");
    },
    onPointerCancel: (event) => {
      drag.current = null;
      event.currentTarget.classList.remove("is-dragging");
    },
    onKeyDown: (event) => {
      if (!canMove || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const step = Math.max(1, Math.round((to - from + 1) / 10));
      moveTo(to + (event.key === "ArrowLeft" ? -step : step));
    },
  };
  return { from, to, bars, drawdown, canMove, moveTo, dragProps };
}


const logScalePrefKey = "iorio.analysis.priceLogScale";
function readLogScale(): boolean {
  try {
    return localStorage.getItem(logScalePrefKey) === "on";
  } catch {
    return false;
  }
}

/** The log scale switch, remembered in this browser for every price chart. */
export function useLogScalePreference(): [boolean, () => void] {
  const [logScale, setLogScale] = useState(readLogScale);
  const toggle = () => {
    const next = !logScale;
    setLogScale(next);
    try {
      localStorage.setItem(logScalePrefKey, next ? "on" : "off");
    } catch {
      // Storage unavailable: the choice still applies while the page is open.
    }
  };
  return [logScale, toggle];
}


/** Both panels reserve the same y-axis label width, so their dates line up. */
const axisLabelWidth = { minWidth: 46, maxWidth: 46 };

export interface PriceDrawdownChartInput {
  symbol: string;
  /** The range's bars. */
  bars: AnalysisFigures["bars"];
  drawdown: AnalysisMaxDrawdown | null;
  theme: "light" | "dark";
  logScale: boolean;
  /** The trading days a shaded run's days are counted on. */
  countedDates: readonly string[];
  /** Runs of days the pot was too small (the Analyse window's alone). */
  smallRuns: [string, string][];
  /** Runs of days an order needed more than one strike. */
  strikeRuns: [string, string][];
  ladderLevels: NonNullable<AnalysisBacktestFigures["ladderLevels"]>;
  ladderRungsSold: NonNullable<AnalysisBacktestFigures["ladderRungsSold"]>;
  /** The symbol's splits: a dashed line on the first day after each (the bars before it are the traded prices ÷ its ratio). */
  splits: readonly { firstDayAfter: string; ratio: number }[];
  /** The account's cash available each day at its 10:00 marks: [date, free cash, cash locked in open puts, account value]; null: no panel. */
  cashAvailable: NonNullable<AnalysisBacktestFigures["cashAvailable"]> | null;
  /** IV Percentile and the 50- and 200-day averages, one per bar of `bars` (indicatorsInWindow); null: none. */
  indicators: AnalysisBarIndicators | null;
}

/** The indicators of a window's bars, cut from those of every bar (the API works them out over the whole data file). */
export function indicatorsInWindow(indicators: AnalysisBarIndicators | null | undefined, from: number, to: number): AnalysisBarIndicators | null {
  if (!indicators) return null;
  return { ivPercentile: indicators.ivPercentile.slice(from, to + 1), movingAverage50: indicators.movingAverage50.slice(from, to + 1), movingAverage200: indicators.movingAverage200.slice(from, to + 1) };
}

/** "IV Percentile 52%: IV 64.0%; 131 of the last 252 days were at or below it". */
function describeIvPercentile([share, atOrBelow, windowDays]: [number, number, number], impliedVolatility: number | null): string {
  return `IV Percentile <b>${formatPercentage(share, 0)}</b>: ${impliedVolatility === null ? "" : `IV ${formatPercentage(impliedVolatility, 1)}; `}${formatNumber(atOrBelow)} of the last ${formatNumber(windowDays)} days were at or below it`;
}

export type PriceDrawdownChart = ReturnType<typeof buildPriceDrawdownChart>;

/** Moves a point annotation's label from above its point onto it, so a rung's badge sits on its strike. */
const rungBadgeOffsetY = 4;

/** "Rung 2 of 2 (reaches 1.44 slices of the reserve; $11,305 already committed)". */
function describeRungReached([rungNumber, rungs, slices, committed]: [number, number, number, number]): string {
  return `Rung ${rungNumber} of ${rungs} (reaches ${slices.toFixed(2)} slices of the reserve${committed > 0 ? `; ${formatCurrency(committed, 0)} already committed` : ""})`;
}

export function buildPriceDrawdownChart(input: PriceDrawdownChartInput) {
  const { symbol, bars, drawdown, theme, logScale, countedDates } = input;
  if (bars.length === 0) return null;
  const colors = analysisChartColors[theme];
  const labelStyle = { background: colors.surface, color: colors.text, fontSize: "11px", fontWeight: 600, padding: { left: 6, right: 6, top: 2, bottom: 3 } };
  const first = bars[0]![0];
  const last = bars.at(-1)![0];
  const inRange = ([from, to]: [string, string]) => to >= first && from <= last;
  const smallRuns = input.smallRuns.filter(inRange);
  const splitsInRange = input.splits.filter((split) => split.firstDayAfter > first && split.firstDayAfter <= last);
  const strikeRuns = input.strikeRuns.filter(inRange);
  // The ladder (approved 2026-10-20): each day's next Put's cap (dashed) and floor (solid), and a dot per rung sold.
  const levelByDate = new Map(input.ladderLevels.map((level) => [level[0], level]));
  const levels = bars.map((bar) => levelByDate.get(bar[0]) ?? null);
  const rungsByDate = new Map<string, NonNullable<AnalysisBacktestFigures["ladderRungsSold"]>>();
  for (const rung of input.ladderRungsSold) if (rung[0] >= first && rung[0] <= last) rungsByDate.set(rung[0], [...(rungsByDate.get(rung[0]) ?? []), rung]);
  const lastLevel = levels.findLast((level) => level !== null) ?? null;
  // Cash available (approved 2026-10-21): free cash (not locked in open puts) ÷ the account value at the day's 10:00 marks.
  const cashByDate = new Map((input.cashAvailable ?? []).map((row) => [row[0], row]));
  const cashAvailable = bars.map((bar) => {
    const row = cashByDate.get(bar[0]);
    return row && row[3] > 0 ? { date: row[0], freeCash: row[1], locked: row[2], accountValue: row[3], share: row[1] / row[3] } : null;
  });
  const cashAvailableText = (day: (typeof cashAvailable)[number]) =>
    day ? `Cash available <b>${formatPercentage(day.share, 0)}</b>: ${formatCurrency(day.freeCash, 0)} of a ${formatCurrency(day.accountValue, 0)} account${day.locked > 0 ? `; ${formatCurrency(day.locked, 0)} locked in puts` : ""}` : "";
  const cashInRange = cashAvailable.flatMap((day) => (day ? [day] : []));
  const cashRecorded = input.cashAvailable !== null && input.cashAvailable.length > 0;
  // The 50- and 200-day averages on the candles and the IV Percentile panel under them (approved 2026-10-26).
  const average50 = bars.map((_, index) => input.indicators?.movingAverage50[index] ?? null);
  const average200 = bars.map((_, index) => input.indicators?.movingAverage200[index] ?? null);
  const ivPercentile = bars.map((_, index) => input.indicators?.ivPercentile[index] ?? null);
  const ivRecorded = ivPercentile.some((day) => day !== null);
  const panelBelow = cashRecorded || ivRecorded;
  // The log scale: each price plotted as log10 of itself on a plain axis, the axis labelled back in dollars (ApexCharts'
  // own logarithmic axis drops the candles and shifts the bands).
  const toAxis = (price: number) => (logScale ? Math.log10(price) : price);
  const fromAxis = (value: number) => (logScale ? 10 ** value : value);
  const daysIn = (runs: [string, string][]) => runs.reduce((count, [from, to]) => count + countedDates.filter((date) => date >= from && date <= to && date >= first && date <= last).length, 0);
  const band = (color: string, opacity: number) => ([from, to]: [string, string]) => ({ x: timeOfDate(from) - dayMilliseconds / 2, x2: timeOfDate(to) + dayMilliseconds / 2, fillColor: color, opacity, borderColor: "transparent" });
  const dark = theme === "dark";
  const options: ApexOptions = {
    chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
    colors: [colors.text, colors.ladder, colors.ladder, colors.movingAverage50, colors.movingAverage200],
    stroke: { width: [1, 2, 2, 1.5, 1.5], curve: ["straight", "stepline", "stepline", "straight", "straight"], dashArray: [0, 5, 0, 5, 0] },
    markers: { size: 0, hover: { size: 0 } },
    legend: { show: false },
    // With a panel below, the bottom one carries the dates.
    xaxis: { type: "datetime", labels: { show: !panelBelow, datetimeUTC: true }, axisTicks: { show: !panelBelow }, tooltip: { enabled: false } },
    yaxis: { labels: { formatter: (value: number) => formatAxisDollars(fromAxis(value)), ...axisLabelWidth }, tooltip: { enabled: false } },
    plotOptions: { candlestick: { colors: { upward: colors.candleUp, downward: colors.candleDown }, wick: { useFillColor: true } } },
    grid: { padding: { left: 4, right: 8 } },
    tooltip: {
      shared: true,
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const bar = bars[dataPointIndex];
        if (!bar) return "";
        const level = levels[dataPointIndex];
        const ladderLine = level
          ? `<div>Ladder cap ${level[1] === null ? "none" : formatCurrency(level[1])} · floor ${level[2] === null ? "none" : formatCurrency(level[2])}${level[3] === null ? "" : ` · no ladder Put: ${analysisLadderPutBlockText[level[3]]}`}</div>`
          : "";
        const rungLines = (rungsByDate.get(bar[0]) ?? []).map(([, , fills, reached]) => `<div>${reached ? describeRungReached(reached) : "Rung sold"}: ${fills.map(([strike, expiry, contracts]) => `${formatOptionContractLabel({ strike, right: "P", expiry, dte: daysToExpiry(expiry, bar[0]) })}${formatOrderSize(contracts, null)}`).join(", ")}</div>`).join("");
        const cashLine = cashAvailable[dataPointIndex] ? `<div>${cashAvailableText(cashAvailable[dataPointIndex])}</div>` : "";
        const averages = [average50[dataPointIndex] == null ? null : `50-day average ${formatCurrency(average50[dataPointIndex]!)}`, average200[dataPointIndex] == null ? null : `200-day average ${formatCurrency(average200[dataPointIndex]!)}`].filter((text) => text !== null);
        const averagesLine = averages.length > 0 ? `<div>${averages.join(" · ")}</div>` : "";
        return `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div style="font-family:var(--tblr-font-monospace)">O ${bar[1].toFixed(2)} · H ${bar[2].toFixed(2)} · L ${bar[3].toFixed(2)} · C ${bar[4].toFixed(2)}</div>${averagesLine}${ladderLine}${rungLines}${cashLine}</div>`;
      },
    },
    annotations: {
      xaxis: [
        ...(drawdown
          ? [{ x: timeOfDate(drawdown.peakDate), x2: timeOfDate(drawdown.troughDate), fillColor: colors.drawdown, opacity: dark ? 0.16 : 0.1, borderColor: colors.border, label: { text: `Max drawdown ${formatPercentage(-drawdown.depth)}`, orientation: "horizontal", position: "top", textAnchor: "start", offsetX: 4, offsetY: -2, borderColor: colors.border, style: labelStyle } }]
          : []),
        // A split (approved 2026-10-21): the prices before it are split-adjusted, the traded ones ÷ its ratio.
        ...splitsInRange.map((split) => ({ x: timeOfDate(split.firstDayAfter) - dayMilliseconds / 2, borderColor: colors.secondary, strokeDashArray: 4, label: { text: `${describeSplitRatio(split.ratio)} split`, orientation: "horizontal", position: "bottom", textAnchor: "start", offsetX: 4, offsetY: -4, borderColor: colors.border, style: labelStyle } })),
        ...smallRuns.map(band(colors.shadeSmall, dark ? 0.35 : 0.3)),
        ...strikeRuns.map(band(colors.shadeStrike, dark ? 0.55 : 0.45)),
      ],
      points: [
        ...(drawdown
          ? [
              { x: timeOfDate(drawdown.peakDate), y: toAxis(drawdown.peak), marker: { size: 4, fillColor: colors.surface, strokeColor: colors.text, strokeWidth: 2 } },
              { x: timeOfDate(drawdown.troughDate), y: toAxis(drawdown.trough), marker: { size: 4, fillColor: colors.surface, strokeColor: colors.text, strokeWidth: 2 } },
            ]
          : []),
        // A numbered badge per rung (approved 2026-10-20: the reserve's slice it reaches); a dot where none was recorded.
        ...[...rungsByDate.values()].flat().map(([date, strike, , reached]) =>
          reached
            ? {
                x: timeOfDate(date),
                y: toAxis(strike),
                marker: { size: 0 },
                label: { text: String(reached[0]), textAnchor: "middle", offsetY: rungBadgeOffsetY, borderColor: colors.ladder, borderWidth: 1, borderRadius: 8, style: { background: colors.rungBadge, color: "#ffffff", fontSize: "0.65rem", fontWeight: 700, padding: { left: 4, right: 4, top: 1, bottom: 2 } } },
              }
            : { x: timeOfDate(date), y: toAxis(strike), marker: { size: 5, fillColor: colors.ladder, strokeColor: colors.surface, strokeWidth: 2 } },
        ),
      ],
    },
    dataLabels: { enabled: false },
  };
  const series: ApexAxisChartSeries = [
    { name: symbol, type: "candlestick", data: bars.map((bar) => ({ x: timeOfDate(bar[0]), y: [bar[1], bar[2], bar[3], bar[4]].map(toAxis) })) },
    { name: "Ladder cap", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: levels[index]?.[1] == null ? null : toAxis(levels[index]![1]!) })) },
    { name: "Ladder floor", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: levels[index]?.[2] == null ? null : toAxis(levels[index]![2]!) })) },
    { name: "50-day average", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: average50[index] === null ? null : toAxis(average50[index]!) })) },
    { name: "200-day average", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: average200[index] === null ? null : toAxis(average200[index]!) })) },
  ];
  const highestShare = cashInRange.length > 0 ? Math.max(...cashInRange.map((day) => day.share)) : 1;
  const cashPanel = cashRecorded
    ? {
        options: {
          chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
          colors: [colors.cashAvailable],
          stroke: { width: 1.75, curve: "straight" },
          fill: { type: "solid", opacity: 0.14 },
          markers: { size: 0, hover: { size: 0 } },
          legend: { show: false },
          // With the IV Percentile under it, that panel carries the dates.
          xaxis: { type: "datetime", labels: { show: !ivRecorded, datetimeUTC: true }, axisTicks: { show: !ivRecorded }, tooltip: { enabled: false } },
          yaxis: { min: 0, max: Math.max(100, Math.ceil(highestShare * 10) * 10), tickAmount: 2, labels: { formatter: (value: number) => `${Math.round(value)}%`, ...axisLabelWidth } },
          grid: { padding: { left: 4, right: 8, top: -8 } },
          dataLabels: { enabled: false },
          tooltip: {
            shared: true,
            intersect: false,
            custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
              const bar = bars[dataPointIndex];
              const day = cashAvailable[dataPointIndex];
              return bar && day ? `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div>${cashAvailableText(day)}</div></div>` : "";
            },
          },
        } satisfies ApexOptions,
        series: [{ name: "Cash available", type: "area", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: cashAvailable[index] ? +(cashAvailable[index]!.share * 100).toFixed(1) : null })) }],
      }
    : null;
  // In the Volatility chart's implied-volatility orange.
  const ivPercentilePanel = ivRecorded
    ? {
        options: {
          chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
          colors: [colors.series2],
          stroke: { width: 1.75, curve: "straight" },
          fill: { type: "solid", opacity: 0.14 },
          markers: { size: 0, hover: { size: 0 } },
          legend: { show: false },
          xaxis: { type: "datetime", labels: { datetimeUTC: true }, tooltip: { enabled: false } },
          yaxis: { min: 0, max: 100, tickAmount: 2, labels: { formatter: (value: number) => `${Math.round(value)}%`, ...axisLabelWidth } },
          grid: { padding: { left: 4, right: 8, top: -8 } },
          dataLabels: { enabled: false },
          tooltip: {
            shared: true,
            intersect: false,
            custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
              const bar = bars[dataPointIndex];
              const day = ivPercentile[dataPointIndex];
              return bar && day ? `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div>${describeIvPercentile(day, bar[5])}</div></div>` : "";
            },
          },
        } satisfies ApexOptions,
        series: [{ name: "IV Percentile", type: "area", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: ivPercentile[index] ? +(ivPercentile[index]![0] * 100).toFixed(1) : null })) }],
      }
    : null;
  const lowestDay = cashInRange.reduce<(typeof cashInRange)[number] | null>((lowest, day) => (lowest === null || day.share < lowest.share ? day : lowest), null);
  const cashSummary = lowestDay ? { median: medianOf(cashInRange.map((day) => day.share))!, lowest: lowestDay.share, lowestDate: lowestDay.date } : null;
  return { options, series, smallDays: daysIn(smallRuns), strikeDays: daysIn(strikeRuns), lastLevel, cashPanel, cashSummary, splitsInRange, ivPercentilePanel, hasAverage50: average50.some((value) => value !== null), hasAverage200: average200.some((value) => value !== null) };
}
