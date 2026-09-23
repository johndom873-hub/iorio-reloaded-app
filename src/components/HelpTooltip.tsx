import { useEffect, useRef } from "react";
// Imported from the same deep path as main.tsx's tabler.esm.min.js (rather
// than the bare "@tabler/core" specifier, which resolves to a different
// file via the package's "module" field) — otherwise Vite pre-bundles two
// independent copies of Bootstrap's JS, each registering its own global
// click listeners. That duplication raced Collapse's data-bs-toggle
// handling (the mobile nav burger menu couldn't be closed) and would have
// silently double-initialized every Tooltip too.
import { Tooltip } from "@tabler/core/dist/js/tabler.esm.min.js";
import { IconHelpCircle } from "@tabler/icons-react";

interface HelpTooltipProps {
  text: string;
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  const iconRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = iconRef.current;
    if (!el) return;
    const tooltip = new Tooltip(el, { title: text, placement: "top", delay: { show: 1000, hide: 0 } });
    return () => tooltip.dispose();
  }, [text]);

  return (
    <span
      ref={iconRef}
      className="text-muted d-inline-flex align-items-center justify-content-center"
      style={{ cursor: "help", padding: "4px" }}
      tabIndex={0}
    >
      <IconHelpCircle size={14} />
    </span>
  );
}

interface DottedLabelTooltipProps {
  label: string;
  /** Tooltip body; simple inline HTML only (Bootstrap sanitizes it). Always developer-authored, never user data. */
  tooltipHtml: string;
}

/** A text label with a dotted underline that reveals a footnote-style tooltip on hover, focus or tap. */
export function DottedLabelTooltip({ label, tooltipHtml }: DottedLabelTooltipProps) {
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const tooltip = new Tooltip(el, { title: tooltipHtml, html: true, placement: "top", customClass: "footnote-tooltip", delay: { show: 1000, hide: 0 } });
    return () => tooltip.dispose();
  }, [tooltipHtml]);

  return (
    <span ref={labelRef} className="dotted-underline-label" tabIndex={0}>
      {label}
    </span>
  );
}
