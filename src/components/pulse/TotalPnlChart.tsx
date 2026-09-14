import { useRef, useState } from "react";

// Pure/presentational — PulsePage owns the rolling-sample logic (a
// setInterval pushing the live sum of unrealizedPnl into a capped array).
// Starts empty and fills in as the tab stays open — no persisted intraday
// P&L history exists on the backend (approved tradeoff, 2026-09-13).
interface TotalPnlChartProps {
  series: number[];
  timestamps: number[];
  formatValue: (value: number) => string;
  formatTime: (timestamp: number) => string;
}

export function TotalPnlChart({ series, timestamps, formatValue, formatTime }: TotalPnlChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  if (series.length < 2) {
    return (
      <svg viewBox="0 0 300 100" preserveAspectRatio="none">
        <line x1={0} y1={50} x2={300} y2={50} stroke="var(--border-strong)" strokeWidth={0.6} strokeDasharray="3 3" />
      </svg>
    );
  }

  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const range = Math.max(max - min, 200);
  const pad = range * 0.15;
  const scaledMin = min - pad;
  const scaledMax = max + pad;
  const y = (value: number) => 95 - ((value - scaledMin) / (scaledMax - scaledMin)) * 90;
  const points = series.map((value, index) => `${(index / (series.length - 1)) * 300},${y(value).toFixed(1)}`).join(" ");
  const zeroY = y(0).toFixed(1);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(fraction * (series.length - 1)));
    setHoverX(fraction * 100);
  }

  const hoverValue = hoverIndex !== null ? series[hoverIndex] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%" }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none">
        <line x1={0} y1={zeroY} x2={300} y2={zeroY} stroke="var(--border-strong)" strokeWidth={0.6} strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="var(--accent-glow)" strokeWidth={0.9} />
        {hoverIndex !== null && (
          <>
            <line
              x1={(hoverIndex / (series.length - 1)) * 300}
              y1={0}
              x2={(hoverIndex / (series.length - 1)) * 300}
              y2={100}
              stroke="var(--text-muted)"
              strokeWidth={0.4}
            />
            <circle cx={(hoverIndex / (series.length - 1)) * 300} cy={y(series[hoverIndex]!)} r={2.2} fill="var(--accent-glow)" />
          </>
        )}
      </svg>
      {hoverValue !== null && hoverIndex !== null && (
        <div
          className="chart-tooltip"
          style={{ left: `${hoverX}%`, transform: hoverX > 80 ? "translateX(-100%)" : hoverX < 5 ? "translateX(0)" : "translateX(-50%)" }}
        >
          <div>{formatValue(hoverValue)}</div>
          <div className="chart-tooltip-time">{formatTime(timestamps[hoverIndex]!)}</div>
        </div>
      )}
    </div>
  );
}
