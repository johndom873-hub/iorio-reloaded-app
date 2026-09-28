import type { PlutoEvent } from "../../api/pluto";
import { formatFeedTime } from "../../lib/formatters";
import { describePlutoEvent } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";

interface PlutoTimelineProps {
  events: PlutoEvent[];
  loading: boolean;
  error: string | null;
}

export function PlutoTimeline({ events, loading, error }: PlutoTimelineProps) {
  return (
    <div className="card h-100">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h3 className="card-title m-0">Timeline</h3>
        <span className="text-muted" style={{ fontSize: "0.75rem" }}>live · last {events.length} events</span>
      </div>
      <div className="card-body" style={{ maxHeight: "34rem", overflowY: "auto" }}>
        {loading ? (
          <Spinner size="sm" label="Loading timeline" />
        ) : error ? (
          <div className="alert alert-danger mb-0">{error}</div>
        ) : events.length === 0 ? (
          <div className="text-muted" style={{ fontSize: "0.85rem" }}>Nothing yet. The first line appears when the agent starts.</div>
        ) : (
          <ul className="list-unstyled m-0">
            {events.map((event) => {
              const entry = describePlutoEvent(event);
              return (
                <li key={event.id} className="d-flex gap-3 py-2 border-bottom">
                  <span className="font-monospace text-muted flex-shrink-0" style={{ fontSize: "0.75rem", width: "5rem" }} title={new Date(event.occurredAt).toLocaleString()}>{formatFeedTime(event.occurredAt)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.85rem" }}>
                      <span className={`badge ${entry.badgeClass} me-1`} style={{ fontSize: "0.72rem" }}>{entry.badgeLabel}</span>
                      {entry.line}
                    </div>
                    {entry.reason && <div className="text-muted fst-italic" style={{ fontSize: "0.78rem" }}>“{entry.reason}”</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
