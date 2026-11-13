import { useState } from "react";
import type { AnalysisBook, PnlAnalysis } from "../../api/pnlAnalysis";
import { formatDayMonth, formatSignedPnl, formatYearMonth, pnlTextClass, showsAsZeroDollars } from "../../lib/formatters";
import { bookChoiceLabels, overTimeSeries, type OverTimeGranularity, type OverTimeGroup, type OverTimePeriod } from "../../lib/pnlAnalysisPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { PnlOverTimeChart } from "./PnlOverTimeChart";

function periodLabel(key: string, granularity: OverTimeGranularity): string {
  if (granularity === "month") return formatYearMonth(key);
  return granularity === "week" ? `Week of ${formatDayMonth(key)}` : formatDayMonth(key);
}

function ChoiceGroup<TValue extends string>({ label, choices, value, onChange }: { label: string; choices: [TValue, string][]; value: TValue; onChange: (value: TValue) => void }) {
  return (
    <div className="btn-group" role="group" aria-label={label}>
      {choices.map(([choice, text]) => (
        <button key={choice} type="button" className={`btn btn-outline-secondary${value === choice ? " active" : ""}`} aria-pressed={value === choice} onClick={() => onChange(choice)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SignedCell({ value, blankWhenZero = false }: { value: number; blankWhenZero?: boolean }) {
  if (blankWhenZero && showsAsZeroDollars(value)) return null;
  return <span className={pnlTextClass(value)}>{formatSignedPnl(value, 0)}</span>;
}

// The P&L Analyser's Over time tab (mockup approved 2026-11-13): the chart, then the same figures per period, newest first.
// The table's columns depend on the grouping, so each grouping keeps its own column choices.
export function PnlOverTimeTab({ analysis, book }: { analysis: PnlAnalysis; book: AnalysisBook }) {
  const [group, setGroup] = useState<OverTimeGroup>("strategy");
  const [granularity, setGranularity] = useState<OverTimeGranularity>("week");
  const nights = analysis.books[book].nights;
  const { series, periods } = overTimeSeries(nights, group, granularity);
  const totalOf = (key: string) => periods.reduce((sum, period) => sum + period.values[key]!, 0);
  const bookTotal = periods.reduce((sum, period) => sum + period.bookPnl, 0);

  const columns: DataTableColumn<OverTimePeriod>[] = [
    { key: "period", header: granularity === "day" ? "Night" : granularity === "week" ? "Week" : "Month", sortValue: (period) => period.key, freezeOnPhone: true, cellClassName: "text-nowrap", render: (period) => periodLabel(period.key, granularity) },
    ...series.map((one): DataTableColumn<OverTimePeriod> => ({ key: one.key, header: one.label, align: "right", sortValue: (period) => period.values[one.key]!, render: (period) => <SignedCell value={period.values[one.key]!} blankWhenZero /> })),
    { key: "bookPnl", header: `${bookChoiceLabels[book]} P&L`, align: "right", sortValue: (period) => period.bookPnl, cellClassName: "fw-bold", render: (period) => <SignedCell value={period.bookPnl} /> },
  ];
  const footerCells = Object.fromEntries([["period", "Total"], ...series.map((one) => [one.key, <SignedCell key={one.key} value={totalOf(one.key)} />]), ["bookPnl", <SignedCell key="bookPnl" value={bookTotal} />]]);

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-1">
        <ChoiceGroup label="Group by" choices={[["strategy", "By strategy"], ["component", "By component"]]} value={group} onChange={setGroup} />
        <ChoiceGroup label="Bars per" choices={[["day", "Day"], ["week", "Week"], ["month", "Month"]]} value={granularity} onChange={setGranularity} />
      </div>
      <PnlOverTimeChart nights={nights} group={group} granularity={granularity} />
      <DataTable
        embedded
        tableId={`pnl-analysis-over-time-${group}`}
        columns={columns}
        rows={periods}
        rowKey={(period) => period.key}
        defaultSort={{ key: "period", direction: "desc" }}
        footerCells={footerCells}
        maxVisibleRows={10}
        emptyMessage="No nights in this period."
      />
    </>
  );
}
