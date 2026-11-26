import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { formatSignedPercentagePointsValue, formatSignedPercentageValue, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import type { PerformanceUnit, performanceComponents } from "../../lib/pnlAnalysisPresentation";
import { TooltipSpan } from "../TooltipSpan";

/** A breakdown row's label: the component's colour square and its name, the hint in a tooltip. */
export function PerformanceComponentLabel({ component }: { component: (typeof performanceComponents)[number] }) {
  return (
    <span className="d-inline-flex align-items-center text-nowrap">
      <span className="pnl-component-swatch" style={{ backgroundColor: `var(${component.colorVariable})` }} aria-hidden="true" />
      <TooltipSpan text={component.hint} className="dotted-underline-label">{component.label}</TooltipSpan>
    </span>
  );
}

/** The chevron that folds a row's breakdown. */
export function BreakdownToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="pnl-row-toggle me-1" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the ${label} breakdown`} onClick={onToggle}>
      {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
    </button>
  );
}

/** The % / $ switch of a performance grid. */
export function PerformanceUnitToggle({ unit, label, onChange }: { unit: PerformanceUnit; label: string; onChange: (unit: PerformanceUnit) => void }) {
  return (
    <div className="btn-group" role="group" aria-label={label}>
      {(
        [
          ["percent", "%"],
          ["dollars", "$"],
        ] as const
      ).map(([choice, text]) => (
        <button key={choice} type="button" className={`btn btn-outline-secondary${unit === choice ? " active" : ""}`} aria-pressed={unit === choice} onClick={() => onChange(choice)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A grid cell: a % or $ figure coloured by its sign, "—" when there is none. */
export function PerformanceValueCell({ value, unit, className = "" }: { value: number | undefined; unit: PerformanceUnit | "points"; className?: string }) {
  if (value === undefined) return <td className={`text-end font-mono text-secondary ${className}`}>—</td>;
  // Rounded first, so a figure that shows as zero has no sign and no colour (−0.004% would read "-0.00%" in red).
  const shown = Number(value.toFixed(unit === "dollars" ? 0 : 2)) + 0;
  const text = unit === "dollars" ? formatSignedPnl(shown, 0) : unit === "points" ? formatSignedPercentagePointsValue(shown, 2) : formatSignedPercentageValue(shown, 2);
  return <td className={`text-end font-mono ${pnlTextClass(shown)} ${className}`}>{text}</td>;
}
