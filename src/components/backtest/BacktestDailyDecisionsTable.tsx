import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { BacktestSessionDay } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { pluralize } from "../../lib/formatters";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { BacktestCard, BacktestCardTitle } from "./backtestBits";

const daysPerPage = 25;

const columns: DataTableColumn<BacktestSessionDay>[] = [
  { key: "date", header: "Day", cellClassName: "font-mono text-nowrap", render: (day) => day.tradingDate },
  {
    key: "decision",
    header: "Decision at 10:00 ET",
    headerTitle: "What the session decided that morning, and why nothing opened when nothing did: the candidates it saw and the filters that turned them down.",
    cellClassName: "backtest-decision-cell",
    render: (day) => day.decisionSummary ?? <span className="text-secondary">no note</span>,
  },
];

/** Daily decisions: each day's note from the run, newest first, 25 a page, collapsible (remembered in this browser). */
export function BacktestDailyDecisionsTable({ days }: { days: BacktestSessionDay[] }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-daily-decisions", true);
  const [page, setPage] = useState(1);
  const newestFirst = [...days].reverse();
  const totalPages = Math.max(1, Math.ceil(newestFirst.length / daysPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = newestFirst.slice((currentPage - 1) * daysPerPage, currentPage * daysPerPage);
  const title = "Daily decisions";
  const description = `${pluralize(days.length, "day")} · newest first · why each day opened a trade or not`;

  const toggle = (
    <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
      <IconChevronDown size={16} aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      {isOpen ? "Hide" : "Show"}
    </button>
  );

  if (!isOpen || days.length === 0) {
    return (
      <BacktestCard title={title} description={days.length === 0 ? "the run has not recorded a day yet" : description} actions={days.length === 0 ? undefined : toggle} className="mt-3">
        {null}
      </BacktestCard>
    );
  }

  return (
    <div className="mt-3">
      <DataTable
        tableId="backtest-daily-decisions"
        columns={columns}
        rows={pageRows}
        rowKey={(day) => day.tradingDate}
        dense
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            {toggle}
          </>
        }
        afterTable={
          <div className="px-3 pb-3">
            <Pagination page={currentPage} pageSize={daysPerPage} totalRows={newestFirst.length} onPageChange={setPage} />
          </div>
        }
      />
    </div>
  );
}
