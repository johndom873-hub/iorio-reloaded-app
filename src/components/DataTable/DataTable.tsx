import { useMemo, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";
import { useColumnVisibility } from "./useColumnVisibility";
import { ColumnVisibilityPopover } from "./ColumnVisibilityPopover";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";

export interface DataTableColumn<TRow> {
  key: string;
  header: string;
  /** Drawn in the header cell instead of `header` (e.g. a select-all checkbox); the gear's list still uses `header`. */
  headerContent?: ReactNode;
  render: (row: TRow) => ReactNode;
  /** Right-align numeric/currency columns, or center a short fixed-width one (e.g. a badge). */
  align?: "left" | "right" | "center";
  /** Full-text tooltip for an abbreviated header (e.g. header: "Avg Vol", headerTitle: "Average Option Volume"). */
  headerTitle?: string;
  /** A group heading shared by adjacent columns, drawn in a row above the headers (one cell per run of visible columns). */
  group?: { label: string; className?: string; title?: string };
  /** Extra class on the column's body cells (e.g. a tinted group). */
  cellClassName?: string;
  /** Extra class on the column's header cell (e.g. data-table-column-gap). */
  headerClassName?: string;
  /** Opt-in sorting: the header becomes a button ordering the rows by this value (nulls last either way). */
  sortValue?: (row: TRow) => number | string | null;
}

export type DataTableSortDirection = "asc" | "desc";
type DataTableSort = { key: string; direction: DataTableSortDirection };

function sortStorageKeyFor(tableId: string): string {
  return `iorio-table-sort-${tableId}`;
}

function readStoredSort(tableId: string): DataTableSort | null {
  try {
    const stored = localStorage.getItem(sortStorageKeyFor(tableId));
    const parsed = stored ? (JSON.parse(stored) as Partial<DataTableSort>) : null;
    if (typeof parsed?.key !== "string" || (parsed.direction !== "asc" && parsed.direction !== "desc")) return null;
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return null;
  }
}

/** The gear's checkbox labels: blank headers left out; a header shared by several columns ("From" under Options and under
 *  Spot) gets its group label in front, so each checkbox says which column it is. */
function columnsForVisibilityList<TRow>(columns: DataTableColumn<TRow>[]): { key: string; header: string }[] {
  const labelled = columns.filter((column) => column.header !== "");
  const headerCounts = new Map<string, number>();
  for (const column of labelled) headerCounts.set(column.header, (headerCounts.get(column.header) ?? 0) + 1);
  return labelled.map((column) => ({ key: column.key, header: (headerCounts.get(column.header) ?? 0) > 1 && column.group ? `${column.group.label} ${column.header}` : column.header }));
}

/** Adjacent visible columns with the same group label, as header cells; ungrouped runs get one blank cell. */
function groupHeaderCells<TRow>(columns: DataTableColumn<TRow>[]): { key: string; label: string; className?: string; title?: string; span: number }[] {
  const cells: { key: string; label: string; className?: string; title?: string; span: number }[] = [];
  for (const column of columns) {
    const label = column.group?.label ?? "";
    const last = cells[cells.length - 1];
    if (last && last.label === label) last.span += 1;
    else cells.push({ key: column.key, label, className: column.group?.className, title: column.group?.title, span: 1 });
  }
  return cells;
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
  /** Extra data-* attributes per row (e.g. data-live-contracts for useVisibleLiveContracts); `index` is the row's position in `rows`. */
  rowAttributes?: (row: TRow, index: number) => Record<`data-${string}`, string>;
  /** Smaller type (0.8rem) for dense, many-column tables. */
  dense?: boolean;
  /** Caps the table body to roughly this many rows and makes it scroll (sticky header) instead of growing the page. */
  maxVisibleRows?: number;
  /** With sortable columns (sortValue): the order the rows start in until the user picks one (saved per tableId in localStorage). */
  defaultSort?: DataTableSort;
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
  rowAttributes,
  dense = false,
  maxVisibleRows,
  defaultSort,
}: DataTableProps<TRow>) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    tableId,
    columns.map((column) => column.key),
  );
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));
  const [chosenSort, setChosenSort] = useState(() => readStoredSort(tableId));
  // A saved sort on a column that is no longer sortable (renamed, removed) falls back to the default.
  const sort = chosenSort && columns.some((column) => column.key === chosenSort.key && column.sortValue) ? chosenSort : (defaultSort ?? null);
  const chooseSort = (next: DataTableSort) => {
    setChosenSort(next);
    try {
      localStorage.setItem(sortStorageKeyFor(tableId), JSON.stringify(next));
    } catch {
      // Storage unavailable (private window, blocked site data): the choice still applies for this page view.
    }
  };
  const sortedRows = useMemo(() => {
    const column = sort ? columns.find((candidate) => candidate.key === sort.key && candidate.sortValue) : undefined;
    if (!sort || !column?.sortValue) return rows;
    const valueOf = column.sortValue;
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const first = valueOf(a);
      const second = valueOf(b);
      if (first === null || second === null) return first === second ? 0 : first === null ? 1 : -1;
      if (typeof first === "string" || typeof second === "string") return sign * String(first).localeCompare(String(second));
      return sign * (first - second);
    });
  }, [rows, columns, sort]);
  /** A first click orders text A to Z and numbers largest first; another click reverses it. */
  const toggleSort = (column: DataTableColumn<TRow>) => {
    if (sort?.key === column.key) {
      chooseSort({ key: column.key, direction: sort.direction === "asc" ? "desc" : "asc" });
      return;
    }
    const sample = rows.map((row) => column.sortValue!(row)).find((value) => value !== null);
    chooseSort({ key: column.key, direction: typeof sample === "string" ? "asc" : "desc" });
  };
  const headerLabel = (column: DataTableColumn<TRow>) => {
    if (column.headerContent !== undefined) return column.headerContent;
    if (!column.sortValue) return <span>{column.header}</span>;
    const active = sort?.key === column.key;
    const Indicator = !active ? IconSelector : sort!.direction === "asc" ? IconChevronUp : IconChevronDown;
    return (
      <button type="button" className="data-table-sort-button" onClick={() => toggleSort(column)}>
        {column.header}
        <Indicator size={12} className={active ? "is-active" : undefined} aria-hidden="true" />
      </button>
    );
  };
  const ariaSort = (column: DataTableColumn<TRow>) => (column.sortValue ? (sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined);
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
            {visibleColumns.some((column) => column.group) && (
              <tr className="data-table-group-row">
                {groupHeaderCells(visibleColumns).map((cell) => (
                  <TooltipSpan as="th" key={`group-${cell.key}`} colSpan={cell.span} text={cell.title} className={cell.label ? cell.className : undefined}>
                    {cell.label}
                  </TooltipSpan>
                ))}
              </tr>
            )}
            <tr>
              {visibleColumns.map((column, index) => {
                const isLastColumn = index === visibleColumns.length - 1;
                return (
                  <TooltipSpan
                    as="th"
                    key={column.key}
                    text={column.headerTitle}
                    className={[alignClassName(column.align), column.headerClassName].filter(Boolean).join(" ") || undefined}
                    ariaSort={ariaSort(column)}
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
                        {headerLabel(column)}
                        {/* A column with no header (e.g. a trailing actions column) has
                            nothing meaningful to label a checkbox with and is never meant
                            to be hidden — exclude it from the toggle list rather than show
                            a blank row (found 2026-08-28). */}
                        <ColumnVisibilityPopover
                          columns={columnsForVisibilityList(columns)}
                          isColumnVisible={isColumnVisible}
                          onToggleColumn={toggleColumn}
                        />
                      </div>
                    ) : column.sortValue || column.headerContent !== undefined ? (
                      headerLabel(column)
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
                <td colSpan={visibleColumns.length} className="text-center text-secondary py-4">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, rowIndex) => (
                <tr
                  key={rowKey(row)}
                  {...rowAttributes?.(row, rowIndex)}
                  className={[rowClassName?.(row), onRowClick ? "cursor-pointer" : undefined].filter(Boolean).join(" ") || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={[alignClassName(column.align), column.cellClassName].filter(Boolean).join(" ") || undefined}>
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
