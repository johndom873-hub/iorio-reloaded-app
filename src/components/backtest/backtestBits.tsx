import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconArrowLeft } from "@tabler/icons-react";
import type { BacktestJobDisplayStatus, BacktestJobKind, BacktestJobView } from "../../api/backtest";
import { formatRelativeAge, formatSecondsInWords, formatShortAgeWithSeconds } from "../../lib/formatters";
import {
  describeJobProgress,
  jobKindBadgeClass,
  jobKindLabel,
  jobProgressBarClass,
  jobProgressFraction,
  jobStatusBadgeClass,
  jobStatusLabel,
  signedPercentDisplay,
} from "../../lib/backtestPresentation";
import { TooltipSpan } from "../TooltipSpan";

// Small pieces shared by the Backtesting screens.

/** A card's eyebrow title with its one-line description, for a DataTable toolbar or a BacktestCard header. */
export function BacktestCardTitle({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap align-items-baseline column-gap-3 row-gap-1" style={{ minWidth: 0 }}>
      <h3 className="subheader mb-0">{title}</h3>
      {description && (
        <span className="text-secondary" style={{ fontSize: "0.78rem" }}>
          {description}
        </span>
      )}
    </div>
  );
}

/** A card with the same header row as a DataTable toolbar: title and description on the left, actions on the right. */
export function BacktestCard({ title, description, actions, children, className = "" }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`.trim()}>
      <div className="card-body d-flex align-items-center py-2 border-bottom justify-content-between gap-2 flex-wrap">
        <BacktestCardTitle title={title} description={description} />
        {actions && <div className="d-flex align-items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A signed percentage (a fraction) in green or red, never coloured when it shows as zero. */
export function SignedPercent({ fraction, decimalPlaces = 1 }: { fraction: number | null | undefined; decimalPlaces?: number }) {
  const display = signedPercentDisplay(fraction, decimalPlaces);
  return <span className={display.className}>{display.text}</span>;
}

export function BacktestBackLink() {
  return (
    <Link to="/backtest" className="d-inline-flex align-items-center gap-1 mb-1 text-decoration-none" style={{ fontSize: "0.8rem" }}>
      <IconArrowLeft size={14} aria-hidden="true" />
      Backtesting
    </Link>
  );
}

export function BacktestJobKindBadge({ kind }: { kind: BacktestJobKind }) {
  return <span className={`badge ${jobKindBadgeClass[kind]}`}>{jobKindLabel[kind]}</span>;
}

export function BacktestJobStatusBadge({ status }: { status: BacktestJobDisplayStatus }) {
  return <span className={`badge ${jobStatusBadgeClass[status]}`}>{jobStatusLabel[status]}</span>;
}

/** A job's progress bar and the line under it: how far, what it is on, time left, and when it last reported. */
export function BacktestJobProgress({ job, now }: { job: BacktestJobView; now: Date }) {
  const percent = Math.round(jobProgressFraction(job) * 100);
  const status = job.displayStatus;
  return (
    <div className="d-flex flex-column gap-1" style={{ minWidth: 0 }}>
      <div className="progress" role="progressbar" aria-label={`${job.symbol} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-bar ${jobProgressBarClass[status]}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="d-flex flex-wrap column-gap-3 row-gap-1" style={{ fontSize: "0.78rem" }}>
        <span className="font-mono">{describeJobProgress(job)}</span>
        {job.progressLabel && <span className="text-secondary">{job.progressLabel}</span>}
        {status === "running" && job.etaSeconds !== null && <span className="text-secondary">~{formatSecondsInWords(job.etaSeconds)} left</span>}
        {status === "queued" && (
          <span className="text-secondary">{job.kind === "download" ? "starts when the download ahead of it finishes (ThetaData allows one at a time)" : "waiting to start"}</span>
        )}
        {status === "running" && job.heartbeatAt && <span className="text-secondary">updated {formatRelativeAge(job.heartbeatAt, now)}</span>}
        {status === "stopped" && (
          <span className="iorio-note-amber">
            no update for {formatShortAgeWithSeconds(job.heartbeatAt ?? job.startedAt ?? job.createdAt, now) ?? "a while"}; {job.kind === "download" ? "Resume continues from the last saved day" : "Resume runs the session again from the start"}
          </span>
        )}
        {(status === "succeeded" || status === "cancelled") && job.finishedAt && <span className="text-secondary">finished {formatRelativeAge(job.finishedAt, now)}</span>}
        {status === "failed" && (
          <TooltipSpan text={job.error} className="text-danger text-truncate d-inline-block" style={{ maxWidth: "100%" }}>
            {job.error ?? "failed"}
          </TooltipSpan>
        )}
      </div>
    </div>
  );
}
