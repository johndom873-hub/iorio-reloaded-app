import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  openTickerBackfillStream,
  retryTickerBackfill,
  type BackfillStep,
  type BackfillStepKey,
  type TickerBackfillRun,
} from "../../api/shortlist";
import { Spinner } from "../Spinner";

interface TickerPrepModalProps {
  tickerId: string;
  symbol: string;
  companyName: string | null;
  /** Latest run state, pushed to the parent so the shortlist badge and rows stay current. */
  onRunChange: (run: TickerBackfillRun | null) => void;
  onClose: () => void;
}

// Shown for the step that is running until the server sends its own message.
const runningStepMessage: Record<BackfillStepKey, string> = {
  history: "Fetching five years of daily prices…",
  calendar: "Looking up upcoming events…",
  chain_warmup: "Checking which strikes exist…",
  first_snapshot: "Capturing option quotes…",
};

function StepIcon({ status }: { status: BackfillStep["status"] }) {
  if (status === "done") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--prep-success)" />
        <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--prep-danger)" />
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--prep-skip)" />
        <path d="M7.5 12h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <svg className="prep-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="var(--prep-track)" strokeWidth="3" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--prep-primary)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="var(--prep-track)" strokeWidth="2.5" />
    </svg>
  );
}

function isFinishedStep(step: BackfillStep): boolean {
  return step.status === "done" || step.status === "skipped" || step.status === "failed";
}

// Informational modal (progress display, no destructive action): closes on
// backdrop click and Esc, per the app's convention. Closing never stops the
// run — it lives on the server. Design approved via mockup 2026-09-21.
export function TickerPrepModal({ tickerId, symbol, companyName, onRunChange, onClose }: TickerPrepModalProps) {
  const [run, setRun] = useState<TickerBackfillRun | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    return openTickerBackfillStream(tickerId, (latestRun) => {
      setRun(latestRun);
      onRunChange(latestRun);
    });
    // onRunChange is a stable setter-wrapper from the parent; re-subscribing on its identity would restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerId, streamKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const restartedRun = await retryTickerBackfill(tickerId);
      setRun(restartedRun);
      onRunChange(restartedRun);
      setStreamKey((key) => key + 1);
    } catch (error) {
      setRetryError(error instanceof ApiError ? error.message : "Could not restart the preparation.");
    } finally {
      setRetrying(false);
    }
  }

  const steps = run?.steps ?? [];
  const totalSteps = steps.length;
  const succeededCount = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const failedSteps = steps.filter((step) => step.status === "failed");
  const isRunning = run === null || run.status === "running";
  const isPartial = run?.status === "partial";
  const currentStepNumber = Math.min(steps.filter(isFinishedStep).length + 1, Math.max(totalSteps, 1));

  const title = isRunning ? `Preparing ${symbol}` : isPartial ? `${symbol}: ${failedSteps.length === 1 ? "one step" : `${failedSteps.length} steps`} failed` : `${symbol} is ready`;
  const progressLabel = isRunning ? `Step ${currentStepNumber} of ${totalSteps || 4}` : isPartial ? `${succeededCount} of ${totalSteps} steps succeeded` : "All steps finished";
  const progressPercent = run?.progressPercent ?? 0;
  const failedChainStep = failedSteps.some((step) => step.key === "chain_warmup" || step.key === "first_snapshot");

  return (
    <>
      <div
        className="modal-backdrop show"
        style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      />
      <div
        className="modal show d-block"
        style={{ zIndex: 1050 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable ticker-prep-dialog">
          <div className="modal-content ticker-prep" role="dialog" aria-label={title}>
            <div className="prep-head">
              <div>
                <h3 className="prep-title">{title}</h3>
                {companyName && <div className="prep-company">{companyName}</div>}
              </div>
              <button type="button" className="prep-x" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </div>

            <div className="modal-body prep-body">
              {run === null ? (
                <Spinner size="sm" label="Loading progress" />
              ) : (
                <>
                  <div className="prep-progress-top">
                    <span>{progressLabel}</span>
                    <span className="prep-pct">{progressPercent}%</span>
                  </div>
                  <div className="prep-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`prep-fill ${isRunning ? "" : isPartial ? "is-partial" : "is-complete"}`} style={{ width: `${progressPercent}%` }} />
                  </div>

                  <ol className="prep-steps">
                    {steps.map((step) => {
                      const message = step.message ?? (step.status === "running" ? runningStepMessage[step.key] : null);
                      return (
                        <li key={step.key} className={`prep-step is-${step.status}`}>
                          <span className="prep-icon">
                            <StepIcon status={step.status} />
                          </span>
                          <div>
                            <div className="prep-step-label">{step.label}</div>
                            {message && <div className="prep-step-message">{message}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  {isRunning && (
                    <div className="prep-note">
                      <p>You can close this window. {symbol} stays on the shortlist and keeps preparing in the background.</p>
                      <p>Nightly jobs skip {symbol} until it finishes.</p>
                    </div>
                  )}
                  {!isRunning && !isPartial && (
                    <div className="prep-note is-ok">
                      <p>{symbol} will be included in tomorrow's trade-alert scan.</p>
                    </div>
                  )}
                  {isPartial && (
                    <div className="prep-note is-warn">
                      <p>
                        The ticker is on the shortlist.{" "}
                        {failedChainStep ? "Tonight's job will retry the chain capture on its own." : "Use Retry to run the failed step again."}
                      </p>
                    </div>
                  )}
                  {retryError && <div className="alert alert-danger mt-3 mb-0">{retryError}</div>}
                </>
              )}
            </div>

            <div className="prep-foot">
              {isPartial ? (
                <>
                  <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={retrying} onClick={handleRetry}>
                    {retrying && <Spinner size="sm" />}
                    Retry
                  </button>
                  <button type="button" className="btn btn-primary" onClick={onClose}>
                    Done
                  </button>
                </>
              ) : isRunning ? (
                <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                  Close
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
