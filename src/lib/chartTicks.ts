export interface TimeAxisTick {
  index: number;
  timestamp: number;
}

// Picks up to maxTicks ticks evenly spaced across the actual TIME range for
// a chart's x-axis (not evenly spaced by array index) — samples aren't
// guaranteed to land at a fixed cadence (a backgrounded browser tab throttles
// setInterval, so real gaps are expected), so evenly-spaced indices can
// bunch several ticks into a few seconds of each other (rendering as
// visually duplicate labels) while leaving a large real time gap elsewhere
// unlabeled. Shared by Pulse's hand-rolled SVG line charts (TotalPnlChart,
// ProfitProbabilityChart).
export function pickTimeAxisTicks(timestamps: number[], maxTicks = 6): TimeAxisTick[] {
  if (timestamps.length === 0) return [];
  if (timestamps.length <= maxTicks) return timestamps.map((timestamp, index) => ({ index, timestamp }));

  const first = timestamps[0]!;
  const last = timestamps[timestamps.length - 1]!;
  const ticks: TimeAxisTick[] = [];
  const seenIndices = new Set<number>();
  for (let i = 0; i < maxTicks; i++) {
    const targetTime = first + ((last - first) * i) / (maxTicks - 1);
    let nearestIndex = 0;
    let nearestDiff = Infinity;
    for (let index = 0; index < timestamps.length; index++) {
      const diff = Math.abs(timestamps[index]! - targetTime);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestIndex = index;
      }
    }
    if (seenIndices.has(nearestIndex)) continue;
    seenIndices.add(nearestIndex);
    ticks.push({ index: nearestIndex, timestamp: timestamps[nearestIndex]! });
  }
  return ticks;
}
