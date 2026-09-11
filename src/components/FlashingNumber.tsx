import type { ReactNode } from "react";
import { flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";

interface FlashingNumberProps {
  /** Raw value to compare across renders — pass the same number the displayed text (children) is formatted from. */
  value: number | null | undefined;
  /** See useFlashOnChange's own doc comment — match this to the precision children is displayed at. */
  precision?: number;
  className?: string;
  title?: string;
  children: ReactNode;
}

// Table-cell counterpart to the inline flash spans already used in
// TickerDetailModal's quote rows (approved 2026-09-11) — same
// useFlashOnChange/.flash-changed mechanism, packaged as a component so a
// DataTable column's `render(row)` callback (a plain function, not a
// component itself — see DataTable.tsx) can still get one flashing
// component instance per cell rather than calling the hook directly, which
// would violate the Rules of Hooks once called from inside a loop over rows.
export function FlashingNumber({ value, precision, className, title, children }: FlashingNumberProps) {
  const flashing = useFlashOnChange(value, 1200, precision);
  return (
    <span className={[className, flashClassName(flashing)].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
