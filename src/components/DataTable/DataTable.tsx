import type { ReactNode } from "react";
import { useColumnVisibility } from "./useColumnVisibility";
import { ColumnVisibilityPopover } from "./ColumnVisibilityPopover";
import { Spinner } from "../Spinner";

export interface DataTableColumn<TRow> {
  key: string;
  header: string;
  render: (row: TRow) => ReactNode;
  /** Right-align numeric/currency columns. */
  align?: "left" | "right";
  /** Full-text tooltip for an abbreviated header (e.g. header: "Avg Vol", headerTitle: "Average Option Volume"). */
  headerTitle?: string;
}

interface DataTableProps<TRow> {
  /** Unique per-table id, used as the localStorage key for column visibility. */
  tableId: string;
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  emptyMessage?: string;
  /** Data is being fetched — shows the standardized spinner instead of emptyMessage or stale rows. */
  loading?: boolean;
}

export function DataTable<TRow>({
  tableId,
  columns,
  rows,
  rowKey,
  emptyMessage = "No data",
  loading = false,
}: DataTableProps<TRow>) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    columns.map((column) => column.key),
  );
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));

  return (
    <div className="card">
      <div className="card-body d-flex justify-content-end py-2 border-bottom">
        {/* A column with no header (e.g. a trailing actions column) has
            nothing meaningful to label a checkbox with and is never meant
            to be hidden — exclude it from the toggle list rather than show
            a blank row (found 2026-08-28). */}
        <ColumnVisibilityPopover
          columns={columns.filter((column) => column.header !== "")}
          isColumnVisible={isColumnVisible}
          onToggleColumn={toggleColumn}
        />
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-hover table-vcenter card-table">
          <thead className="table-light">
            <tr>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  className={column.align === "right" ? "text-end" : undefined}
                  title={column.headerTitle}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumns.length} className="text-center py-4">
                  <Spinner size="sm" label="Loading" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="text-center text-muted py-4">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)}>
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={column.align === "right" ? "text-end" : undefined}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
