import { IconSettings } from "@tabler/icons-react";

interface ColumnVisibilityPopoverProps {
  columns: { key: string; header: string }[];
  isColumnVisible: (columnKey: string) => boolean;
  onToggleColumn: (columnKey: string) => void;
}

export function ColumnVisibilityPopover({ columns, isColumnVisible, onToggleColumn }: ColumnVisibilityPopoverProps) {
  return (
    <div className="dropdown">
      <button
        type="button"
        className="btn btn-icon"
        data-bs-toggle="dropdown"
        data-bs-auto-close="outside"
        aria-label="Choose visible columns"
        title="Choose visible columns"
      >
        <IconSettings size={18} />
      </button>
      <div className="dropdown-menu dropdown-menu-end p-2">
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
