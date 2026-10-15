import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { cancelBacktestJob, putBacktestDownloadFirst, resumeBacktestJob, type BacktestJobView } from "../../api/backtest";
import { describeJobTitle } from "../../lib/backtestPresentation";
import { formatNumber } from "../../lib/formatters";
import { useTickingNow } from "../../hooks/useTickingNow";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";
import { BacktestCard, BacktestJobProgress, BacktestJobStatusBadge } from "./backtestBits";
import { usePutDownloadFirst } from "./usePutDownloadFirst";

interface BacktestJobsCardProps {
  jobs: BacktestJobView[];
  onJobsChanged: () => Promise<void>;
}

type JobAction = "cancel" | "resume" | "first";

/** Background jobs: downloads and backtest runs, each in its own process, with progress read from the database. Backtests
 *  and downloads sit in two lists, side by side on wide screens and stacked on narrower ones, each in the order the
 *  overview gives (BacktestOverview.jobs): the 50 latest backtests; every unfinished download, then finished ones up to 50. */
export function BacktestJobsCard({ jobs, onJobsChanged }: BacktestJobsCardProps) {
  // The clock for the rows' relative times ticks here, so only this card redraws every second while a job runs.
  const newestHeartbeat = jobs.map((job) => job.heartbeatAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
  const now = useTickingNow(newestHeartbeat);
  const [pendingAction, setPendingAction] = useState<{ jobId: string; action: JobAction } | null>(null);
  const [jobToCancel, setJobToCancel] = useState<BacktestJobView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { requestPutFirst, putFirstModal } = usePutDownloadFirst(jobs);

  const runAction = async (job: BacktestJobView, action: JobAction, pauseRunning = false) => {
    setPendingAction({ jobId: job.id, action });
    setActionError(null);
    try {
      if (action === "cancel") await cancelBacktestJob(job.id);
      else if (action === "first") await putBacktestDownloadFirst(job.id, pauseRunning);
      else await resumeBacktestJob(job.id);
      await onJobsChanged();
    } catch (err) {
      const what = action === "cancel" ? "cancel" : action === "first" ? "move to the top" : "resume";
      setActionError(errorMessage(err, `Could not ${what} the ${job.symbol} job.`));
    } finally {
      setPendingAction(null);
      setJobToCancel(null);
    }
  };

  const isPending = (job: BacktestJobView, action: JobAction) => pendingAction?.jobId === job.id && pendingAction.action === action;
  const listProps = {
    now,
    pendingAction,
    isPending,
    onResume: (job: BacktestJobView) => void runAction(job, "resume"),
    onCancel: setJobToCancel,
    onMoveToTop: (job: BacktestJobView) => void requestPutFirst(job.symbol, (pauseRunning) => runAction(job, "first", pauseRunning)),
  };

  return (
    <BacktestCard
      title="Background jobs"
      description="Each runs in its own process and saves its progress as it goes: restarting the web server stops nothing, and this list picks up where it was."
      className="mb-3"
    >
      {actionError && <div className="alert alert-danger m-3 mb-0">{actionError}</div>}
      <div className="backtest-job-columns">
        <BacktestJobList title="Backtests" emptyText="No backtests. They appear here while they run." jobs={jobs.filter((job) => job.kind === "backtest")} {...listProps} />
        <BacktestJobList title="Downloads" emptyText="No downloads. They appear here while they run." jobs={jobs.filter((job) => job.kind === "download")} {...listProps} />
      </div>
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
      {putFirstModal}
    </BacktestCard>
  );
}

interface BacktestJobListProps {
  title: string;
  emptyText: string;
  /** This kind's jobs from the overview, shown in the order given. */
  jobs: BacktestJobView[];
  now: Date;
  pendingAction: { jobId: string; action: JobAction } | null;
  isPending: (job: BacktestJobView, action: JobAction) => boolean;
  onResume: (job: BacktestJobView) => void;
  onCancel: (job: BacktestJobView) => void;
  onMoveToTop: (job: BacktestJobView) => void;
}

/** One kind's jobs under a small header with their count, in a list of fixed height (about six rows) so the card never
 *  changes height as jobs update; past that the list scrolls, its scrollbar always showing. */
function BacktestJobList({ title, emptyText, jobs, now, pendingAction, isPending, onResume, onCancel, onMoveToTop }: BacktestJobListProps) {
  const firstQueuedJobId = jobs.find((job) => job.displayStatus === "queued")?.id ?? null;
  const downloadRunning = jobs.some((job) => job.kind === "download" && job.displayStatus === "running" && !job.pauseRequested);

  return (
    <section className="backtest-job-column" aria-label={title}>
      <div className="backtest-job-column-header">
        <span className="fw-semibold">{title}</span>
        <span className="badge bg-secondary-lt" style={{ fontSize: "0.72rem" }}>
          {formatNumber(jobs.length)}
        </span>
      </div>
      <div className="backtest-job-list-scroll">
        {jobs.length === 0 ? (
          <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
            {emptyText}
          </div>
        ) : (
          jobs.map((job) => {
            const status = job.displayStatus;
            const canCancel = status === "queued" || status === "running" || status === "stopped";
            // The list gives the queue in the order it starts: the first queued download is already at the top, so it can only
            // start now, by pausing the running one.
            const isFirstQueued = job.id === firstQueuedJobId;
            const canMoveToTop = job.kind === "download" && status === "queued" && (!isFirstQueued || downloadRunning);
            return (
              <div key={job.id} className="backtest-job-row">
                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                  <BacktestJobStatusBadge status={status} />
                  {job.kind === "backtest" && job.sessionId ? (
                    <Link to={`/backtest/sessions/${job.sessionId}`} className="fw-semibold text-truncate" title={describeJobTitle(job)}>
                      {describeJobTitle(job)}
                    </Link>
                  ) : (
                    <strong className="text-truncate" title={describeJobTitle(job)}>
                      {describeJobTitle(job)}
                    </strong>
                  )}
                  {job.pauseRequested && (
                    <span className="badge bg-secondary-lt flex-shrink-0" style={{ fontSize: "0.72rem" }} title="Goes back into the queue once it stops, right after the download put first">
                      Pausing
                    </span>
                  )}
                </div>
                <div className="d-flex gap-2 justify-content-end">
                  {canMoveToTop && (
                    <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap" disabled={pendingAction !== null} onClick={() => onMoveToTop(job)}>
                      {isPending(job, "first") && <Spinner size="sm" />}
                      {isFirstQueued ? "Start now" : "Move to top"}
                    </button>
                  )}
                  {(status === "stopped" || status === "failed") && (
                    <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={pendingAction !== null} onClick={() => onResume(job)}>
                      {isPending(job, "resume") && <Spinner size="sm" />}
                      Resume
                    </button>
                  )}
                  {canCancel && (
                    <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={pendingAction !== null} onClick={() => onCancel(job)}>
                      {status === "queued" ? "Remove" : "Cancel"}
                    </button>
                  )}
                </div>
                <div className="backtest-job-row-progress">
                  <BacktestJobProgress job={job} now={now} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
