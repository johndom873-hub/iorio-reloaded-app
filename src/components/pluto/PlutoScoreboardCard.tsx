import type { PlutoScoreboard } from "../../api/pluto";
import { formatDate, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { Spinner } from "../Spinner";

interface PlutoScoreboardCardProps {
  scoreboard: PlutoScoreboard | null;
  error: string | null;
}

function Figure({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="col-6 col-md-4 col-xl-2">
      <div className="text-muted text-uppercase" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>{label}</div>
      <div className="fw-bold font-monospace" style={{ fontSize: "1.1rem" }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: "0.75rem" }}>{sub}</div>}
    </div>
  );
}

/** Cumulative record since the first pass: is Pluto making money, and does it think like the Edge $ ranking. */
export function PlutoScoreboardCard({ scoreboard, error }: PlutoScoreboardCardProps) {
  const filled = (scoreboard?.outcomes.filled ?? 0) + (scoreboard?.outcomes.partially_filled ?? 0) + (scoreboard?.outcomes.cancelled_partially_filled ?? 0);
  const sent = filled + (scoreboard?.outcomes.cancelled ?? 0) + (scoreboard?.outcomes.rejected ?? 0) + (scoreboard?.outcomes.error ?? 0) + (scoreboard?.outcomes.confirmed ?? 0);
  const decided = scoreboard ? scoreboard.modelVsTopPick.agree + scoreboard.modelVsTopPick.disagree : 0;
  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h3 className="card-title m-0">Scoreboard</h3>
        <span className="text-muted" style={{ fontSize: "0.75rem" }}>{scoreboard?.since ? `since ${formatDate(scoreboard.since)}` : "no passes yet"}</span>
      </div>
      <div className="card-body">
        {error ? (
          <div className="alert alert-danger mb-0">{error}</div>
        ) : !scoreboard ? (
          <Spinner size="sm" label="Loading scoreboard" />
        ) : (
          <div className="row g-3">
            <Figure label="Realized" value={<span className={pnlTextClass(scoreboard.realizedPnl)}>{formatSignedPnl(scoreboard.realizedPnl)}</span>} sub={`${scoreboard.closedActions} closed · ${scoreboard.openActions} open`} />
            <Figure label="Hit rate" value={scoreboard.closedActions > 0 ? `${Math.round((scoreboard.winningActions / scoreboard.closedActions) * 100)}%` : "—"} sub={`${scoreboard.winningActions} of ${scoreboard.closedActions} closed made money`} />
            <Figure label="Pessimistic" value={<span className={pnlTextClass(scoreboard.pessimisticPnl)}>{formatSignedPnl(scoreboard.pessimisticPnl)}</span>} sub="fills vs the worse side of the market" />
            <Figure label="Orders" value={`${filled} / ${sent}`} sub={`filled of sent · ${scoreboard.outcomes.blocked ?? 0} blocked by gates`} />
            <Figure label="Model vs Edge $" value={decided > 0 ? `${Math.round((scoreboard.modelVsTopPick.agree / decided) * 100)}%` : "—"} sub={`agreed on ${scoreboard.modelVsTopPick.agree} of ${decided} trades · ${scoreboard.modelVsTopPick.noTrade} no-trade`} />
            <Figure label="Model cost" value={`$${scoreboard.costUsd.toFixed(2)}`} sub={`${scoreboard.modelCalls} calls over ${scoreboard.passes} passes`} />
          </div>
        )}
      </div>
    </div>
  );
}
