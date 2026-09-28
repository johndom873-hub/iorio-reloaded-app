interface PnlSparklineProps {
  series: number[];
}

const WIDTH = 64;
const HEIGHT = 16;

/** Tiny inline P&L line for the collapsed Charts header on the phone layout; a flat dashed line until two samples exist. */
export function PnlSparkline({ series }: PnlSparklineProps) {
  if (series.length < 2) {
    return (
      <svg className="phone-sparkline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1);
  const y = (value: number) => HEIGHT - 2 - ((value - min) / range) * (HEIGHT - 4);
  const points = series.map((value, index) => `${((index / (series.length - 1)) * WIDTH).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="phone-sparkline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--pnl-line)" strokeWidth={1.5} />
    </svg>
  );
}
