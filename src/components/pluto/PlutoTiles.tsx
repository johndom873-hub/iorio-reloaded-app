import type { PlutoAction, PlutoState } from "../../api/pluto";
import { formatCompactDollars, formatHourMinute, formatPercentageValue } from "../../lib/formatters";
import { describePlutoActionContract, plutoActionKindLabel } from "../../lib/plutoPresentation";

interface PlutoTilesProps {
  state: PlutoState;
  workingActions: PlutoAction[];
  spyDayChangePct: number | null;
  spyStressPct: number;
}

function Tile({ label, value, children, meterPct }: { label: string; value: React.ReactNode; children?: React.ReactNode; meterPct?: number }) {
  return (
    <div className="col-12 col-sm-6 col-xl-3">
      <div className="card h-100">
        <div className="card-body py-3">
          <div className="text-muted text-uppercase" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>{label}</div>
          <div className="fw-bold font-monospace mt-1" style={{ fontSize: "1.35rem" }}>{value}</div>
          <div className="text-muted" style={{ fontSize: "0.78rem" }}>{children}</div>
          {meterPct !== undefined && (
            <div className="progress mt-2" style={{ height: "0.35rem" }}>
              <div className="progress-bar bg-primary" style={{ width: `${Math.max(0, Math.min(100, meterPct))}%` }} role="progressbar" aria-valuenow={Math.round(meterPct)} aria-valuemin={0} aria-valuemax={100} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlutoTiles({ state, workingActions, spyDayChangePct, spyStressPct }: PlutoTilesProps) {
  const { counters, book, session } = state;
  const budgetDollars = book.netLiquidationValue !== null ? (book.netLiquidationValue * book.capitalBudgetPct) / 100 : null;
  const usedPctOfNlv = book.netLiquidationValue ? (book.committedDollars / book.netLiquidationValue) * 100 : null;
  const meterPct = budgetDollars ? (book.committedDollars / budgetDollars) * 100 : 0;
  const working = workingActions[0];
  return (
    <div className="row g-3 mb-3">
      <Tile label="Today" value={<>{counters.actionsToday} <span className="text-muted fw-normal" style={{ fontSize: "0.78rem" }}>/ {counters.maxActionsPerSession} actions</span></>}>
        {counters.modelCallsToday} of {counters.maxModelCallsPerSession} model calls · ${counters.costTodayUsd.toFixed(2)} of ${counters.dailyCostCeilingUsd.toFixed(2)}
      </Tile>
      <Tile label="Pluto book" value={formatCompactDollars(book.committedDollars)} meterPct={meterPct}>
        {usedPctOfNlv !== null ? `${formatPercentageValue(usedPctOfNlv, 1)} of NLV used of the ${book.capitalBudgetPct}% budget` : "NLV unknown until the nightly snapshot"} · {book.openPositionCount} of {book.maxOpenPositions} positions
      </Tile>
      <Tile label="Orders" value={<>{state.orders.working} <span className="text-muted fw-normal" style={{ fontSize: "0.78rem" }}>working</span></>}>
        {working ? `${working.symbol} ${working.quantity ?? ""}× ${describePlutoActionContract(working)} ${plutoActionKindLabel(working)} sent ${formatHourMinute(working.createdAt)}` : state.orders.unsent > 0 ? `${state.orders.unsent} built, not yet sent` : "nothing working"}
      </Tile>
      <Tile label="Market" value={spyDayChangePct === null ? "SPY —" : `SPY ${spyDayChangePct >= 0 ? "+" : ""}${spyDayChangePct.toFixed(2)}%`}>
        Opens blocked at −{spyStressPct}% · closes {session.closeTimeEt} ET{session.closeTimeEt !== "16:00" ? ` · window ends ${session.windowEndEt}` : ""} · orders cancel by {session.cancelByEt}
      </Tile>
    </div>
  );
}
