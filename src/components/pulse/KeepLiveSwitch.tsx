import { TooltipSpan } from "../TooltipSpan";

const TOOLTIP_TEXT = "Keep prices and P&L updating while this tab is in the background. Uses IBKR market-data lines for as long as it is on.";

export function KeepLiveSwitch({ isKeepingLive, onChange, label }: { isKeepingLive: boolean; onChange: (isKeepingLive: boolean) => void; label: string }) {
  return (
    <TooltipSpan text={TOOLTIP_TEXT} className="keep-live-wrap">
      <label className="keep-live-switch">
        <input type="checkbox" role="switch" checked={isKeepingLive} onChange={(event) => onChange(event.target.checked)} />
        <span className="keep-live-track" aria-hidden="true" />
        <span className="keep-live-label">{label}</span>
      </label>
    </TooltipSpan>
  );
}
