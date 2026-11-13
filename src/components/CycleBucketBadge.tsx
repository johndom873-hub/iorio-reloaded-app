import type { CycleBucketKey } from "../api/positions";
import { StrategyBadge } from "./StrategyBadge";
import { strategyKeyOfCycleBucket } from "../lib/positionPnl";

// The cycle buckets are the strategies under their own short keys; the
// badge itself is the platform-wide StrategyBadge, so the scoreboard and the
// Cycle card can never disagree with Positions, Signals, etc.
export function CycleBucketBadge({ bucket }: { bucket: CycleBucketKey }) {
  return <StrategyBadge strategyKey={strategyKeyOfCycleBucket(bucket)} />;
}
