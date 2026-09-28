import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { pausePluto, resetPlutoBreaker, resumePluto, updatePlutoMode, type PlutoState, type PlutoStateCore } from "../../api/pluto";
import { formatDateTime, formatRelativeTime } from "../../lib/formatters";
import { humanizeKey } from "../../lib/plutoPresentation";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";

interface PlutoControlCardProps {
  state: PlutoState;
  onStateChanged: (state: PlutoStateCore) => void;
}

type PendingAction = { kind: "mode"; mode: "on" | "off" } | { kind: "pause_cancel" } | { kind: "resume" } | { kind: "reset"; name: string };

function statusTitle(state: PlutoState): { title: string; badgeClass: string; badgeLabel: string } {
  if (state.mode === "off") return { title: "Off", badgeClass: "bg-secondary text-white", badgeLabel: "OFF" };
  if (Object.keys(state.breakers).length > 0) return { title: "Breaker tripped", badgeClass: "bg-danger text-white", badgeLabel: "TRIPPED" };
  if (state.paused) return { title: "Paused", badgeClass: "bg-warning text-white", badgeLabel: "PAUSED" };
  return { title: "Running", badgeClass: "bg-success text-white", badgeLabel: "ON" };
}

function pauseDescription(state: PlutoState): string {
  if (!state.paused) return "";
  const who = state.pausedByDisplayName ? ` by ${state.pausedByDisplayName}` : "";
  const when = state.pausedAt ? ` ${formatRelativeTime(state.pausedAt) ?? formatDateTime(state.pausedAt)}` : "";
  if (state.pauseReason === "deploy") return `Paused after a deploy${when}. Resume once you are happy with the release.`;
  if (state.pauseReason === "crash_loop") return `Paused after a crash loop${when}. Check the agent's logs before resuming.`;
  if (state.pauseReason?.startsWith("breaker:")) return `Paused by the ${humanizeKey(state.pauseReason.slice("breaker:".length)).toLowerCase()} breaker${when}.`;
  return `Paused${who}${when}.`;
}

export function PlutoControlCard({ state, onStateChanged }: PlutoControlCardProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState<"pause" | "modal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<PlutoStateCore>, kind: "pause" | "modal", fallback: string): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      onStateChanged(await work());
      setPending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  const status = statusTitle(state);
  const breakerNames = Object.keys(state.breakers);
  const isOn = state.mode === "on";
  const canResume = state.paused && breakerNames.length === 0;
  const session = state.session;
  const closeSourceLabel = session.closeSource === "ibkr_liquid_hours" ? "IBKR liquid hours" : session.closeSource === "fallback_list" ? "fallback list, IBKR not read yet" : "assumed, IBKR not read yet";
  const fullDay = session.closeTimeEt === "16:00";

  let modal: ReactNode = null;
  if (pending?.kind === "mode") {
    modal = (
      <ConfirmModal
        title={pending.mode === "on" ? "Switch Pluto on?" : "Switch Pluto off?"}
        danger={pending.mode === "off"}
        confirmLabel={pending.mode === "on" ? "Switch on" : "Switch off"}
        confirming={busy === "modal"}
        message={pending.mode === "on" ? <>Pluto will trade the enabled tickers on its own{state.paused ? " once resumed" : ""}. Every order still goes through the platform's confirm gates.</> : <>Pluto stops acting. Working orders are left alone; use Pause and cancel to pull them.</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => updatePlutoMode(pending.mode), "modal", "Could not change the mode.")}
      />
    );
  } else if (pending?.kind === "pause_cancel") {
    modal = (
      <ConfirmModal
        title="Pause and cancel working orders?"
        confirmLabel="Pause and cancel"
        confirming={busy === "modal"}
        message={<>Pluto pauses, unsent orders are dropped and a cancel is requested for {state.orders.working} working order{state.orders.working === 1 ? "" : "s"} at IBKR.</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => pausePluto(true), "modal", "Could not pause Pluto.")}
      />
    );
  } else if (pending?.kind === "resume") {
    modal = (
      <ConfirmModal
        title="Resume Pluto?"
        danger={false}
        confirmLabel="Resume"
        confirming={busy === "modal"}
        message={<>Pluto starts acting again{isOn ? "" : " once switched on"}. {state.pauseReason === "deploy" ? "This release has not traded yet." : ""}</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => resumePluto(), "modal", "Could not resume Pluto.")}
      />
    );
  } else if (pending?.kind === "reset") {
    modal = (
      <ConfirmModal
        title={`Reset the ${humanizeKey(pending.name).toLowerCase()} breaker?`}
        confirmLabel="Reset breaker"
        confirming={busy === "modal"}
        message={<>Clears the trip and records who did it. Pluto stays paused until you press Resume; nothing is retried.</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => resetPlutoBreaker(pending.name), "modal", "Could not reset the breaker.")}
      />
    );
  }

  return (
    <>
      <div className={`card mb-3${breakerNames.length > 0 ? " border-danger" : ""}`}>
        <div className="card-body">
          <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
            <div>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <h3 className="card-title m-0">{status.title}</h3>
                <span className={`badge ${status.badgeClass}`} style={{ fontSize: "0.72rem" }}>{status.badgeLabel}</span>
                <span className="badge bg-azure-lt" style={{ fontSize: "0.72rem" }}>{state.enabledTickers.count} of {state.enabledTickers.max} tickers enabled</span>
                <span className="badge bg-secondary-lt" style={{ fontSize: "0.72rem" }}>Window {session.windowStartEt}–{session.windowEndEt} ET</span>
                <span className={`badge ${fullDay ? "bg-secondary-lt" : "bg-warning-lt"}`} style={{ fontSize: "0.72rem" }}>
                  Session closes {session.closeTimeEt} ET · {fullDay ? "full day" : "early close"} ({closeSourceLabel}{session.closeReadAt ? `, read ${formatRelativeTime(session.closeReadAt) ?? formatDateTime(session.closeReadAt)}` : ""})
                </span>
              </div>
              <div className="text-muted mt-1" style={{ fontSize: "0.8rem" }}>
                {state.paused ? pauseDescription(state) : state.mode === "off" ? "Pluto is off. Switch it on and resume to let it trade." : `Acting on its own inside the window. Last pass ${state.lastPassAt ? formatRelativeTime(state.lastPassAt) ?? formatDateTime(state.lastPassAt) : "not yet"}.`}
                {state.agent ? ` Agent heartbeat ${state.agent.heartbeatAgeSeconds} s ago${state.agent.gitSha ? ` · release ${state.agent.gitSha}` : ""}${state.agent.connected ? "" : " · IBKR disconnected"}.` : " Agent process not seen yet."}
              </div>
              {error && <div className="text-danger mt-1" style={{ fontSize: "0.8rem" }}>{error}</div>}
            </div>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <label className="form-check form-switch m-0 d-inline-flex align-items-center gap-2" style={{ cursor: "pointer" }}>
                <input className="form-check-input m-0" type="checkbox" role="switch" checked={isOn} onChange={() => setPending({ kind: "mode", mode: isOn ? "off" : "on" })} aria-label="Pluto mode" />
                <span style={{ fontSize: "0.85rem" }}>Mode {isOn ? "on" : "off"}</span>
              </label>
              <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-1" disabled={state.paused || busy !== null} onClick={() => void run(() => pausePluto(false), "pause", "Could not pause Pluto.")}>
                {busy === "pause" && <Spinner size="sm" />}
                Pause
              </button>
              <button type="button" className="btn btn-outline-danger" disabled={busy !== null || (state.paused && state.orders.working === 0)} onClick={() => setPending({ kind: "pause_cancel" })}>
                Pause and cancel working orders
              </button>
              <button type="button" className="btn btn-success" disabled={!canResume || busy !== null} onClick={() => setPending({ kind: "resume" })}>
                Resume
              </button>
            </div>
          </div>
          {breakerNames.map((name) => (
            <div key={name} className="alert alert-danger d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 mt-3 mb-0">
              <div>
                <strong>Circuit breaker tripped: {humanizeKey(name).toLowerCase()}</strong> — {state.breakers[name]!.detail} ({formatRelativeTime(state.breakers[name]!.trippedAt) ?? formatDateTime(state.breakers[name]!.trippedAt)}). Pluto is paused until a human resets it.
              </div>
              <button type="button" className="btn btn-outline-danger text-nowrap" disabled={busy !== null} onClick={() => setPending({ kind: "reset", name })}>
                Reset breaker
              </button>
            </div>
          ))}
        </div>
      </div>
      {modal}
    </>
  );
}
