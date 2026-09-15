import { pickTimeAxisTicks } from "../../lib/chartTicks";
import { formatHourMinute } from "../../lib/formatters";

interface ChartTimeAxisProps {
  timestamps: number[];
}

// Shared bottom time axis for Pulse's hand-rolled SVG line charts (P&L,
// Position Deltas). Plain HTML/CSS row rather than SVG text — the charts'
// viewBox is stretched non-uniformly (preserveAspectRatio="none"), which
// would distort text placed inside the SVG itself.
export function ChartTimeAxis({ timestamps }: ChartTimeAxisProps) {
  if (timestamps.length < 2) return null;
  const ticks = pickTimeAxisTicks(timestamps);
  return (
    <div className="chart-time-axis">
      {ticks.map((tick, tickIndex) => (
        <span
          key={tick.index}
          className="chart-time-axis-label"
          style={{
            left: `${(tick.index / (timestamps.length - 1)) * 100}%`,
            transform: tickIndex === 0 ? "translateX(0)" : tickIndex === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {formatHourMinute(tick.timestamp)}
        </span>
      ))}
    </div>
  );
}
