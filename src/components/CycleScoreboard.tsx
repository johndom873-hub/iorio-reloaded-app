import { useEffect, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { CycleBucketBadge } from "./CycleBucketBadge";
import { Spinner } from "./Spinner";
import { fetchCycleScoreboard, type CycleBucketKey, type CycleScoreboard as CycleScoreboardData } from "../api/positions";
import { formatSignedPnl, pnlTextClass } from "../lib/formatters";

const bucketOrder: CycleBucketKey[] = ["csp", "unstructured", "cc"];

// Fair strategy scoreboard (approved 2026-09-19): every wheel cycle attributed to CSP / Unstructured / CC. The
// "Premium only" column is the old view where a put looks like free money; the fair view charges it for the
// assignment (assignment-day close vs strike) and gives each strategy only what happened while it held the shares.
export function CycleScoreboard() {
  const [data, setData] = useState<CycleScoreboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchCycleScoreboard().then(setData).catch(() => setFailed(true));
  }, []);

  return (
    <CollapsibleCard
      className="mt-3 mb-3"
      title="Profit & Loss"
      storageKey="positions-cycle-scoreboard"
      defaultOpen={false}
    >
      {data === null && !failed && (
        <div className="d-flex justify-content-center py-2">
          <Spinner size="sm" label="Loading scoreboard" />
        </div>
      )}
      {failed && <div className="text-muted">Couldn't load the scoreboard.</div>}
      {data && (
        <>
          <div className="table-responsive table-flush">
            <table className="table table-sm table-vcenter card-table mb-0">
              <thead className="table-light">
                <tr>
                  <th>Strategy</th>
                  <th className="text-end" title="Premium collected, net of commissions — the old view">Premium</th>
                  <th className="text-end" title="Assignment charge (puts) or stock P&L while the strategy held the shares">Stock</th>
                  <th className="text-end">Total</th>
                </tr>
              </thead>
              <tbody>
                {bucketOrder.map((bucket) => {
                  const row = data.buckets[bucket];
                  return (
                    <tr key={bucket}>
                      <td><CycleBucketBadge bucket={bucket} /></td>
                      <td className="text-end font-mono">{row.premium === 0 ? "—" : formatSignedPnl(row.premium)}</td>
                      <td className={`text-end font-mono ${pnlTextClass(row.stock)}`}>{row.stock === 0 ? "—" : formatSignedPnl(row.stock)}</td>
                      <td className={`text-end font-mono fw-bold ${pnlTextClass(row.total)}`}>{formatSignedPnl(row.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="table-totals-row">
                <tr>
                  <td>Total</td>
                  <td className="text-end font-mono">{formatSignedPnl(data.buckets.csp.premium + data.buckets.cc.premium)}</td>
                  <td className={`text-end font-mono ${pnlTextClass(data.buckets.csp.stock + data.buckets.unstructured.stock + data.buckets.cc.stock)}`}>
                    {formatSignedPnl(data.buckets.csp.stock + data.buckets.unstructured.stock + data.buckets.cc.stock)}
                  </td>
                  <td className={`text-end font-mono ${pnlTextClass(data.total)}`}>{formatSignedPnl(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.cyclesExcluded.length > 0 && (
            <div className="text-muted" style={{ fontSize: "0.8rem", marginTop: "calc(var(--tblr-card-spacer-y) + 0.5rem)" }}>
              {data.cyclesExcluded.length} cycle(s) left out because their fills are incomplete: {data.cyclesExcluded.map((item) => `${item.symbol} (${item.reason})`).join("; ")}.
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
