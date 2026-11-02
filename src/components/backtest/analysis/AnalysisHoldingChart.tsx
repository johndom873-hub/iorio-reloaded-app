import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../../api/client";
import { fetchBacktestSessionPriceChart, type AnalysisBacktestFigures, type AnalysisFileFigures, type BacktestSessionPriceChart } from "../../../api/backtestAnalysis";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";
import { AnalysisCard, AnalysisNote } from "./analysisBits";
import { buildHoldingChart, holdingChartRanges, holdingEventsOf, holdingHoverLines, holdingRangeStart, holdingWeeksOf, type HoldingChartRange } from "./analysisHoldingChartModel";
import { useLogScalePreference } from "./priceDrawdownChartModel";

// "Price, holding and trades" (Vol Farmer v4, mockup approved 2026-11-01): the weekly close with the analysis backtest's
// call-aways, top-ups and trims, the shares against their band, the IV with the Calls' own IV, the cash available, and a
// navigator of the whole history. When Puts happened, the B-E lines, the LEAPS and the Step pane too (read from the
// session's price chart). The range is the window's, so the volatility card below follows it.

interface AnalysisHoldingChartProps {
  symbol: string;
  figures: Pick<AnalysisFileFigures, "bars" | "realisedStandIn" | "falls">;
  /** Null before the first analysis: the price and IV panes only. */
  backtest: AnalysisBacktestFigures | null;
  range: HoldingChartRange;
  onRangeChange: (range: HoldingChartRange) => void;
  /** F24's target and band as fractions of the pot (0.8 and 0.05). */
  targetShare: number;
  bandShare: number;
  /** No daily bars: why, and what can fetch them (null: nothing can). */
  missingBars: { message: string; action: React.ReactNode | null } | null;
}

export function AnalysisHoldingChart({ symbol, figures, backtest, range, onRangeChange, targetShare, bandShare, missingBars }: AnalysisHoldingChartProps) {
  const [logScale, toggleLogScale] = useLogScalePreference();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const putsHappened = backtest !== null && backtest.putsSold > 0;
  const [sessionChart, setSessionChart] = useState<BacktestSessionPriceChart | null>(null);
  const [sessionChartError, setSessionChartError] = useState<string | null>(null);
  const sessionId = backtest?.sessionId ?? null;
  const needsSessionChart = backtest !== null && (backtest.putsSold > 0 || backtest.leapsBought > 0);
  useEffect(() => {
    if (!needsSessionChart || sessionId === null) return;
    let cancelled = false;
    fetchBacktestSessionPriceChart(sessionId, symbol).then(
      (chart) => {
        if (!cancelled) setSessionChart(chart);
      },
      (err: unknown) => {
        if (!cancelled) setSessionChartError(errorMessage(err, "Could not load the backtest's B-E lines."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsSessionChart, sessionId, symbol]);

  const allWeeks = useMemo(() => holdingWeeksOf({ bars: figures.bars, realisedStandIn: figures.realisedStandIn, backtest, breakEvenLevels: sessionChart?.breakEvenLevels ?? [] }), [figures.bars, figures.realisedStandIn, backtest, sessionChart]);
  const events = useMemo(() => holdingEventsOf(symbol, backtest, sessionChart?.leapsEvents ?? []), [symbol, backtest, sessionChart]);
  const shownRange: HoldingChartRange = range === "Backtest" && !backtest ? "All" : range;
  const rangeStart = holdingRangeStart(shownRange, figures.bars, backtest?.startDate ?? null);
  const chart = useMemo(
    () => buildHoldingChart({ allWeeks, bars: figures.bars, events, falls: figures.falls, range: shownRange, rangeStart, logScale, hasBacktest: backtest !== null, putsHappened, targetShare, bandShare }),
    [allWeeks, figures.bars, events, figures.falls, shownRange, rangeStart, logScale, backtest, putsHappened, targetShare, bandShare],
  );
  const historyYears = figures.bars.length < 2 ? 0 : (Date.parse(`${figures.bars.at(-1)![0]}T00:00:00Z`) - Date.parse(`${figures.bars[0]![0]}T00:00:00Z`)) / (365.25 * 86_400_000);

  const actions = (
    <div className="d-flex flex-wrap align-items-center gap-3">
      <div className="btn-group" role="group" aria-label="Range">
        {holdingChartRanges
          .filter((entry) => entry !== "Backtest" || backtest !== null)
          .map((entry) => {
            const years = entry === "10Y" ? 10 : entry === "5Y" ? 5 : entry === "2Y" ? 2 : entry === "1Y" ? 1 : null;
            const tooShort = years !== null && years > historyYears + 0.05;
            return (
              <button key={entry} type="button" className={`btn ${shownRange === entry ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={shownRange === entry} disabled={tooShort} title={tooShort ? `${symbol} has ${formatNumber(historyYears, 1)} years of daily bars` : undefined} onClick={() => {
                setHoverIndex(null);
                onRangeChange(entry);
              }}>
                {entry}
              </button>
            );
          })}
      </div>
      <label className="form-check form-switch m-0">
        <input className="form-check-input" type="checkbox" checked={logScale} onChange={toggleLogScale} />
        <span className="form-check-label">Log scale</span>
      </label>
    </div>
  );

  if (missingBars) {
    return (
      <AnalysisCard title="Price, holding and trades" description="IBKR daily bars, split-adjusted">
        <div className="card-body">
          <AnalysisNote tone="plain" actions={missingBars.action}>
            <p>{missingBars.message}</p>
          </AnalysisNote>
        </div>
      </AnalysisCard>
    );
  }

  const hover = chart && hoverIndex !== null && hoverIndex < chart.weeks.length ? (() => {
    const lines = holdingHoverLines(chart, hoverIndex, targetShare);
    const x = chart.xOf(hoverIndex);
    const boxWidth = Math.max(...lines.map((line) => line.text.length)) * 6.1 + 22;
    const boxX = x + 16 + boxWidth > chart.width - 4 ? x - 16 - boxWidth : x + 16;
    return { x, y: chart.priceYOf(chart.weeks[hoverIndex]!.close), boxX, boxWidth, lines };
  })() : null;
  const lastPaneBottom = chart ? (chart.panes.at(-1) ? chart.panes.at(-1)!.top + chart.panes.at(-1)!.height : chart.priceBottom) : 0;
  const maxDrawdown = chart?.maxDrawdown ?? null;

  return (
    <AnalysisCard title="Price, holding and trades" description={backtest ? "IBKR daily bars, split-adjusted, drawn here at each week's close. Holding and trades from the analysis's backtest." : "IBKR daily bars, split-adjusted, drawn here at each week's close."} actions={actions}>
      <div className="card-body">
        {!chart ? (
          <p className="text-secondary mb-0">Fewer than two weeks of bars in this range.</p>
        ) : (
          <figure className="m-0">
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="analysis-svg" role="img" aria-label={`${symbol}'s weekly close${backtest ? " with call-aways and top-ups, the shares against their target band, implied volatility and cash available" : " and implied volatility"}`} onMouseLeave={() => setHoverIndex(null)}>
              {chart.fallShades.map((shade, index) => (
                <rect key={index} x={shade.x} y={chart.priceTop} width={shade.width} height={chart.priceBottom - chart.priceTop} className="analysis-svg-band is-falls" />
              ))}
              {chart.drawdownBand && (
                <>
                  <rect x={chart.drawdownBand.x} y={chart.priceTop} width={chart.drawdownBand.width} height={chart.priceBottom - chart.priceTop} className="analysis-svg-band is-drawdown" />
                  <text x={chart.drawdownBand.x + 6} y={chart.priceTop + 14} className="analysis-svg-text is-strong">
                    {chart.drawdownBand.label}
                  </text>
                </>
              )}
              {chart.priceGrid.map((line) => (
                <g key={line.label}>
                  <line x1={chart.left} x2={chart.right} y1={line.y} y2={line.y} className="analysis-svg-grid" />
                  <text x={chart.left - 8} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
                    {line.label}
                  </text>
                </g>
              ))}
              {chart.breakEvenLines.map((points, index) => (
                <polyline key={`be${index}`} points={points} className="analysis-svg-line is-break-even" />
              ))}
              {chart.breakEven2Lines.map((points, index) => (
                <polyline key={`be2${index}`} points={points} className="analysis-svg-line is-break-even-2" />
              ))}
              <polyline points={chart.priceLine} className="analysis-svg-line is-price" />
              {chart.calledAway.map((mark, index) => (
                <circle key={index} cx={mark.cx} cy={mark.cy} r={3.5} className="analysis-svg-mark is-call-away" />
              ))}
              {chart.topUps.map((points, index) => (
                <polygon key={index} points={points} className="analysis-svg-mark is-top-up" />
              ))}
              {chart.trims.map((points, index) => (
                <polygon key={index} points={points} className="analysis-svg-mark is-trim" />
              ))}
              {chart.leaps.map((badge, index) => (
                <g key={index}>
                  <rect x={badge.x - 8} y={badge.y} width={16} height={14} rx={3} className="analysis-svg-leaps-badge" />
                  <text x={badge.x} y={badge.y + 10.5} textAnchor="middle" className="analysis-svg-leaps-glyph">
                    {badge.glyph}
                  </text>
                </g>
              ))}
              {chart.panes.map((pane) => (
                <text key={pane.key} x={chart.left} y={pane.top - 6} className="analysis-svg-text is-pane">
                  {pane.label}
                </text>
              ))}
              {chart.shares && (
                <>
                  <rect x={chart.left} y={chart.shares.band.top} width={chart.right - chart.left} height={chart.shares.band.height} className="analysis-svg-band is-target" />
                  <line x1={chart.left} x2={chart.right} y1={chart.shares.targetY} y2={chart.shares.targetY} className="analysis-svg-dashed is-target" />
                  {chart.shares.grid.map((line) => (
                    <g key={line.label}>
                      <line x1={chart.left} x2={chart.right} y1={line.y} y2={line.y} className="analysis-svg-grid" />
                      <text x={chart.left - 8} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
                        {line.label}
                      </text>
                    </g>
                  ))}
                  <text x={chart.right - 2} y={chart.shares.band.top - 4} textAnchor="end" className="analysis-svg-text">
                    {chart.shares.targetLabel}
                  </text>
                  {chart.shares.lines.map((points, index) => (
                    <polyline key={index} points={points} className="analysis-svg-line is-shares" />
                  ))}
                </>
              )}
              {chart.iv.grid.map((line) => (
                <g key={`iv${line.label}`}>
                  <line x1={chart.left} x2={chart.right} y1={line.y} y2={line.y} className="analysis-svg-grid" />
                  <text x={chart.left - 8} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
                    {line.label}
                  </text>
                </g>
              ))}
              {chart.iv.implied.map((points, index) => (
                <polyline key={`ivi${index}`} points={points} className="analysis-svg-line is-iv" />
              ))}
              {chart.iv.realised.map((points, index) => (
                <polyline key={`ivr${index}`} points={points} className="analysis-svg-line is-iv-realised" />
              ))}
              {chart.iv.dots.map((dot, index) => (
                <circle key={index} cx={dot.cx} cy={dot.cy} r={2.2} className="analysis-svg-dot is-call-iv" />
              ))}
              {chart.step && (
                <>
                  {chart.step.grid.map((line) => (
                    <g key={`step${line.label}`}>
                      <line x1={chart.left} x2={chart.right} y1={line.y} y2={line.y} className="analysis-svg-grid" />
                      <text x={chart.left - 8} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
                        {line.label}
                      </text>
                    </g>
                  ))}
                  {chart.step.implied.map((points, index) => (
                    <polyline key={`si${index}`} points={points} className="analysis-svg-line is-step" />
                  ))}
                  {chart.step.realised.map((points, index) => (
                    <polyline key={`sr${index}`} points={points} className="analysis-svg-line is-step-realised" />
                  ))}
                </>
              )}
              {chart.cash && (
                <>
                  <line x1={chart.left} x2={chart.right} y1={chart.cash.top} y2={chart.cash.top} className="analysis-svg-grid" />
                  <line x1={chart.left} x2={chart.right} y1={chart.cash.bottom} y2={chart.cash.bottom} className="analysis-svg-grid" />
                  <text x={chart.left - 8} y={chart.cash.top + 4} textAnchor="end" className="analysis-svg-text">
                    100%
                  </text>
                  <text x={chart.left - 8} y={chart.cash.bottom + 4} textAnchor="end" className="analysis-svg-text">
                    0%
                  </text>
                  {chart.cash.area && <polygon points={chart.cash.area} className="analysis-svg-area is-cash" />}
                </>
              )}
              {chart.ticks.map((tick) => (
                <text key={`${tick.x}`} x={tick.x} y={chart.ticksY} textAnchor="middle" className="analysis-svg-text">
                  {tick.label}
                </text>
              ))}
              <rect x={chart.left} y={chart.navigator.top} width={chart.right - chart.left} height={chart.navigator.height} rx={4} className="analysis-svg-navigator" />
              <polyline points={chart.navigator.line} className="analysis-svg-line is-navigator" />
              <rect x={chart.navigator.windowX} y={chart.navigator.top} width={chart.navigator.windowWidth} height={chart.navigator.height} rx={4} className="analysis-svg-navigator-window" />
              {hover && (
                <>
                  <line x1={hover.x} x2={hover.x} y1={chart.priceTop} y2={lastPaneBottom} className="analysis-svg-cursor" />
                  <circle cx={hover.x} cy={hover.y} r={4} className="analysis-svg-cursor-dot is-price" />
                  <rect x={hover.boxX} y={20} width={hover.boxWidth} height={16 * hover.lines.length + 12} rx={6} className="analysis-svg-tooltip" />
                  {hover.lines.map((line, index) => (
                    <text key={index} x={hover.boxX + 11} y={38 + 16 * index} className={`analysis-svg-text ${line.strong ? "is-strong" : "is-body"}`}>
                      {line.text}
                    </text>
                  ))}
                </>
              )}
              {chart.targets.map((target, index) => (
                <rect key={index} x={target.x} y={chart.priceTop} width={target.width} height={lastPaneBottom - chart.priceTop} className="analysis-svg-hit" onMouseEnter={() => setHoverIndex(index)} />
              ))}
            </svg>
            <figcaption className="analysis-chart-caption">
              {maxDrawdown && maxDrawdown.depth > 0
                ? `Max drawdown in this range: ${formatPercentage(-maxDrawdown.depth)}, ${formatDayMonthYear(maxDrawdown.peakDate)} (${formatCurrency(maxDrawdown.peak)}) to ${formatDayMonthYear(maxDrawdown.troughDate)} (${formatCurrency(maxDrawdown.trough)}) on the daily closes. ${maxDrawdown.recoveredOn ? `Back above the peak on ${formatDayMonthYear(maxDrawdown.recoveredOn)}.` : "Not back above the peak yet."}`
                : "No fall in this range."}
              {backtest && ` In this range: ${formatNumber(chart.counts.calledAway)} call-aways, ${formatNumber(chart.counts.topUps)} top-ups, ${formatNumber(chart.counts.trims)} trims${chart.counts.leaps > 0 ? `, ${formatNumber(chart.counts.leaps)} LEAPS trades` : ""}.`}
            </figcaption>
          </figure>
        )}
        {sessionChartError && <div className="alert alert-danger mt-2 mb-0">{sessionChartError}</div>}
        {needsSessionChart && !sessionChart && !sessionChartError && (
          <div className="d-inline-flex align-items-center gap-1 text-secondary mt-2" style={{ fontSize: "0.78rem" }}>
            <Spinner size="sm" />
            Loading the backtest's B-E lines and LEAPS
          </div>
        )}
        <div className="analysis-legend mt-3" style={{ rowGap: "0.5rem" }}>
          {backtest && (
            <>
              <span className="analysis-legend-item">
                <svg width="12" height="12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4" className="analysis-svg-mark is-call-away" />
                </svg>
                Called away: the same-day Call ended in the money; the shares are bought back at the next look
              </span>
              <span className="analysis-legend-item">
                <svg width="12" height="12" aria-hidden="true">
                  <polygon points="6,1 11,11 1,11" className="analysis-svg-mark is-top-up" />
                </svg>
                Top-up: lots bought because the shares fell under {formatPercentage(targetShare - bandShare, 0)} of the pot
              </span>
              <span className="analysis-legend-item">
                <svg width="12" height="12" aria-hidden="true">
                  <polygon points="1,1 11,1 6,11" className="analysis-svg-mark is-trim" />
                </svg>
                Trim: lots sold over {formatPercentage(targetShare + bandShare, 0)}
                {backtest.trims.count === 0 ? ` (none on ${symbol})` : ""}
              </span>
              {chart && chart.breakEvenLines.length > 0 && (
                <span className="analysis-legend-item">
                  <svg width="22" height="6" aria-hidden="true">
                    <line x1="0" x2="22" y1="3" y2="3" className="analysis-svg-line is-break-even" />
                  </svg>
                  B-E: the first position's break-even, what its shares cost less its Calls' premiums, per share
                </span>
              )}
              {chart && chart.breakEven2Lines.length > 0 && (
                <span className="analysis-legend-item">
                  <svg width="22" height="6" aria-hidden="true">
                    <line x1="0" x2="22" y1="3" y2="3" className="analysis-svg-line is-break-even-2" />
                  </svg>
                  B-E2: the second position's, the assigned Puts' strike less its Puts' and Calls' premiums, per share
                </span>
              )}
              {backtest.leapsBought > 0 && (
                <span className="analysis-legend-item">
                  <svg width="16" height="14" aria-hidden="true">
                    <rect width="16" height="14" rx="3" className="analysis-svg-leaps-badge" />
                    <text x="8" y="10.5" textAnchor="middle" className="analysis-svg-leaps-glyph">
                      ▲
                    </text>
                  </svg>
                  LEAPS: ▲ bought, ▼ sold, ✕ expired
                </span>
              )}
              <span className="analysis-legend-item">
                <svg width="22" height="6" aria-hidden="true">
                  <line x1="0" x2="22" y1="3" y2="3" className="analysis-svg-line is-shares" />
                </svg>
                Shares ÷ pot: the holding's value ÷ the pot at the week's last 10:00 mark
              </span>
            </>
          )}
          <span className="analysis-legend-item">
            <svg width="22" height="6" aria-hidden="true">
              <line x1="0" x2="22" y1="3" y2="3" className="analysis-svg-line is-iv" />
            </svg>
            IBKR's 30-day implied volatility; dashed: the 63-day realised volatility on weeks without it
          </span>
          {backtest && (
            <span className="analysis-legend-item">
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="3" className="analysis-svg-dot is-call-iv" />
              </svg>
              IV of the week's Calls sold, by contracts; one above the axis sits on its top edge
            </span>
          )}
          {putsHappened && (
            <span className="analysis-legend-item">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="0" x2="22" y1="3" y2="3" className="analysis-svg-line is-step" />
              </svg>
              Step: the IV × √(21 ÷ 252); dashed from the 63-day realised volatility
            </span>
          )}
          {backtest && (
            <span className="analysis-legend-item">
              <svg width="14" height="10" aria-hidden="true">
                <rect width="14" height="10" rx="2" className="analysis-svg-swatch is-cash" />
              </svg>
              Cash available: free cash ÷ the account value just before the close
            </span>
          )}
          <span className="analysis-legend-item">
            <svg width="14" height="10" aria-hidden="true">
              <rect width="14" height="10" rx="2" className="analysis-svg-swatch is-falls" />
            </svg>
            Falls that reached 2 Steps (10Y and All)
          </span>
        </div>
      </div>
    </AnalysisCard>
  );
}
