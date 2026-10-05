import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface MenuPlacement {
  top?: number;
  bottom?: number;
  right: number;
}

// Same manual open-state/click-outside pattern as ColumnVisibilityPopover.tsx -- this app never loads
// Bootstrap's JS bundle, so data-bs-toggle="dropdown" alone does nothing.
//
// Portaled to <body> with fixed positioning for the same reason as ColumnVisibilityPopover: this button
// lives inside a table row, inside `.table-responsive` (overflow-x: auto, which per spec forces
// overflow-y: auto too) -- a menu absolutely positioned inside that box renders broken (clipped/painted
// under sibling rows) whenever it would extend past the scroll container. Also flips to open upward when
// there isn't room below the button -- rows near the bottom of a long shortlist otherwise open a menu that
// runs off the bottom of the viewport (found 2026-09-29). No component in the app measured this before, so
// it's done here with a two-pass layout effect: open with a provisional "below" placement, measure the
// menu's actual rendered height (varies with item count and the danger-item divider), then correct before
// the browser paints -- useLayoutEffect runs before paint, so the correction never flickers.
export function ActionsMenu({ items }: ActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [measured, setMeasured] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function toggleMenu() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (!buttonRef.current) return;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    setPlacement({ top: buttonRect.bottom + 4, right: window.innerWidth - buttonRect.right });
    setMeasured(false);
    setIsOpen(true);
  }

  useLayoutEffect(() => {
    if (!isOpen || measured || !buttonRef.current || !menuRef.current) return;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const openUpward = spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow;
    const right = window.innerWidth - buttonRect.right;
    setPlacement(
      openUpward ? { bottom: window.innerHeight - buttonRect.top + 4, right } : { top: buttonRect.bottom + 4, right },
    );
    setMeasured(true);
  }, [isOpen, measured]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    // Scrolling (the page or the table's own horizontal scroll) would leave a fixed-position menu
    // pointing at stale coordinates -- close it instead of tracking it, same as ColumnVisibilityPopover.
    function handleDismiss() {
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [isOpen]);

  return (
    <div className="dropdown" style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
        onClick={toggleMenu}
      >
        Actions <IconChevronDown size={14} />
      </button>
      {isOpen &&
        placement &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu show"
            style={{ position: "fixed", minWidth: "13rem", zIndex: 1101, ...placement }}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
