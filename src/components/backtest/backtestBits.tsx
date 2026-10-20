import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconArrowLeft, IconChevronDown } from "@tabler/icons-react";
import type { BacktestJobDisplayStatus, BacktestJobView, BacktestSessionBatchRef } from "../../api/backtest";
import { formatRelativeAge, formatSecondsInWords, formatShortAgeWithSeconds, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import {
  describeJobProgress,
  describeJobRunTime,
  jobProgressBarClass,
  jobProgressFraction,
  jobStatusBadgeClass,
  jobStatusLabel,
  signedPercentDisplay,
  type BacktestValueScale,
} from "../../lib/backtestPresentation";
import { useSignalsTickerModal } from "../../hooks/useSignalsTickerModal";
import { TooltipSpan } from "../TooltipSpan";

// Small pieces shared by the Backtesting screens.

/** A card's title with its one-line description, for a DataTable toolbar or a BacktestCard header. */
export function BacktestCardTitle({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap align-items-baseline column-gap-3 row-gap-1" style={{ minWidth: 0 }}>
      <h3 className="card-title mb-0">{title}</h3>
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

/** Signed whole dollars in green or red ("+$1,234", "-$560"). */
export function SignedDollars({ value }: { value: number | null | undefined }) {
  return <span className={pnlTextClass(value)}>{formatSignedPnl(value ?? null, 0)}</span>;
}

/** A ticker symbol that opens the shared ticker modal, readable on a card in both themes. */
export function BacktestSymbolLink({ symbol }: { symbol: string }) {
  const { open } = useSignalsTickerModal();
  return (
    <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold iorio-symbol-link" onClick={() => open(symbol)}>
      {symbol}
    </button>
  );
}

/** A chart line's legend swatch for a table row or column: solid for a session, dashed for buy and hold of the symbols,
 *  dotted for SPY. The colour is the chart's own (backtestPresentation's palettes). */
export function BacktestSeriesSwatch({ color, line }: { color: string; line: "solid" | "dashed" | "dotted" }) {
  return <span aria-hidden="true" className="d-inline-block flex-shrink-0" style={{ width: "1rem", height: 0, borderTop: `3px ${line} ${color}` }} />;
}

/** A two-or-more-way choice as a button group, the chosen one filled (the Linear / Log switch, the New session's Period, Capital and Ticker values). */
export function BacktestSegmentedSwitch<TValue extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: TValue; label: string }[];
  value: TValue;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  /** Extra classes on the group (backtest-switch-wrap: the buttons fill the width and wrap their labels on a phone). */
  className?: string;
}) {
  return (
    <div className={className ? `btn-group ${className}` : "btn-group"} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" className={`btn ${value === option.value ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

const valueScaleOptions: { value: BacktestValueScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
];

/** The account value charts' Linear / Log switch (a card action). */
export function BacktestValueScaleSwitch({ scale, onChange }: { scale: BacktestValueScale; onChange: (scale: BacktestValueScale) => void }) {
  return <BacktestSegmentedSwitch options={valueScaleOptions} value={scale} onChange={onChange} ariaLabel="Value axis" />;
}

/** The Show / Hide button of a collapsible results card (its state remembered by useCollapsibleCard). */
export function BacktestCollapseToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" aria-expanded={isOpen} onClick={onToggle}>
      <IconChevronDown size={16} aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      {isOpen ? "Hide" : "Show"}
    </button>
  );
}

/** Back to Backtesting; a run of a batch also links to its batch ("← Backtesting / Batch test · Run 2 of 3"). */
export function BacktestBackLink({ batch = null }: { batch?: BacktestSessionBatchRef | null }) {
  const backtesting = (
    <Link to="/backtest" className="d-inline-flex align-items-center gap-1 text-decoration-none">
      <IconArrowLeft size={14} aria-hidden="true" />
      Backtesting
    </Link>
  );
  if (!batch) return <div className="mb-1" style={{ fontSize: "0.8rem" }}>{backtesting}</div>;
  return (
    <nav aria-label="Breadcrumb" className="d-flex flex-wrap align-items-center gap-2 mb-1" style={{ fontSize: "0.8rem" }}>
      {backtesting}
      <span aria-hidden="true" className="text-secondary">
        /
      </span>
      <Link to={`/backtest/batches/${encodeURIComponent(batch.id)}`} className="text-decoration-none">
        Batch {batch.name}
      </Link>
      <span className="text-secondary">
        · Run {batch.runNumber} of {batch.runCount}
      </span>
    </nav>
  );
}

export function BacktestJobStatusBadge({ status }: { status: BacktestJobDisplayStatus }) {
  return <span className={`badge ${jobStatusBadgeClass[status]}`}>{jobStatusLabel[status]}</span>;
}

/** A job's progress bar, coloured by its status. */
export function BacktestJobProgressBar({ job, className }: { job: BacktestJobView; className?: string }) {
  const percent = Math.round(jobProgressFraction(job) * 100);
  return (
    <div className={`progress ${className ?? ""}`.trim()} role="progressbar" aria-label={`${job.symbol} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-bar ${jobProgressBarClass[job.displayStatus]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A job's progress bar and the line under it: how far, what it is on, time left, and when it last reported. */
export function BacktestJobProgress({ job, now }: { job: BacktestJobView; now: Date }) {
  const status = job.displayStatus;
  return (
    <div className="d-flex flex-column gap-1" style={{ minWidth: 0 }}>
      <BacktestJobProgressBar job={job} />
      <div className="d-flex flex-wrap column-gap-3 row-gap-1" style={{ fontSize: "0.78rem" }}>
        <span className="font-mono">{describeJobProgress(job)}</span>
        {job.progressLabel && <span className="text-secondary">{job.progressLabel}</span>}
        {status === "running" && job.etaSeconds !== null && <span className="text-secondary">~{formatSecondsInWords(job.etaSeconds)} left</span>}
        {status === "queued" && (
          <span className="text-secondary">{job.kind === "download" ? "starts when the download ahead of it finishes (ThetaData allows one at a time)" : "waiting to start"}</span>
        )}
        {job.runSeconds !== null && <span className="text-secondary">{describeJobRunTime(status, job.runSeconds)}</span>}
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
