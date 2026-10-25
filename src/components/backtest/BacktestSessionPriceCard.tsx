import { useEffect, useMemo, useState } from "react";
import { fetchBacktestSessionPriceChart, type BacktestSessionPriceChart } from "../../api/backtestAnalysis";
import { errorMessage } from "../../api/client";
import { useTheme } from "../../hooks/useTheme";
import { dateRuns } from "../../lib/analysisPresentation";
import { formatNumber } from "../../lib/formatters";
import { Spinner } from "../Spinner";
import { BacktestCard } from "./backtestBits";
import { LadderLegendItems, PriceChartActions, PriceDrawdownCaption, PriceDrawdownCharts, PriceWindowNavigator, SplitLegendItem } from "./analysis/priceDrawdownChart";
import { buildPriceDrawdownChart, historyYearsOf, useLogScalePreference, usePriceWindow, type PriceChartRange } from "./analysis/priceDrawdownChartModel";

// The Analyse window's "Price and Max drawdown" chart on a session's results (Marcelo 2026-10-20): over the session's
// period, with this session's ladder levels, rungs sold and orders over one strike (no "Pot too small": that is the
// Analyse window's fit); one symbol at a time.

function PriceChartBody({ chart, range, logScale, severalSymbols }: { chart: BacktestSessionPriceChart; range: PriceChartRange; logScale: boolean; severalSymbols: boolean }) {
  const { theme } = useTheme();
  const priceWindow = usePriceWindow(chart.bars, range);
  const { bars, drawdown } = priceWindow;
  const drawn = useMemo(() => {
    const dates = chart.bars.map((bar) => bar[0]);
    const strikeDates = [...new Set(chart.tooLargeDays.filter(([, , givenUp]) => givenUp !== null).map(([date]) => date))];
    return buildPriceDrawdownChart({
      symbol: chart.symbol,
      bars,
      drawdown,
      theme,
      logScale,
      countedDates: dates,
      smallRuns: [],
      strikeRuns: dateRuns(strikeDates, dates),
      ladderLevels: chart.ladderLevels,
      ladderRungsSold: chart.ladderRungsSold,
      cashAvailable: chart.cashAvailable,
      splits: chart.splits ?? [],
    });
  }, [chart, bars, drawdown, theme, logScale]);

  if (chart.bars.length === 0) return <div className="card-body text-secondary">No IBKR daily bars for {chart.symbol} in the session's period.</div>;
  const ladderRecorded = chart.ladderLevels.length > 0 || chart.ladderRungsSold.length > 0;
  return (
    <div className="card-body">
      {drawn && (
        <div {...priceWindow.dragProps}>
          <PriceDrawdownCharts chart={drawn} />
        </div>
      )}
      {priceWindow.canMove && (
        <div className="price-navigator-row">
          <PriceWindowNavigator allBars={chart.bars} priceWindow={priceWindow} />
        </div>
      )}
      <PriceDrawdownCaption chart={drawn} drawdown={drawdown} />
      {drawn && (
        <div className="analysis-chart-legend">
          <span className="analysis-legend-item">
            <span className="analysis-shade-swatch is-strike" />
            An order needed more than one strike: {drawn.strikeDays > 0 ? `${formatNumber(drawn.strikeDays)} sale days in this range` : "none in this range"}
          </span>
          {ladderRecorded ? (
            <>
              <LadderLegendItems />
              <span className="analysis-legend-item">{drawn.lastLevel ? "Levels from this session, each day a cycle held shares" : "No cycle held shares in this range"}</span>
            </>
          ) : (
            <span className="analysis-legend-item">Ladder cap and floor: none recorded (no ladder in this session, or it ran before the levels were kept)</span>
          )}
          <SplitLegendItem splits={drawn.splitsInRange} />
          {drawn.cashPanel && (
            <span className="analysis-legend-item">
              <span className="analysis-ladder-line is-cash-available" />
              Cash available: the cash not locked in open Cash-Secured Puts (strike × 100 × contracts) ÷ the account value, at the day's 10:00 marks before its orders{severalSymbols && " (the whole account, every symbol's)"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "Price and Max drawdown" for a session: read for the symbol chosen, again when the run's status changes. */
export function BacktestSessionPriceCard({ sessionId, symbols, status }: { sessionId: string; symbols: string[]; status: string }) {
  const [symbol, setSymbol] = useState(symbols[0]!);
  const [range, setRange] = useState<PriceChartRange>("All");
  const [logScale, toggleLogScale] = useLogScalePreference();
  const [state, setState] = useState<{ status: "loading" } | { status: "loaded"; chart: BacktestSessionPriceChart } | { status: "failed"; error: string }>({ status: "loading" });
  useEffect(() => {
    let current = true;
    setState((previous) => (previous.status === "loaded" && previous.chart.symbol === symbol ? previous : { status: "loading" }));
    fetchBacktestSessionPriceChart(sessionId, symbol).then(
      (chart) => current && setState({ status: "loaded", chart }),
      (error: unknown) => current && setState({ status: "failed", error: errorMessage(error, "Could not load the price chart.") }),
    );
    return () => {
      current = false;
    };
  }, [sessionId, symbol, status]);

  return (
    <BacktestCard
      title="Price and Max drawdown"
      description="IBKR daily bars, split-adjusted, over the session's period"
      actions={
        <>
          {symbols.length > 1 && (
            <select className="form-select w-auto" aria-label="Symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)}>
              {symbols.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          )}
          {state.status === "loaded" && state.chart.bars.length > 0 && (
            <PriceChartActions symbol={state.chart.symbol} range={range} onRangeChange={setRange} historyYears={historyYearsOf(state.chart.bars)} logScale={logScale} onToggleLogScale={toggleLogScale} />
          )}
        </>
      }
      className="mb-3"
    >
      {state.status === "loading" ? (
        <div className="card-body d-flex justify-content-center py-4">
          <Spinner size="sm" label="Loading the price chart" />
        </div>
      ) : state.status === "failed" ? (
        <div className="card-body">
          <div className="alert alert-danger mb-0">{state.error}</div>
        </div>
      ) : (
        <PriceChartBody key={state.chart.symbol} chart={state.chart} range={range} logScale={logScale} severalSymbols={symbols.length > 1} />
      )}
    </BacktestCard>
  );
}
