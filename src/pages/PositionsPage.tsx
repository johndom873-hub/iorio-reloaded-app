import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";

interface PositionRow {
  id: string;
  ticker: string;
  strategy: string;
  status: string;
}

const columns: DataTableColumn<PositionRow>[] = [
  { key: "ticker", header: "Ticker", render: (row) => row.ticker },
  { key: "strategy", header: "Strategy", render: (row) => row.strategy },
  { key: "status", header: "Status", render: (row) => row.status },
];

export function PositionsPage() {
  return (
    <>
      <PageHeader
        title="Positions"
        subtitle="Open and closed positions across all strategies"
        actions={
          <button type="button" className="btn btn-primary">
            + New Position
          </button>
        }
      />
      <DataTable
        tableId="positions"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage="No positions yet — this screen isn't wired up to real data yet."
      />
    </>
  );
}
