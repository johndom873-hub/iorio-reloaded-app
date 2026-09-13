// Pure/presentational — PulsePage owns the rolling-sample logic (sampling
// the live greeks stream's |delta| per position). Reference line is the
// real configured delta_target_max from strategy_settings (fetched once on
// mount, not hardcoded) — 0.3 for both strategies as of 2026-09-13, but
// this reads whatever's actually configured rather than assuming that stays
// true.
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
  const y = (value: number) => 95 - (value / yAxisMax) * 90;
  const limitY = y(deltaLimit).toFixed(1);

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
      <div className="chart-svg-wrap">
        <svg viewBox="0 0 300 100" preserveAspectRatio="none">
          <line x1={0} y1={limitY} x2={300} y2={limitY} stroke="var(--warning)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.7} />
          {seriesByPosition
            .filter((series) => series.values.length >= 2)
            .map((series) => {
              const points = series.values
                .map((value, index) => `${(index / (series.values.length - 1)) * 300},${y(value).toFixed(1)}`)
                .join(" ");
              return <polyline key={series.id} points={points} fill="none" stroke={series.color} strokeWidth={0.6} opacity={0.8} />;
            })}
        </svg>
      </div>
    </div>
  );
}
