import type { ReactNode } from "react";
import { useColumnVisibility } from "./useColumnVisibility";
import { ColumnVisibilityPopover } from "./ColumnVisibilityPopover";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";

export interface DataTableColumn<TRow> {
  key: string;
  header: string;
  render: (row: TRow) => ReactNode;
  /** Right-align numeric/currency columns, or center a short fixed-width one (e.g. a badge). */
  align?: "left" | "right" | "center";
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
  /** Optional totals row, keyed by column key; columns without an entry render an empty cell. Hidden while loading or when there are no rows. */
  footerCells?: Record<string, ReactNode>;
  /** Rendered on the left of the column-gear row (title, status chips, filters). */
  toolbar?: ReactNode;
  /** Rendered between the gear row and the table (e.g. a collapsible notice). */
  beforeTable?: ReactNode;
  /** Rendered under the table, inside the card (e.g. a legend). */
  afterTable?: ReactNode;
  onRowClick?: (row: TRow) => void;
  rowClassName?: (row: TRow) => string | undefined;
  /** Smaller type (0.8rem) for dense, many-column tables. */
  dense?: boolean;
  /** Caps the table body to roughly this many rows and makes it scroll (sticky header) instead of growing the page. */
  maxVisibleRows?: number;
}

export function DataTable<TRow>({
  tableId,
  columns,
  rows,
  rowKey,
  emptyMessage = "No data",
  loading = false,
  footerCells,
  toolbar,
  beforeTable,
  afterTable,
  onRowClick,
  rowClassName,
  dense = false,
  maxVisibleRows,
}: DataTableProps<TRow>) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    columns.map((column) => column.key),
  );
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));
  const alignClassName = (align: DataTableColumn<TRow>["align"]) => (align === "right" ? "text-end" : align === "center" ? "text-center" : undefined);
  const rowHeightRem = dense ? 1.9 : 2.25;
  const maxBodyHeight = maxVisibleRows ? `${(maxVisibleRows + 1) * rowHeightRem}rem` : undefined;

  return (
    <div className="card">
      {toolbar && (
        <div className="card-body d-flex align-items-center py-2 border-bottom justify-content-between gap-2 flex-wrap">
          {toolbar}
        </div>
      )}
      {beforeTable}
      <div className="table-responsive" style={maxBodyHeight ? { maxHeight: maxBodyHeight, overflowY: "auto" } : undefined}>
        <table className="table table-sm table-hover table-vcenter card-table" style={dense ? { fontSize: "0.8rem" } : undefined}>
          <thead className="table-light" style={maxBodyHeight ? { position: "sticky", top: 0, zIndex: 1 } : undefined}>
            <tr>
              {visibleColumns.map((column, index) => {
                const isLastColumn = index === visibleColumns.length - 1;
                return (
                  <TooltipSpan
                    as="th"
                    key={column.key}
                    text={column.headerTitle}
                    className={alignClassName(column.align)}
                  >
                    {isLastColumn ? (
                      // A blank-header trailing column (e.g. row actions) has no label to sit
                      // "right after" -- its own cells are right-aligned via their own render
                      // (see ShortlistTab's actions column, which avoids align: "right" to dodge
                      // the numeric-column font it triggers), so push the gear right too, or it
                      // ends up flush left while the column's content sits flush right, reading
                      // as though it belongs to the column before it (found 2026-09-23).
                      <div
                        className={`d-flex align-items-center gap-1 ${column.align === "right" || column.header === "" ? "justify-content-end" : column.align === "center" ? "justify-content-center" : ""}`}
                      >
                        <span>{column.header}</span>
                        {/* A column with no header (e.g. a trailing actions column) has
                            nothing meaningful to label a checkbox with and is never meant
                            to be hidden — exclude it from the toggle list rather than show
                            a blank row (found 2026-08-28). */}
                        <ColumnVisibilityPopover
                          columns={columns.filter((c) => c.header !== "")}
                          isColumnVisible={isColumnVisible}
                          onToggleColumn={toggleColumn}
                        />
                      </div>
                    ) : (
                      column.header
                    )}
                  </TooltipSpan>
                );
              })}
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
                <tr
                  key={rowKey(row)}
                  className={[rowClassName?.(row), onRowClick ? "cursor-pointer" : undefined].filter(Boolean).join(" ") || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={alignClassName(column.align)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footerCells && !loading && rows.length > 0 && (
            <tfoot className="table-totals-row">
              <tr>
                {visibleColumns.map((column) => (
                  <td key={column.key} className={alignClassName(column.align)}>
                    {footerCells[column.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {afterTable}
    </div>
  );
}
