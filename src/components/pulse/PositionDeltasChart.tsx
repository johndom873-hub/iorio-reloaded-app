import { useRef, useState } from "react";

// Pure/presentational — PulsePage owns the rolling-sample logic (sampling
// the live greeks stream's |delta| per position, filtered to CC/CSP only
// before it reaches this component). Reference line is the real configured
// delta_target_max from strategy_settings (fetched once on mount, not
// hardcoded).
export interface DeltaSeries {
  /** Position id, not symbol — a rolled position can leave two open positions sharing one ticker, so symbol alone isn't a safe React key. */
  id: string;
  symbol: string;
  color: string;
  values: number[];
}

interface PositionDeltasChartProps {
  seriesByPosition: DeltaSeries[];
  deltaLimit: number;
  /** Upper bound of the y-axis — kept independent of deltaLimit so the reference line isn't pinned to the very top edge. */
  yAxisMax?: number;
}

export function PositionDeltasChart({ seriesByPosition, deltaLimit, yAxisMax = 0.4 }: PositionDeltasChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const y = (value: number) => 95 - (value / yAxisMax) * 90;
  const limitY = y(deltaLimit).toFixed(1);
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
      <div className="delta-legend">
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
    </div>
  );
}
