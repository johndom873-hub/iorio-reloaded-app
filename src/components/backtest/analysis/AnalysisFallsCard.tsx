import type { AnalysisBacktestFigures, AnalysisFileFigures } from "../../../api/backtestAnalysis";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage, formatRatio, formatSignedPercentage, formatYearMonth } from "../../../lib/formatters";
import { ColumnVisibilityPopover } from "../../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../DataTable/useColumnVisibility";
import { AnalysisCard } from "./analysisBits";

// Falls and recoveries (F7, with F11 for the falls that reach into the analysis backtest; mockup approved 2026-11-01):
// every fall of a Step or more over the file's daily bars, newest first.

const dayMilliseconds = 86_400_000;
const yardstickLabels = { implied: "IV", realised: "realised", median: "median" } as const;

const fallColumns = [
  { key: "low", header: "Low" },
  { key: "depth", header: "Fall" },
  { key: "steps", header: "In Steps" },
  { key: "step", header: "Step used" },
  { key: "daysDown", header: "Days down" },
  { key: "back", header: "Back" },
  { key: "daysBack", header: "Days back" },
  { key: "v4", header: "VF v4 in it" },
  { key: "topUps", header: "Its top-ups" },
];
const rightAligned = new Set(["depth", "steps", "step", "daysDown", "daysBack", "v4", "topUps"]);

interface AnalysisFallsCardProps {
  symbol: string;
  figures: Pick<AnalysisFileFigures, "falls" | "stockProfile" | "bars">;
  /** Null before the first analysis: no account columns. */
  backtest: AnalysisBacktestFigures | null;
}

export function AnalysisFallsCard({ symbol, figures, backtest }: AnalysisFallsCardProps) {
  const columns = backtest ? fallColumns : fallColumns.filter((column) => column.key !== "v4" && column.key !== "topUps");
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-v4-falls", fallColumns.map((column) => column.key));
  const summary = figures.stockProfile.falls;
  const medianStep = figures.stockProfile.steps.median;
  const firstBar = figures.bars[0]?.[0] ?? null;
  const lastBar = figures.bars.at(-1)?.[0] ?? null;
  const falls = [...figures.falls].reverse();
  const longest = figures.falls.reduce<{ peakDate: string; endDate: string; back: boolean; days: number } | null>((best, fall) => {
    const endDate = fall.backDate ?? lastBar ?? fall.lowDate;
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${fall.peakDate}T00:00:00Z`)) / dayMilliseconds;
    return best === null || days > best.days ? { peakDate: fall.peakDate, endDate, back: fall.backDate !== null, days } : best;
  }, null);
  const visible = columns.filter((column) => isColumnVisible(column.key));
  return (
    <AnalysisCard
      title="Falls and recoveries"
      description={`Every fall of a Step or more from a peak close, ${firstBar ? formatDayMonthYear(firstBar) : "—"} → ${lastBar ? formatDayMonthYear(lastBar) : "—"} (the file's daily bars start in ${firstBar?.slice(0, 4) ?? "—"})${backtest ? "; the ones that reach into the backtest show what VF v4's account did" : ""}. Switch the price chart to All to see them.`}
      actions={<ColumnVisibilityPopover columns={columns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
    >
      <div className="card-body d-flex flex-column gap-3">
        {falls.length === 0 ? (
          <p className="text-secondary mb-0">No fall of a Step or more in the file's daily bars.</p>
        ) : (
          <>
            <div className="analysis-chips m-0">
              <span className="analysis-chip">
                {formatNumber(summary.count)} falls{summary.perYear !== null ? ` · ${formatNumber(summary.perYear, 1)} a year` : ""}
              </span>
              <span className="analysis-chip">{formatNumber(summary.reachedTwoSteps)} reached 2 Steps</span>
              <span className="analysis-chip">{formatNumber(summary.backWithinAYear)} back within a year</span>
              <span className="analysis-chip">
                median {formatNumber(summary.medianDaysDown)} days down{summary.medianDaysBack !== null ? `, ${formatNumber(summary.medianDaysBack)} back` : ""}
              </span>
              {longest && (
                <span className="analysis-chip">
                  longest: {formatYearMonth(longest.peakDate.slice(0, 7))} → {longest.back ? formatYearMonth(longest.endDate.slice(0, 7)) : "not back yet"}, {formatNumber(longest.days / 365.25, 1)} years
                </span>
              )}
            </div>
            <div className="table-responsive analysis-bordered-table" style={{ maxHeight: "24rem", overflowY: "auto" }}>
              <table className="table table-sm table-vcenter mb-0">
                <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Peak</th>
                    {visible.map((column) => (
                      <th key={column.key} className={rightAligned.has(column.key) ? "text-end" : column.key === "back" ? "ps-4" : undefined}>
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {falls.map((fall) => {
                    const during = backtest?.falls[fall.peakDate] ?? null;
                    const cells: Record<string, React.ReactNode> = {
                      low: formatDayMonthYear(fall.lowDate),
                      depth: formatPercentage(-fall.depth, 0),
                      steps: formatRatio(fall.steps, 1),
                      step: (
                        <>
                          {formatPercentage(fall.yardstick)} <span className="analysis-plain">{yardstickLabels[fall.yardstickFrom]}</span>
                        </>
                      ),
                      daysDown: formatNumber(fall.daysDown),
                      back: fall.backDate ? formatDayMonthYear(fall.backDate) : "not yet",
                      daysBack: fall.daysBack === null ? "" : formatNumber(fall.daysBack),
                      v4: during ? `${formatSignedPercentage(during.fall)}, back ${during.backOn ? formatDayMonthYear(during.backOn) : "not yet"}` : "",
                      topUps: during ? (during.topUps === 0 ? "none" : `${formatNumber(during.topUps)} · ${formatCurrency(during.topUpDollars, 0)}`) : "",
                    };
                    return (
                      <tr key={fall.peakDate} className={during ? "backtest-cycle-highlighted-row" : undefined}>
                        <td className="font-monospace">{formatDayMonthYear(fall.peakDate)}</td>
                        {visible.map((column) => (
                          <td key={column.key} className={`font-monospace${rightAligned.has(column.key) ? " text-end" : column.key === "back" ? " ps-4" : ""}`}>
                            {cells[column.key]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="analysis-chart-caption m-0">
          A fall counts at the larger of the Step on the peak's day (IV × √(21 ÷ 252); before IV, 63-day realised volatility) and {symbol}'s median Step, {formatPercentage(medianStep)}.
          {backtest && " VF v4 in it: its lowest 10:00 value from the peak (or the backtest's first day) to the stock's recovery ÷ its value on that first day, and when it got back."}
        </div>
      </div>
    </AnalysisCard>
  );
}
