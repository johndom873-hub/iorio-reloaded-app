import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { cancelBacktestJob, resumeBacktestJob, type BacktestJobView } from "../../api/backtest";
import { describeJobTitle } from "../../lib/backtestPresentation";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";
import { BacktestCard, BacktestJobKindBadge, BacktestJobProgress, BacktestJobStatusBadge } from "./backtestBits";

interface BacktestJobsCardProps {
  jobs: BacktestJobView[];
  now: Date;
  onJobsChanged: () => Promise<void>;
}

type JobAction = "cancel" | "resume";

/** Background jobs: downloads and backtest runs, each in its own process, with progress read from the database. */
export function BacktestJobsCard({ jobs, now, onJobsChanged }: BacktestJobsCardProps) {
  const [pendingAction, setPendingAction] = useState<{ jobId: string; action: JobAction } | null>(null);
  const [jobToCancel, setJobToCancel] = useState<BacktestJobView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (job: BacktestJobView, action: JobAction) => {
    setPendingAction({ jobId: job.id, action });
    setActionError(null);
    try {
      if (action === "cancel") await cancelBacktestJob(job.id);
      else await resumeBacktestJob(job.id);
      await onJobsChanged();
    } catch (err) {
      setActionError(errorMessage(err, action === "cancel" ? `Could not cancel the ${job.symbol} job.` : `Could not resume the ${job.symbol} job.`));
    } finally {
      setPendingAction(null);
      setJobToCancel(null);
    }
  };

  const isPending = (job: BacktestJobView, action: JobAction) => pendingAction?.jobId === job.id && pendingAction.action === action;

  return (
    <BacktestCard
      title="Background jobs"
      description="Each runs in its own process and saves its progress as it goes: restarting the web server stops nothing, and this list picks up where it was."
      className="mb-3"
    >
      {actionError && <div className="alert alert-danger m-3 mb-0">{actionError}</div>}
      {jobs.length === 0 ? (
        <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
          No background jobs. Downloads and backtests appear here while they run.
        </div>
      ) : (
        <div>
          {jobs.map((job) => {
            const status = job.displayStatus;
            const canCancel = status === "queued" || status === "running" || status === "stopped";
            return (
              <div key={job.id} className="backtest-job-row">
                <div className="d-flex flex-column gap-1" style={{ minWidth: 0 }}>
                  <span className="d-inline-flex flex-wrap gap-1 align-items-center">
                    <BacktestJobKindBadge kind={job.kind} />
                    <BacktestJobStatusBadge status={status} />
                  </span>
                  {job.kind === "backtest" && job.sessionId ? (
                    <Link to={`/backtest/sessions/${job.sessionId}`} className="fw-semibold text-truncate">
                      {describeJobTitle(job)}
                    </Link>
                  ) : (
                    <strong className="text-truncate">{describeJobTitle(job)}</strong>
                  )}
                </div>
                <BacktestJobProgress job={job} now={now} />
                <div className="d-flex gap-2 justify-content-md-end">
                  {status === "stopped" && (
                    <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={pendingAction !== null} onClick={() => void runAction(job, "resume")}>
                      {isPending(job, "resume") && <Spinner size="sm" />}
                      Resume
                    </button>
                  )}
                  {canCancel && (
                    <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={pendingAction !== null} onClick={() => setJobToCancel(job)}>
                      {status === "queued" ? "Remove" : "Cancel"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {jobToCancel && (
        <ConfirmModal
          title={jobToCancel.displayStatus === "queued" ? "Remove from the queue?" : `Cancel this ${jobToCancel.kind}?`}
          message={
            jobToCancel.kind === "download"
              ? `${jobToCancel.symbol}: the days already saved stay in the file; Update downloads the rest later.`
              : `${describeJobTitle(jobToCancel)}: the session stops and is marked cancelled. Running it again starts from the first day.`
          }
          confirmLabel={jobToCancel.displayStatus === "queued" ? "Remove" : "Cancel job"}
          confirming={isPending(jobToCancel, "cancel")}
          onConfirm={() => void runAction(jobToCancel, "cancel")}
          onCancel={() => setJobToCancel(null)}
        />
      )}
    </BacktestCard>
  );
}
