import type { ReactNode } from "react";

/** A setting printed for a trader in place of its input: the label, then the value. */
export function ReadOnlySetting({ label, value, help }: { label: ReactNode; value: ReactNode; help?: ReactNode }) {
  return (
    <div className="read-only-setting">
      <div className="read-only-setting-label text-secondary">
        {label}
        {help}
      </div>
      <div className="read-only-setting-value">{value}</div>
    </div>
  );
}
