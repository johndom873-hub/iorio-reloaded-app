import type { BacktestMetrics } from "../../api/backtest";
import { useTheme } from "../../contexts/ThemeContext";
import { formatCurrency, formatRatio } from "../../lib/formatters";
import { backtestMetricExplanation, backtestSeriesColorsByTheme, buyAndHoldColorByTheme, spyBuyAndHoldColorByTheme } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle, BacktestSeriesSwatch, SignedPercent } from "./backtestBits";

interface ComparisonRow {
  key: "session" | "baseline" | "spy";
  name: string;
  metrics: BacktestMetrics | null;
  color: string;
  line: "solid" | "dashed" | "dotted";
}

const columns: DataTableColumn<ComparisonRow>[] = [
  {
    key: "series",
    header: "Series",
    cellClassName: "text-nowrap",
    render: (row) => (
      <span className="d-inline-flex align-items-center gap-2">
        <BacktestSeriesSwatch color={row.color} line={row.line} />
        <span className={row.key === "session" ? "fw-semibold" : undefined}>{row.name}</span>
      </span>
    ),
  },
  { key: "totalReturn", header: "Total return", headerTitle: backtestMetricExplanation.totalReturn, align: "right", render: (row) => <SignedPercent fraction={row.metrics?.totalReturn} /> },
  { key: "cagr", header: "CAGR", headerTitle: backtestMetricExplanation.cagr, align: "right", render: (row) => <SignedPercent fraction={row.metrics?.cagr} /> },
  { key: "sortino", header: "Sortino", headerTitle: backtestMetricExplanation.sortino, align: "right", render: (row) => formatRatio(row.metrics?.sortino, 2) },
  { key: "maxDrawdown", header: "Max drawdown", headerTitle: backtestMetricExplanation.maxDrawdown, align: "right", render: (row) => <SignedPercent fraction={row.metrics?.maxDrawdown} /> },
  { key: "worstMonth", header: "Worst month", headerTitle: backtestMetricExplanation.worstMonth, align: "right", render: (row) => <SignedPercent fraction={row.metrics?.worstMonth} /> },
  { key: "endValue", header: "End value", headerTitle: "The account value on the last session day, at 10:00 ET.", align: "right", render: (row) => (row.metrics ? formatCurrency(row.metrics.endValue, 0) : "—") },
];

interface BacktestBaselineComparisonTableProps {
  metrics: BacktestMetrics | null;
  baselineMetrics: BacktestMetrics | null;
  baselineLabel: string;
  spyBaselineMetrics: BacktestMetrics | null;
  spyBaselineLabel: string;
}

/** The session's account figures beside buy and hold of its symbols (equal dollars) and of SPY, measured with the same
 *  formulas. Comparison only: nothing in the session depends on them. SPY's row is left out on a session run before it was kept. */
export function BacktestBaselineComparisonTable({ metrics, baselineMetrics, baselineLabel, spyBaselineMetrics, spyBaselineLabel }: BacktestBaselineComparisonTableProps) {
  const { theme } = useTheme();
  const rows: ComparisonRow[] = [
    { key: "session", name: "This session", metrics, color: backtestSeriesColorsByTheme[theme][0], line: "solid" },
    { key: "baseline", name: baselineLabel, metrics: baselineMetrics, color: buyAndHoldColorByTheme[theme], line: "dashed" },
    ...(spyBaselineMetrics ? [{ key: "spy" as const, name: spyBaselineLabel, metrics: spyBaselineMetrics, color: spyBuyAndHoldColorByTheme[theme], line: "dotted" as const }] : []),
  ];

  return (
    <DataTable
      tableId="backtest-baseline-comparison"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      dense
      toolbar={<BacktestCardTitle title="Against buy and hold" description="comparison only: the same figures for buying the shares on day one and holding them" />}
      afterTable={
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          {backtestMetricExplanation.symbolsBuyAndHold} {spyBaselineMetrics ? backtestMetricExplanation.spyBuyAndHold : "Buy and hold of SPY is not available on this session: it was run before SPY's line was kept, or SPY had no prices in its period."}
        </div>
      }
    />
  );
}
