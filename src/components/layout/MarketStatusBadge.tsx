import type { MarketSessionState, MarketStatus } from "../../api/systemHealth";
import { useTickingNow } from "../../hooks/useTickingNow";
import { useTooltip } from "../../hooks/useTooltip";
import { formatCountdownUntil } from "../../lib/formatters";
import "./MarketStatusBadge.css";

const stateDisplay: Record<MarketSessionState, { label: string; countdownVerb: string }> = {
  "pre-market": { label: "Pre-Market", countdownVerb: "opens in" },
  open: { label: "Market Open", countdownVerb: "closes in" },
  "after-hours": { label: "After-Hours", countdownVerb: "closes in" },
  closed: { label: "Market Closed", countdownVerb: "opens in" },
};

const SESSION_HOURS_TEXT = "Pre-market 4:00–9:30 AM, regular session 9:30 AM–4:00 PM, after-hours 4:00–8:00 PM (Eastern time, trading days only).";

/** Top-bar badge for the US equity session: state on the left, live countdown to the next change on the right. */
export function MarketStatusBadge({ status }: { status: MarketStatus | null }) {
  const now = useTickingNow(null, [status?.nextChangeAt]);
  const tooltipRef = useTooltip<HTMLSpanElement>(status ? `${status.exchanges.join(" · ")}. ${SESSION_HOURS_TEXT}` : undefined);
  if (!status) return null;
  const { label, countdownVerb } = stateDisplay[status.state];
  const countdown = formatCountdownUntil(status.nextChangeAt, now);
  return (
    <span ref={tooltipRef} className={`mk-badge mk-badge-${status.state}`} tabIndex={0} aria-label={`${label}, ${countdownVerb} ${countdown}`}>
      <span className="mk-badge-state">
        <span className="mk-badge-dot" aria-hidden="true" />
        {label}
      </span>
      <span className="mk-badge-time" aria-hidden="true">
        {countdownVerb} <b>{countdown}</b>
      </span>
    </span>
  );
}
