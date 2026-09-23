import type { CSSProperties, ReactNode, Ref } from "react";
import { useTooltip } from "../hooks/useTooltip";

interface TooltipSpanProps {
  /** Tooltip text; renders no tooltip (but still renders children) when falsy. */
  text: string | undefined | null;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Element to render — defaults to "span". Used for table header/cell tooltip targets (e.g. "th", "td"). */
  as?: "span" | "div" | "td" | "th";
}

// Generic tooltip-carrying wrapper for spots where a tooltip target sits
// inside a .map()/render(row) callback (a plain function, not a component),
// so calling useTooltip directly there would violate the Rules of Hooks —
// see FlashingNumber.tsx's doc comment for the same constraint. Each
// TooltipSpan instance is its own component instance, so the hook call
// inside it is safe to use from a loop or table-cell render callback.
export function TooltipSpan({ text, children, className, style, as = "span" }: TooltipSpanProps) {
  const ref = useTooltip<HTMLElement>(text);
  const Tag = as;
  return (
    <Tag ref={ref as Ref<never>} className={className} style={style} tabIndex={text ? 0 : undefined}>
      {children}
    </Tag>
  );
}
