import type { ReactNode } from "react";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";

interface PulseCollapsiblePanelProps {
  /** Persisted under the app-wide `iorio-card-collapsed-pulse-phone-<key>` localStorage convention. */
  storageKey: string;
  title: string;
  count?: ReactNode;
  /** One-line summary shown in the header (right-aligned) whether open or closed. */
  summary?: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
}

/**
 * Phone-layout Pulse panel: a 44px tappable header (chevron, title, count,
 * summary) above a body that collapses. Open/closed state persists per panel.
 */
export function PulseCollapsiblePanel({ storageKey, title, count, summary, defaultOpen, children }: PulseCollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useCollapsibleCard(`pulse-phone-${storageKey}`, defaultOpen);
  return (
    <section className="phone-panel">
      <button type="button" className="phone-panel-toggle" aria-expanded={isOpen} onClick={() => setIsOpen((previous) => !previous)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="phone-panel-title">{title}</span>
        {count !== undefined && <span className="phone-panel-count">{count}</span>}
        {summary !== undefined && <span className="phone-panel-summary">{summary}</span>}
      </button>
      {isOpen && <div className="phone-panel-body">{children}</div>}
    </section>
  );
}
