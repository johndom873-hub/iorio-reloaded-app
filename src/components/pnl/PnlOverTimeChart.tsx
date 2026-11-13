import type { ApexOptions } from "apexcharts";
import { ApexChart, textColorByTheme } from "../charts/ApexChart";
import type { NightFigures } from "../../api/pnlAnalysis";
import { useTheme } from "../../hooks/useTheme";
import { cssVariableColor } from "../../lib/cssColors";
import { formatCompactDollars, formatSignedPnl } from "../../lib/formatters";
import { overTimeSeries, type OverTimeGranularity, type OverTimeGroup } from "../../lib/pnlAnalysisPresentation";

// The P&L per day, week or month, stacked by strategy or component, with the book's P&L from its nightly value as a line
// (mockup approved 2026-11-13). Each bar's segments add up to the line: Unexplained is a segment of its own.
export function PnlOverTimeChart({ nights, group, granularity, height = 300 }: { nights: readonly NightFigures[]; group: OverTimeGroup; granularity: OverTimeGranularity; height?: number }) {
  const { theme } = useTheme();
  const { series, periods } = overTimeSeries(nights, group, granularity);
  if (periods.length === 0) return <div className="text-secondary">No nights in this period.</div>;
  const timeOf = (key: string) => Date.parse(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`);
  const lineColor = textColorByTheme[theme];
  const chartSeries = [
    ...series.map((one) => ({ name: one.label, type: "bar", data: periods.map((period) => ({ x: timeOf(period.key), y: period.values[one.key]! })) })),
    { name: "Book P&L", type: "line", data: periods.map((period) => ({ x: timeOf(period.key), y: period.bookPnl })) },
  ];
  const options: ApexOptions = {
    chart: { stacked: true, stackOnlyBar: true, animations: { enabled: false }, zoom: { enabled: false } },
    colors: [...series.map((one) => cssVariableColor(one.colorVariable)), lineColor],
    plotOptions: { bar: { columnWidth: "62%" } },
    fill: { opacity: 1 },
    stroke: { width: [...series.map(() => 0), 2] },
    markers: { size: [...series.map(() => 0), 3] },
    annotations: { yaxis: [{ y: 0, borderColor: lineColor, borderWidth: 1, strokeDashArray: 0 }] },
    xaxis: { type: "datetime", labels: { datetimeUTC: true, format: granularity === "month" ? "MMM yyyy" : "d MMM" } },
    yaxis: { labels: { formatter: (value: number) => formatCompactDollars(value) } },
    tooltip: { shared: true, intersect: false, x: { format: granularity === "month" ? "MMM yyyy" : granularity === "week" ? "'Week of' d MMM yyyy" : "d MMM yyyy" }, y: { formatter: (value: number) => formatSignedPnl(value, 0) } },
    dataLabels: { enabled: false },
    legend: { position: "top", horizontalAlign: "left" },
  };
  return <ApexChart type="line" height={height} series={chartSeries as ApexOptions["series"]} options={options} />;
}
