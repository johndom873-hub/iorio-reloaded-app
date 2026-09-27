import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

// Same manual portal-based dropdown mechanics as ColumnVisibilityPopover
// (this app never loads Bootstrap's JS bundle, so data-bs-toggle="dropdown"
// and native <select multiple> checkbox-list UX aren't options) — factored
// out here since a second filter needing "pick several of these" is exactly
// the kind of thing worth sharing rather than re-implementing the portal/
// click-outside/position logic inline again.
export function MultiSelectDropdown({ label, options, selected, onChange }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [isOpen]);

  function toggleValue(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const buttonText = selected.length === 0 ? label : `${label} (${selected.length})`;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        className="form-select text-start d-inline-flex align-items-center justify-content-between"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{buttonText}</span>
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
              left: menuPosition.left,
              minWidth: menuPosition.width,
              width: "max-content",
              maxWidth: "24rem",
              zIndex: 1101,
            }}
          >
            <div className="d-flex justify-content-end mb-1">
              <button type="button" className="btn btn-link btn-sm p-0" disabled={selected.length === 0} onClick={() => onChange([])}>
                Reset
              </button>
            </div>
            {options.map((option) => (
              <label key={option.value} className="mb-1 column-visibility-row">
                <input type="checkbox" className="form-check-input" checked={selected.includes(option.value)} onChange={() => toggleValue(option.value)} />
                <span className="form-check-label">{option.label}</span>
              </label>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
