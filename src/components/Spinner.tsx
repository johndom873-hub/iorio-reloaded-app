interface SpinnerProps {
  /** "sm" for inline use (buttons, table cells); "md" (default) for standalone/page-level use. */
  size?: "sm" | "md";
  /**
   * Screen-reader label. Provide one for a standalone spinner (e.g. a
   * full-page loading state) so it's announced. Omit when adjacent visible
   * text already describes what's loading (e.g. inside a button that
   * already has a label) — the spinner is then purely decorative.
   */
  label?: string;
  className?: string;
}

/** Standardized loading indicator — every non-immediate operation uses this, not an inline spinner-border. */
export function Spinner({ size = "md", label, className = "" }: SpinnerProps) {
  const sizeClass = size === "sm" ? "spinner-border-sm" : "";
  return (
    <span
      className={`spinner-border ${sizeClass} ${className}`.trim()}
      role="status"
      aria-hidden={label ? undefined : true}
    >
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  );
}
