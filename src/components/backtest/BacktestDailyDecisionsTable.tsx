import { useState } from "react";
import type { BacktestSessionDay } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatNumber, pluralizeCount } from "../../lib/formatters";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Pagination } from "../Pagination";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";

const daysPerPage = 25;

function columnsFor(looksReplayed: boolean): DataTableColumn<BacktestSessionDay>[] {
  return [
    { key: "date", header: "Day", cellClassName: "font-mono text-nowrap", render: (day) => day.tradingDate },
    ...(looksReplayed
      ? [
          { key: "looks", header: "Looks", headerTitle: "Looks run that day inside Pluto's window: 12 on a full day with intraday quotes, 1 when only the 10:00 quotes exist.", align: "right" as const, render: (day: BacktestSessionDay) => formatNumber(day.looksRun) },
          { key: "actions", header: "Actions", headerTitle: "Actions filled that day, over all its looks.", align: "right" as const, render: (day: BacktestSessionDay) => formatNumber(day.actionsTaken) },
        ]
      : []),
    {
      key: "decision",
      header: looksReplayed ? "What the looks did" : "Decision at 10:00 ET",
      headerTitle: looksReplayed
        ? "What each look did (opened, rolled, closed, blocked or no action) and why: the candidates it saw, the checks that refused a choice, the filters that turned the rest down."
        : "What that morning's look did (opened, rolled, closed, blocked or no action) and why: the candidates it saw, the checks that refused a choice, the filters that turned the rest down.",
      cellClassName: "backtest-decision-cell",
      render: (day) => day.decisionSummary ?? <span className="text-secondary">no note</span>,
    },
  ];
}

/** Daily decisions: each day's note from the run, with its looks and actions, newest first, 25 a page, collapsible
 *  (remembered in this browser). */
export function BacktestDailyDecisionsTable({ days }: { days: BacktestSessionDay[] }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-daily-decisions", true);
  const [page, setPage] = useState(1);
  const newestFirst = [...days].reverse();
  const totalPages = Math.max(1, Math.ceil(newestFirst.length / daysPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows = newestFirst.slice((currentPage - 1) * daysPerPage, currentPage * daysPerPage);
  const title = "Daily decisions";
  const looksReplayed = days.some((day) => day.looksRun !== null);
  const description = `${pluralizeCount(days.length, "day")} · newest first · what each day's ${looksReplayed ? "looks" : "look"} did, and why`;

  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

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
        columns={columnsFor(looksReplayed)}
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
