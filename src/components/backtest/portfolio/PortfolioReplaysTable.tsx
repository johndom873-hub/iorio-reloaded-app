import type { PortfolioProjection } from "../../../api/backtestPortfolio";
import { formatDayMonthYear, formatNumber, formatPercentage } from "../../../lib/formatters";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { BacktestCardTitle, SignedPercent } from "../backtestBits";

type Replay = PortfolioProjection["replays"][number];

const columns: DataTableColumn<Replay>[] = [
  { key: "window", header: "Window", render: (row) => <span className="fw-semibold">{row.name}</span> },
  { key: "dates", header: "Dates", render: (row) => `${formatDayMonthYear(row.from)} – ${formatDayMonthYear(row.to)}` },
  { key: "sessions", header: "Sessions", align: "right", render: (row) => formatNumber(row.days) },
  { key: "bookReturn", header: "Book return", align: "right", render: (row) => <SignedPercent fraction={row.bookReturn} /> },
  { key: "maxDrawdown", header: "Book Max drawdown", align: "right", render: (row) => formatPercentage(row.maxDrawdown) },
  { key: "spyReturn", header: "SPY return", align: "right", render: (row) => <SignedPercent fraction={row.spyReturn} /> },
];

/** Today's book through 2008, Covid and 2022: each window's actual days once, at the actual drift. */
export function PortfolioReplaysTable({ replays }: { replays: Replay[] }) {
  return (
    <DataTable
      tableId="portfolio-simulator-replays"
      columns={columns}
      rows={replays}
      rowKey={(row) => row.name}
      toolbar={<BacktestCardTitle title="Today's book through past crashes" description="each window's actual days, once, at the actual drift; a ticker not yet listed moves as β × SPY; SPY with its dividends reinvested" />}
    />
  );
}
