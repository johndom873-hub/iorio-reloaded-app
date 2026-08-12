import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

interface ApexChartProps {
  type: "line" | "bar" | "area" | "candlestick";
  series: ApexOptions["series"];
  options?: ApexOptions;
  height?: number;
}

// Shared wrapper around react-apexcharts so every chart in the app gets
// the same baseline styling (fonts, toolbar off, theme colors) without
// repeating config at every call site.
export function ApexChart({ type, series, options = {}, height = 300 }: ApexChartProps) {
  const mergedOptions: ApexOptions = {
    chart: {
      toolbar: { show: false },
      fontFamily: "inherit",
      ...options.chart,
    },
    ...options,
  };

  return <ReactApexChart type={type} series={series} options={mergedOptions} height={height} />;
}
