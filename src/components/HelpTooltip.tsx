import { useEffect, useRef } from "react";
import { Tooltip } from "@tabler/core";
import { IconHelpCircle } from "@tabler/icons-react";

interface HelpTooltipProps {
  text: string;
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  const iconRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = iconRef.current;
    if (!el) return;
    const tooltip = new Tooltip(el, { title: text, placement: "top" });
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
