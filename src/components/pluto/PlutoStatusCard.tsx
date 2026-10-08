import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { cancelOrder } from "../../api/positions";
import { pausePluto, resetPlutoBreaker, resumePluto, updatePlutoMode, updatePlutoStressOverride, type PlutoSettings, type PlutoState, type PlutoStateCore } from "../../api/pluto";
import { formatCompactDollarsTrimmed, formatCurrency, formatEasternTime, formatHoursMinutesUntil, pluralize, todayInEasternIso } from "../../lib/formatters";
import { checkLabel, describeOrderLine, formatAgeInWords, humanizeKey, orderedChecks, sentenceCase, spyStressFromState, type PlutoStatus } from "../../lib/plutoPresentation";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";
import { CheckIcon, CrossIcon, Meter, PauseIcon, PlayIcon, ResetIcon, StopIcon, WarningIcon } from "./plutoBits";

interface PlutoStatusCardProps {
  state: PlutoState;
  status: PlutoStatus;
  settings: PlutoSettings | null;
  now: Date;
  /** Phone layout: stacked controls, two KPI columns; the KPI strip is shown only on the Live tab. */
  isPhone: boolean;
  showKpis: boolean;
  onStateChanged: (state: PlutoStateCore) => void;
  onOrdersChanged: () => void;
}

type PendingAction = { kind: "turn_on" } | { kind: "pause_cancel" } | { kind: "resume" } | { kind: "reset"; name: string } | { kind: "cancel_working" } | { kind: "allow_stress" };

function workingOrdersLabel(count: number): string {
  return count === 1 ? "Cancel the working order" : `Cancel the ${count} working orders`;
}

export function PlutoStatusCard({ state, status, settings, now, isPhone, showKpis, onStateChanged, onOrdersChanged }: PlutoStatusCardProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState<"pause" | "off" | "modal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [alsoResume, setAlsoResume] = useState(true);
  const [showAllChecks, setShowAllChecks] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function close(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  async function run(work: () => Promise<PlutoStateCore | void>, kind: "pause" | "off" | "modal", fallback: string): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      const next = await work();
      if (next) onStateChanged(next);
      setPending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  async function cancelWorkingOrders(): Promise<void> {
    for (const order of state.workingOrders) await cancelOrder(order.orderRequestId);
    onOrdersChanged();
  }

  const isOn = state.mode === "on";
  const breakerNames = Object.keys(state.breakers);
  const working = state.workingOrders;
  const stress = spyStressFromState(state);
  const stressOverrideOn = state.stressOverrideDate === todayInEasternIso();
  const session = state.session;
  const tickers = state.enabledTickers.count;

  // ---- Controls per state ----
  const masterSwitch = (
    <div className="pm-master">
      <span className="pm-master-label">Pluto</span>
      <div className="pm-seg" role="group" aria-label="Pluto on or off">
        <button type="button" className={isOn ? "" : "on"} disabled={busy !== null} aria-pressed={!isOn} onClick={() => (isOn ? void run(() => updatePlutoMode("off"), "off", "Could not switch Pluto off.") : undefined)}>
          {busy === "off" && <Spinner size="sm" />}
          Off
        </button>
        <button type="button" className={isOn ? "on good" : ""} disabled={busy !== null} aria-pressed={isOn} onClick={() => (isOn ? undefined : (setAlsoResume(true), setPending({ kind: "turn_on" })))}>
          {isOn && <span className="dot" aria-hidden="true" />}
          On
        </button>
      </div>
    </div>
  );

  const cancelWorkingButton = working.length > 0 && (
    <button type="button" className={`pm-btn danger${isPhone ? " full" : ""}`} disabled={busy !== null} onClick={() => setPending({ kind: "cancel_working" })}>
      {workingOrdersLabel(working.length)}
    </button>
  );

  const pauseSplit = (
    <div className="pm-split" ref={menuRef}>
      <button type="button" className="pm-btn" disabled={busy !== null} onClick={() => void run(() => pausePluto(false), "pause", "Could not pause Pluto.")}>
        {busy === "pause" ? <Spinner size="sm" /> : <PauseIcon />}
        Pause
      </button>
      <button type="button" className={`pm-btn caret${menuOpen ? " open" : ""}`} aria-label="More ways to pause" aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy !== null} onClick={() => setMenuOpen((open) => !open)}>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={menuOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {menuOpen && (
        <div className="pm-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void run(() => pausePluto(false), "pause", "Could not pause Pluto."); }}>
            <PauseIcon />
            <span>
              Pause
              <small>Stops analysing and placing orders. Orders already working are left alone.</small>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPending({ kind: "pause_cancel" }); }}>
            <StopIcon className="ic t-bad" />
            <span>
              Pause and cancel working orders
              <small>{working.length === 0 ? "No orders are working right now, so this is a plain pause." : `Also asks IBKR to cancel the ${pluralize(working.length, "working order")} (${working.map((order) => order.symbol).join(", ")}).`}</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );

  const resumeButton = (
    <button type="button" className={`pm-btn primary${isPhone ? " full" : ""}${status.kind === "stopped" ? " disabled" : ""}`} disabled={busy !== null || status.kind === "stopped"} title={status.kind === "stopped" ? "Reset the breaker first" : undefined} onClick={() => setPending({ kind: "resume" })}>
      <PlayIcon />
      Resume
    </button>
  );

  let controls: ReactNode;
  if (status.kind === "off" || status.kind === "offline") controls = cancelWorkingButton;
  else if (status.kind === "paused") controls = (<>{cancelWorkingButton}{resumeButton}</>);
  else if (status.kind === "stopped") controls = resumeButton;
  else controls = pauseSplit;

  // ---- Modals ----
  let modal: ReactNode = null;
  if (pending?.kind === "turn_on") {
    const pausedByBreaker = breakerNames.length > 0;
    modal = (
      <ConfirmModal
        title="Turn Pluto on?"
        danger={false}
        confirmLabel={state.paused && alsoResume && !pausedByBreaker ? "Turn on and resume" : "Turn on"}
        confirming={busy === "modal"}
        message={
          <>
            Pluto will analyse and trade the {pluralize(tickers, "allowed ticker")} on its own. Every order still goes through the platform's order checks.
            {state.paused && !pausedByBreaker && (
              <label className="pm-check-row">
                <input type="checkbox" checked={alsoResume} onChange={(event) => setAlsoResume(event.target.checked)} />
                <span>
                  <span className="strong">Also resume</span>
                  <span className="pm-help d-block">{state.pauseReason === "deploy" ? "Pluto is paused after an update and the new version hasn't traded yet." : state.pauseReason === "crash_loop" ? "Pluto paused itself after repeated restarts." : `Pluto is paused${state.pausedByDisplayName ? ` by ${state.pausedByDisplayName}` : ""}.`} Untick to turn on but stay paused.</span>
                </span>
              </label>
            )}
            {pausedByBreaker && <div className="pm-help mt-3">A safety breaker is tripped: Pluto stays stopped after turning on until the breaker is reset and Pluto resumed.</div>}
          </>
        }
        onCancel={() => setPending(null)}
        onConfirm={() =>
          void run(
            async () => {
              let next = await updatePlutoMode("on");
              if (state.paused && alsoResume && !pausedByBreaker) next = await resumePluto();
              return next;
            },
            "modal",
            "Could not turn Pluto on.",
          )
        }
      />
    );
  } else if (pending?.kind === "pause_cancel") {
    modal = (
      <ConfirmModal
        title="Pause and cancel working orders?"
        confirmLabel="Pause and cancel"
        confirming={busy === "modal"}
        message={working.length === 0 ? <>No orders are working right now, so Pluto simply pauses. Orders not yet sent are dropped.</> : <>Pluto pauses, orders not yet sent are dropped and IBKR is asked to cancel the {pluralize(working.length, "working order")} ({working.map((order) => describeOrderLine(order, order.limitPrice)).join("; ")}).</>}
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
        message={<>Pluto starts analysing and placing orders again{isOn ? "" : " once switched on"}.{state.pauseReason === "deploy" ? " This version hasn't traded yet." : ""}{state.pauseReason === "crash_loop" ? " It restarted repeatedly before pausing — check what went wrong first." : ""}</>}
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
  } else if (pending?.kind === "cancel_working") {
    modal = (
      <ConfirmModal
        title={working.length === 1 ? "Cancel the working order?" : `Cancel the ${working.length} working orders?`}
        confirmLabel={working.length === 1 ? "Cancel the order" : "Cancel the orders"}
        confirming={busy === "modal"}
        message={<>IBKR is asked to cancel {working.map((order) => describeOrderLine(order, order.limitPrice)).join("; ")}. Anything already filled stays filled.</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => cancelWorkingOrders(), "modal", "Could not cancel the working orders.")}
      />
    );
  } else if (pending?.kind === "allow_stress") {
    modal = (
      <ConfirmModal
        title="Allow new positions today?"
        confirmLabel="Allow for today"
        confirming={busy === "modal"}
        message={<>The SPY stress check stops blocking new positions for the rest of today's session. Rolls, closes and every other check stay as they are. The override clears itself tomorrow.</>}
        onCancel={() => setPending(null)}
        onConfirm={() => void run(() => updatePlutoStressOverride(true), "modal", "Could not change the stress override.")}
      />
    );
  }

  // ---- KPI figures ----
  const nlv = state.book.netLiquidationValue;
  const budget = nlv === null ? null : (nlv * state.book.capitalBudgetPct) / 100;
  const orderSize = budget === null ? null : (budget * state.book.orderSizePctOfBudget) / 100;
  const ordersMax = state.counters.maxActionsPerSession;
  const costMax = state.counters.dailyCostCeilingUsd;
  const windowStartMs = new Date(session.windowStartAt).getTime();
  const windowEndMs = new Date(session.windowEndAt).getTime();
  const windowSub = !session.isOpen ? "Market closed today" : now.getTime() < windowStartMs ? `Starts in ${formatHoursMinutesUntil(session.windowStartAt, now)} · market closes ${session.closeTimeEt}` : now.getTime() < windowEndMs ? `${formatHoursMinutesUntil(session.windowEndAt, now)} left · market closes ${session.closeTimeEt}` : `Closed for today · market closes ${session.closeTimeEt}`;
  const firstWorking = working[0] ?? null;
  const workingSub = firstWorking ? `${describeOrderLine(firstWorking, firstWorking.limitPrice)} · ${formatAgeInWords(firstWorking.createdAt, now)}${working.length > 1 ? ` · +${working.length - 1} more` : ""}` : "None at IBKR";

  const subline = isPhone && !showKpis ? `${state.ordersToday.sent} of ${ordersMax} orders today · ${working.length} working` : status.subline;

  return (
    <>
      <section className={`pm-card${status.kind === "stopped" ? " danger" : ""}`} aria-label="Pluto status">
        <div className="pm-cmd-top">
          <span className={`pm-state ${status.kind}`}>
            <span className="dot" aria-hidden="true" />
            {status.label}
          </span>
          <div className="pm-cmd-text">
            <div className="pm-cmd-headline">{status.headline}</div>
            <div className="pm-cmd-sub">
              <span>{subline}</span>
            </div>
          </div>
          {isPhone ? (
            <div className="pm-m-ctl">
              {controls}
              {masterSwitch}
            </div>
          ) : (
            <div className="pm-cmd-actions">
              {controls}
              {controls && <span className="pm-vdiv" aria-hidden="true" />}
              {masterSwitch}
            </div>
          )}
        </div>
        {error && <div className="pm-cmd-error" role="alert">{error}</div>}

        {status.kind === "stopped" &&
          breakerNames.map((name) => (
            <div className="pm-cmd-alert" key={name}>
              <div className="pm-alert">
                <WarningIcon className="ic lg" />
                <div className="pm-alert-body">
                  <div className="pm-alert-title">{humanizeKey(name)} breaker · tripped {formatEasternTime(state.breakers[name]!.trippedAt)}</div>
                  <div className="pm-alert-text">{state.breakers[name]!.detail}</div>
                </div>
                <button type="button" className="pm-btn danger" disabled={busy !== null} onClick={() => setPending({ kind: "reset", name })}>
                  <ResetIcon />
                  Reset breaker
                </button>
              </div>
            </div>
          ))}

        {status.kind === "held" && status.holdAlert && (
          <div className="pm-cmd-alert">
            <div className="pm-alert warn">
              <WarningIcon className="ic lg" />
              <div className="pm-alert-body">
                <div className="pm-alert-title">{status.holdAlert.title}</div>
                <div className="pm-alert-text">{status.holdAlert.text}</div>
              </div>
              {state.lastChecks && (
                <button type="button" className="pm-link" onClick={() => setShowAllChecks((open) => !open)}>
                  {showAllChecks ? "Hide checks" : "All checks"}
                </button>
              )}
            </div>
            {showAllChecks && state.lastChecks && (
              <div className="pm-checks mt-3">
                {orderedChecks(state.lastChecks.checks).map(([name, check]) => (
                  <span key={name} className={`pm-check ${check.ok ? "ok" : "bad"}`}>
                    {check.ok ? <CheckIcon /> : <CrossIcon />}
                    <span>
                      {checkLabel(name)}
                      <small>{sentenceCase(check.detail)}</small>
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {(status.kind === "running" || status.kind === "held") && stress && (stress.blocking || stressOverrideOn) && (
          <div className="pm-cmd-banner">
            <WarningIcon />
            <span className="body">
              {stressOverrideOn ? (
                <>
                  <span className="strong">New positions allowed today despite SPY stress</span> <span className="muted">(allowed{state.stressOverrideByDisplayName ? ` by ${state.stressOverrideByDisplayName}` : ""}; clears itself tomorrow).</span>
                </>
              ) : (
                <>
                  <span className="strong">No new positions while SPY is down {stress.spyDayChangePct === null ? "" : `${Math.abs(stress.spyDayChangePct).toFixed(1)}% `}today</span>{" "}
                  <span className="muted">(the limit is {settings?.spyStressBreakerPct ?? "—"}%). Rolls and closes continue. Lifts by itself if SPY recovers.</span>
                </>
              )}
            </span>
            {stressOverrideOn ? (
              <button type="button" className="pm-btn sm" disabled={busy !== null} onClick={() => void run(() => updatePlutoStressOverride(false), "modal", "Could not remove the override.")}>
                Block again
              </button>
            ) : (
              <button type="button" className="pm-btn sm" disabled={busy !== null} onClick={() => setPending({ kind: "allow_stress" })}>
                Allow new positions today
              </button>
            )}
          </div>
        )}

        {showKpis && (
          <div className="pm-kpis">
            <div className="pm-kpi">
              <div className="pm-kpi-l">Orders today</div>
              <div className="pm-kpi-v">
                {state.ordersToday.sent} <small>of {ordersMax}{isPhone ? "" : " allowed"}</small>
              </div>
              <Meter pct={(state.ordersToday.sent / Math.max(1, ordersMax)) * 100} warn={state.ordersToday.sent >= ordersMax} />
              <div className="pm-kpi-s">
                {state.ordersToday.filled} filled · {state.ordersToday.working} working{state.ordersToday.blocked > 0 ? ` · ${state.ordersToday.blocked} blocked` : ""}
              </div>
            </div>
            <div className="pm-kpi">
              <div className="pm-kpi-l">{isPhone ? "Capital in use" : "Pluto's capital in use"}</div>
              <div className="pm-kpi-v">
                {formatCompactDollarsTrimmed(state.book.committedDollars)} <small>of {budget === null ? "—" : formatCompactDollarsTrimmed(budget).replace(/^\$/, isPhone ? "" : "$")}</small>
              </div>
              <Meter pct={budget ? (state.book.committedDollars / budget) * 100 : 0} />
              <div className="pm-kpi-s">
                {pluralize(state.book.openPositionCount, "managed position")}
                {!isPhone && orderSize !== null ? ` · order size ${formatCompactDollarsTrimmed(orderSize)}` : ""}
              </div>
            </div>
            <div className="pm-kpi">
              <div className="pm-kpi-l">{isPhone ? "Working" : "Working orders"}</div>
              <div className="pm-kpi-v">{working.length}</div>
              <div className="pm-kpi-s spaced">{workingSub}</div>
            </div>
            <div className="pm-kpi">
              <div className="pm-kpi-l">{isPhone ? "Model spend" : "Model spend today"}</div>
              <div className="pm-kpi-v">
                {formatCurrency(state.counters.costTodayUsd, 2)} <small>of {isPhone ? `$${costMax}` : formatCurrency(costMax, 2)}</small>
              </div>
              <Meter pct={(state.counters.costTodayUsd / Math.max(0.01, costMax)) * 100} warn={state.counters.costTodayUsd >= costMax} />
              <div className="pm-kpi-s">{pluralize(state.counters.modelCallsToday, "call")}</div>
            </div>
            <div className={`pm-kpi${isPhone ? " wide" : ""}`}>
              <div className="pm-kpi-l">Trading window</div>
              <div className="pm-kpi-v">
                {session.windowStartEt}–{session.windowEndEt} <small>ET{isPhone ? ` · ${windowSub.split(" · ")[0]}` : ""}</small>
              </div>
              {!isPhone && <div className="pm-kpi-s spaced">{windowSub}</div>}
            </div>
          </div>
        )}
      </section>
      {modal}
    </>
  );
}
