import { useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import type { AnalysisFigures, AnalysisPriceRange } from "../../../api/backtestAnalysis";
import { analysisChartColors, dateRuns, lotPriceCeiling, potOnDayFrom, rungPriceCeiling, shockFor, tooSmallDates, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage, formatVolatilityPoints } from "../../../lib/formatters";
import { useTheme } from "../../../contexts/ThemeContext";
import { ApexChart } from "../../charts/ApexChart";
import { AnalysisCard, AnalysisNote } from "./analysisBits";

// Price and Max drawdown (daily candles, the drawdown band, the fit's two price ceilings, the days the pot was too small
// and the days an order needed more than one strike), and volatility (21-day Yang-Zhang and IBKR's implied, implied minus
// what followed). Mockup approved 2026-10-15; the volatility chart follows the price chart's range.

const ranges: { key: AnalysisPriceRange; years: number | null }[] = [
  { key: "All", years: null },
  { key: "10Y", years: 10 },
  { key: "5Y", years: 5 },
  { key: "2Y", years: 2 },
  { key: "1Y", years: 1 },
];
const dayMilliseconds = 86_400_000;
const timeOf = (dateIso: string) => Date.parse(`${dateIso}T00:00:00Z`);
const yearsBefore = (dateIso: string, years: number) => `${Number(dateIso.slice(0, 4)) - years}${dateIso.slice(4)}`;
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

interface AnalysisPriceCardsProps {
  symbol: string;
  figures: AnalysisFigures;
  shown: AnalysisPanelValues;
  showingTrial: boolean;
  stale: boolean;
  /** No daily bars: why, and what can fetch them (null: nothing can). */
  missingBars: { message: string; action: React.ReactNode | null } | null;
}

export function AnalysisPriceCards({ symbol, figures, shown, showingTrial, stale, missingBars }: AnalysisPriceCardsProps) {
  const { theme } = useTheme();
  const colors = analysisChartColors[theme];
  const [range, setRange] = useState<AnalysisPriceRange>("All");
  const lastDate = figures.bars.at(-1)?.[0] ?? null;
  const historyYears = figures.bars.length > 1 ? (timeOf(lastDate!) - timeOf(figures.bars[0]![0])) / (365.25 * dayMilliseconds) : 0;
  const yearsOf = (key: AnalysisPriceRange) => ranges.find((entry) => entry.key === key)!.years;
  const rangeIndexes = useMemo(() => {
    const years = yearsOf(range);
    if (years === null || years === 10 || lastDate === null) return { from: 0 };
    const from = yearsBefore(lastDate, years);
    const index = figures.bars.findIndex((bar) => bar[0] > from);
    return { from: Math.max(0, index) };
  }, [range, lastDate, figures.bars]);
  const bars = figures.bars.slice(rangeIndexes.from);
  const drawdown = figures.maxDrawdown[range] ?? figures.maxDrawdown.All;
  const whose = showingTrial ? "your values" : `${symbol}'s settings`;

  const priceChart = useMemo(() => {
    if (bars.length === 0) return null;
    const shock = shockFor(shown, figures.shock.shock);
    const high = Math.max(...bars.map((bar) => bar[2]));
    const low = Math.min(...bars.map((bar) => bar[3]));
    const ceilingNotes: string[] = [];
    const labelStyle = { background: colors.surface, color: colors.text, fontSize: "11px", fontWeight: 600, padding: { left: 6, right: 6, top: 2, bottom: 3 } };
    const ceilingLines: NonNullable<ApexOptions["annotations"]>["yaxis"] = [];
    for (const [name, price] of [
      ["lot ceiling", lotPriceCeiling(shown)],
      ["rung ceiling", rungPriceCeiling(shown, shock)],
    ] as const) {
      if (price > high) ceilingNotes.push(`the ${name} (${formatCurrency(price)}) is above this range's prices`);
      else if (price < low) ceilingNotes.push(`the ${name} (${formatCurrency(price)}) is below this range's prices`);
      else ceilingLines.push({ y: price, borderColor: colors.text, strokeDashArray: 6, borderWidth: 1.5, label: { text: `${name} ${formatCurrency(price)}`, position: "left", textAnchor: "start", offsetX: 6, offsetY: -2, borderColor: colors.border, style: labelStyle } });
    }
    const first = bars[0]![0];
    const last = bars.at(-1)![0];
    const allDates = figures.fitDays.map(([date]) => date);
    const inRange = ([from, to]: [string, string]) => to >= first && from <= last;
    const backtest = figures.analysisBacktest && "sessionId" in figures.analysisBacktest ? figures.analysisBacktest : null;
    // Each day against the pot the analysis backtest's ladder sized from that day (none for a trial: it has no backtest).
    const potOnDay = showingTrial ? null : potOnDayFrom(backtest?.potPath);
    const smallRuns = potOnDay ? dateRuns(tooSmallDates(figures.fitDays, shown, potOnDay), allDates).filter(inRange) : [];
    const strikeDates = backtest ? [...new Set(backtest.tooLargeDays.filter(([, , givenUp]) => givenUp !== null).map(([date]) => date))] : [];
    const strikeRuns = dateRuns(strikeDates, allDates).filter(inRange);
    const daysIn = (runs: [string, string][]) => runs.reduce((count, [from, to]) => count + allDates.filter((date) => date >= from && date <= to && date >= first && date <= last).length, 0);
    const band = (color: string, opacity: number) => ([from, to]: [string, string]) => ({ x: timeOf(from) - dayMilliseconds / 2, x2: timeOf(to) + dayMilliseconds / 2, fillColor: color, opacity, borderColor: "transparent" });
    const dark = theme === "dark";
    const options: ApexOptions = {
      chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
      xaxis: { type: "datetime", labels: { datetimeUTC: true }, tooltip: { enabled: false } },
      yaxis: { labels: { formatter: (value: number) => `$${Math.round(value)}` }, tooltip: { enabled: false } },
      plotOptions: { candlestick: { colors: { upward: colors.candleUp, downward: colors.candleDown }, wick: { useFillColor: true } } },
      grid: { padding: { left: 4, right: 8 } },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const bar = bars[dataPointIndex];
          if (!bar) return "";
          return `<div style="padding:0.4rem 0.6rem;font-size:0.75rem"><b>${formatDayMonthYear(bar[0])}</b><div style="font-family:var(--tblr-font-monospace)">O ${bar[1].toFixed(2)} · H ${bar[2].toFixed(2)} · L ${bar[3].toFixed(2)} · C ${bar[4].toFixed(2)}</div></div>`;
        },
      },
      annotations: {
        xaxis: [
          ...(drawdown
            ? [{ x: timeOf(drawdown.peakDate), x2: timeOf(drawdown.troughDate), fillColor: colors.drawdown, opacity: dark ? 0.16 : 0.1, borderColor: colors.border, label: { text: `Max drawdown ${formatPercentage(-drawdown.depth)}`, orientation: "horizontal", position: "top", textAnchor: "start", offsetX: 4, offsetY: -2, borderColor: colors.border, style: labelStyle } }]
            : []),
          ...smallRuns.map(band(colors.shadeSmall, dark ? 0.35 : 0.3)),
          ...strikeRuns.map(band(colors.shadeStrike, dark ? 0.55 : 0.45)),
        ],
        yaxis: ceilingLines,
        points: drawdown
          ? [
              { x: timeOf(drawdown.peakDate), y: drawdown.peak, marker: { size: 4, fillColor: colors.surface, strokeColor: colors.text, strokeWidth: 2 } },
              { x: timeOf(drawdown.troughDate), y: drawdown.trough, marker: { size: 4, fillColor: colors.surface, strokeColor: colors.text, strokeWidth: 2 } },
            ]
          : [],
      },
      dataLabels: { enabled: false },
    };
    return { options, series: [{ name: symbol, data: bars.map((bar) => ({ x: timeOf(bar[0]), y: [bar[1], bar[2], bar[3], bar[4]] })) }], ceilingNotes, smallDays: potOnDay ? daysIn(smallRuns) : null, strikeDays: daysIn(strikeRuns), hasBacktest: backtest !== null };
  }, [bars, shown, showingTrial, figures, colors, theme, drawdown, symbol]);

  const volatilityChart = useMemo(() => {
    const offset = rangeIndexes.from;
    const realised = bars.flatMap((bar, index) => {
      const value = figures.yangZhang21[offset + index];
      return value === null || value === undefined ? [] : [[timeOf(bar[0]), +(value * 100).toFixed(1)] as [number, number]];
    });
    const implied = bars.flatMap((bar) => (bar[5] === null ? [] : [[timeOf(bar[0]), +(bar[5] * 100).toFixed(1)] as [number, number]]));
    const options: ApexOptions = {
      chart: { animations: { enabled: false }, zoom: { enabled: false }, background: "transparent", parentHeightOffset: 0 },
      colors: [colors.series1, colors.series2],
      stroke: { width: 1.75, curve: "straight" },
      legend: { position: "top", horizontalAlign: "left", markers: { size: 5 } },
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
  }, [bars, rangeIndexes.from, figures.yangZhang21, colors]);

  if (missingBars) {
    return (
      <>
        <AnalysisCard title="Price and Max drawdown" description="IBKR daily bars, split-adjusted">
          <div className="card-body">
            <AnalysisNote tone="plain" actions={missingBars.action}>
              <p>{missingBars.message}</p>
            </AnalysisNote>
          </div>
        </AnalysisCard>
      </>
    );
  }

  const lastYearFrom = lastDate ? yearsBefore(lastDate, 1) : "";
  const lastYear = figures.bars.map((bar, index) => ({ date: bar[0], implied: bar[5], realised: figures.yangZhang21[index] ?? null })).filter((row) => row.date > lastYearFrom);
  const impliedMedian = median(lastYear.flatMap((row) => (row.implied === null ? [] : [row.implied])));
  const realisedMedian = median(lastYear.flatMap((row) => (row.realised === null ? [] : [row.realised])));
  const premium = figures.volatility.impliedVersusRealised;
  const rangeButtons = (
    <div className="btn-group" role="group" aria-label="Range">
      {ranges.map((entry) => {
        const tooShort = entry.years !== null && entry.years > historyYears;
        return (
          <button
            key={entry.key}
            type="button"
            className={`btn ${range === entry.key ? "btn-primary" : "btn-outline-secondary"}`}
            aria-pressed={range === entry.key}
            disabled={tooShort}
            title={tooShort ? `${symbol} has ${historyYears.toFixed(1)} years of daily bars` : undefined}
            onClick={() => setRange(entry.key)}
          >
            {entry.key}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <AnalysisCard title="Price and Max drawdown" description="IBKR daily bars, split-adjusted. Daily candles for every range." actions={rangeButtons} stale={stale}>
        <div className="card-body">
          {priceChart && <ApexChart type="candlestick" series={priceChart.series} options={priceChart.options} height={340} />}
          {drawdown && (
            <div className="analysis-chart-caption">
              Max drawdown in this range: <b className="font-mono">{formatPercentage(-drawdown.depth)}</b>, {formatDayMonthYear(drawdown.peakDate)} ({formatCurrency(drawdown.peak)}) to {formatDayMonthYear(drawdown.troughDate)} ({formatCurrency(drawdown.trough)}). {drawdown.recoveredOn ? `Back above the peak on ${formatDayMonthYear(drawdown.recoveredOn)}.` : "Not back above the peak yet."}
              {priceChart && priceChart.ceilingNotes.length > 0 && ` Fit at ${whose}: ${priceChart.ceilingNotes.join("; ")}.`}
            </div>
          )}
          {priceChart && (
            <div className="analysis-chart-legend">
              <span className="analysis-legend-item">
                <span className="analysis-shade-swatch is-small" />
                Pot too small (a lot or a rung didn't fit that day's pot, which follows the analysis backtest's account):{" "}
                {priceChart.smallDays === null ? (showingTrial ? "save to see it with a live-like pot" : "no analysis backtest") : priceChart.smallDays > 0 ? `${formatNumber(priceChart.smallDays)} days in this range` : "none in this range"}
              </span>
              <span className="analysis-legend-item">
                <span className="analysis-shade-swatch is-strike" />
                An order needed more than one strike: {!priceChart.hasBacktest ? "no analysis backtest" : priceChart.strikeDays > 0 ? `${formatNumber(priceChart.strikeDays)} sale days in this range` : "none in this range"} (the analysis's backtest)
              </span>
              <span className="analysis-legend-item">
                <span className="analysis-dash-line" />
                Lot and rung ceilings at a {formatCurrency(shown.potDollars, 0)} pot
              </span>
            </div>
          )}
        </div>
      </AnalysisCard>
      <AnalysisCard
        title="Volatility: realised and implied"
        description="Follows the price range above"
        stale={stale}
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
            <ApexChart type="line" series={volatilityChart.series} options={volatilityChart.options} height={250} />
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
    </>
  );
}
