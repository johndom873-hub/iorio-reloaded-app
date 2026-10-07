import { Spinner } from "./Spinner";
import { TooltipSpan } from "./TooltipSpan";

interface ToggleSwitchProps {
  checked: boolean;
  /** A save is in flight: the switch is locked and a spinner shows next to it. */
  saving: boolean;
  /** Not clickable; shown in Bootstrap's disabled style, with disabledReason as its tooltip. */
  disabled?: boolean;
  disabledReason?: string;
  ariaLabel: string;
  onToggle: () => void;
}

/** A save-on-click form switch for table rows (the Shortlist's Signals and Pluto columns). */
export function ToggleSwitch({ checked, saving, disabled = false, disabledReason, ariaLabel, onToggle }: ToggleSwitchProps) {
  return (
    <TooltipSpan text={disabled ? disabledReason : null} className="d-inline-flex">
      {/* Padding cancelled by an equal negative margin: a 44px tap target without making the table row taller. */}
      <label className="form-check form-switch d-inline-flex align-items-center gap-2" style={{ cursor: disabled ? "not-allowed" : saving ? "wait" : "pointer", padding: "0.75rem 0.375rem", margin: "-0.75rem -0.375rem" }}>
        <input className="form-check-input m-0" type="checkbox" role="switch" checked={checked} disabled={disabled || saving} onChange={onToggle} aria-label={ariaLabel} />
        {saving && <Spinner size="sm" />}
      </label>
    </TooltipSpan>
  );
}
