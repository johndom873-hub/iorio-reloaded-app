import { useState } from "react";
import type { PlutoPass } from "../../api/pluto";
import { PlutoChecksBoard } from "./PlutoChecksBoard";
import { formatHourMinute } from "../../lib/formatters";
import { describeCandidateId, describePlutoTrigger, passVerdict } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";

interface PlutoDecisionsProps {
  passes: PlutoPass[];
  loading: boolean;
  error: string | null;
}

/** What the model saw and said: one block per pass that called the model, newest first. */
export function PlutoDecisions({ passes, loading, error }: PlutoDecisionsProps) {
  const decided = passes.filter((pass) => pass.modelCalled);
  const [checksOpenFor, setChecksOpenFor] = useState<string | null>(null);
  return (
    <div className="card h-100">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h3 className="card-title m-0">Decisions</h3>
        <span className="text-muted" style={{ fontSize: "0.75rem" }}>what the model saw and said</span>
      </div>
      <div className="card-body" style={{ maxHeight: "34rem", overflowY: "auto" }}>
        {loading ? (
          <Spinner size="sm" label="Loading decisions" />
        ) : error ? (
          <div className="alert alert-danger mb-0">{error}</div>
        ) : decided.length === 0 ? (
          <div className="text-muted" style={{ fontSize: "0.85rem" }}>The model has not been asked anything yet.</div>
        ) : (
          decided.map((pass) => {
            const verdict = passVerdict(pass);
            const output = verdict.output;
            const isTrade = output?.decision === "trade";
            const failed = pass.decisions.find((decision) => decision.error);
            return (
              <div key={pass.id} className="py-2 border-bottom">
                <div className="d-flex flex-wrap align-items-center gap-2" style={{ fontSize: "0.85rem" }}>
                  <span className="font-monospace text-muted" style={{ fontSize: "0.75rem" }}>{formatHourMinute(pass.startedAt)}</span>
                  <span className={`badge ${isTrade ? "bg-success text-white" : failed ? "bg-danger-lt" : "bg-secondary-lt"}`} style={{ fontSize: "0.72rem" }}>{failed ? "failed" : (output?.decision ?? "—").replace("_", " ")}</span>
                  <span className="text-muted" style={{ fontSize: "0.78rem" }}>
                    {isTrade ? `${describeCandidateId(output?.candidateId)} · ${output?.sizeTier ?? "full"} · ` : ""}
                    {describePlutoTrigger(pass)} · confidence {output?.confidence !== undefined ? output.confidence.toFixed(2) : "—"} · {(verdict.latencyMs / 1000).toFixed(1)} s · ${(pass.costUsd ?? 0).toFixed(4)}
                    {pass.decisions.length >= 2 ? (verdict.agreed ? " · agreed" : " · disagreed") : ""}
                  </span>
                </div>
                {failed ? (
                  <div className="text-danger" style={{ fontSize: "0.8rem" }}>{failed.error}</div>
                ) : (
                  <ul className="mb-1 ps-3" style={{ fontSize: "0.82rem" }}>
                    {(output?.reasons ?? []).map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                    {(output?.risksAcknowledged ?? []).map((risk, index) => (
                      <li key={`risk-${index}`} className="text-muted">Risk acknowledged: {risk}</li>
                    ))}
                  </ul>
                )}
                <div className="d-flex flex-wrap gap-3 text-muted" style={{ fontSize: "0.78rem" }}>
                  <span>Model: <strong>{isTrade ? describeCandidateId(output?.candidateId) : (output?.decision ?? "—").replace("_", " ")}</strong></span>
                  {verdict.topPick && (
                    <span>
                      Edge $ top pick: <strong>{describeCandidateId(verdict.topPick.id)}, ${Math.round(verdict.topPick.edgeDollars)}</strong>
                      {isTrade && output?.candidateId === verdict.topPick.id ? " (agree)" : ""}
                    </span>
                  )}
                  {pass.servedModelIds.length > 0 && <span>{[...new Set(pass.servedModelIds)].join(", ")}</span>}
                  <button type="button" className="btn btn-link p-0 text-decoration-none" style={{ fontSize: "0.78rem" }} onClick={() => setChecksOpenFor(checksOpenFor === pass.id ? null : pass.id)}>
                    {checksOpenFor === pass.id ? "hide checks" : "checks"}
                  </button>
                </div>
                {checksOpenFor === pass.id && <div className="mt-1"><PlutoChecksBoard checks={pass.systemChecks} /></div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
