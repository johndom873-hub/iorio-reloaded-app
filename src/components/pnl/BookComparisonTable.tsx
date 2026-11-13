import type { ReactNode } from "react";
import type { AnalysisBook, BookRiskFigures, GatedFigure, GatedTradeFigure, PnlAnalysis, TradeStats } from "../../api/pnlAnalysis";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatDayMonth, formatPercentageValue, formatRatio, formatSignedPercentageValue, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { bookChoiceLabels, gatedNote } from "../../lib/pnlAnalysisPresentation";
import { TooltipSpan } from "../TooltipSpan";

const bookOrder: AnalysisBook[] = ["pluto", "manual", "all"];

interface Cell {
  text: string;
  className?: string;
  note?: string | null;
}

interface MetricRow {
  label: string;
  hint: string;
  cell: (risk: BookRiskFigures, trades: { csp: TradeStats; cc: TradeStats; both: TradeStats } | null) => Cell;
}

const noHistory: Cell = { text: "—", className: "text-secondary", note: "no nights" };

function gatedCell(figure: GatedFigure | GatedTradeFigure | null | undefined, format: (value: number) => string, noDenominatorNote?: string): Cell {
  const note = gatedNote(figure, noDenominatorNote);
  return note === null ? { text: format(figure!.value!) } : { text: "—", className: "text-secondary", note };
}

// The figures of each book side by side (formulas approved 2026-11-13; a dotted label holds its formula). Ratios that lack
// history say how much they have and need. The Dashboard shows the returns and risk rows only.
const returnRows: MetricRow[] = [
  { label: "P&L", hint: "Book value change less deposits and moves between books", cell: (risk) => ({ text: formatSignedPnl(risk.pnl, 0), className: pnlTextClass(risk.pnl) }) },
  { label: "Return", hint: "Time-weighted: the nightly returns chained, (1 + r1)(1 + r2)… − 1", cell: (risk) => ({ text: formatSignedPercentageValue(risk.returnPercent, 2), className: pnlTextClass(risk.returnPercent) }) },
  { label: "CAGR", hint: "(1 + Return) ^ (365 ÷ days) − 1, from 90 calendar days", cell: (risk) => gatedCell(risk.cagrPercent, (value) => formatSignedPercentageValue(value, 2)) },
];
const riskRows: MetricRow[] = [
  {
    label: "Max drawdown",
    hint: "Deepest fall of the growth index below its running peak",
    cell: (risk) => {
      const drawdown = risk.maxDrawdown;
      if (drawdown.percent === 0) return { text: formatSignedPercentageValue(0, 2) };
      const recovery = drawdown.recoveryNight ? `recovered ${formatDayMonth(drawdown.recoveryNight)}` : "not recovered";
      return { text: formatSignedPercentageValue(drawdown.percent, 2), className: "text-danger", note: `${formatSignedPnl(drawdown.dollars, 0)} · ${drawdown.lengthDays} d · ${recovery}` };
    },
  },
  { label: "Current drawdown", hint: "How far the growth index is below its peak tonight", cell: (risk) => ({ text: formatSignedPercentageValue(risk.currentDrawdownPercent, 2), className: risk.currentDrawdownPercent < 0 ? "text-danger" : "" }) },
  { label: "Volatility", hint: "Sample standard deviation of the daily returns × √252, from 60 returns", cell: (risk) => gatedCell(risk.volatilityPercent, (value) => formatPercentageValue(value, 2), "flat returns") },
  { label: "Sharpe", hint: "(mean daily return − T-bill ÷ 252) ÷ standard deviation × √252, from 60 returns", cell: (risk) => gatedCell(risk.sharpe, (value) => formatRatio(value), "flat returns") },
  { label: "Sortino", hint: "(mean daily return − T-bill ÷ 252) × √252 ÷ downside deviation, from 60 returns", cell: (risk) => gatedCell(risk.sortino, (value) => formatRatio(value), "no down days") },
  { label: "Excess Calmar", hint: "(CAGR − T-bill) ÷ |Max drawdown|, from 180 calendar days. Example: (18% − 4.05%) ÷ 6% = 2.33", cell: (risk) => gatedCell(risk.excessCalmar, (value) => formatRatio(value), "no drawdown") },
];
const dayRows: MetricRow[] = [
  { label: "Best day", hint: "Highest daily return in the period", cell: (risk) => (risk.bestDay ? { text: formatSignedPercentageValue(risk.bestDay.returnPercent, 2), className: pnlTextClass(risk.bestDay.returnPercent), note: formatDayMonth(risk.bestDay.night) } : noHistory) },
  { label: "Worst day", hint: "Lowest daily return in the period", cell: (risk) => (risk.worstDay ? { text: formatSignedPercentageValue(risk.worstDay.returnPercent, 2), className: pnlTextClass(risk.worstDay.returnPercent), note: formatDayMonth(risk.worstDay.night) } : noHistory) },
  { label: "Positive days", hint: "Share of nights with a positive return", cell: (risk) => ({ text: formatPercentageValue(risk.positiveDaysPercent, 0), note: `of ${risk.dailyReturnCount} nights` }) },
];
const tradeRows: MetricRow[] = [
  { label: "Win rate", hint: "Closed short options with a positive result ÷ all closed, from 10 closed; an assigned put is charged for its assignment", cell: (_, trades) => gatedCell(trades?.both.winRatePercent, (value) => formatPercentageValue(value, 0)) },
  { label: "Profit factor", hint: "Σ winning results ÷ |Σ losing results|, from 10 closed", cell: (_, trades) => gatedCell(trades?.both.profitFactor, (value) => formatRatio(value), "no losing trades") },
  { label: "Premium kept", hint: "(credit − buyback) ÷ credit at the fill prices, from 10 closed", cell: (_, trades) => gatedCell(trades?.both.premiumCapturePercent, (value) => formatPercentageValue(value, 0)) },
  { label: "Puts assigned", hint: "Assigned puts ÷ puts held to expiry, from 10 closed puts", cell: (_, trades) => gatedCell(trades?.csp.assignmentRatePercent, (value) => formatPercentageValue(value, 0), "none held to expiry") },
  { label: "Calls called away", hint: "Called-away calls ÷ calls held to expiry, from 10 closed calls", cell: (_, trades) => gatedCell(trades?.cc.calledAwayRatePercent, (value) => formatPercentageValue(value, 0), "none held to expiry") },
  { label: "Days held", hint: "Mean calendar days from the sale to the close, from 10 closed", cell: (_, trades) => gatedCell(trades?.both.averageDaysHeld, (value) => `${value.toFixed(1)} d`) },
];

const fullGroups: { title: string; rows: MetricRow[] }[] = [
  { title: "Returns", rows: returnRows },
  { title: "Risk", rows: riskRows },
  { title: "Days", rows: dayRows },
  { title: "Closed short options", rows: tradeRows },
];
const compactGroups: { title: string; rows: MetricRow[] }[] = [{ title: "", rows: [...returnRows, ...riskRows.filter((row) => row.label !== "Current drawdown" && row.label !== "Sharpe")] }];

function cellOf(analysis: PnlAnalysis, book: AnalysisBook, row: MetricRow): Cell {
  const bookAnalysis = analysis.books[book];
  return bookAnalysis.risk ? row.cell(bookAnalysis.risk, bookAnalysis.tradeStats) : noHistory;
}

function CellContent({ cell }: { cell: Cell }) {
  return (
    <>
      <div className={cell.className}>{cell.text}</div>
      {cell.note && (
        <div className="text-secondary" style={{ fontSize: "0.72rem", fontFamily: "var(--tblr-font-sans-serif)" }}>
          {cell.note}
        </div>
      )}
    </>
  );
}

function MetricLabel({ row }: { row: MetricRow }): ReactNode {
  return (
    <TooltipSpan text={row.hint} className="dotted-underline-label">
      {row.label}
    </TooltipSpan>
  );
}

/** Pluto, Manual and All books side by side; on a phone one block per book. */
export function BookComparisonTable({ analysis, variant, title }: { analysis: PnlAnalysis; variant: "full" | "compact"; title: string }) {
  const isPhone = useMediaQuery("(max-width: 575.98px)");
  const groups = variant === "full" ? fullGroups : compactGroups;

  if (isPhone) {
    return (
      <div className="d-flex flex-column gap-3">
        {bookOrder.map((book) => (
          <div key={book}>
            <div className="fw-semibold mb-1">{bookChoiceLabels[book]}</div>
            {analysis.books[book].risk === null ? (
              <div className="text-secondary">No nights in this period.</div>
            ) : (
            <table className="table table-sm table-vcenter card-table mb-0">
              <tbody>
                {groups.flatMap((group) => group.rows).map((row) => (
                  <tr key={row.label}>
                    <td><MetricLabel row={row} /></td>
                    <td className="text-end"><CellContent cell={cellOf(analysis, book, row)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm table-vcenter card-table mb-0">
        <thead className="table-light">
          <tr>
            <th>{title}</th>
            {bookOrder.map((book) => (
              <th key={book} className="text-end">{bookChoiceLabels[book]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => [
            group.title ? (
              <tr key={`group-${group.title}`} className="pnl-section-row">
                <td colSpan={4} className="text-secondary text-uppercase fw-semibold">{group.title}</td>
              </tr>
            ) : null,
            ...group.rows.map((row) => (
              <tr key={row.label}>
                <td><MetricLabel row={row} /></td>
                {bookOrder.map((book) => (
                  <td key={book} className="text-end"><CellContent cell={cellOf(analysis, book, row)} /></td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
