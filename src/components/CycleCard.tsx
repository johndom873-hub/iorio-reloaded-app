import { useEffect, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { CycleBucketBadge } from "./CycleBucketBadge";
import { Spinner } from "./Spinner";
import { fetchCycles, type Cycle } from "../api/positions";
import { formatCurrency, formatDate, formatSignedPnl, pnlTextClass } from "../lib/formatters";

// The symbol's wheel cycle (approved 2026-09-19): summary tiles + a dated timeline where every event is owned by
// exactly one bucket (CSP / Unstructured / CC). Figures are as of the latest daily close (open shares marked at it,
// open options at the last nightly snapshot), not live ticks.
export function CycleCard({ symbol }: { symbol: string }) {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setCycles(null);
    setFailed(false);
    setSelectedIndex(0);
    fetchCycles(symbol)
      .then((result) => setCycles(result.cycles))
      .catch(() => setFailed(true));
  }, [symbol]);

  if (cycles !== null && cycles.length === 0) return null;
  const cycle = cycles?.[selectedIndex];

  return (
    <CollapsibleCard
      title="Wheel cycle"
      storageKey="ticker-detail-cycle"
      defaultOpen={false}
    >
      {cycles === null && !failed && (
        <div className="d-flex justify-content-center py-2">
          <Spinner size="sm" label="Loading cycle" />
        </div>
      )}
      {failed && <div className="text-muted">Couldn't load the cycle.</div>}
      {cycle && (
        <div className="d-flex flex-column gap-3">
          <p className="text-muted mb-0" style={{ fontSize: "0.8rem" }}>
            Every event since this symbol's cycle began, owned by one strategy. Shares are marked at the latest daily close and open options at the last nightly snapshot.
          </p>
          {cycles!.length > 1 && (
            <select
              id="cycle-select"
              className="form-select"
              style={{ maxWidth: "24rem" }}
              value={selectedIndex}
              onChange={(event) => setSelectedIndex(Number(event.target.value))}
              aria-label="Cycle"
            >
              {cycles!.map((option, index) => (
                <option key={option.startAt} value={index}>
                  {formatDate(option.startAt)} – {option.endAt ? formatDate(option.endAt) : "now"} ({option.status})
                </option>
              ))}
            </select>
          )}

          {cycle.dataFlags.length > 0 && (
            <div className="alert alert-warning mb-0">
              Numbers for this cycle may be incomplete: {cycle.dataFlags.join("; ")}.
            </div>
          )}

          <div className="row g-3">
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Cycle P&amp;L</div>
              <div className={`fw-bold font-mono ${pnlTextClass(cycle.total)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(cycle.total)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Net premium</div>
              <div className={`fw-bold font-mono ${pnlTextClass(cycle.netPremium)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(cycle.netPremium)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Stock P&amp;L</div>
              {(() => {
                const stock = cycle.buckets.csp.stock + cycle.buckets.unstructured.stock + cycle.buckets.cc.stock;
                return <div className={`fw-bold font-mono ${pnlTextClass(stock)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(stock)}</div>;
              })()}
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Break-even</div>
              <div className="fw-bold font-mono" style={{ fontSize: "1.25rem" }}>
                {cycle.breakEvenPerShare === null ? "—" : cycle.breakEvenPerShare <= 0 ? "Free" : formatCurrency(cycle.breakEvenPerShare, 2)}
              </div>
            </div>
          </div>

          <div className="table-responsive border rounded">
            <table className="table table-sm table-vcenter card-table mb-0">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Owner</th>
                  <th className="text-end">Premium</th>
                  <th className="text-end">Stock</th>
                </tr>
              </thead>
              <tbody>
                {cycle.timeline.map((row, index) => (
                  <tr key={`${row.at ?? "now"}-${index}`}>
                    <td>{row.at ? formatDate(row.at) : "Today"}</td>
                    <td>{row.label}</td>
                    <td><CycleBucketBadge bucket={row.bucket} /></td>
                    <td className={`text-end font-mono ${row.premium === 0 ? "text-muted" : pnlTextClass(row.premium)}`}>{row.premium === 0 ? "—" : formatSignedPnl(row.premium)}</td>
                    <td className={`text-end font-mono ${row.stock === 0 ? "text-muted" : pnlTextClass(row.stock)}`}>{row.stock === 0 ? "—" : formatSignedPnl(row.stock)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="table-totals-row">
                <tr>
                  <td colSpan={3}>Cycle total</td>
                  <td className={`text-end font-mono ${pnlTextClass(cycle.netPremium)}`}>{formatSignedPnl(cycle.netPremium)}</td>
                  <td className={`text-end font-mono ${pnlTextClass(cycle.total - cycle.netPremium)}`}>{formatSignedPnl(cycle.total - cycle.netPremium)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
