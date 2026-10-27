import { useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { analysisLadderLevelsFormulasVersion, type AnalysisFigures, type AnalysisFileFigures } from "../../../api/backtestAnalysis";
import { analysisChartColors, dateRuns, potOnDayFrom, tooSmallDates, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatDayMonthYear, formatNumber, formatPercentage, formatVolatilityPoints } from "../../../lib/formatters";
import { useTheme } from "../../../hooks/useTheme";
import { ApexChart } from "../../charts/ApexChart";
import { AnalysisCard, AnalysisNote, AnalysisSeriesKey } from "./analysisBits";
import { IvPercentileLegendItem, LadderLegendItems, PriceChartActions, PriceDrawdownCaption, PriceDrawdownCharts, PriceWindowNavigator, SplitLegendItem } from "./priceDrawdownChart";
import { buildPriceDrawdownChart, historyYearsOf, indicatorsInWindow, medianOf, timeOfDate, useLogScalePreference, usePriceWindow, yearsBefore, type PriceChartRange } from "./priceDrawdownChartModel";

// Price and Max drawdown (daily candles, the drawdown band, the days the pot was too
// small and the days an order needed more than one strike, and the analysis backtest's ladder: its next Put's cap, its
// floor and the rungs sold; a log scale to switch on; under the candles, the backtest account's cash available and the IV
// Percentile, and under them a navigator for the window), and volatility (21-day Yang-Zhang and IBKR's implied, implied
// minus what followed). Mockups approved 2026-10-15, 2026-10-20 (the ladder, the log scale), 2026-10-21 (cash available,
// the navigator) and 2026-10-26 (the averages, IV Percentile); the volatility chart follows the price chart's window,
// which a drag or the navigator moves.

interface AnalysisPriceCardsProps {
  symbol: string;
  /** Before the first analysis, the data file's figures alone: no chain scan, no analysis backtest, none of their legend rows. */
  figures: AnalysisFileFigures & Partial<Pick<AnalysisFigures, "fitDays" | "analysisBacktest">>;
  /** The values the figures were computed with; null before the first analysis. */
  shown: AnalysisPanelValues | null;
  showingTrial: boolean;
  stale: boolean;
  /** The symbol's splits over its bars (the price chart's split lines); null before its file was analysed. */
  splits: readonly { firstDayAfter: string; ratio: number }[] | null;
  /** No daily bars: why, and what can fetch them (null: nothing can). */
  missingBars: { message: string; action: React.ReactNode | null } | null;
}

export function AnalysisPriceCards({ symbol, figures, shown, showingTrial, stale, splits, missingBars }: AnalysisPriceCardsProps) {
  const { theme } = useTheme();
  const colors = analysisChartColors[theme];
  // The chart opens on the option data's period (Marcelo 2026-10-25), where the file has one.
  const optionData = useMemo(() => (figures.dataQuality.firstDate && figures.dataQuality.lastDate ? { from: figures.dataQuality.firstDate, to: figures.dataQuality.lastDate } : null), [figures.dataQuality.firstDate, figures.dataQuality.lastDate]);
  const [range, setRange] = useState<PriceChartRange>(optionData ? "Options data" : "All");
  const [logScale, toggleLogScale] = useLogScalePreference();
  const lastDate = figures.bars.at(-1)?.[0] ?? null;
  const priceWindow = usePriceWindow(figures.bars, range, optionData);
  const analysed = figures.fitDays !== undefined;
  const { bars, drawdown } = priceWindow;

  const priceChart = useMemo(() => {
    const allDates = (figures.fitDays ?? []).map(([date]) => date);
    const backtest = figures.analysisBacktest && "sessionId" in figures.analysisBacktest ? figures.analysisBacktest : null;
    // Each day against the pot the analysis backtest's ladder sized from that day (an Analyse Only run has its own backtest).
    const potOnDay = potOnDayFrom(backtest?.potPath);
    const strikeDates = backtest ? [...new Set(backtest.tooLargeDays.filter(([, , givenUp]) => givenUp !== null).map(([date]) => date))] : [];
    const chart = buildPriceDrawdownChart({
      symbol,
      bars,
      drawdown,
      theme,
      logScale,
      countedDates: allDates,
      smallRuns: potOnDay && shown && figures.fitDays ? dateRuns(tooSmallDates(figures.fitDays, shown, potOnDay), allDates) : [],
      strikeRuns: dateRuns(strikeDates, allDates),
      ladderLevels: backtest?.ladderLevels ?? [],
      ladderRungsSold: backtest?.ladderRungsSold ?? [],
      cashAvailable: backtest?.cashAvailable ?? null,
      splits: splits ?? [],
      indicators: indicatorsInWindow(figures.barIndicators, priceWindow.from, priceWindow.to),
    });
    if (!chart) return null;
    // Why the ladder lines are missing: no backtest, or one from before the levels were recorded.
    const ladderMissing = !backtest ? "no analysis backtest" : backtest.ladderLevels === undefined || figures.formulasVersion < analysisLadderLevelsFormulasVersion ? "computed with an older version of the formulas; Update Analysis to see them" : null;
    return { ...chart, smallDays: potOnDay ? chart.smallDays : null, hasBacktest: backtest !== null, ladderMissing };
  }, [bars, shown, figures, theme, drawdown, symbol, logScale, splits, priceWindow.from, priceWindow.to]);

  const volatilityChart = useMemo(() => {
    const offset = priceWindow.from;
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
  }, [bars, priceWindow.from, figures.yangZhang21, colors]);

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
  const impliedMedian = medianOf(lastYear.flatMap((row) => (row.implied === null ? [] : [row.implied])));
  const realisedMedian = medianOf(lastYear.flatMap((row) => (row.realised === null ? [] : [row.realised])));
  const premium = figures.volatility.impliedVersusRealised;
  const priceActions = <PriceChartActions symbol={symbol} range={range} onRangeChange={setRange} historyYears={historyYearsOf(figures.bars)} logScale={logScale} onToggleLogScale={toggleLogScale} optionData={optionData} />;

  return (
    <>
      <AnalysisCard title="Price and Max drawdown" description="IBKR daily bars, split-adjusted. Daily candles for every range." actions={priceActions} stale={stale}>
        <div className="card-body">
          {priceChart && (
            <div {...priceWindow.dragProps}>
              <PriceDrawdownCharts chart={priceChart} />
            </div>
          )}
          {priceWindow.canMove && (
            <div className="price-navigator-row">
              <PriceWindowNavigator allBars={figures.bars} priceWindow={priceWindow} />
            </div>
          )}
          <PriceDrawdownCaption chart={priceChart} drawdown={drawdown} />
          {priceChart && !analysed && (priceChart.splitsInRange.length > 0 || priceChart.ivPercentilePanel) && (
            <div className="analysis-chart-legend">
              <SplitLegendItem splits={priceChart.splitsInRange} />
              <IvPercentileLegendItem chart={priceChart} />
            </div>
          )}
          {priceChart && analysed && (
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
              {priceChart.ladderMissing ? (
                <span className="analysis-legend-item">Ladder cap and floor: {priceChart.ladderMissing}</span>
              ) : (
                <>
                  <LadderLegendItems />
                  <span className="analysis-legend-item">{priceChart.lastLevel ? "Levels from the analysis's backtest, each day a cycle held shares" : "No cycle held shares in this range (the analysis's backtest)"}</span>
                </>
              )}
              <SplitLegendItem splits={priceChart.splitsInRange} />
              {priceChart.cashPanel && (
                <span className="analysis-legend-item">
                  <span className="analysis-ladder-line is-cash-available" />
                  Cash available: the cash not locked in open Cash-Secured Puts (strike × 100 × contracts) ÷ the account value, just before the day's close: after its orders, before its expiries settle (the analysis's backtest)
                </span>
              )}
              <IvPercentileLegendItem chart={priceChart} />
            </div>
          )}
        </div>
      </AnalysisCard>
      <AnalysisCard
        title="Volatility: realised and implied"
        description="Follows the price chart's window above"
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
            <div className="analysis-vol-chart">
              <AnalysisSeriesKey items={volatilityChart.series.map((series, index) => ({ label: series.name, color: [colors.series1, colors.series2][index]! }))} />
              <ApexChart type="line" series={volatilityChart.series} options={volatilityChart.options} height={250} />
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
    </>
  );
}
