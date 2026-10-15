import { useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { IconAlertCircle, IconCircleCheck, IconCircleX } from "@tabler/icons-react";
import { analysisDteRanges, type AnalysisChainView, type AnalysisFigures } from "../../../api/backtestAnalysis";
import { analysisChartColors, liquidityLevel, type AnalysisLevel, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonth, formatDayMonthYear, formatPercentage, formatYearMonth } from "../../../lib/formatters";
import { useTheme } from "../../../contexts/ThemeContext";
import { ApexChart } from "../../charts/ApexChart";
import { TooltipSpan } from "../../TooltipSpan";
import { BacktestSegmentedSwitch } from "../backtestBits";
import { AnalysisCard, AnalysisSeriesKey } from "./analysisBits";

// Option liquidity and yield by year and days to expiry, coloured by the share of days with a passing contract (no
// minimum yield: Marcelo 2026-10-15), and the monthly chart of contracts passing, Calls and Puts stacked. The Puts toggle
// (all Puts, or those under the first rung's cap) is shared by both cards.

const rangeLabels: Record<(typeof analysisDteRanges)[number], string> = { "1-7": "1–7", "8-14": "8–14", "15-30": "15–30", "31-45": "31–45" };
const levelIcons: Record<AnalysisLevel, typeof IconCircleCheck> = { good: IconCircleCheck, fair: IconAlertCircle, poor: IconCircleX };

export function AnalysisPutsSwitch({ capped, onChange }: { capped: boolean; onChange: (capped: boolean) => void }) {
  return (
    <BacktestSegmentedSwitch
      ariaLabel="Which Puts"
      options={[
        { value: "all", label: "All Puts" },
        { value: "cap", label: "Under the first rung's cap" },
      ]}
      value={capped ? "cap" : "all"}
      onChange={(value) => onChange(value === "cap")}
    />
  );
}

interface AnalysisLiquidityCardsProps {
  symbol: string;
  figures: AnalysisFigures;
  /** The values the stored figures were computed with (the filters' description). */
  computedWith: AnalysisPanelValues;
  putsCapped: boolean;
  onPutsCappedChange: (capped: boolean) => void;
  stale: boolean;
}

export function AnalysisLiquidityCards({ figures, computedWith, putsCapped, onPutsCappedChange, stale }: AnalysisLiquidityCardsProps) {
  const { theme } = useTheme();
  const colors = analysisChartColors[theme];
  const [side, setSide] = useState<"C" | "P">("P");
  const view: AnalysisChainView = side === "C" ? "C" : putsCapped ? "Pcap" : "P";
  const who = view === "C" ? "Calls" : view === "P" ? "Puts" : "Puts under the first rung's cap";
  const years = Object.keys(figures.chains.grid[view]).sort();
  const lastDay = figures.chains.lastDay;

  const yearNote = (year: string) => {
    const span = figures.chains.years[year];
    if (!span) return null;
    if (year === years[0]) return <span className="analysis-year-note">from {formatDayMonth(span.from)}</span>;
    if (year === years.at(-1)) return <span className="analysis-year-note">to {formatDayMonth(span.to)}</span>;
    return null;
  };

  const table = (kind: "liquidity" | "yield") => (
    <div className="analysis-rag-table table-responsive">
      <table className="table table-sm mb-0">
        <thead className="table-light">
          <tr>
            <th />
            <th colSpan={4} className="text-center">
              Days to expiry
            </th>
          </tr>
          <tr>
            <th>Year</th>
            {analysisDteRanges.map((range) => (
              <th key={range} className="text-end">
                {rangeLabels[range]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <th scope="row">
                {year}
                {yearNote(year)}
              </th>
              {analysisDteRanges.map((range) => {
                const cell = figures.chains.grid[view][year]?.[range];
                if (!cell) return <td key={range} className="text-end">—</td>;
                const share = cell.days === 0 ? 0 : cell.daysWithPassing / cell.days;
                const tip = `${who}, ${rangeLabels[range]} days, ${year}: ${cell.daysWithPassing} of ${cell.days} days had a passing contract (${formatPercentage(share, 0)}) · median ${cell.medianPassingPerDay} contract${cell.medianPassingPerDay === 1 ? "" : "s"} a day passing · best yield, median of each day's best: ${formatPercentage(cell.medianBestYield)} · pooled median yield: ${formatPercentage(cell.pooledMedianYield, 0)}`;
                if (kind === "yield") {
                  return (
                    <TooltipSpan key={range} as="td" className="text-end" text={tip}>
                      {cell.medianBestYield === null ? "—" : formatPercentage(cell.medianBestYield, 0)}
                    </TooltipSpan>
                  );
                }
                const level = liquidityLevel(share);
                const Icon = levelIcons[level];
                return (
                  <TooltipSpan key={range} as="td" className={`text-end analysis-cell-${level}`} text={tip}>
                    <span className="analysis-rag-cell">
                      {formatPercentage(share, 0)}
                      <Icon size={14} aria-label={level === "good" ? "80% or more" : level === "fair" ? "50% to 80%" : "under 50%"} />
                    </span>
                  </TooltipSpan>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const monthlyChart = useMemo(() => {
    const months = figures.chains.monthly;
    const options: ApexOptions = {
      chart: { stacked: true, animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
      colors: [colors.series1, colors.series2],
      plotOptions: { bar: { columnWidth: "78%", borderRadius: 0 } },
      stroke: { width: 1, colors: [colors.surface] },
      legend: { show: false },
      xaxis: { type: "datetime", labels: { datetimeUTC: true }, tooltip: { enabled: false } },
      yaxis: { labels: { formatter: (value: number) => String(Math.round(value)) }, title: { text: "a day", style: { color: colors.secondary, fontWeight: 400 } } },
      dataLabels: { enabled: false },
      tooltip: {
        shared: true,
        intersect: false,
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const month = months[dataPointIndex];
          if (!month) return "";
          const puts = putsCapped ? month.cappedPutsMedian : month.putsMedian;
          return `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatYearMonth(month.month)}</b> · ${month.days} days<div>Calls ${month.callsMedian} · ${putsCapped ? "Puts under the cap" : "Puts"} ${puts} a day (median)</div><div>Total a day, median: ${putsCapped ? month.cappedTotalMedian : month.totalMedian}</div></div>`;
        },
      },
      grid: { padding: { left: 4, right: 8 } },
    };
    const x = (month: string) => Date.parse(`${month}-15T00:00:00Z`);
    return {
      options,
      series: [
        { name: "Calls", data: months.map((month) => ({ x: x(month.month), y: month.callsMedian })) },
        { name: putsCapped ? "Puts under the first rung's cap" : "Puts", data: months.map((month) => ({ x: x(month.month), y: putsCapped ? month.cappedPutsMedian : month.putsMedian })) },
      ],
    };
  }, [figures.chains.monthly, putsCapped, colors]);

  const filters = `|delta| ${computedWith.minAbsDelta.toFixed(2)}–${computedWith.maxAbsDelta.toFixed(2)}, ${computedWith.minDte}–${computedWith.maxDte} days, spread at most ${computedWith.maxSpreadPctOfMid}% of the mid, bid at least $0.05, up to 20% of the previous session's volume, a positive premium after the $0.68 fee`;
  const actions = (
    <>
      <BacktestSegmentedSwitch
        ariaLabel="Calls or Puts"
        options={[
          { value: "P", label: "Puts" },
          { value: "C", label: "Calls" },
        ]}
        value={side}
        onChange={setSide}
      />
      {side === "P" && <AnalysisPutsSwitch capped={putsCapped} onChange={onPutsCappedChange} />}
    </>
  );

  return (
    <>
      <AnalysisCard
        title="Option liquidity and yield"
        description="Contracts passing the strategy's filters at the 10:00 quote, by year and days to expiry"
        actions={actions}
        stale={stale}
        footer={
          <>
            {view === "Pcap" && lastDay && lastDay.spot !== null && lastDay.cap !== null && (
              <p className="mb-1">
                <span className="analysis-formula">first rung's cap = 10:00 price × (1 − S ÷ {computedWith.ladderRungs})</span> each day, S = the shock for a cycle starting that day. Only passing Puts at or below it count. On {formatDayMonthYear(lastDay.date)}: {formatCurrency(lastDay.spot)} × (1 − {Math.round(lastDay.shock * 100)}% ÷ {computedWith.ladderRungs}) = {formatCurrency(lastDay.cap)}.
              </p>
            )}
            <p className="mb-0">
              Filters: {filters}. Spreads: {formatPercentage(figures.chains.spreadShareUnder25, 0)} of the contracts that passed quoted at or under 25% of the mid.
            </p>
          </>
        }
      >
        <div className="card-body">
          <div className="analysis-rag-grids">
            <div>
              <h4 className="analysis-rag-title">Days with a passing contract</h4>
              {table("liquidity")}
            </div>
            <div>
              <h4 className="analysis-rag-title">
                Best yield, % a year <span className="fw-normal text-secondary">(median of each day's best)</span>
              </h4>
              {table("yield")}
            </div>
          </div>
          <div className="analysis-legend mt-3">
            {(["good", "fair", "poor"] as const).map((level) => {
              const Icon = levelIcons[level];
              return (
                <span key={level} className="analysis-legend-item">
                  <span className={`analysis-legend-swatch analysis-cell-${level}`}>
                    <Icon size={11} aria-hidden="true" />
                  </span>
                  {level === "good" ? "80% of days or more" : level === "fair" ? "50% to 80%" : "Under 50%"}
                </span>
              );
            })}
            <span className="analysis-legend-item">Hover or tap a cell for the median contracts a day and the pooled yield.</span>
          </div>
        </div>
      </AnalysisCard>
      <AnalysisCard title="Contracts passing the strategy's filters, by month" description="Median a day at the 10:00 quote, Calls and Puts stacked" actions={<AnalysisPutsSwitch capped={putsCapped} onChange={onPutsCappedChange} />} stale={stale}>
        <div className="card-body">
          <AnalysisSeriesKey items={monthlyChart.series.map((series, index) => ({ label: series.name, color: [colors.series1, colors.series2][index]! }))} />
          <ApexChart type="bar" series={monthlyChart.series} options={monthlyChart.options} height={230} />
        </div>
      </AnalysisCard>
    </>
  );
}
