import type { ReactNode } from "react";
import { flashClassName } from "../hooks/useFlashOnChange";
import { useTickDirectionColor } from "../hooks/useTickDirectionColor";

interface TickColoredPriceProps {
  /** Raw live value to compare against its own previous tick. */
  value: number | null;
  /** Seeds the very first comparison (e.g. last completed daily close) — there's no prior tick yet on the stream's first value. */
  initialReference: number | null;
  precision?: number;
  title?: string;
  children: ReactNode;
}

// Table-cell counterpart to FlashingNumber, for a value that should be
// colored by its own tick-to-tick direction (red/green vs. the previous
// live price) rather than by its own sign or a fixed reference — see
// useTickDirectionColor's doc comment for why (Marcelo, 2026-09-11: Price
// Performance's Current cell was wrongly colored vs. the last daily close).
export function TickColoredPrice({ value, initialReference, precision, title, children }: TickColoredPriceProps) {
  const { colorClass, flashing } = useTickDirectionColor(value, initialReference, precision);
  return (
    <span className={[colorClass, flashClassName(flashing)].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
