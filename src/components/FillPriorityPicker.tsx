import { DottedLabelTooltip } from "./HelpTooltip";
import type { AdaptivePriority } from "../api/positions";

const adaptivePriorities: AdaptivePriority[] = ["Patient", "Normal", "Urgent"];

const fillPriorityTooltipHtml =
  "How aggressively IBKR works this order within your limit price. Urgent seeks the fastest fill; Patient waits longer for a better price. Never fills worse than your limit price.";

interface FillPriorityPickerProps {
  value: AdaptivePriority;
  onChange: (priority: AdaptivePriority) => void;
  disabled?: boolean;
}

// The IBKR Adaptive fill-priority choice as a button group (same options and order as the Signals order setup
// form), for forms that pick it before the order review step.
export function FillPriorityPicker({ value, onChange, disabled }: FillPriorityPickerProps) {
  return (
    <div className="d-flex justify-content-between align-items-center gap-3">
      <span className="form-label mb-0">
        <DottedLabelTooltip label="Fill priority (IBKR Adaptive)" tooltipHtml={fillPriorityTooltipHtml} />
      </span>
      <div className="btn-group" role="group" aria-label="Fill priority">
        {adaptivePriorities.map((priority) => (
          <button
            key={priority}
            type="button"
            className={`btn btn-sm ${priority === value ? "btn-primary" : "btn-outline-secondary"}`}
            aria-pressed={priority === value}
            disabled={disabled}
            onClick={() => onChange(priority)}
          >
            {priority}
          </button>
        ))}
      </div>
    </div>
  );
}
