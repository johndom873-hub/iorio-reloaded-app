import type { CycleBucketKey } from "../api/positions";

// One place for the three cycle buckets' label + colour, shared by the Cycle card and the scoreboard.
export const cycleBucketLabel: Record<CycleBucketKey, string> = {
  csp: "CSP",
  unstructured: "Unstructured",
  cc: "CC",
};

const cycleBucketBadgeClass: Record<CycleBucketKey, string> = {
  csp: "bg-purple text-white",
  unstructured: "bg-orange-lt",
  cc: "bg-blue text-white",
};

export function CycleBucketBadge({ bucket }: { bucket: CycleBucketKey }) {
  return (
    <span className={`badge ${cycleBucketBadgeClass[bucket]}`} style={{ fontSize: "0.72rem" }}>
      {cycleBucketLabel[bucket]}
    </span>
  );
}
