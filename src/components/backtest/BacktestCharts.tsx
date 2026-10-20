import type { ApexOptions } from "apexcharts";
import { useTheme } from "../../hooks/useTheme";
import type { BacktestCompareCurve, BacktestSessionDay } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCurrency, formatPercentage, formatSignedPercentage } from "../../lib/formatters";
import {
  backtestSeriesColorsByTheme,
  buyAndHoldColorByTheme,
  buyAndHoldDashArray,
  dollarAxisFor,
  doublingLogValueAxis,
  drawdownsOf,
  formatChartDollars,
  roundToShownPercent,
  roundValueAxis,
  spyBuyAndHoldColorByTheme,
  spyBuyAndHoldDashArray,
  tradingDateToChartTime,
  type BacktestValueScale,
} from "../../lib/backtestPresentation";
import { ApexChart } from "../charts/ApexChart";

// The Backtesting charts. Every chart has a legend (click an entry to hide its line), dollar values on the value axis (the
// drawdown chart's axis is the fall from the peak, in %), and a shared hover tooltip with every line's value for the day.

/** Phone legends sit under the plot, a row per line and two for a long name: each line past the second adds that much height, so
 *  the plot keeps its size and the legend is not cut off. */
function useChartHeight(lineCount: number): number {
  const isPhone = useMediaQuery("(max-width: 767px)");
  return isPhone ? 220 + 32 * Math.max(0, lineCount - 2) : 300;
}

/** The account value axis: round linear ticks, or logarithmic with doubling ticks ($500k, $1M, $2M …) and compact labels.
 *  ApexCharts gives a logarithmic chart one y-axis per line, and its hidden copies still took their labels' width, so on Log
 *  every line gets an axis here: the first shows, the others are hidden without labels, all on the first line's scale. */
function valueAxisOptions(scale: BacktestValueScale, values: number[], isPhone: boolean, seriesNames: string[]): NonNullable<ApexOptions["yaxis"]> {
  const dollarAxis = dollarAxisFor(values);
  if (values.length === 0) return { tickAmount: isPhone ? 4 : 6, labels: { formatter: dollarAxis.formatter, minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } };
  if (scale === "log") {
    // ApexCharts places log ticks at base ^ (log of the min + k): 999,999.99 for $1M, so a label is rounded to 3 digits first.
    const logLabel = (value: number) => formatChartDollars(Number(value.toPrecision(3)));
    const logAxis = doublingLogValueAxis(Math.min(...values), Math.max(...values));
    return seriesNames.map((_, index) =>
      index === 0
        ? { ...logAxis, seriesName: seriesNames[0], labels: { formatter: logLabel, minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } }
        : { ...logAxis, seriesName: seriesNames[0], show: false, labels: { show: false } },
    );
  }
  return { ...roundValueAxis(Math.min(...values), Math.max(...values), isPhone ? 4 : 6), labels: { formatter: dollarAxis.formatter, minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } };
}

/** A session shorter than this many days gets one x tick per day (ApexCharts would otherwise label hours). */
const dailyTicksBelowPointCount = 12;

function baseLineChartOptions(isPhone: boolean, pointCount: number): ApexOptions {
  return {
    chart: { animations: { enabled: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 4 } },
    xaxis: {
      type: "datetime",
      tickAmount: pointCount < dailyTicksBelowPointCount ? Math.max(1, pointCount - 1) : undefined,
      labels: { datetimeUTC: true, datetimeFormatter: { year: "yyyy", month: "MMM yyyy", day: "dd MMM", hour: "dd MMM" } },
      tooltip: { enabled: false },
    },
    legend: { show: true, showForSingleSeries: true, position: "top", horizontalAlign: "left", onItemClick: { toggleDataSeries: true }, fontSize: isPhone ? "0.6875rem" : "0.75rem", markers: { shape: "line", size: 7, strokeWidth: 2 } },
    tooltip: { shared: true, intersect: false, x: { format: "dd MMM yyyy" } },
    grid: { strokeDashArray: 0 },
    responsive: [{ breakpoint: 768, options: { legend: { position: "bottom", horizontalAlign: "left" } } }],
  };
}

interface SessionChartsProps {
  days: BacktestSessionDay[];
  /** The account value axis; the drawdown chart stays linear. */
  scale: BacktestValueScale;
  /** The session's buy-and-hold labels: "Buy and hold · SMCI, HOOD", "Buy and hold · SPY". */
  baselineLabel: string;
  spyBaselineLabel: string;
}

type ChartPoint = [number, number | null];

interface ChartSeries {
  name: string;
  color: string;
  width: number;
  dash: number;
  values: (number | null)[];
  drawdowns: (number | null)[];
}

/** Account value with both buy-and-hold lines overlaid (comparison only), then the drawdown of each. SPY's line is left out on
 *  a session run before it was kept (every day null); a day without a SPY value is a gap. */
export function BacktestSessionCharts({ days, scale, baselineLabel, spyBaselineLabel }: SessionChartsProps) {
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const hasSpy = days.some((day) => day.spyBaselineValue !== null);
  const height = useChartHeight(hasSpy ? 3 : 2);
  const times = days.map((day) => tradingDateToChartTime(day.tradingDate));
  const pointsOf = (values: (number | null)[]): ChartPoint[] => values.map((value, index) => [times[index]!, value]);

  const spyValues = days.map((day) => day.spyBaselineValue);
  const spyKnown = spyValues.filter((value): value is number => value !== null);
  const spyKnownDrawdowns = drawdownsOf(spyKnown);
  let spyKnownIndex = 0;
  const spyDrawdowns = spyValues.map((value) => (value === null ? null : spyKnownDrawdowns[spyKnownIndex++]!));
  const baselineDrawdowns = drawdownsOf(days.map((day) => day.baselineValue));

  const series: ChartSeries[] = [
    { name: "This session", color: backtestSeriesColorsByTheme[theme][0], width: 2, dash: 0, values: days.map((day) => day.accountValue), drawdowns: days.map((day) => day.drawdown) },
    { name: baselineLabel, color: buyAndHoldColorByTheme[theme], width: 1.5, dash: 0, values: days.map((day) => day.baselineValue), drawdowns: baselineDrawdowns },
    ...(hasSpy ? [{ name: spyBaselineLabel, color: spyBuyAndHoldColorByTheme[theme], width: 1.5, dash: 0, values: spyValues, drawdowns: spyDrawdowns }] : []),
  ];
  const base = baseLineChartOptions(isPhone, days.length);
  const allValues = series.flatMap((entry) => entry.values.filter((value): value is number => value !== null));
  const dollarAxis = dollarAxisFor(allValues);
  const deepestDrawdown = Math.min(0, ...series.flatMap((entry) => entry.drawdowns.filter((value): value is number => value !== null)));
  const drawdownRange = roundValueAxis(deepestDrawdown < 0 ? deepestDrawdown : -0.01, 0, isPhone ? 3 : 4);
  const colors = series.map((entry) => entry.color);

  const accountValueOptions: ApexOptions = {
    ...base,
    colors,
    stroke: { width: series.map((entry) => entry.width), dashArray: series.map((entry) => entry.dash), curve: "straight" },
    yaxis: valueAxisOptions(scale, allValues, isPhone, series.map((entry) => entry.name)),
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => (value === null || value === undefined ? "—" : formatCurrency(value, 0)) } },
  };
  const drawdownOptions: ApexOptions = {
    ...base,
    colors,
    stroke: { width: series.map(() => 1.5), dashArray: series.map((entry) => entry.dash), curve: "straight" },
    fill: { type: "solid", opacity: series.map((_, index) => (index === 0 ? 0.25 : 0)) },
    yaxis: { ...drawdownRange, labels: { formatter: (value: number) => formatPercentage(roundToShownPercent(value, 0), 0), minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } },
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => (value === null || value === undefined ? "—" : formatPercentage(value, 1)) } },
  };

  return (
    <div className="d-flex flex-column gap-2">
      <ApexChart type="line" height={height} series={series.map((entry) => ({ name: entry.name, data: pointsOf(entry.values) }))} options={accountValueOptions} />
      <div>
        <div className="subheader px-1">Drawdown from the last peak</div>
        <ApexChart type="area" height={isPhone ? height - 70 : Math.round(height * 0.6)} series={series.map((entry) => ({ name: entry.name, data: pointsOf(entry.drawdowns) }))} options={drawdownOptions} />
      </div>
    </div>
  );
}

/** One line of a batch chart: a run or the combined portfolio, buy and hold of its tickers, SPY; dashed and dotted lines take
 *  a longer dash each (the second dashed 5, the next 8). */
export interface BacktestValueLine {
  name: string;
  color: string;
  line: "solid" | "dashed" | "dotted";
  points: { tradingDate: string; value: number }[];
}

/** A growth index's labels: 100 is the start, so 160 is +60% since the start. */
const growthIndexLabel = (index: number, decimalPlaces: number) => formatSignedPercentage(index / 100 - 1, decimalPlaces);

/**
 * A batch's lines (mockup approved 2026-10-17): in "percent", each as % since its own start (an index of 100 there), so runs of
 * different capital share one axis (D11); in "dollars", as account values (the combined portfolio, one account). Linear or Log
 * as on the session page; the buy-and-hold lines are for comparison only.
 */
export function BacktestValueLinesChart({ scale, lines, mode }: { scale: BacktestValueScale; lines: BacktestValueLine[]; mode: "percent" | "dollars" }) {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const height = useChartHeight(lines.length);
  const base = baseLineChartOptions(isPhone, Math.max(0, ...lines.map((entry) => entry.points.length)));
  const shown = lines.map((entry) => {
    const start = entry.points[0]?.value ?? 0;
    return { ...entry, values: entry.points.map((point) => (mode === "percent" ? (start > 0 ? (point.value / start) * 100 : 0) : point.value)) };
  });
  const allValues = shown.flatMap((entry) => entry.values);
  let dashedIndex = 0;
  let dottedIndex = 0;
  const dashArray = shown.map((entry) => (entry.line === "dashed" ? buyAndHoldDashArray + 3 * dashedIndex++ : entry.line === "dotted" ? spyBuyAndHoldDashArray + 2 * dottedIndex++ : 0));
  let yaxis: NonNullable<ApexOptions["yaxis"]>;
  if (mode === "dollars") yaxis = valueAxisOptions(scale, allValues, isPhone, shown.map((entry) => entry.name));
  else if (allValues.length > 0 && scale === "log") {
    const logAxis = doublingLogValueAxis(Math.min(...allValues), Math.max(...allValues));
    yaxis = shown.map((_, index) => (index === 0 ? { ...logAxis, seriesName: shown[0]!.name, labels: { formatter: (value: number) => growthIndexLabel(Number(value.toPrecision(3)), 0), minWidth: 56, maxWidth: 56 } } : { ...logAxis, seriesName: shown[0]!.name, show: false, labels: { show: false } }));
  } else {
    const range = allValues.length > 0 ? roundValueAxis(Math.min(...allValues), Math.max(...allValues), isPhone ? 4 : 6) : { tickAmount: 4 };
    yaxis = { ...range, labels: { formatter: (value: number) => growthIndexLabel(value, 0), minWidth: 56, maxWidth: 56 } };
  }
  const options: ApexOptions = {
    ...base,
    colors: shown.map((entry) => entry.color),
    stroke: { width: shown.map((entry) => (entry.line === "dashed" ? 1.5 : 2)), dashArray, curve: "straight" },
    yaxis,
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => (value === null || value === undefined ? "—" : mode === "percent" ? growthIndexLabel(value, 1) : formatCurrency(value, 0)) } },
  };
  return (
    <ApexChart
      type="line"
      height={height}
      series={shown.map((entry) => ({ name: entry.name, data: entry.points.map((point, index) => [tradingDateToChartTime(point.tradingDate), entry.values[index]!]) }))}
      options={options}
    />
  );
}

interface CompareChartProps {
  scale: BacktestValueScale;
  sessionCurves: BacktestCompareCurve[];
  baselineCurves: BacktestCompareCurve[];
  spyBaselineCurves: BacktestCompareCurve[];
}

/** Every compared session's account value (categorical colours in order), buy and hold of their symbols (white on dark) and of
 *  SPY (grey), the first of each solid and later ones (other periods or symbols) dashed and dotted: for comparison only. */
export function BacktestCompareChart({ scale, sessionCurves, baselineCurves, spyBaselineCurves }: CompareChartProps) {
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const palette = backtestSeriesColorsByTheme[theme];
  const curves = [...sessionCurves, ...baselineCurves, ...spyBaselineCurves];
  const height = useChartHeight(curves.length);
  const base = baseLineChartOptions(isPhone, Math.max(0, ...curves.map((curve) => curve.points.length)));
  const allValues = curves.flatMap((curve) => curve.points.map((point) => point.value));
  const options: ApexOptions = {
    ...base,
    colors: [...sessionCurves.map((_, index) => palette[index % palette.length]), ...baselineCurves.map(() => buyAndHoldColorByTheme[theme]), ...spyBaselineCurves.map(() => spyBuyAndHoldColorByTheme[theme])],
    stroke: {
      width: [...sessionCurves.map(() => 2), ...baselineCurves.map(() => 1.5), ...spyBaselineCurves.map(() => 2)],
      dashArray: [...sessionCurves.map(() => 0), ...baselineCurves.map((_, index) => (index === 0 ? 0 : buyAndHoldDashArray + (index - 1) * 3)), ...spyBaselineCurves.map((_, index) => (index === 0 ? 0 : spyBuyAndHoldDashArray + (index - 1) * 2))],
      curve: "straight",
    },
    yaxis: valueAxisOptions(scale, allValues, isPhone, curves.map((curve) => curve.label)),
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => formatCurrency(value, 0) } },
  };
  return (
    <ApexChart
      type="line"
      height={height}
      series={curves.map((curve) => ({ name: curve.label, data: curve.points.map((point) => [tradingDateToChartTime(point.tradingDate), point.value]) }))}
      options={options}
    />
  );
}
