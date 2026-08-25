import ReactApexChart from "react-apexcharts";
import type { ApexOptions, ApexYAxis } from "apexcharts";
import { useTheme } from "../../contexts/ThemeContext";

interface ApexChartProps {
  type: "line" | "bar" | "area" | "candlestick" | "donut";
  series: ApexOptions["series"];
  options?: ApexOptions;
  height?: number;
}

// Same theme colors as TickerPriceChart's textColorByTheme/gridColorByTheme
// (lightweight-charts) — kept in sync so every chart in the app reads the
// same in dark mode. ApexCharts defaults to a fixed grey unaware of the
// app's dark navy background, which made axis labels/legend illegible.
const textColorByTheme = { light: "#1d273b", dark: "#f9fafb" } as const;
const gridColorByTheme = { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.12)" } as const;

// Shared wrapper around react-apexcharts so every chart in the app gets
// the same baseline styling (fonts, toolbar off, theme colors) without
// repeating config at every call site.
export function ApexChart({ type, series, options = {}, height = 300 }: ApexChartProps) {
  const { theme } = useTheme();
  const textColor = textColorByTheme[theme];
  const gridColor = gridColorByTheme[theme];

  const mergedOptions: ApexOptions = {
    ...options,
    chart: {
      toolbar: { show: false },
      fontFamily: "inherit",
      foreColor: textColor,
      ...options.chart,
    },
    grid: { ...options.grid, borderColor: gridColor },
    xaxis: {
      ...options.xaxis,
      labels: { ...options.xaxis?.labels, style: { colors: textColor, ...options.xaxis?.labels?.style } },
      axisBorder: { color: gridColor, ...options.xaxis?.axisBorder },
      axisTicks: { color: gridColor, ...options.xaxis?.axisTicks },
    },
    yaxis: Array.isArray(options.yaxis)
      ? options.yaxis
      : ({
          ...options.yaxis,
          labels: {
            ...(options.yaxis as ApexYAxis | undefined)?.labels,
            style: { colors: textColor, ...(options.yaxis as ApexYAxis | undefined)?.labels?.style },
          },
        } satisfies ApexYAxis),
    legend: { ...options.legend, labels: { colors: textColor, ...options.legend?.labels } },
    tooltip: { theme, ...options.tooltip },
  };

  return <ReactApexChart type={type} series={series} options={mergedOptions} height={height} />;
}
