import { useEffect, useRef } from "react";
// Same deep-import rationale as HelpTooltip.tsx: import from tabler's ESM JS
// bundle directly rather than the bare "@tabler/core" specifier, which
// resolves to a different file and would double-initialize Bootstrap's JS.
import { Tooltip } from "@tabler/core/dist/js/tabler.esm.min.js";

/** Shared replacement for native `title=` tooltips — Tabler/Bootstrap Tooltip,
 * shown after a 1000ms hover/focus delay. Attach the returned ref to the DOM
 * element that should carry the tooltip. `text` is rendered as plain text
 * (never HTML) since this hook is also used for data-driven strings. */
export function useTooltip<T extends HTMLElement = HTMLElement>(text: string | undefined | null, options: { multiline?: boolean } = {}) {
  const multiline = options.multiline ?? false;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !text) return;
    const tooltip = new Tooltip(el, {
      title: text,
      placement: "top",
      delay: { show: 1000, hide: 0 },
      trigger: "hover focus",
      html: false,
      // A list (line breaks kept, left-aligned, wider): the .multiline-tooltip class in theme.css.
      ...(multiline ? { customClass: "multiline-tooltip" } : {}),
    });
    return () => tooltip.dispose();
  }, [text, multiline]);

  return ref;
}
