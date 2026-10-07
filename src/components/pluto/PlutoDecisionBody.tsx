import { Link } from "react-router-dom";
import type { PlutoPass, PlutoState } from "../../api/pluto";
import { formatCurrency } from "../../lib/formatters";
import { checkLabel, checksAndGatesSummary, describeCandidateId, formatModelCost, orderedChecks, sentenceCase, describeChosenAction, describeOrderContract, describeTopPickComparison, formatExposure, gateLabel, passVerdict, verdictKind } from "../../lib/plutoPresentation";
import { CheckIcon, CrossIcon, ExternalIcon, GradeBadge, StrategyBadge } from "./plutoBits";

// The body of one model decision, shared by the Live tab's "Latest model decision" card and the History tab's
// expanded decision rows. Pure rendering of a pass; the parent decides the chrome around it.

function candidateFigures(pass: PlutoPass): { edgeDollars: number | null; grade: string | null } {
  const { action } = passVerdict(pass);
  const scores = (action?.candidateScores ?? null) as Record<string, unknown> | null;
  const edge = scores && typeof scores.edgeDollars === "number" ? scores.edgeDollars : scores && typeof scores.edge_dollars === "number" ? scores.edge_dollars : null;
  const grade = scores && typeof scores.grade === "string" ? scores.grade : null;
  return { edgeDollars: edge, grade };
}

function sizingNote(pass: PlutoPass): string | null {
  const { action } = passVerdict(pass);
  const sizing = action?.gateResults.find((gate) => gate.gate === "sizing");
  if (!sizing) return null;
  if (/volume share allows/.test(sizing.detail)) return "limited by how many contracts traded today";
  if (/budget left/.test(sizing.detail) && /→ 0 contract/.test(sizing.detail)) return "no room left in the budget";
  return null;
}

export function VerdictTag({ pass, size }: { pass: PlutoPass; size?: "sm" | "xs" }) {
  const kind = verdictKind(pass);
  const sizeClass = size ? ` ${size}` : "";
  if (kind === "failed") return <span className="pm-b bad">Failed</span>;
  if (kind === "order") return <span className={`pm-verdict-tag trade${sizeClass}`}>{size ? "Order" : "Place order"}</span>;
  return <span className={`pm-verdict-tag notrade${sizeClass}`}>No order</span>;
}

export function DecisionVerdictLine({ pass }: { pass: PlutoPass }) {
  const { action } = passVerdict(pass);
  const kind = verdictKind(pass);
  return (
    <div className="pm-verdict">
      <VerdictTag pass={pass} />
      {kind === "order" && action && <StrategyBadge kind={action.kind} contract={action.contract} />}
      <span className="pm-verdict-what">{kind === "failed" ? passVerdict(pass).error : describeChosenAction(pass)}</span>
    </div>
  );
}

export function ComparePanels({ pass, flush = false }: { pass: PlutoPass; flush?: boolean }) {
  const { output, action, topPick } = passVerdict(pass);
  const figures = candidateFigures(pass);
  const comparison = describeTopPickComparison(pass);
  const chosenTitle = action && action.kind !== "no_trade" ? describeOrderContract(action).title : null;
  // "MU roll $105 → $100 put", "COIN buy back $300 put · 10 Oct": a verb after the symbol reads in lower case.
  const chosenName = action && chosenTitle ? `${action.symbol} ${/^[A-Z][a-z]/.test(chosenTitle) ? chosenTitle.charAt(0).toLowerCase() + chosenTitle.slice(1) : chosenTitle}` : output?.candidate_id ? describeCandidateId(output.candidate_id) : "Nothing";
  return (
    <div className={`pm-compare${flush ? " flush" : ""}`}>
      <div>
        <div className="lbl">Model chose</div>
        <div className="val">{chosenName}</div>
        <div className="sub">
          {figures.edgeDollars !== null ? `Edge ${formatCurrency(figures.edgeDollars, 0)} per contract` : output?.confidence !== undefined ? `Confidence ${output.confidence.toFixed(2)}` : "—"}
          {figures.grade && <GradeBadge grade={figures.grade} />}
        </div>
      </div>
      <div>
        <div className="lbl">Edge $ top pick</div>
        <div className="val">{topPick ? describeCandidateId(topPick.id) : "—"}</div>
        <div className={`sub${comparison.tone === "ok" ? " t-ok" : comparison.tone === "warn" ? " t-warn" : ""}`}>
          {comparison.tone === "ok" && <CheckIcon />}
          {comparison.tone === "ok" ? "Same as the model" : topPick ? `${formatCurrency(topPick.edgeDollars, 0)} per contract` : comparison.text}
          {topPick?.grade && comparison.tone !== "ok" && <GradeBadge grade={topPick.grade} />}
        </div>
      </div>
    </div>
  );
}

export function ReasonsAndRisks({ pass, firstHeading = false }: { pass: PlutoPass; firstHeading?: boolean }) {
  const { output } = passVerdict(pass);
  const reasons = output?.reasons ?? [];
  const risks = output?.risks_acknowledged ?? [];
  const concerns = output?.system_concerns ?? [];
  return (
    <>
      <div className={`pm-h4${firstHeading ? " first" : ""}`}>Why</div>
      {reasons.length > 0 ? (
        <ul className="pm-reasons">
          {reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      ) : (
        <div className="muted">{passVerdict(pass).error ?? "The model gave no reasons."}</div>
      )}
      <div className="pm-h4">Risks it acknowledged</div>
      {risks.length > 0 ? (
        <ul className="pm-reasons muted">
          {risks.map((risk, index) => (
            <li key={index}>{risk}</li>
          ))}
        </ul>
      ) : (
        <div className="muted">None stated.</div>
      )}
      {concerns.length > 0 && (
        <>
          <div className="pm-h4">Data it distrusted</div>
          <ul className="pm-reasons muted">
            {concerns.map((entry, index) => (
              <li key={index}>
                <strong>{entry.symbol ?? "All data"}</strong> — {entry.concern}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function DecisionFacts({ pass, state, flush = false }: { pass: PlutoPass; state: PlutoState | null; flush?: boolean }) {
  const { output, action } = passVerdict(pass);
  const nlv = state?.book.netLiquidationValue ?? null;
  const orderSize = nlv === null || !state ? null : (((nlv * state.book.capitalBudgetPct) / 100) * state.book.orderSizePctOfBudget) / 100;
  const note = sizingNote(pass);
  return (
    <div className={`pm-facts${flush ? " flush" : ""}`}>
      {action && action.exposureDollars !== null && action.exposureDollars > 0 && (
        <span>
          Commits <b>{formatExposure(action.exposureDollars)}</b>
          {orderSize !== null ? ` of the ${formatCurrency(orderSize, 0)} order size` : ""}
          {note ? ` — ${note}` : ""}
        </span>
      )}
      {output?.confidence !== undefined && (
        <span>
          Confidence <b>{output.confidence.toFixed(2)}</b>
        </span>
      )}
      <span>
        Cost <b>{formatModelCost(pass.costUsd)}</b>
      </span>
    </div>
  );
}

export function CallFacts({ pass }: { pass: PlutoPass }) {
  const { call } = passVerdict(pass);
  return (
    <div className="pm-facts flush">
      {call?.latencyMs !== null && call?.latencyMs !== undefined && (
        <span>
          Answered in <b>{(call.latencyMs / 1000).toFixed(1)} s</b>
        </span>
      )}
      <span>
        Model <b>{call?.servedModelId ?? pass.servedModelIds[0] ?? "—"}</b>
      </span>
      {call?.serviceTier && (
        <span>
          Tier <b>{call.serviceTier}</b>
        </span>
      )}
      <span>
        Prompt <b>{pass.promptVersion ?? "—"}</b>
      </span>
      {call?.tokensIn !== null && call?.tokensIn !== undefined && (
        <span>
          Tokens <b>{call.tokensIn.toLocaleString()} in · {(call.tokensOut ?? 0).toLocaleString()} out</b>
        </span>
      )}
    </div>
  );
}

export function ChecksGrid({ pass, columns = 2 }: { pass: PlutoPass; columns?: 2 | 3 }) {
  const checks = orderedChecks(pass.systemChecks);
  if (checks.length === 0) return <div className="muted">No checks recorded.</div>;
  return (
    <div className={`pm-checks${columns === 2 ? " two" : ""}`}>
      {checks.map(([name, check]) => (
        <span key={name} className={`pm-check ${check.ok ? "ok" : "bad"}`} title={check.detail}>
          {check.ok ? <CheckIcon /> : <CrossIcon />}
          <span>
            {checkLabel(name)}
            {!check.ok && <small>{sentenceCase(check.detail)}</small>}
          </span>
        </span>
      ))}
    </div>
  );
}

export function GatesList({ pass }: { pass: PlutoPass }) {
  const { action } = passVerdict(pass);
  const gates = action?.gateResults ?? [];
  if (gates.length === 0) return <div className="muted">No gates ran: the model placed no order.</div>;
  return (
    <div>
      {gates.map((gate) => (
        <div key={gate.gate} className={`pm-gate${gate.ok ? "" : " bad"}`}>
          {gate.ok ? <CheckIcon /> : <CrossIcon />}
          <span className="name">{gateLabel(gate.gate)}</span>
          <span className="detail">{sentenceCase(gate.detail)}</span>
        </div>
      ))}
    </div>
  );
}

/** The History tab's expanded decision: two columns, every detail. */
export function DecisionDetails({ pass, state }: { pass: PlutoPass; state: PlutoState | null }) {
  const { action } = passVerdict(pass);
  const summary = checksAndGatesSummary(pass);
  return (
    <div className="pm-dec-body">
      <div>
        <ReasonsAndRisks pass={pass} firstHeading />
        <div className="pm-h4">The call</div>
        <DecisionFacts pass={pass} state={state} flush />
        <CallFacts pass={pass} />
        <div className="pm-h4">Checks before the model · {summary.checks.passed} of {summary.checks.total} passed</div>
        <ChecksGrid pass={pass} columns={2} />
      </div>
      <div>
        <ComparePanels pass={pass} flush />
        <div className="pm-h4">Gates after the model{summary.gates.total > 0 ? ` · ${summary.gates.passed} of ${summary.gates.total} passed` : ""}</div>
        <GatesList pass={pass} />
        {action?.orderRequestId && (
          <div className="mt-3">
            <Link className="pm-link" to={`/trade-blotter?order=${encodeURIComponent(action.orderRequestId)}`}>
              Open the order in the Trade Blotter
              <ExternalIcon />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
