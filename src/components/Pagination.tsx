interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}

// Client-side pager for tables whose full row set is already in memory.
// Renders nothing when everything fits on one page.
export function Pagination({ page, pageSize, totalRows, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (totalPages <= 1) return null;

  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalRows);

  return (
    <div className="d-flex flex-column flex-sm-row align-items-center justify-content-between gap-2 mt-3">
      <div className="text-muted" style={{ fontSize: "0.8rem" }}>
        {firstRow}–{lastRow} of {totalRows}
      </div>
      <div className="btn-group" role="group" aria-label="Pagination">
        <button type="button" className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span className="btn btn-outline-secondary disabled text-nowrap">
          Page {page} of {totalPages}
        </span>
        <button type="button" className="btn btn-outline-secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
