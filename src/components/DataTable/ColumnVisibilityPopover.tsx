import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSettings } from "@tabler/icons-react";
import { useTooltip } from "../../hooks/useTooltip";

interface ColumnVisibilityPopoverProps {
  columns: { key: string; header: string }[];
  isColumnVisible: (columnKey: string) => boolean;
  onToggleColumn: (columnKey: string) => void;
}

// Bootstrap's data-bs-toggle="dropdown" needs Bootstrap's JS bundle, which
// this app never loads (only @tabler/core's CSS) — that markup alone was a
// dead button. Driven manually here instead: open state + click-outside to
// close, with the menu's own position/visibility set explicitly rather than
// relying on Popper (also JS the app doesn't load).
//
// The trigger now lives inside a table's <thead>, itself inside a
// `.table-responsive` (overflow-x: auto, which per spec forces overflow-y to
// auto too). A menu absolutely positioned inside that box gets clipped
// whenever the table is shorter than the checkbox list (found 2026-09-23,
// moving the gear from the card header into the header row). Portal it to
// <body> with fixed positioning instead, so it escapes any scrollable/clipped
// ancestor.
export function ColumnVisibilityPopover({ columns, isColumnVisible, onToggleColumn }: ColumnVisibilityPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useTooltip<HTMLButtonElement>("Choose visible columns");

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    // Scrolling (the page, a modal body, or the table's own horizontal
    // scroll) would leave a fixed-position menu pointing at stale
    // coordinates — close it instead of tracking it. Capture phase so it
    // fires for scrolls on any ancestor, not just window (scroll doesn't bubble).
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
    <div className="dropdown" style={{ position: "relative", lineHeight: 1 }}>
      <button
        ref={(el) => {
          buttonRef.current = el;
          tooltipRef.current = el;
        }}
        type="button"
        className="btn btn-icon"
        aria-label="Choose visible columns"
        onClick={() => setIsOpen((open) => !open)}
        style={{ width: "1.4rem", height: "1.4rem", padding: 0, minWidth: 0 }}
      >
        <IconSettings size={14} />
      </button>
      {isOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu p-2 show"
            style={{
              position: "fixed",
              top: menuPosition.top,
              right: menuPosition.right,
              fontWeight: "normal",
              textTransform: "none",
              // Above the modal backdrop/content (z-index 1050) and even a second
              // stacked modal (1100), since this menu can be triggered from inside
              // either (project z-index convention, see CLAUDE.md).
              zIndex: 1101,
              // Tabler's .dropdown-menu ships min-width: 11rem, sized for menus with
              // icons/longer labels -- these rows are single short column names, so
              // let the menu shrink to fit them instead of always padding out to 11rem.
              minWidth: 0,
              width: "max-content",
            }}
          >
            {/* Not .form-check/.form-check-inline/.d-block -- .column-visibility-row now owns
                layout entirely (flex row, sized checkbox, see theme.css), and .d-block ships
                with !important, which silently overrode that flex with block and stacked the
                checkbox above the label instead of beside it (found 2026-09-23). */}
            {columns.map((column) => (
              <label key={column.key} className="mb-1 column-visibility-row">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={isColumnVisible(column.key)}
                  onChange={() => onToggleColumn(column.key)}
                />
                <span className="form-check-label">{column.header}</span>
              </label>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
