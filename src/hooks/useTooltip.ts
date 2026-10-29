import { useEffect, useRef } from "react";
// Imported from the same deep path as main.tsx's tabler.esm.min.js (rather than the bare "@tabler/core" specifier, which
// resolves to a different file via the package's "module" field): otherwise Vite pre-bundles two copies of Bootstrap's
// JS, each registering its own global click listeners (that raced Collapse's data-bs-toggle handling, so the mobile nav
// burger menu couldn't be closed) and every Tooltip would be initialized twice.
import { Tooltip } from "@tabler/core/dist/js/tabler.esm.min.js";

/** How long a pointer or focus rests on an element before its tooltip shows: every tooltip in the app (Marcelo 2026-10-19). */
export const tooltipShowDelayMilliseconds = 500;

type TooltipOptions = ConstructorParameters<typeof Tooltip>[1];

/**
 * A Bootstrap Tooltip on `element`, and the cleanup that disposes it. Bootstrap ends a hide with a callback after the fade
 * that reads the tooltip's state, so disposing the tooltip of an element that left the page mid-fade made that callback
 * throw; such a tooltip is disposed once its hide has ended instead.
 */
export function attachTooltip(element: HTMLElement, options: TooltipOptions): () => void {
  const tooltip = new Tooltip(element, options);
  let hiding = false;
  const onHide = () => {
    hiding = true;
  };
  const onHidden = () => {
    hiding = false;
  };
  element.addEventListener("hide.bs.tooltip", onHide);
  element.addEventListener("hidden.bs.tooltip", onHidden);
  return () => {
    element.removeEventListener("hide.bs.tooltip", onHide);
    element.removeEventListener("hidden.bs.tooltip", onHidden);
    if (hiding && !element.isConnected) element.addEventListener("hidden.bs.tooltip", () => tooltip.dispose(), { once: true });
    else tooltip.dispose();
  };
}

/** Shared replacement for native `title=` tooltips — Tabler/Bootstrap Tooltip,
 * shown after tooltipShowDelayMilliseconds of hover/focus. Attach the returned ref to the DOM
 * element that should carry the tooltip. `text` is rendered as plain text
 * (never HTML) since this hook is also used for data-driven strings. */
export function useTooltip<T extends HTMLElement = HTMLElement>(text: string | undefined | null, options: { multiline?: boolean } = {}) {
  const multiline = options.multiline ?? false;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !text) return;
    return attachTooltip(el, {
      title: text,
      placement: "top",
      delay: { show: tooltipShowDelayMilliseconds, hide: 0 },
      trigger: "hover focus",
      html: false,
      // A list (line breaks kept, left-aligned, wider): the .multiline-tooltip class in theme.css.
      ...(multiline ? { customClass: "multiline-tooltip" } : {}),
    });
  }, [text, multiline]);

  return ref;
}
