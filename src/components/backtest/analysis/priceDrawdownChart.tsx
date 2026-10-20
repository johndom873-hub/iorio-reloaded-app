import type { AnalysisMaxDrawdown, AnalysisPriceRange } from "../../../api/backtestAnalysis";
import { formatCurrency, formatDayMonthYear, formatPercentage } from "../../../lib/formatters";
import { ApexChart } from "../../charts/ApexChart";
import { priceRanges, type PriceDrawdownChart, type PriceWindow } from "./priceDrawdownChartModel";

// The "Price and Max drawdown" chart, shared by the Analyse window (its analysis backtest) and a session's results (that
// session): daily candles, the drawdown band, shaded runs of days, the ladder's next Put's cap and floor and the rungs
// sold, a log scale to switch on, and under the candles the share of the account in shares.

/** Under a movable chart: the days on screen, and a way back to the latest. */
export function PriceWindowNote({ priceWindow }: { priceWindow: PriceWindow }) {
  if (!priceWindow.canMove || priceWindow.bars.length === 0) return null;
  return (
    <div className="analysis-chart-caption d-flex flex-wrap align-items-center gap-2">
      <span>
        Showing {formatDayMonthYear(priceWindow.bars[0]![0])} to {formatDayMonthYear(priceWindow.bars.at(-1)![0])}. Drag the chart, or use the arrow keys on it, to move across the timeline.
      </span>
      {!priceWindow.atLatest && (
        <button type="button" className="btn btn-outline-secondary" onClick={priceWindow.toLatest}>
          Back to the latest
        </button>
      )}
    </div>
  );
}


/** The Log scale switch and the range buttons (a range longer than the bars is disabled). */
export function PriceChartActions({ symbol, range, onRangeChange, historyYears, logScale, onToggleLogScale }: { symbol: string; range: AnalysisPriceRange; onRangeChange: (range: AnalysisPriceRange) => void; historyYears: number; logScale: boolean; onToggleLogScale: () => void }) {
  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <button type="button" className={`btn ${logScale ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={logScale} onClick={onToggleLogScale}>
        Log scale
      </button>
      <div className="btn-group" role="group" aria-label="Range">
        {priceRanges.map((entry) => {
          const tooShort = entry.years !== null && entry.years > historyYears;
          return (
            <button
              key={entry.key}
              type="button"
              className={`btn ${range === entry.key ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={range === entry.key}
              disabled={tooShort}
              title={tooShort ? `${symbol} has ${historyYears.toFixed(1)} years of daily bars` : undefined}
              onClick={() => onRangeChange(entry.key)}
            >
              {entry.key}
            </button>
          );
        })}
      </div>
    </div>
  );
}


/** The candles and, when recorded, the account-in-shares panel under them. */
export function PriceDrawdownCharts({ chart }: { chart: Pick<NonNullable<PriceDrawdownChart>, "options" | "series" | "sharesPanel"> }) {
  return (
    <>
      <ApexChart type="line" series={chart.series} options={chart.options} height={chart.sharesPanel ? 320 : 340} />
      {chart.sharesPanel && (
        <>
          <div className="analysis-panel-label">Account in shares</div>
          <ApexChart type="line" series={chart.sharesPanel.series} options={chart.sharesPanel.options} height={112} />
        </>
      )}
    </>
  );
}

/** The caption under the chart: the range's Max drawdown, the account in shares and the last ladder levels. */
export function PriceDrawdownCaption({ chart, drawdown }: { chart: Pick<NonNullable<PriceDrawdownChart>, "sharesSummary" | "lastLevel"> | null; drawdown: AnalysisMaxDrawdown | null }) {
  if (!drawdown) return null;
  return (
    <div className="analysis-chart-caption">
      Max drawdown in this range: <b className="font-mono">{formatPercentage(-drawdown.depth)}</b>, {formatDayMonthYear(drawdown.peakDate)} ({formatCurrency(drawdown.peak)}) to {formatDayMonthYear(drawdown.troughDate)} ({formatCurrency(drawdown.trough)}). {drawdown.recoveredOn ? `Back above the peak on ${formatDayMonthYear(drawdown.recoveredOn)}.` : "Not back above the peak yet."}
      {chart?.sharesSummary && ` Account in shares in this range: median ${formatPercentage(chart.sharesSummary.median, 0)}, highest ${formatPercentage(chart.sharesSummary.highest, 0)}.`}
      {chart?.lastLevel && ` Ladder on ${formatDayMonthYear(chart.lastLevel[0])}: cap ${chart.lastLevel[1] === null ? "none" : formatCurrency(chart.lastLevel[1])}, floor ${chart.lastLevel[2] === null ? "none" : formatCurrency(chart.lastLevel[2])}.`}
    </div>
  );
}

/** The ladder's three legend items. */
export function LadderLegendItems() {
  return (
    <>
      <span className="analysis-legend-item">
        <span className="analysis-ladder-line is-dashed" />
        Ladder cap: the highest strike the next ladder Put may have
      </span>
      <span className="analysis-legend-item">
        <span className="analysis-ladder-line" />
        Ladder floor: the last rung's cap, the shares' average cost × (1 − S)
      </span>
      <span className="analysis-legend-item">
        <span className="analysis-rung-badge">2</span>A rung sold at its highest strike, numbered by the reserve's slice it reaches
      </span>
    </>
  );
}
