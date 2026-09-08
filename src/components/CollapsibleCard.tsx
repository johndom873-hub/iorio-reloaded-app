import { useEffect, useState, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";

// No Bootstrap collapse JS is loaded in this app (see
// ColumnVisibilityPopover.tsx's comment) -- driven manually here the same
// way, with local isOpen state rather than data-bs-toggle="collapse".
interface CollapsibleCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  children: ReactNode;
}

function storageKeyFor(storageKey: string): string {
  return `iorio-card-collapsed-${storageKey}`;
}

export function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = true,
  storageKey,
  className,
  children,
}: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const stored = localStorage.getItem(storageKeyFor(storageKey));
      return stored === null ? defaultOpen : stored === "open";
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKeyFor(storageKey), isOpen ? "open" : "closed");
  }, [storageKey, isOpen]);

  return (
    <div className={`card ${className ?? ""}`}>
      <div
        className="card-header d-flex align-items-center justify-content-between"
        style={{ cursor: "pointer" }}
        onClick={() => setIsOpen((open) => !open)}
        role="button"
        aria-expanded={isOpen}
      >
        <h3 className="card-title mb-0 d-flex align-items-center gap-2" style={{ fontSize: "1rem" }}>
          {title}
          {subtitle}
        </h3>
        <IconChevronDown
          size={18}
          className="text-muted"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
        />
      </div>
      {isOpen && <div className="card-body">{children}</div>}
    </div>
  );
}
