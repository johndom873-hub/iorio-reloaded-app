import type { ReactNode } from "react";
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconRefresh } from "@tabler/icons-react";

// Pieces shared by the Analyse window's cards.

/** A card with the window's header row: the title, a "computed with the previous settings" tag when stale, a description and actions. */
export function AnalysisCard({ title, description, actions, stale = false, children, footer, className = "" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; stale?: boolean; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`.trim()}>
      <div className="analysis-card-head">
        <div className="analysis-card-title-row">
          <h3 className="subheader">{title}</h3>
          {stale && (
            <span className="analysis-prev-tag">
              <IconAlertTriangle size={14} aria-hidden="true" />
              Computed with the previous settings
            </span>
          )}
          {description && <span className="analysis-card-desc">{description}</span>}
        </div>
        {actions && <div className="analysis-card-actions">{actions}</div>}
      </div>
      {children}
      {footer && (
        <div className="card-footer text-secondary" style={{ fontSize: "0.75rem" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

const noteIcons = { warn: IconAlertTriangle, info: IconInfoCircle, plain: IconInfoCircle, done: IconCircleCheck, progress: IconRefresh };

/** A note inside the window: warning (amber), information (blue) or plain (grey), with an optional row of actions. */
export function AnalysisNote({ tone, icon, children, actions, live = false }: { tone: "warn" | "info" | "plain"; icon?: keyof typeof noteIcons; children: ReactNode; actions?: ReactNode; live?: boolean }) {
  const Icon = noteIcons[icon ?? tone];
  return (
    <div className={`analysis-note analysis-note-${tone}`} role={live ? "status" : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="analysis-note-body">
        {children}
        {actions && <div className="analysis-note-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A chart's series key: a dot in each series' colour and its name. Not a control (ApexCharts' own legend makes each name a toggle button). */
export function AnalysisSeriesKey({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="analysis-legend mb-1">
      {items.map((item) => (
        <span key={item.label} className="analysis-legend-item">
          <span className="analysis-series-dot" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** A progress bar for a background job, 0–1. */
export function AnalysisProgressBar({ fraction, label }: { fraction: number | null; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-bar${fraction === null ? " progress-bar-indeterminate" : ""}`} style={fraction === null ? undefined : { width: `${Math.max(2, Math.min(100, fraction * 100))}%` }} />
    </div>
  );
}
