import type { ApexOptions } from "apexcharts";
import { ApexChart } from "../charts/ApexChart";
import { useTheme } from "../../hooks/useTheme";
import { cssVariableColor } from "../../lib/cssColors";
import { formatCompactDollars, formatCompactDollarsTrimmed, formatSignedPnl } from "../../lib/formatters";

// The P&L as a waterfall from $0 (mockup approved 2026-11-13): each component a floating bar, green when it adds and red
// when it takes away, and the last bar the book's P&L from its nightly value. Vertical on Positions, horizontal in the
// Dashboard's narrow column.
export function PnlWaterfallChart({ steps, total, orientation, height }: { steps: { label: string; value: number }[]; total: number; orientation: "vertical" | "horizontal"; height?: number }) {
  useTheme(); // re-render on a theme change, so the colours read below follow it
  let running = 0;
  const spans = steps.map((step) => {
    const from = running;
    running += step.value;
    return { label: step.label, value: step.value, from, to: running, isTotal: false };
  });
  spans.push({ label: "P&L", value: total, from: 0, to: total, isTotal: true });
  const colorOf = (span: (typeof spans)[number]) => cssVariableColor(span.isTotal ? "--iorio-pnl-total" : span.value >= 0 ? "--iorio-pnl-adds" : "--iorio-pnl-takes-away");
  const horizontal = orientation === "horizontal";
  const options: ApexOptions = {
    chart: { animations: { enabled: false }, zoom: { enabled: false } },
    plotOptions: { bar: { horizontal, columnWidth: "60%", barHeight: "65%", borderRadius: 2, dataLabels: { position: "top" } } },
    fill: { opacity: 1 },
    dataLabels: {
      enabled: true,
      formatter: (_value, options) => (options ? formatSignedPnl(spans[options.dataPointIndex]!.value, 0) : ""),
      offsetX: horizontal ? 34 : 0,
      offsetY: horizontal ? 0 : -18,
      style: { fontSize: "0.72rem", fontWeight: 600, colors: [cssVariableColor("--tblr-body-color")] },
      background: { enabled: false },
    },
    xaxis: horizontal ? { labels: { formatter: (value: string) => formatCompactDollarsTrimmed(Number(value)) } } : { labels: { rotate: 0, trim: false, hideOverlappingLabels: false } },
    yaxis: horizontal ? {} : { labels: { formatter: (value: number) => formatCompactDollars(value) } },
    tooltip: {
      custom: ({ dataPointIndex }) => {
        const span = spans[dataPointIndex]!;
        return `<div class="px-2 py-1">${span.label}: <strong>${formatSignedPnl(span.value, 0)}</strong>${span.isTotal ? "" : `<br><span class="text-secondary">running total ${formatSignedPnl(span.to, 0)}</span>`}</div>`;
      },
    },
    legend: { show: false },
  };
  const series = [{ name: "P&L", data: spans.map((span) => ({ x: span.label, y: [Math.min(span.from, span.to), Math.max(span.from, span.to)], fillColor: colorOf(span) })) }];
  return <ApexChart type="rangeBar" height={height ?? (horizontal ? spans.length * 30 + 40 : 300)} series={series} options={options} />;
}
