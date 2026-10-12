import type { ApexOptions } from "apexcharts";
import { useTheme } from "../../contexts/ThemeContext";
import type { BacktestCompareCurve, BacktestSessionDay } from "../../api/backtest";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCurrency, formatPercentage } from "../../lib/formatters";
import { backtestSeriesColorsByTheme, buyAndHoldColorByTheme, buyAndHoldDashArray, dollarAxisFor, drawdownsOf, roundToShownPercent, tradingDateToChartTime } from "../../lib/backtestPresentation";
import { ApexChart } from "../charts/ApexChart";

// The Backtesting charts. Every chart has a legend (click an entry to hide its line), dollar values on the value axis (the
// drawdown chart's axis is the fall from the peak, in %), and a shared hover tooltip with every line's value for the day.

function useChartHeight(): number {
  return useMediaQuery("(max-width: 767px)") ? 220 : 300;
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
    legend: { show: true, showForSingleSeries: true, position: "top", horizontalAlign: "left", onItemClick: { toggleDataSeries: true }, fontSize: isPhone ? "11px" : "12px", markers: { shape: "line", size: 7 } },
    tooltip: { shared: true, intersect: false, x: { format: "dd MMM yyyy" } },
    grid: { strokeDashArray: 0 },
    responsive: [{ breakpoint: 768, options: { legend: { position: "bottom", horizontalAlign: "left" } } }],
  };
}

interface SessionChartsProps {
  days: BacktestSessionDay[];
  symbol: string;
}

/** Account value with buy and hold overlaid, then the drawdown of both. */
export function BacktestSessionCharts({ days, symbol }: SessionChartsProps) {
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const height = useChartHeight();
  const sessionColor = backtestSeriesColorsByTheme[theme][0];
  const baselineColor = buyAndHoldColorByTheme[theme];
  const baselineLabel = `Buy and hold ${symbol}`;
  const times = days.map((day) => tradingDateToChartTime(day.tradingDate));
  const baselineDrawdowns = drawdownsOf(days.map((day) => day.baselineValue));
  const base = baseLineChartOptions(isPhone, days.length);
  const dollarAxis = dollarAxisFor(days.flatMap((day) => [day.accountValue, day.baselineValue]));
  const deepestDrawdown = Math.min(0, ...days.map((day) => day.drawdown), ...baselineDrawdowns);

  const accountValueOptions: ApexOptions = {
    ...base,
    colors: [sessionColor, baselineColor],
    stroke: { width: [2, 1.5], dashArray: [0, buyAndHoldDashArray], curve: "straight" },
    yaxis: { tickAmount: isPhone ? 4 : 6, labels: { formatter: dollarAxis.formatter, minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } },
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => formatCurrency(value, 0) } },
  };
  const drawdownOptions: ApexOptions = {
    ...base,
    colors: [sessionColor, baselineColor],
    stroke: { width: [1.5, 1.5], dashArray: [0, buyAndHoldDashArray], curve: "straight" },
    fill: { type: "solid", opacity: [0.25, 0] },
    yaxis: { max: 0, min: deepestDrawdown < 0 ? undefined : -0.01, tickAmount: isPhone ? 3 : 4, labels: { formatter: (value: number) => formatPercentage(roundToShownPercent(value, 0), 0), minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } },
    tooltip: { ...base.tooltip, y: { formatter: (value: number) => formatPercentage(value, 1) } },
  };

  return (
    <div className="d-flex flex-column gap-2">
      <ApexChart
        type="line"
        height={height}
        series={[
          { name: "This session", data: days.map((day, index) => [times[index]!, day.accountValue]) },
          { name: baselineLabel, data: days.map((day, index) => [times[index]!, day.baselineValue]) },
        ]}
        options={accountValueOptions}
      />
      <div>
        <div className="subheader px-1">Drawdown from the last peak</div>
        <ApexChart
          type="area"
          height={Math.round(height * 0.6)}
          series={[
            { name: "This session", data: days.map((day, index) => [times[index]!, day.drawdown]) },
            { name: baselineLabel, data: baselineDrawdowns.map((drawdown, index) => [times[index]!, drawdown]) },
          ]}
          options={drawdownOptions}
        />
      </div>
    </div>
  );
}

interface CompareChartProps {
  sessionCurves: BacktestCompareCurve[];
  baselineCurves: BacktestCompareCurve[];
}

/** Every compared session's account value (categorical colours in order) and buy and hold (grey, dashed). */
export function BacktestCompareChart({ sessionCurves, baselineCurves }: CompareChartProps) {
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const height = useChartHeight();
  const palette = backtestSeriesColorsByTheme[theme];
  const curves = [...sessionCurves, ...baselineCurves];
  const base = baseLineChartOptions(isPhone, Math.max(0, ...curves.map((curve) => curve.points.length)));
  const dollarAxis = dollarAxisFor(curves.flatMap((curve) => curve.points.map((point) => point.value)));
  const options: ApexOptions = {
    ...base,
    colors: [...sessionCurves.map((_, index) => palette[index % palette.length]), ...baselineCurves.map(() => buyAndHoldColorByTheme[theme])],
    stroke: {
      width: [...sessionCurves.map(() => 2), ...baselineCurves.map(() => 1.5)],
      dashArray: [...sessionCurves.map(() => 0), ...baselineCurves.map((_, index) => buyAndHoldDashArray + index * 3)],
      curve: "straight",
    },
    yaxis: { tickAmount: isPhone ? 4 : 6, labels: { formatter: dollarAxis.formatter, minWidth: dollarAxis.labelWidth, maxWidth: dollarAxis.labelWidth } },
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
