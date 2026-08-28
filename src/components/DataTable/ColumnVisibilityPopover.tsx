import { useEffect, useRef, useState } from "react";
import { IconSettings } from "@tabler/icons-react";

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
export function ColumnVisibilityPopover({ columns, isColumnVisible, onToggleColumn }: ColumnVisibilityPopoverProps) {
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
    <div className="dropdown" ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-icon"
        aria-label="Choose visible columns"
        title="Choose visible columns"
        onClick={() => setIsOpen((open) => !open)}
      >
        <IconSettings size={18} />
      </button>
      <div
        className={`dropdown-menu dropdown-menu-end p-2 ${isOpen ? "show" : ""}`}
        style={{ position: "absolute", top: "100%", right: 0, marginTop: "0.25rem" }}
      >
        {columns.map((column) => (
          <label key={column.key} className="form-check form-check-inline d-block mb-1">
            <input
              type="checkbox"
              className="form-check-input"
              checked={isColumnVisible(column.key)}
              onChange={() => onToggleColumn(column.key)}
            />
            <span className="form-check-label">{column.header}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
