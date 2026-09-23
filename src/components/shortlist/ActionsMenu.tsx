import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { Spinner } from "../Spinner";
import { useTooltip } from "../../hooks/useTooltip";

export interface ActionsMenuItem {
  key: string;
  label: string;
  onClick: () => void;
  /** Shown greyed out and unclickable; `disabledReason` becomes the hover tooltip explaining why. */
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  danger?: boolean;
}

interface ActionsMenuProps {
  items: ActionsMenuItem[];
}

// A disabled dropdown item never fires hover/focus, so its tooltip has to
// live on a wrapping span. Extracted into its own component so useTooltip
// can be called once per item from inside items.map() without violating the
// Rules of Hooks (see FlashingNumber.tsx's doc comment for the constraint).
function ActionsMenuItemButton({ item, onSelect }: { item: ActionsMenuItem; onSelect: () => void }) {
  const tooltipText = item.disabled ? item.disabledReason : undefined;
  const wrapperRef = useTooltip<HTMLSpanElement>(tooltipText);
  return (
    <span ref={wrapperRef} tabIndex={tooltipText ? 0 : undefined} style={{ display: "block" }}>
      <button
        type="button"
        className={`dropdown-item d-flex align-items-center justify-content-between gap-2 ${item.danger ? "text-danger" : ""}`}
        disabled={item.disabled || item.loading}
        onClick={onSelect}
      >
        {item.label}
        {item.loading && <Spinner size="sm" />}
      </button>
    </span>
  );
}

// Same manual open-state/click-outside pattern as ColumnVisibilityPopover.tsx -- this app never loads
// Bootstrap's JS bundle, so data-bs-toggle="dropdown" alone does nothing.
export function ActionsMenu({ items }: ActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="dropdown" ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setIsOpen((open) => !open)}>
        Actions <IconChevronDown size={14} />
      </button>
      <div
        className={`dropdown-menu dropdown-menu-end ${isOpen ? "show" : ""}`}
        style={{ position: "absolute", top: "100%", right: 0, marginTop: "0.25rem", minWidth: "13rem" }}
      >
        {items.map((item, index) => (
          <div key={item.key}>
            {item.danger && index > 0 && <div className="dropdown-divider" />}
            <ActionsMenuItemButton
              item={item}
              onSelect={() => {
                setIsOpen(false);
                item.onClick();
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
