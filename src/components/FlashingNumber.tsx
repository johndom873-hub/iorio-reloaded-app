import type { CSSProperties, ReactNode } from "react";
import { FLASH_DURATION_MS, flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";
import { useTooltip } from "../hooks/useTooltip";

interface FlashingNumberProps {
  /** Raw value to compare across renders — pass the same number the displayed text (children) is formatted from. */
  value: number | null | undefined;
  /** See useFlashOnChange's own doc comment — match this to the precision children is displayed at. */
  precision?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

// Table-cell counterpart to the inline flash spans (e.g. the Signals modal's
// chain cells) — same useFlashOnChange/.flash-changed mechanism, packaged as a component so a
// DataTable column's `render(row)` callback (a plain function, not a
// component itself — see DataTable.tsx) can still get one flashing
// component instance per cell rather than calling the hook directly, which
// would violate the Rules of Hooks once called from inside a loop over rows.
export function FlashingNumber({ value, precision, className, title, style, children }: FlashingNumberProps) {
  const flashing = useFlashOnChange(value, FLASH_DURATION_MS, precision);
  const tooltipRef = useTooltip<HTMLSpanElement>(title);
  return (
    <span ref={tooltipRef} className={[className, flashClassName(flashing)].filter(Boolean).join(" ")} style={style}>
      {children}
    </span>
  );
}
