import type { ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useCollapsibleCard } from "../hooks/useCollapsibleCard";

// No Bootstrap collapse JS is loaded in this app (see
// ColumnVisibilityPopover.tsx's comment) -- driven manually here the same
// way, with local isOpen state rather than data-bs-toggle="collapse".
interface CollapsibleCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  /** Bump this to force the card open programmatically (e.g. scrolling to it from elsewhere), even if the user had collapsed it. */
  forceOpenSignal?: number;
  /** Shown in the header only while the card is collapsed (e.g. key figures), so they're visible without expanding. */
  collapsedSummary?: ReactNode;
  /** Controls in the header (e.g. a period picker), shown while open; clicking them doesn't collapse the card. */
  headerActions?: ReactNode;
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = true,
  storageKey,
  className,
  forceOpenSignal,
  collapsedSummary,
  headerActions,
  children,
}: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useCollapsibleCard(storageKey, defaultOpen, forceOpenSignal);

  return (
    <div className={`card ${className ?? ""}`}>
      <div
        className={`card-header d-flex align-items-center justify-content-between${headerActions ? " flex-wrap row-gap-2 card-header-with-actions" : ""}`}
        style={{ cursor: "pointer" }}
        onClick={() => setIsOpen((open) => !open)}
        role="button"
        aria-expanded={isOpen}
      >
        <h3 className="card-title mb-0 d-flex align-items-center gap-2" style={{ fontSize: "1rem" }}>
          {title}
          {subtitle}
        </h3>
        {!isOpen && collapsedSummary && <div className="ms-auto me-3 d-flex flex-wrap justify-content-end column-gap-3 row-gap-1">{collapsedSummary}</div>}
        {isOpen && headerActions && (
          <div className="card-header-actions ms-auto me-3 d-flex flex-wrap justify-content-end align-items-center gap-2" onClick={(event) => event.stopPropagation()} style={{ cursor: "default" }}>
            {headerActions}
          </div>
        )}
        <IconChevronDown
          size={18}
          className="text-secondary"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
        />
      </div>
      {isOpen && <div className="card-body">{children}</div>}
    </div>
  );
}
