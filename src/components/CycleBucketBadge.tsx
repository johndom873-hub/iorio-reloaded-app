import type { CycleBucketKey, PositionStrategyKey } from "../api/positions";
import { StrategyBadge } from "./StrategyBadge";

// The cycle buckets are the strategies under their own short keys; the
// badge itself is the platform-wide StrategyBadge, so the scoreboard and the
// Cycle card can never disagree with Positions, Signals, etc.
const strategyKeyByBucket: Record<CycleBucketKey, PositionStrategyKey> = {
  csp: "cash_secured_put",
  unstructured: "unstructured",
  cc: "covered_call",
  hedge: "hedge",
};

export function CycleBucketBadge({ bucket }: { bucket: CycleBucketKey }) {
  return <StrategyBadge strategyKey={strategyKeyByBucket[bucket]} />;
}
