import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { AnalysisFileFigures } from "../../../api/backtestAnalysis";
import { analysisChartColors } from "../../../lib/analysisPresentation";
import { formatDayMonthYear, formatNumber, formatPercentage, formatVolatilityPoints } from "../../../lib/formatters";
import { useTheme } from "../../../hooks/useTheme";
import { ApexChart } from "../../charts/ApexChart";
import { AnalysisCard, AnalysisSeriesKey } from "./analysisBits";
import { medianOf, timeOfDate, yearsBefore } from "./priceDrawdownChartModel";

// Volatility, realised and implied (mockup approved 2026-10-15): the 21-day Yang-Zhang and IBKR's implied over the price
// chart's window, and implied minus what followed. It follows the "Price, holding and trades" chart's range.

interface AnalysisVolatilityCardProps {
  figures: Pick<AnalysisFileFigures, "bars" | "yangZhang21" | "volatility">;
  /** The price chart's window starts on this date. */
  fromDate: string;
}

export function AnalysisVolatilityCard({ figures, fromDate }: AnalysisVolatilityCardProps) {
  const { theme } = useTheme();
  const colors = analysisChartColors[theme];
  const lastDate = figures.bars.at(-1)?.[0] ?? null;
  const chart = useMemo(() => {
    const offset = Math.max(0, figures.bars.findIndex((bar) => bar[0] >= fromDate));
    const bars = figures.bars.slice(offset);
    const realised = bars.flatMap((bar, index) => {
      const value = figures.yangZhang21[offset + index];
      return value === null || value === undefined ? [] : [[timeOfDate(bar[0]), +(value * 100).toFixed(1)] as [number, number]];
    });
    const implied = bars.flatMap((bar) => (bar[5] === null ? [] : [[timeOfDate(bar[0]), +(bar[5] * 100).toFixed(1)] as [number, number]]));
    const options: ApexOptions = {
      chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
      colors: [colors.series1, colors.series2],
      stroke: { width: 1.75, curve: "straight" },
      legend: { show: false },
      xaxis: { type: "datetime", labels: { datetimeUTC: true }, tooltip: { enabled: false } },
      yaxis: { min: 0, labels: { formatter: (value: number) => `${Math.round(value)}%` } },
      tooltip: { shared: true, x: { format: "d MMM yyyy" }, y: { formatter: (value: number | null | undefined) => (value === undefined || value === null ? "—" : `${value.toFixed(1)}%`) } },
      dataLabels: { enabled: false },
      grid: { padding: { left: 4, right: 8 } },
    };
    return {
      options,
      series: [
        { name: "Realised, 21-day Yang-Zhang", data: realised },
        { name: "Implied (IBKR)", data: implied },
      ],
    };
  }, [figures.bars, figures.yangZhang21, fromDate, colors]);

  const lastYearFrom = lastDate ? yearsBefore(lastDate, 1) : "";
  const lastYear = figures.bars.map((bar, index) => ({ date: bar[0], implied: bar[5], realised: figures.yangZhang21[index] ?? null })).filter((row) => row.date > lastYearFrom);
  const impliedMedian = medianOf(lastYear.flatMap((row) => (row.implied === null ? [] : [row.implied])));
  const realisedMedian = medianOf(lastYear.flatMap((row) => (row.realised === null ? [] : [row.realised])));
  const premium = figures.volatility.impliedVersusRealised;
  return (
    <AnalysisCard
      title="Volatility: realised and implied"
      description="Follows the price chart's window above"
      footer={
        <>
          <p className="mb-1">
            <span className="analysis-formula">implied minus what followed = IBKR implied volatility on a day − 21-day Yang-Zhang volatility of the 21 sessions after it</span>
          </p>
          <p className="mb-0">Positive: option sellers were paid for more movement than came. The last 21 sessions have no figure yet.</p>
        </>
      }
    >
      <div className="card-body">
        <div className="analysis-vol-layout">
          <div className="analysis-vol-chart">
            <AnalysisSeriesKey items={chart.series.map((series, index) => ({ label: series.name, color: [colors.series1, colors.series2][index]! }))} />
            <ApexChart type="line" series={chart.series} options={chart.options} height={250} />
          </div>
          <dl className="analysis-stat-list">
            <div>
              <dt>Implied (IBKR, about 30 days)</dt>
              <dd>
                {formatPercentage(figures.volatility.impliedNow)} <span className="analysis-plain">on {lastDate ? formatDayMonthYear(lastDate) : "—"} · 1-year median {formatPercentage(impliedMedian)}</span>
              </dd>
            </div>
            <div>
              <dt>Realised, 21-day Yang-Zhang</dt>
              <dd>
                {formatPercentage(figures.volatility.yangZhang21Now)} <span className="analysis-plain">1-year median {formatPercentage(realisedMedian)} · 63-day {formatPercentage(figures.volatility.yangZhang63Now)}</span>
              </dd>
            </div>
            <div>
              <dt>Implied minus what followed (the next 21 sessions)</dt>
              <dd className="analysis-stat-pair">
                {(
                  [
                    ["All history", premium.all],
                    ["Last year", premium.lastYear],
                  ] as const
                ).map(([label, stats]) => (
                  <div key={label}>
                    <span className="subheader" style={{ fontSize: "0.68rem" }}>
                      {label}
                    </span>
                    <b>{formatVolatilityPoints(stats.medianPremium)}</b>
                    <span>
                      median · above on {formatPercentage(stats.shareAbove, 0)} of {formatNumber(stats.days)} days
                    </span>
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </AnalysisCard>
  );
}
