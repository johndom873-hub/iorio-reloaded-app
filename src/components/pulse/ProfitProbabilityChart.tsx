import { useRef, useState } from "react";
import { ChartTimeAxis } from "./ChartTimeAxis";

// Pure/presentational — PulsePage owns the rolling-sample logic (sampling
// the live greeks stream's probabilityByD2 — the approved N(d2) success
// probability, see positionSuccessProbability.ts — per position, filtered to
// CC/CSP only before it reaches this component). The reference line is a
// minimum: a position sitting below it is unlikely to end in profit.
export interface ProbabilitySeries {
  /** Position id, not symbol — a rolled position can leave two open positions sharing one ticker, so symbol alone isn't a safe React key. */
  id: string;
  symbol: string;
  color: string;
  values: number[];
}

interface ProfitProbabilityChartProps {
  seriesByPosition: ProbabilitySeries[];
  probabilityThreshold: number;
  /**
   * Same sample clock PulsePage uses for every series (one push per
   * interval tick) — used only for the shared x-axis labels below, not to
   * place each polyline (those still plot along their own values.length,
   * since a position that opened after tracking started has a shorter
   * series than this array).
   */
  timestamps: number[];
  /** Upper bound of the y-axis — kept independent of probabilityThreshold so the reference line isn't pinned to the very top edge. */
  yAxisMax?: number;
}

export function ProfitProbabilityChart({ seriesByPosition, probabilityThreshold, timestamps, yAxisMax = 1 }: ProfitProbabilityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const y = (value: number) => 95 - (value / yAxisMax) * 90;
  const limitY = y(probabilityThreshold).toFixed(1);
  const plottable = seriesByPosition.filter((series) => series.values.length >= 2);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverFraction(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  }

  const hoverEntries =
    hoverFraction !== null
      ? plottable.map((series) => ({
          series,
          value: series.values[Math.round(hoverFraction * (series.values.length - 1))],
        }))
      : [];
  const hoverXPercent = (hoverFraction ?? 0) * 100;

  return (
    <div className="chart-body">
      <div className="probability-legend">
        {seriesByPosition.map((series) => (
          <div className="legend-item" key={series.id}>
            <span className="legend-dot" style={{ background: series.color }} />
            <span className="legend-tkr">{series.symbol}</span>
          </div>
        ))}
      </div>
      <div
        className="chart-svg-wrap"
        ref={wrapRef}
        style={{ position: "relative" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverFraction(null)}
      >
        <svg viewBox="0 0 300 100" preserveAspectRatio="none">
          <line x1={0} y1={limitY} x2={300} y2={limitY} stroke="var(--warning)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.7} />
          {plottable.map((series) => {
            const points = series.values
              .map((value, index) => `${(index / (series.values.length - 1)) * 300},${y(value).toFixed(1)}`)
              .join(" ");
            return <polyline key={series.id} points={points} fill="none" stroke={series.color} strokeWidth={0.6} opacity={0.8} />;
          })}
          {hoverFraction !== null && <line x1={hoverFraction * 300} y1={0} x2={hoverFraction * 300} y2={100} stroke="var(--text-muted)" strokeWidth={0.4} />}
        </svg>
        {hoverFraction !== null && hoverEntries.length > 0 && (
          <div
            className="chart-tooltip chart-tooltip-multi"
            style={{ left: `${hoverXPercent}%`, transform: hoverXPercent > 75 ? "translateX(-100%)" : hoverXPercent < 8 ? "translateX(0)" : "translateX(-50%)" }}
          >
            {hoverEntries.map(({ series, value }) => (
              <div className="chart-tooltip-row" key={series.id}>
                <span className="legend-dot" style={{ background: series.color }} />
                <span>{series.symbol}</span>
                <span className="chart-tooltip-value">{value !== undefined ? value.toFixed(3) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <ChartTimeAxis timestamps={timestamps} />
    </div>
  );
}
