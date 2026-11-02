import { useMemo, useState } from "react";
import type { BacktestMetrics } from "../../../api/backtest";
import type { AnalysisBacktestFigures } from "../../../api/backtestAnalysis";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage, formatRatio, formatSignedPercentage, formatThousands } from "../../../lib/formatters";
import { ColumnVisibilityPopover } from "../../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../DataTable/useColumnVisibility";
import { AnalysisCard } from "./analysisBits";
import { niceStep } from "./analysisHoldingChartModel";

// The analysis backtest (Vol Farmer v4, mockup approved 2026-11-01): the account against buy and hold with its drawdown,
// the session's metrics, Month by month with the year rows (F21), and the wheel cycles.

const mondayOf = (dateIso: string) => {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

/** The account, the stock held and SPY held at each week's last session, with the account's drawdown from its last peak. */
function AccountValueChart({ symbol, backtest }: { symbol: string; backtest: AnalysisBacktestFigures }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const lastOfWeek = new Map<string, AnalysisBacktestFigures["days"][number]>();
    for (const day of backtest.days) lastOfWeek.set(mondayOf(day[0]), day);
    const weeks = [...lastOfWeek.values()].map(([date, account, hold, spy, drawdown]) => ({ date, account, hold, spy, drawdown }));
    if (weeks.length < 2) return null;
    const count = weeks.length;
    const xOf = (index: number) => 56 + (index / (count - 1)) * 640;
    const highest = Math.max(...weeks.map((week) => Math.max(week.account, week.hold, week.spy ?? 0)));
    const step = niceStep(highest, 6);
    const top = Math.ceil(highest / step) * step;
    const valueYOf = (value: number) => 12 + (1 - value / top) * 210;
    const deepest = Math.min(...weeks.map((week) => week.drawdown), -0.1);
    const drawdownFloor = Math.ceil(-deepest * 10) / 10;
    const drawdownYOf = (value: number) => 250 + (-value / drawdownFloor) * 64;
    const lineOf = (valueOf: (week: (typeof weeks)[number]) => number | null) => weeks.flatMap((week, index) => (valueOf(week) === null ? [] : [`${xOf(index).toFixed(1)},${valueYOf(valueOf(week)!).toFixed(1)}`])).join(" ");
    const last = weeks.at(-1)!;
    const ends = [
      { label: `VF v4 ${formatThousands(last.account)}`, y: valueYOf(last.account) },
      { label: `${symbol} ${formatThousands(last.hold)}`, y: valueYOf(last.hold) },
      ...(last.spy === null ? [] : [{ label: `SPY ${formatThousands(last.spy)}`, y: valueYOf(last.spy) }]),
    ].sort((a, b) => a.y - b.y);
    for (let index = 1; index < ends.length; index += 1) ends[index]!.y = Math.max(ends[index]!.y, ends[index - 1]!.y + 14);
    const grid: { y: number; label: string }[] = [];
    for (let value = 0; value <= top + step / 2; value += step) grid.push({ y: valueYOf(value), label: formatThousands(value) });
    const ticks = weeks.flatMap((week, index) => (index > 0 && week.date.slice(0, 4) !== weeks[index - 1]!.date.slice(0, 4) ? [{ x: xOf(index), label: week.date.slice(0, 4) }] : []));
    const drawdownArea = ["56,250", ...weeks.map((week, index) => `${xOf(index).toFixed(1)},${drawdownYOf(week.drawdown).toFixed(1)}`), `${xOf(count - 1).toFixed(1)},250`].join(" ");
    const targets = weeks.map((_, index) => {
      const from = index === 0 ? 56 : (xOf(index - 1) + xOf(index)) / 2;
      const to = index === count - 1 ? 696 : (xOf(index) + xOf(index + 1)) / 2;
      return { x: from, width: Math.max(0.5, to - from) };
    });
    return { weeks, xOf, valueYOf, grid, startY: valueYOf(backtest.startingValue), account: lineOf((week) => week.account), hold: lineOf((week) => week.hold), spy: lineOf((week) => week.spy), ends, ticks, drawdownArea, drawdownFloor, drawdownYOf, targets };
  }, [backtest, symbol]);
  if (!chart) return null;
  const hover = hoverIndex === null ? null : (() => {
    const week = chart.weeks[hoverIndex]!;
    const x = chart.xOf(hoverIndex);
    const boxX = x + 196 > 820 ? x - 186 : x + 10;
    return { x, week, boxX };
  })();
  return (
    <figure className="m-0">
      <div className="analysis-legend mb-1">
        <span className="analysis-legend-item">
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" x2="18" y1="2" y2="2" className="analysis-svg-line is-account" />
          </svg>
          VF v4
        </span>
        <span className="analysis-legend-item">
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" x2="18" y1="2" y2="2" className="analysis-svg-line is-hold" />
          </svg>
          Buy and hold · {symbol}
        </span>
        <span className="analysis-legend-item">
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" x2="18" y1="2" y2="2" className="analysis-svg-line is-spy" />
          </svg>
          Buy and hold · SPY
        </span>
      </div>
      <svg viewBox="0 0 820 340" className="analysis-svg" role="img" aria-label={`Account value by week: VF v4 ends at ${formatThousands(backtest.metrics?.endValue ?? 0)}, ${symbol} held at ${formatThousands(backtest.buyAndHoldMetrics?.endValue ?? 0)}; with VF v4's drawdown from its last peak`} onMouseLeave={() => setHoverIndex(null)}>
        {chart.grid.map((line) => (
          <g key={line.label}>
            <line x1={56} x2={696} y1={line.y} y2={line.y} className="analysis-svg-grid" />
            <text x={48} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
              {line.label}
            </text>
          </g>
        ))}
        <line x1={56} x2={696} y1={chart.startY} y2={chart.startY} className="analysis-svg-dashed is-start" />
        <polyline points={chart.spy} className="analysis-svg-line is-spy" />
        <polyline points={chart.hold} className="analysis-svg-line is-hold" />
        <polyline points={chart.account} className="analysis-svg-line is-account" />
        {chart.ends.map((end) => (
          <text key={end.label} x={704} y={end.y + 4} className="analysis-svg-text is-body">
            {end.label}
          </text>
        ))}
        <text x={56} y={244} className="analysis-svg-text is-pane">
          Drawdown from the last peak
        </text>
        {[0, chart.drawdownFloor / 2, chart.drawdownFloor].map((depth) => (
          <g key={depth}>
            <line x1={56} x2={696} y1={chart.drawdownYOf(-depth)} y2={chart.drawdownYOf(-depth)} className="analysis-svg-grid" />
            <text x={48} y={chart.drawdownYOf(-depth) + 4} textAnchor="end" className="analysis-svg-text">
              {formatPercentage(-depth, 0)}
            </text>
          </g>
        ))}
        <polygon points={chart.drawdownArea} className="analysis-svg-area is-drawdown" />
        {chart.ticks.map((tick) => (
          <text key={tick.label} x={tick.x} y={332} textAnchor="middle" className="analysis-svg-text">
            {tick.label}
          </text>
        ))}
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={12} y2={314} className="analysis-svg-cursor" />
            <circle cx={hover.x} cy={chart.valueYOf(hover.week.account)} r={4} className="analysis-svg-cursor-dot is-account" />
            <circle cx={hover.x} cy={chart.valueYOf(hover.week.hold)} r={4} className="analysis-svg-cursor-dot is-hold" />
            {hover.week.spy !== null && <circle cx={hover.x} cy={chart.valueYOf(hover.week.spy)} r={4} className="analysis-svg-cursor-dot is-spy" />}
            <rect x={hover.boxX} y={16} width={176} height={86} rx={6} className="analysis-svg-tooltip" />
            <text x={hover.boxX + 10} y={34} className="analysis-svg-text is-strong">
              {formatDayMonthYear(hover.week.date)}
            </text>
            <text x={hover.boxX + 10} y={50} className="analysis-svg-text is-body">
              VF v4 {formatThousands(hover.week.account)}
            </text>
            <text x={hover.boxX + 10} y={64} className="analysis-svg-text is-body">
              {symbol} held {formatThousands(hover.week.hold)}
            </text>
            <text x={hover.boxX + 10} y={78} className="analysis-svg-text is-body">
              SPY held {hover.week.spy === null ? "—" : formatThousands(hover.week.spy)}
            </text>
            <text x={hover.boxX + 10} y={92} className="analysis-svg-text is-body">
              Drawdown {formatPercentage(hover.week.drawdown)}
            </text>
          </>
        )}
        {chart.targets.map((target, index) => (
          <rect key={index} x={target.x} y={12} width={target.width} height={302} className="analysis-svg-hit" onMouseEnter={() => setHoverIndex(index)} />
        ))}
      </svg>
      <figcaption className="analysis-chart-caption">Account value at each week's last session, in thousands of dollars; the dashed line is the starting {formatCurrency(backtest.startingValue, 0)}.</figcaption>
    </figure>
  );
}

const metricColumns = [
  { key: "totalReturn", header: "Total return" },
  { key: "cagr", header: "CAGR" },
  { key: "sortino", header: "Sortino" },
  { key: "maxDrawdown", header: "Max drawdown" },
  { key: "worstMonth", header: "Worst month" },
  { key: "excessCalmar", header: "Excess Calmar" },
];

interface AnalysisBacktestCardProps {
  symbol: string;
  backtest: AnalysisBacktestFigures;
  /** The month the steady weeklies start ("2020-01"); null when they never do (the backtest runs from the file's first day). */
  steadyWeekliesFrom: string | null;
  isTrial: boolean;
  onOpenSession: () => void;
}

export function AnalysisBacktestCard({ symbol, backtest, steadyWeekliesFrom, isTrial, onOpenSession }: AnalysisBacktestCardProps) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-v4-backtest-metrics", metricColumns.map((column) => column.key));
  const metrics = backtest.metrics;
  const rows: { label: string; strong: boolean; metrics: BacktestMetrics | null; calmar: number | null }[] = [
    { label: "VF v4", strong: true, metrics, calmar: backtest.excessCalmar.v4 },
    { label: `${symbol}, held`, strong: false, metrics: backtest.buyAndHoldMetrics, calmar: backtest.excessCalmar.hold },
    { label: "SPY, held", strong: false, metrics: backtest.spyMetrics, calmar: backtest.excessCalmar.spy },
  ];
  const closedCycles = backtest.cycles.filter((cycle) => !cycle[1]).length;
  const openCycles = backtest.cycles.length - closedCycles;
  const cyclePnl = backtest.cycles.reduce((total, cycle) => total + cycle[5], 0);
  const value = (row: (typeof rows)[number], key: string) => {
    const entry = row.metrics;
    if (key === "excessCalmar") return formatRatio(row.calmar);
    if (!entry) return "—";
    if (key === "totalReturn") return formatSignedPercentage(entry.totalReturn);
    if (key === "cagr") return formatPercentage(entry.cagr);
    if (key === "sortino") return formatRatio(entry.sortino);
    if (key === "maxDrawdown") return formatPercentage(entry.maxDrawdown);
    return formatPercentage(entry.worstMonth);
  };
  const dates = backtest.maxDrawdownDates;
  return (
    <AnalysisCard
      title="Backtest"
      description={`Vol Farmer v4 at the lab's values${isTrial ? ", a trial" : ""} · ${formatCurrency(backtest.startingValue, 0)} (a ${formatCurrency(backtest.startingPotDollars, 0)} pot) · ${formatDayMonthYear(backtest.startDate)} → ${formatDayMonthYear(backtest.endDate)}, ${steadyWeekliesFrom ? "from the start of steady weeklies" : "from the file's first day (it never has steady weeklies)"} to the file's end. Marked every trading day at 10:00 ET; buy and hold for comparison only.`}
      actions={
        <button type="button" className="btn btn-outline-secondary" onClick={onOpenSession}>
          Open the session
        </button>
      }
    >
      <div className="card-body analysis-backtest-grid">
        <AccountValueChart symbol={symbol} backtest={backtest} />
        <div className="d-flex flex-column gap-3">
          <div>
            <div className="d-flex justify-content-end mb-1">
              <ColumnVisibilityPopover columns={metricColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-vcenter mb-0 analysis-bordered-table analysis-wrap-head">
                <thead className="table-light">
                  <tr>
                    <th />
                    {metricColumns.filter((column) => isColumnVisible(column.key)).map((column) => (
                      <th key={column.key} className="text-end">
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className={`text-nowrap ${row.strong ? "fw-semibold" : "fw-normal"}`}>
                        {row.label}
                      </th>
                      {metricColumns.filter((column) => isColumnVisible(column.key)).map((column) => (
                        <td key={column.key} className="text-end font-monospace">
                          {value(row, column.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <dl className="analysis-stat-list analysis-stat-grid-2">
            <div>
              <dt>Wheel cycle P&amp;L</dt>
              <dd>
                {formatCurrency(cyclePnl, 0)} <span className="analysis-plain">· {formatNumber(closedCycles)} closed cycles{openCycles > 0 ? `, ${formatNumber(openCycles)} open` : ""}; interest not included</span>
              </dd>
            </div>
            <div>
              <dt>T-bill interest on cash</dt>
              <dd>
                {formatCurrency(backtest.interest?.pnlDollars, 0)} <span className="analysis-plain">· T-bill CAGR {formatPercentage(backtest.treasuryBillCagr)}</span>
              </dd>
            </div>
            <div>
              <dt>Capital in use</dt>
              <dd>
                {formatPercentage(metrics?.capitalInUse, 0)} of the account <span className="analysis-plain">· earning {formatPercentage(metrics?.returnOnCapitalInUse)} a year</span>
              </dd>
            </div>
            <div>
              <dt>Top-ups</dt>
              <dd>
                {formatNumber(backtest.topUps.count)}{" "}
                <span className="analysis-plain">
                  · {formatNumber(backtest.topUps.lots)} lots, {formatCurrency(backtest.topUps.dollars, 0)}; {backtest.trims.count === 0 ? "no trims" : `${formatNumber(backtest.trims.count)} trims, ${formatNumber(backtest.trims.lots)} lots, ${formatCurrency(backtest.trims.dollars, 0)}`}
                </span>
              </dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd>
                {formatPercentage(metrics?.maxDrawdown)} {dates && <span className="analysis-plain">· {formatDayMonthYear(dates.peak)} → {formatDayMonthYear(dates.trough)}, {dates.back ? `back on ${formatDayMonthYear(dates.back)}` : "not back yet"}</span>}
              </dd>
            </div>
            <div>
              <dt>Upside given up at call-aways</dt>
              <dd>
                {formatCurrency(backtest.upsideGivenUp.dollars, 0)} <span className="analysis-plain">· {formatNumber(backtest.upsideGivenUp.callAwaysWithUpside)} of {formatNumber(backtest.upsideGivenUp.callAways)}, the next session opening above the strike</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </AnalysisCard>
  );
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yearColumns = (symbol: string) => [
  { key: "months", header: "Months" },
  { key: "v4", header: "VF v4" },
  { key: "hold", header: `${symbol} held` },
  { key: "spy", header: "SPY held" },
  { key: "tbills", header: "T-bills" },
  { key: "v4Drawdown", header: "VF v4 Max drawdown" },
  { key: "holdDrawdown", header: `${symbol} Max drawdown` },
];

export function AnalysisMonthByMonthCard({ symbol, backtest }: { symbol: string; backtest: AnalysisBacktestFigures }) {
  const columns = yearColumns(symbol);
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-v4-month-by-month", columns.map((column) => column.key));
  const byMonth = new Map(backtest.monthly.map(([month, v4]) => [month, v4]));
  const visible = (key: string) => isColumnVisible(key);
  return (
    <AnalysisCard
      title="Month by month"
      description={`VF v4's return each month, % of the account at the month's start; the year compounds its months. Shaded years: VF v4 against holding ${symbol}.`}
      actions={<ColumnVisibilityPopover columns={columns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
    >
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table analysis-rag-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Year</th>
              {visible("months") &&
                monthNames.map((month) => (
                  <th key={month} className="text-end">
                    {month}
                  </th>
                ))}
              {columns.slice(1).filter((column) => visible(column.key)).map((column, index) => (
                <th key={column.key} className="text-end" style={index === 0 && visible("months") ? { borderLeft: "1px solid var(--tblr-border-color)" } : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {backtest.years.map((row) => {
              const yearCells: Record<string, React.ReactNode> = {
                v4: formatSignedPercentage(row.v4Return),
                hold: formatSignedPercentage(row.holdReturn),
                spy: formatSignedPercentage(row.spyReturn),
                tbills: formatSignedPercentage(row.treasuryBillReturn),
                v4Drawdown: formatPercentage(row.v4MaxDrawdown),
                holdDrawdown: formatPercentage(row.holdMaxDrawdown),
              };
              const tint: Record<string, string> = {
                v4: row.holdReturn === null ? "" : row.v4Return >= row.holdReturn ? "analysis-cell-good" : "analysis-cell-poor",
                v4Drawdown: row.holdMaxDrawdown === null ? "" : row.v4MaxDrawdown >= row.holdMaxDrawdown ? "analysis-cell-good" : "analysis-cell-poor",
              };
              return (
                <tr key={row.year}>
                  <th scope="row">{row.year}</th>
                  {visible("months") &&
                    monthNames.map((_, monthIndex) => {
                      const monthReturn = byMonth.get(`${row.year}-${String(monthIndex + 1).padStart(2, "0")}`);
                      return (
                        <td key={monthIndex} className={`text-end font-monospace ${monthReturn === undefined ? "" : monthReturn >= 0 ? "backtest-month-gain" : "backtest-month-loss"}`} style={{ fontSize: "0.78rem" }}>
                          {monthReturn === undefined ? "" : formatSignedPercentage(monthReturn)}
                        </td>
                      );
                    })}
                  {columns.slice(1).filter((column) => visible(column.key)).map((column, index) => (
                    <td key={column.key} className={`text-end font-monospace ${tint[column.key] ?? ""}${column.key === "v4" ? " fw-semibold" : ""}`} style={index === 0 && visible("months") ? { borderLeft: "1px solid var(--tblr-border-color)" } : undefined}>
                      {yearCells[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AnalysisCard>
  );
}

const cycleColumns = (symbol: string) => [
  { key: "pnl", header: "Cycle P&L" },
  { key: "return", header: "Return" },
  { key: "hold", header: symbol },
  { key: "status", header: "Status" },
  { key: "opened", header: "Opened" },
  { key: "closed", header: "Closed" },
  { key: "sessions", header: "Sessions" },
  { key: "calls", header: "Calls sold" },
  { key: "premium", header: "Net premium" },
  { key: "stock", header: "Stock P&L" },
];

export function AnalysisWheelCyclesCard({ symbol, backtest }: { symbol: string; backtest: AnalysisBacktestFigures }) {
  const columns = cycleColumns(symbol);
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-v4-wheel-cycles", columns.map((column) => column.key));
  const closed = backtest.cycles.filter((cycle) => !cycle[1]).length;
  const open = backtest.cycles.length - closed;
  const visible = (key: string) => isColumnVisible(key);
  const totals = backtest.cycles.reduce((sum, cycle) => ({ pnl: sum.pnl + cycle[5], calls: sum.calls + cycle[8], premium: sum.premium + cycle[9], stock: sum.stock + cycle[10] }), { pnl: 0, calls: 0, premium: 0, stock: 0 });
  const right = new Set(["pnl", "return", "hold", "sessions", "calls", "premium", "stock"]);
  return (
    <AnalysisCard
      title="Wheel cycles"
      description={`${formatNumber(closed)} closed cycles${open > 0 ? ` · ${formatNumber(open)} open` : ""}. A cycle runs from its first shares bought to the last called away; v4 buys them back at the next look, so most cycles are days long.`}
      actions={<ColumnVisibilityPopover columns={columns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
    >
      <div className="table-responsive analysis-scroll-table">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Cycle</th>
              {columns.filter((column) => visible(column.key)).map((column) => (
                <th key={column.key} className={right.has(column.key) ? "text-end" : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {backtest.cycles.map(([number, isOpen, opened, closedOn, sessions, pnl, accountReturn, stockChange, calls, premium, stock]) => {
              const cells: Record<string, React.ReactNode> = {
                pnl: <span className={pnl < 0 ? "analysis-ink-poor" : undefined}>{formatCurrency(pnl, 0)}</span>,
                return: formatSignedPercentage(accountReturn),
                hold: formatSignedPercentage(stockChange),
                status: isOpen ? <span className="fw-semibold">Open</span> : <span className="text-secondary">Closed</span>,
                opened: formatDayMonthYear(opened),
                closed: closedOn ? formatDayMonthYear(closedOn) : "",
                sessions: formatNumber(sessions),
                calls: formatNumber(calls),
                premium: formatCurrency(premium, 0),
                stock: formatCurrency(stock, 0),
              };
              return (
                <tr key={number}>
                  <td className="font-monospace">#{number}</td>
                  {columns.filter((column) => visible(column.key)).map((column) => (
                    <td key={column.key} className={`font-monospace${right.has(column.key) ? " text-end" : ""}`}>
                      {cells[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="table-totals-row">
            <tr>
              <td>All</td>
              {columns.filter((column) => visible(column.key)).map((column) => (
                <td key={column.key} className={`font-monospace${right.has(column.key) ? " text-end" : ""}`}>
                  {column.key === "pnl" ? formatCurrency(totals.pnl, 0) : column.key === "calls" ? formatNumber(totals.calls) : column.key === "premium" ? formatCurrency(totals.premium, 0) : column.key === "stock" ? formatCurrency(totals.stock, 0) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </AnalysisCard>
  );
}
