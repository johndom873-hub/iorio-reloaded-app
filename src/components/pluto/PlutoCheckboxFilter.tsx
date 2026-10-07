import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PlutoCheckboxFilterProps {
  label: string;
  options: { key: string; label: string }[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  /** Replaces the whole selection: the menu's All / None. */
  onSelectKeys: (keys: string[]) => void;
}

/** A dropdown button whose menu is a checkbox list ("Categories · 5 of 6") under All / None. The menu is portalled to <body> so no clipped ancestor hides it, like ColumnVisibilityPopover. */
export function PlutoCheckboxFilter({ label, options, selectedKeys, onToggle, onSelectKeys }: PlutoCheckboxFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    function handleDismiss() {
      setIsOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [isOpen]);

  return (
    <>
      <button ref={buttonRef} type="button" className="pm-select pm-filter-trigger" aria-haspopup="true" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        {label} · {selectedKeys.length} of {options.length}
      </button>
      {isOpen &&
        menuPosition &&
        createPortal(
          <div ref={menuRef} className="dropdown-menu p-2 show pm-filter-menu" style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, zIndex: 1101, minWidth: 0, width: "max-content" }}>
            <div className="pm-filter-quick">
              <button type="button" className="pm-link-btn" disabled={selectedKeys.length === options.length} onClick={() => onSelectKeys(options.map((option) => option.key))}>
                All
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className="pm-link-btn" disabled={selectedKeys.length === 0} onClick={() => onSelectKeys([])}>
                None
              </button>
            </div>
            {options.map((option) => (
              <label key={option.key}>
                <input type="checkbox" className="form-check-input m-0" checked={selectedKeys.includes(option.key)} onChange={() => onToggle(option.key)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
