import type { ReactNode } from "react";
import { flashClassName, useFlashOnKeyChange } from "../hooks/useFlashOnChange";

interface FlashingTextProps {
  /** Identity of what the children show (e.g. a contract key); the flash fires when it changes. */
  changeKey: string | null | undefined;
  className?: string;
  children: ReactNode;
}

// Table-cell counterpart to FlashingNumber for a non-numeric value: one flashing component per cell,
// since a DataTable column's render(row) is a plain function and cannot call the hook itself.
export function FlashingText({ changeKey, className, children }: FlashingTextProps) {
  const flashing = useFlashOnKeyChange(changeKey);
  return <span className={[className, flashClassName(flashing)].filter(Boolean).join(" ")}>{children}</span>;
}
