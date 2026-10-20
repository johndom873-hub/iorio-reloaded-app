import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import type { ApexAxisChartSeries, ApexOptions } from "apexcharts";
import type { AnalysisBacktestFigures, AnalysisFigures, AnalysisMaxDrawdown, AnalysisPriceRange } from "../../../api/backtestAnalysis";
import { analysisChartColors, analysisLadderPutBlockText, maxDrawdownOfBars } from "../../../lib/analysisPresentation";
import { daysToExpiry, formatAxisDollars, formatCurrency, formatDayMonthYear, formatNumber, formatOptionContractLabel, formatOrderSize, formatPercentage } from "../../../lib/formatters";

// The "Price and Max drawdown" chart, shared by the Analyse window (its analysis backtest) and a session's results (that
// session): daily candles, the drawdown band, shaded runs of days, the ladder's next Put's cap and floor and the rungs
// sold, a log scale to switch on, and under the candles the share of the account in shares.
// This module: its ranges, the window a drag moves, the log scale preference and the chart's options (the components are in
// priceDrawdownChart.tsx).

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
  atLatest: boolean;
  toLatest: () => void;
  /** Spread on the element the window is dragged on. */
  dragProps: HTMLAttributes<HTMLDivElement> & { ref: RefObject<HTMLDivElement | null> };
}

/** The y-axis labels and the plot's side paddings: the width beside the candles, for the pixels a day takes. */
const plotSideWidth = 58;

/**
 * The window of bars a price chart shows (approved 2026-10-20): the range's years ending at the last bar, which a drag
 * (mouse or one finger) or the arrow keys move across the timeline by whole days; the Max drawdown band and caption follow
 * the bars on screen. A new range or new bars go back to the latest.
 */
export function usePriceWindow(allBars: AnalysisFigures["bars"], range: AnalysisPriceRange): PriceWindow {
  const years = priceRanges.find((entry) => entry.key === range)!.years;
  const last = allBars.length - 1;
  // The earliest end: the first bar a whole range after the first bar (the window then starts at the first bar).
  const earliestEnd = useMemo(() => {
    if (years === null || allBars.length === 0) return last;
    const firstFull = allBars.findIndex((bar) => bar[0] >= yearsAfter(allBars[0]![0], years));
    return firstFull === -1 ? last : firstFull;
  }, [allBars, years, last]);
  const [chosenEnd, setChosenEnd] = useState<number | null>(null);
  useEffect(() => setChosenEnd(null), [allBars, range]);
  const to = chosenEnd === null ? last : Math.min(last, Math.max(earliestEnd, chosenEnd));
  const from = last < 0 ? 0 : windowStartIndex(allBars, to, years);
  const bars = useMemo(() => allBars.slice(from, to + 1), [allBars, from, to]);
  const drawdown = useMemo(() => maxDrawdownOfBars(bars, allBars), [bars, allBars]);
  const canMove = earliestEnd < last;
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
  return { from, to, bars, drawdown, canMove, atLatest: to === last, toLatest: () => setChosenEnd(null), dragProps };
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
  /** The account in shares, each day; null: no panel. */
  accountInShares: NonNullable<AnalysisBacktestFigures["accountInShares"]> | null;
  /** Each day's 10:00 price, for the shares held in the account-in-shares tooltip (absent: the shares are not counted). */
  tenOclockPriceByDate: ReadonlyMap<string, number>;
}

export type PriceDrawdownChart = ReturnType<typeof buildPriceDrawdownChart>;

export function buildPriceDrawdownChart(input: PriceDrawdownChartInput) {
  const { symbol, bars, drawdown, theme, logScale, countedDates } = input;
  if (bars.length === 0) return null;
  const colors = analysisChartColors[theme];
  const labelStyle = { background: colors.surface, color: colors.text, fontSize: "11px", fontWeight: 600, padding: { left: 6, right: 6, top: 2, bottom: 3 } };
  const first = bars[0]![0];
  const last = bars.at(-1)![0];
  const inRange = ([from, to]: [string, string]) => to >= first && from <= last;
  const smallRuns = input.smallRuns.filter(inRange);
  const strikeRuns = input.strikeRuns.filter(inRange);
  // The ladder (approved 2026-10-20): each day's next Put's cap (dashed) and floor (solid), and a dot per rung sold.
  const levelByDate = new Map(input.ladderLevels.map((level) => [level[0], level]));
  const levels = bars.map((bar) => levelByDate.get(bar[0]) ?? null);
  const rungsByDate = new Map<string, NonNullable<AnalysisBacktestFigures["ladderRungsSold"]>>();
  for (const rung of input.ladderRungsSold) if (rung[0] >= first && rung[0] <= last) rungsByDate.set(rung[0], [...(rungsByDate.get(rung[0]) ?? []), rung]);
  const lastLevel = levels.findLast((level) => level !== null) ?? null;
  // The account in shares (approved 2026-10-20): the shares at the 10:00 marks before the day's orders ÷ the account then.
  const sharesByDate = new Map((input.accountInShares ?? []).map((row) => [row[0], row]));
  const accountInShares = bars.map((bar) => {
    const row = sharesByDate.get(bar[0]);
    return row && row[1] !== null && row[2] > 0 ? { sharesValue: row[1], accountValue: row[2], share: row[1] / row[2], price: input.tenOclockPriceByDate.get(bar[0]) ?? null } : null;
  });
  const accountInSharesText = (day: (typeof accountInShares)[number]) => {
    if (!day) return "";
    const holding = day.price !== null && day.sharesValue > 0 ? `${formatNumber(Math.round(day.sharesValue / day.price))} shares × ${formatCurrency(day.price)} = ` : "";
    return `Account in shares <b>${formatPercentage(day.share, 0)}</b>: ${holding}${formatCurrency(day.sharesValue, 0)} of a ${formatCurrency(day.accountValue, 0)} account`;
  };
  const sharesInRange = accountInShares.flatMap((day) => (day ? [day.share] : []));
  const sharesRecorded = input.accountInShares !== null && input.accountInShares.some(([, sharesValue]) => sharesValue !== null);
  // The log scale: each price plotted as log10 of itself on a plain axis, the axis labelled back in dollars (ApexCharts'
  // own logarithmic axis drops the candles and shifts the bands).
  const toAxis = (price: number) => (logScale ? Math.log10(price) : price);
  const fromAxis = (value: number) => (logScale ? 10 ** value : value);
  const daysIn = (runs: [string, string][]) => runs.reduce((count, [from, to]) => count + countedDates.filter((date) => date >= from && date <= to && date >= first && date <= last).length, 0);
  const band = (color: string, opacity: number) => ([from, to]: [string, string]) => ({ x: timeOfDate(from) - dayMilliseconds / 2, x2: timeOfDate(to) + dayMilliseconds / 2, fillColor: color, opacity, borderColor: "transparent" });
  const dark = theme === "dark";
  const options: ApexOptions = {
    chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
    colors: [colors.text, colors.ladder, colors.ladder],
    stroke: { width: [1, 2, 2], curve: ["straight", "stepline", "stepline"], dashArray: [0, 5, 0] },
    markers: { size: 0, hover: { size: 0 } },
    legend: { show: false },
    // With the account in shares below, its panel carries the dates.
    xaxis: { type: "datetime", labels: { show: !sharesRecorded, datetimeUTC: true }, axisTicks: { show: !sharesRecorded }, tooltip: { enabled: false } },
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
        const rungLines = (rungsByDate.get(bar[0]) ?? []).map(([, , fills]) => `<div>Rung sold: ${fills.map(([strike, expiry, contracts]) => `${formatOptionContractLabel({ strike, right: "P", expiry, dte: daysToExpiry(expiry, bar[0]) })}${formatOrderSize(contracts, null)}`).join(", ")}</div>`).join("");
        const sharesLine = accountInShares[dataPointIndex] ? `<div>${accountInSharesText(accountInShares[dataPointIndex])}</div>` : "";
        return `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div style="font-family:var(--tblr-font-monospace)">O ${bar[1].toFixed(2)} · H ${bar[2].toFixed(2)} · L ${bar[3].toFixed(2)} · C ${bar[4].toFixed(2)}</div>${ladderLine}${rungLines}${sharesLine}</div>`;
      },
    },
    annotations: {
      xaxis: [
        ...(drawdown
          ? [{ x: timeOfDate(drawdown.peakDate), x2: timeOfDate(drawdown.troughDate), fillColor: colors.drawdown, opacity: dark ? 0.16 : 0.1, borderColor: colors.border, label: { text: `Max drawdown ${formatPercentage(-drawdown.depth)}`, orientation: "horizontal", position: "top", textAnchor: "start", offsetX: 4, offsetY: -2, borderColor: colors.border, style: labelStyle } }]
          : []),
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
        ...[...rungsByDate.values()].flat().map(([date, strike]) => ({ x: timeOfDate(date), y: toAxis(strike), marker: { size: 5, fillColor: colors.ladder, strokeColor: colors.surface, strokeWidth: 2 } })),
      ],
    },
    dataLabels: { enabled: false },
  };
  const series: ApexAxisChartSeries = [
    { name: symbol, type: "candlestick", data: bars.map((bar) => ({ x: timeOfDate(bar[0]), y: [bar[1], bar[2], bar[3], bar[4]].map(toAxis) })) },
    { name: "Ladder cap", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: levels[index]?.[1] == null ? null : toAxis(levels[index]![1]!) })) },
    { name: "Ladder floor", type: "line", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: levels[index]?.[2] == null ? null : toAxis(levels[index]![2]!) })) },
  ];
  const highestShare = sharesInRange.length > 0 ? Math.max(...sharesInRange) : 1;
  const sharesPanel = sharesRecorded
    ? {
        options: {
          chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
          colors: [colors.accountInShares],
          stroke: { width: 1.75, curve: "straight" },
          markers: { size: 0, hover: { size: 0 } },
          legend: { show: false },
          xaxis: { type: "datetime", labels: { datetimeUTC: true }, tooltip: { enabled: false } },
          yaxis: { min: 0, max: Math.max(100, Math.ceil(highestShare * 10) * 10), tickAmount: 2, labels: { formatter: (value: number) => `${Math.round(value)}%`, ...axisLabelWidth } },
          grid: { padding: { left: 4, right: 8, top: -8 } },
          dataLabels: { enabled: false },
          tooltip: {
            shared: true,
            intersect: false,
            custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
              const bar = bars[dataPointIndex];
              const day = accountInShares[dataPointIndex];
              return bar && day ? `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div>${accountInSharesText(day)}</div></div>` : "";
            },
          },
        } satisfies ApexOptions,
        series: [{ name: "Account in shares", data: bars.map((bar, index) => ({ x: timeOfDate(bar[0]), y: accountInShares[index] ? +(accountInShares[index]!.share * 100).toFixed(1) : null })) }],
      }
    : null;
  const sharesSummary = sharesInRange.length > 0 ? { median: medianOf(sharesInRange)!, highest: highestShare } : null;
  return { options, series, smallDays: daysIn(smallRuns), strikeDays: daysIn(strikeRuns), lastLevel, sharesPanel, sharesSummary };
}
