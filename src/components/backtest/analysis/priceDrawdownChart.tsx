import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { AnalysisFigures, AnalysisMaxDrawdown, AnalysisPriceRange } from "../../../api/backtestAnalysis";
import { formatCurrency, formatDayMonthYear, formatPercentage } from "../../../lib/formatters";
import { ApexChart } from "../../charts/ApexChart";
import { priceRanges, type PriceDrawdownChart, type PriceWindow } from "./priceDrawdownChartModel";

// The "Price and Max drawdown" chart, shared by the Analyse window (its analysis backtest) and a session's results (that
// session): daily candles, the drawdown band, shaded runs of days, the ladder's next Put's cap and floor and the rungs
// sold, a log scale to switch on, under the candles the account's cash available, and under both a navigator to move the
// window across the session.

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


/** The candles and, when recorded, the cash-available panel under them. */
export function PriceDrawdownCharts({ chart }: { chart: Pick<NonNullable<PriceDrawdownChart>, "options" | "series" | "cashPanel"> }) {
  return (
    <>
      <ApexChart type="line" series={chart.series} options={chart.options} height={chart.cashPanel ? 320 : 340} />
      {chart.cashPanel && (
        <>
          <div className="analysis-panel-label">Cash available</div>
          <ApexChart type="area" series={chart.cashPanel.series} options={chart.cashPanel.options} height={112} />
        </>
      )}
    </>
  );
}

/** Bars a step of the arrow keys moves the navigator's window: about a month of trading days. */
const navigatorKeyStep = 21;
/** The navigator draws its bars between these x (of 1,000), so a grip at either end stays whole. */
const navigatorLeft = 3;
const navigatorWidth = 994;

/**
 * Under a movable chart (approved 2026-10-21, mockup "A · Navigator"): the whole period's closes in miniature with the
 * window on screen boxed. Drag the box, click the strip to centre the window there, or use the arrow keys (a month a step).
 */
export function PriceWindowNavigator({ allBars, priceWindow }: { allBars: AnalysisFigures["bars"]; priceWindow: PriceWindow }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const line = useMemo(() => {
    const closes = allBars.map((bar) => bar[4]);
    const lowest = Math.min(...closes);
    const span = Math.max(...closes) - lowest || 1;
    return closes.map((close, index) => `${index ? "L" : "M"}${(navigatorLeft + (index / Math.max(1, closes.length - 1)) * navigatorWidth).toFixed(1)},${(40 - ((close - lowest) / span) * 34).toFixed(1)}`).join("");
  }, [allBars]);
  if (!priceWindow.canMove || allBars.length < 2 || priceWindow.bars.length === 0) return null;
  const last = allBars.length - 1;
  const xOf = (index: number) => navigatorLeft + (index / last) * navigatorWidth;
  const indexAt = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    return box && box.width > 0 ? Math.round(((((clientX - box.left) / box.width) * 1000 - navigatorLeft) / navigatorWidth) * last) : priceWindow.to;
  };
  const halfWindow = Math.round((priceWindow.to - priceWindow.from) / 2);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const at = indexAt(event.clientX);
    // Outside the box: the window jumps to centre there, then follows the drag.
    const end = at < priceWindow.from || at > priceWindow.to ? at + halfWindow : priceWindow.to;
    if (end !== priceWindow.to) priceWindow.moveTo(end);
    drag.current = { pointerId: event.pointerId, offset: end - at };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    priceWindow.moveTo(indexAt(event.clientX) + drag.current.offset);
  };
  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === "ArrowLeft" ? -navigatorKeyStep : event.key === "ArrowRight" ? navigatorKeyStep : event.key === "Home" ? -last : event.key === "End" ? last : 0;
    if (step === 0) return;
    event.preventDefault();
    priceWindow.moveTo(priceWindow.to + step);
  };
  const windowText = `Showing ${formatDayMonthYear(priceWindow.bars[0]![0])} to ${formatDayMonthYear(priceWindow.bars.at(-1)![0])}`;
  const left = xOf(priceWindow.from);
  const right = xOf(priceWindow.to);
  return (
    <svg
      ref={svgRef}
      className="price-navigator"
      viewBox="0 0 1000 44"
      preserveAspectRatio="none"
      role="slider"
      tabIndex={0}
      aria-label="Move the chart's window across the period: drag the box, click the strip, or use the arrow keys"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={priceWindow.to}
      aria-valuetext={windowText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <rect className="price-navigator-frame" x={0.5} y={0.5} width={999} height={43} rx={3} />
      <path className="price-navigator-line" d={line} />
      <rect className="price-navigator-dim" x={0} y={0} width={left} height={44} />
      <rect className="price-navigator-dim" x={right} y={0} width={1000 - right} height={44} />
      <rect className="price-navigator-window" x={left} y={1} width={Math.max(4, right - left)} height={42} rx={2} />
      <rect className="price-navigator-grip" x={left - 2} y={14} width={4} height={16} rx={1} />
      <rect className="price-navigator-grip" x={right - 2} y={14} width={4} height={16} rx={1} />
    </svg>
  );
}

/** The caption under the chart: the range's Max drawdown, its cash available and the last ladder levels. */
export function PriceDrawdownCaption({ chart, drawdown }: { chart: Pick<NonNullable<PriceDrawdownChart>, "cashSummary" | "lastLevel"> | null; drawdown: AnalysisMaxDrawdown | null }) {
  if (!drawdown) return null;
  return (
    <div className="analysis-chart-caption">
      Max drawdown in this range: <b className="font-mono">{formatPercentage(-drawdown.depth)}</b>, {formatDayMonthYear(drawdown.peakDate)} ({formatCurrency(drawdown.peak)}) to {formatDayMonthYear(drawdown.troughDate)} ({formatCurrency(drawdown.trough)}). {drawdown.recoveredOn ? `Back above the peak on ${formatDayMonthYear(drawdown.recoveredOn)}.` : "Not back above the peak yet."}
      {chart?.cashSummary && ` Cash available in this range: median ${formatPercentage(chart.cashSummary.median, 0)}, lowest ${formatPercentage(chart.cashSummary.lowest, 0)} on ${formatDayMonthYear(chart.cashSummary.lowestDate)}.`}
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
