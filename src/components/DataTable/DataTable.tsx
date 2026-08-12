import type { ReactNode } from "react";
import { useColumnVisibility } from "./useColumnVisibility";
import { ColumnVisibilityPopover } from "./ColumnVisibilityPopover";

export interface DataTableColumn<TRow> {
  key: string;
  header: string;
  render: (row: TRow) => ReactNode;
  /** Right-align numeric/currency columns. */
  align?: "left" | "right";
}

interface DataTableProps<TRow> {
  /** Unique per-table id, used as the localStorage key for column visibility. */
  tableId: string;
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  emptyMessage?: string;
}

export function DataTable<TRow>({ tableId, columns, rows, rowKey, emptyMessage = "No data" }: DataTableProps<TRow>) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    columns.map((column) => column.key),
  );
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));

  return (
    <div className="card">
      <div className="card-body d-flex justify-content-end py-2 border-bottom">
        <ColumnVisibilityPopover columns={columns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
      </div>
      <div className="table-responsive">
        <table className="table table-vcenter card-table">
          <thead className="table-light">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} className={column.align === "right" ? "text-end" : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
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
