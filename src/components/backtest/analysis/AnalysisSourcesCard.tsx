import { useMemo, useState } from "react";
import type { AnalysisBacktestFigures, AnalysisYearRow } from "../../../api/backtestAnalysis";
import { analysisSourceKeys, analysisSourceLabels, expiryDaysSoldTint, formatSignedCagrPoints, type AnalysisSourceKey } from "../../../lib/analysisPresentation";
import { formatCompactDollarsTrimmed, formatCurrency, formatDayMonth, formatDayMonthYear, formatNumber, formatPercentage, formatSignedPercentage, formatSignedThousands, formatSignedWholeDollars } from "../../../lib/formatters";
import { ColumnVisibilityPopover } from "../../DataTable/ColumnVisibilityPopover";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { useColumnVisibility } from "../../DataTable/useColumnVisibility";
import { AnalysisCard } from "./analysisBits";
import { niceStep } from "./analysisHoldingChartModel";

// "Where the CAGR came from" (Vol Farmer v4, mockup approved 2026-11-01): the session tiles' sources with their part of
// the CAGR, each year's P&L by source by the marks (F17), and the Calls year by year (F19) with the expiry days that had no
// Call sold and what the look recorded.

const sourceShortLabels: Record<AnalysisSourceKey, string> = { calls: "Calls", puts: "Puts", leaps: "LEAPS", interest: "Interest", shares: "Shares" };

interface SourceTile {
  key: AnalysisSourceKey;
  label: string;
  part: string;
  partNote: string;
  lines: string[];
}

function sourceTilesOf(symbol: string, backtest: AnalysisBacktestFigures, putsStartCallYieldPct: number): SourceTile[] {
  const { sources, averages, interest } = backtest;
  const calls = sources?.coveredCalls ?? null;
  const shares = sources?.shares ?? null;
  const puts = sources?.cashSecuredPuts ?? null;
  const leaps = sources?.leaps ?? null;
  const tiles: SourceTile[] = [
    {
      key: "calls",
      label: "Covered Calls",
      part: formatPercentage(calls?.cagrPart),
      partNote: "of the CAGR",
      lines: calls ? [`${formatCurrency(calls.pnlDollars, 0)} after commissions`, `median ${formatPercentage(calls.quotedYieldMedian)} a year at sale · ${formatNumber(calls.quotedCount)} Calls`, `a Call open on ${formatPercentage(calls.daysHeldShare, 0)} of days: the expiry days`] : ["No Calls sold"],
    },
    {
      key: "shares",
      label: "Shares",
      part: formatPercentage(shares?.cagrPart),
      partNote: "of the CAGR",
      lines: shares ? [`${formatCurrency(shares.pnlDollars, 0)} after commissions`, `held on ${formatPercentage(shares.daysHeldShare, 0)} of days`, `${formatPercentage(averages.sharesShare, 0)} of the account on average`] : ["No shares held"],
    },
    {
      key: "interest",
      label: "T-bill interest",
      part: formatPercentage(interest?.cagrPart),
      partNote: "of the CAGR",
      lines: [`${formatCurrency(interest?.pnlDollars, 0)} on the cash`, `cash ${formatPercentage(averages.cashShare, 0)} of the account on average`, `T-bill CAGR ${formatPercentage(backtest.treasuryBillCagr)} over the period`],
    },
  ];
  if (backtest.putsSold === 0 && backtest.leapsBought === 0) {
    tiles.push({ key: "puts", label: "Puts and LEAPS", part: "None", partNote: "in this backtest", lines: [`Puts start only when the best Call pays under ${formatNumber(putsStartCallYieldPct, 1)}% a year`, "a LEAPS only after a Put is assigned", `neither happened on ${symbol}`] });
  } else {
    const parts = [puts?.cagrPart, leaps?.cagrPart].filter((part): part is number => part !== null && part !== undefined);
    tiles.push({
      key: "puts",
      label: "Puts and LEAPS",
      part: parts.length === 0 ? "—" : formatPercentage(parts.reduce((total, part) => total + part, 0)),
      partNote: "of the CAGR",
      lines: [
        `Puts ${formatSignedWholeDollars(puts?.pnlDollars ?? 0)} · LEAPS ${formatSignedWholeDollars(leaps?.pnlDollars ?? 0)} after commissions`,
        `${formatNumber(backtest.putsSold)} Puts sold${puts?.quotedYieldMedian != null ? `, median ${formatPercentage(puts.quotedYieldMedian)} a year at sale` : ""}`,
        backtest.leapsBought === 0 ? "no LEAPS bought" : `${formatNumber(backtest.leapsBought)} LEAPS bought`,
      ],
    });
  }
  return tiles;
}

/** Each year's P&L by source as stacked bars, a total line on each, and a hover per year. */
function SourcesByYearChart({ years }: { years: AnalysisYearRow[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const shownKeys = analysisSourceKeys.filter((key) => years.some((row) => row.sources[key] !== 0));
  const geometry = useMemo(() => {
    let lowest = 0;
    let highest = 0;
    for (const row of years) {
      const up = shownKeys.reduce((total, key) => total + Math.max(0, row.sources[key]), 0);
      const down = shownKeys.reduce((total, key) => total + Math.min(0, row.sources[key]), 0);
      lowest = Math.min(lowest, down, row.endValue - row.startValue);
      highest = Math.max(highest, up, row.endValue - row.startValue);
    }
    const step = niceStep(highest - lowest || 1, 6);
    const low = Math.floor(lowest / step) * step;
    const high = Math.ceil(highest / step) * step;
    const yOf = (value: number) => 16 + (1 - (value - low) / (high - low || 1)) * 240;
    const grid: { y: number; label: string; zero: boolean }[] = [];
    for (let value = low; value <= high + step / 2; value += step) grid.push({ y: yOf(value), label: value === 0 ? "$0" : formatCompactDollarsTrimmed(value), zero: Math.abs(value) < step / 2 });
    const slot = 542 / years.length;
    const barWidth = Math.min(44, slot * 0.6);
    const bars = years.map((row, index) => {
      const center = 62 + (index + 0.5) * slot;
      let up = 0;
      let down = 0;
      const segments = shownKeys.flatMap((key) => {
        const value = row.sources[key];
        if (value === 0) return [];
        const from = value > 0 ? up : down;
        const to = from + value;
        if (value > 0) up = to;
        else down = to;
        const top = yOf(Math.max(from, to));
        return [{ key, y: top, height: Math.max(1, yOf(Math.min(from, to)) - top) }];
      });
      const total = row.endValue - row.startValue;
      return { center, segments, total, totalY: yOf(total), labelY: total >= 0 ? yOf(up) - 6 : yOf(down) + 14 };
    });
    return { grid, bars, slot, barWidth };
  }, [years, shownKeys]);
  const hover = hoverIndex === null ? null : (() => {
    const row = years[hoverIndex]!;
    const center = geometry.bars[hoverIndex]!.center;
    const lines = [{ text: `${row.year}: ${formatSignedWholeDollars(row.endValue - row.startValue)}`, strong: true }, ...shownKeys.map((key) => ({ text: `${sourceShortLabels[key]} ${formatSignedWholeDollars(row.sources[key])}`, strong: false }))];
    const boxX = center + 34 + 190 > 620 ? center - 34 - 190 : center + 34;
    return { boxX, lines };
  })();
  return (
    <figure className="m-0">
      <div className="analysis-rag-title">Each year's P&amp;L by source</div>
      <div className="analysis-legend mb-1">
        {shownKeys.map((key) => (
          <span key={key} className="analysis-legend-item">
            <svg width="12" height="12" aria-hidden="true">
              <rect width="12" height="12" rx="2" className={`analysis-svg-segment is-${key}`} />
            </svg>
            {analysisSourceLabels[key]}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 620 300" className="analysis-svg" role="img" aria-label={`Each year's P&L by source, ${years[0]?.year} to ${years.at(-1)?.year}`} onMouseLeave={() => setHoverIndex(null)}>
        {geometry.grid.map((line) => (
          <g key={line.label}>
            <line x1={62} x2={604} y1={line.y} y2={line.y} className={line.zero ? "analysis-svg-zero" : "analysis-svg-grid"} />
            <text x={54} y={line.y + 4} textAnchor="end" className="analysis-svg-text">
              {line.label}
            </text>
          </g>
        ))}
        {geometry.bars.map((bar, index) => (
          <g key={years[index]!.year}>
            {bar.segments.map((segment) => (
              <rect key={segment.key} x={bar.center - geometry.barWidth / 2} y={segment.y} width={geometry.barWidth} height={segment.height} rx={2} className={`analysis-svg-segment is-${segment.key}`} />
            ))}
            <line x1={bar.center - geometry.barWidth / 2 - 5} x2={bar.center + geometry.barWidth / 2 + 5} y1={bar.totalY} y2={bar.totalY} className="analysis-svg-total" />
            <text x={bar.center} y={bar.labelY} textAnchor="middle" className="analysis-svg-text is-strong">
              {formatSignedThousands(bar.total)}
            </text>
            <text x={bar.center} y={286} textAnchor="middle" className="analysis-svg-text">
              {years[index]!.year}
            </text>
          </g>
        ))}
        {hover && (
          <>
            <rect x={hover.boxX} y={18} width={190} height={16 * hover.lines.length + 10} rx={6} className="analysis-svg-tooltip" />
            {hover.lines.map((line, index) => (
              <text key={index} x={hover.boxX + 10} y={36 + 16 * index} className={`analysis-svg-text ${line.strong ? "is-strong" : "is-body"}`}>
                {line.text}
              </text>
            ))}
          </>
        )}
        {geometry.bars.map((bar, index) => (
          <rect key={index} x={bar.center - geometry.slot / 2} y={16} width={geometry.slot} height={252} className="analysis-svg-hit" onMouseEnter={() => setHoverIndex(index)} />
        ))}
      </svg>
    </figure>
  );
}

/** "In 2022 the shares lost $252,337 while the Calls made $92,713; in 2026 the Calls made $605,376." */
function describeSourceYears(years: AnalysisYearRow[]): string {
  if (years.length === 0) return "";
  const worstShares = years.reduce((worst, row) => (row.sources.shares < worst.sources.shares ? row : worst), years[0]!);
  const bestCalls = years.reduce((best, row) => (row.sources.calls > best.sources.calls ? row : best), years[0]!);
  const parts: string[] = [];
  if (worstShares.sources.shares < 0) parts.push(`In ${worstShares.year} the shares lost ${formatCurrency(-worstShares.sources.shares, 0)} while the Calls made ${formatCurrency(worstShares.sources.calls, 0)}`);
  if (bestCalls.sources.calls > 0 && bestCalls.year !== worstShares.year) parts.push(`${parts.length === 0 ? "In" : "in"} ${bestCalls.year} the Calls made ${formatCurrency(bestCalls.sources.calls, 0)}`);
  return parts.length === 0 ? "" : `${parts.join("; ")}. `;
}

const callColumns = [
  { key: "return", header: "VF v4 return" },
  { key: "calls", header: "Calls sold" },
  { key: "yield", header: "Yield, median" },
  { key: "iv", header: "IV of the Calls sold" },
  { key: "sold", header: "Expiry days sold" },
  { key: "weeks", header: "Weeks with an expiry" },
  { key: "calledAway", header: "Called away" },
  { key: "topUps", header: "Top-ups" },
  { key: "trims", header: "Trims" },
  { key: "part", header: "Calls' part of the return, points" },
];

/** F19's expiry days without a Call sold, with what that day's look recorded (two lines; the rest in the cell's title). */
const daysWithoutCallColumns: DataTableColumn<[string, string | null]>[] = [
  { key: "date", header: "Expiry day", sortValue: ([date]) => date, cellClassName: "font-mono text-nowrap", render: ([date]) => formatDayMonthYear(date) },
  {
    key: "summary",
    header: "What the 10:00 look recorded",
    render: ([, summary]) => (
      <span className="analysis-clamp-2 text-secondary" style={{ fontSize: "0.78rem" }} title={summary ?? undefined}>
        {summary ?? "Nothing recorded"}
      </span>
    ),
  },
];

/** The year's note: "to 28 Oct" on a year cut short at the end, "from 4 Mar" on one started late. */
function yearNote(row: AnalysisYearRow, backtest: AnalysisBacktestFigures): string {
  if (row.toDate === backtest.endDate && row.toDate.slice(5) < "12-24") return `to ${formatDayMonth(row.toDate)}`;
  if (row.fromDate === null && backtest.startDate.slice(5) > "01-07") return `from ${formatDayMonth(backtest.startDate)}`;
  return "";
}

interface AnalysisSourcesCardProps {
  symbol: string;
  backtest: AnalysisBacktestFigures;
  putsStartCallYieldPct: number;
  /** F24's band as fractions of the pot, for the caption (0.75 and 0.85). */
  bandFloorShare: number;
  bandTopShare: number;
}

export function AnalysisSourcesCard({ symbol, backtest, putsStartCallYieldPct, bandFloorShare, bandTopShare }: AnalysisSourcesCardProps) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-v4-calls-by-year", callColumns.map((column) => column.key));
  const [showDaysWithoutCall, setShowDaysWithoutCall] = useState(false);
  const metrics = backtest.metrics;
  const tiles = sourceTilesOf(symbol, backtest, putsStartCallYieldPct);
  const all = backtest.allYears;
  const visible = (key: string) => isColumnVisible(key);
  const cells = (row: Pick<AnalysisYearRow, "callsSold" | "callYieldMedian" | "callImpliedVolatility" | "expiryDays" | "expiryDaysSold" | "wholeWeeks" | "weeksWithExpiryDay" | "calledAway" | "topUps" | "trims">, returnText: string, partText: string) => (
    <>
      {visible("return") && <td className="text-end font-monospace">{returnText}</td>}
      {visible("calls") && <td className="text-end font-monospace">{formatNumber(row.callsSold)}</td>}
      {visible("yield") && <td className="text-end font-monospace">{formatPercentage(row.callYieldMedian)}</td>}
      {visible("iv") && <td className="text-end font-monospace">{formatPercentage(row.callImpliedVolatility)}</td>}
      {visible("sold") && <td className={`text-end font-monospace ${expiryDaysSoldTint(row.expiryDays === 0 ? null : row.expiryDaysSold / row.expiryDays)}`}>{`${formatNumber(row.expiryDaysSold)} of ${formatNumber(row.expiryDays)}`}</td>}
      {visible("weeks") && <td className="text-end font-monospace">{`${formatNumber(row.weeksWithExpiryDay)} of ${formatNumber(row.wholeWeeks)}`}</td>}
      {visible("calledAway") && <td className="text-end font-monospace">{formatNumber(row.calledAway)}</td>}
      {visible("topUps") && <td className="text-end font-monospace">{formatNumber(row.topUps)}</td>}
      {visible("trims") && <td className="text-end font-monospace">{formatNumber(row.trims)}</td>}
      {visible("part") && <td className="text-end font-monospace">{partText}</td>}
    </>
  );
  const daysWithoutCall = backtest.expiryDaysWithoutCall;
  return (
    <AnalysisCard
      title={`Where the ${formatPercentage(metrics?.cagr)} a year came from`}
      description={metrics ? `Each source's share of the CAGR = CAGR × its P&L ÷ the account's P&L of ${formatCurrency(metrics.endValue - metrics.startValue, 0)}. Yields a year after costs, on the trading sessions held.` : undefined}
    >
      <div className="card-body d-flex flex-column gap-4">
        <div className="analysis-source-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className={`card analysis-source-tile is-${tile.key}`}>
              <div className="analysis-kpi">
                <span className="analysis-eyebrow">{tile.label}</span>
                <span className="analysis-kpi-value">
                  {tile.part} <span className="analysis-plain">{tile.partNote}</span>
                </span>
                {tile.lines.map((line) => (
                  <span key={line} className="analysis-kpi-sub">
                    {line}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="analysis-sources-grid">
          <div>
            <SourcesByYearChart years={backtest.years} />
            <div className="analysis-chart-caption">{describeSourceYears(backtest.years)}Shares' price moves are what is left of the account's P&amp;L after the other sources.</div>
          </div>
          <div>
            <div className="d-flex align-items-center justify-content-between gap-2">
              <div className="analysis-rag-title">The Calls, year by year</div>
              <ColumnVisibilityPopover columns={callColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />
            </div>
            <div className="table-responsive analysis-bordered-table">
              <table className="table table-sm table-vcenter analysis-rag-table analysis-wrap-head mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Year</th>
                    {callColumns.filter((column) => visible(column.key)).map((column) => (
                      <th key={column.key} className="text-end">
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {backtest.years.map((row) => (
                    <tr key={row.year}>
                      <th scope="row">
                        {row.year}
                        <span className="analysis-year-note">{yearNote(row, backtest)}</span>
                      </th>
                      {cells(row, formatSignedPercentage(row.v4Return), formatSignedCagrPoints(row.parts.calls))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="table-totals-row">
                  <tr>
                    <td className="font-monospace">
                      All<span className="analysis-year-note">CAGR</span>
                    </td>
                    {cells(all, formatSignedPercentage(metrics?.cagr), formatSignedCagrPoints(backtest.sources?.coveredCalls?.cagrPart))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="analysis-chart-caption">
              Yield a year = (time value × 100 − $0.68) ÷ ((the stock − the fill) × 100) × 252 ÷ the sessions held: 1 for a Call sold the morning it expires. IV of the Calls sold: each Call's own IV at the sale, from its 10:00 mid to that day's close, weighed by contracts. Expiry days sold: tinted 70% or more, 50 to 70%, under 50%. Top-ups: lots bought because the shares fell under {formatPercentage(bandFloorShare, 0)} of the pot; trims: sold over {formatPercentage(bandTopShare, 0)}. Part of the return = the Calls' P&amp;L in the year ÷ the account at the year's start; the All row: the part of the CAGR.
            </div>
            {daysWithoutCall.length > 0 && (
              <div className="mt-2">
                <button type="button" className="analysis-link" aria-expanded={showDaysWithoutCall} onClick={() => setShowDaysWithoutCall(!showDaysWithoutCall)}>
                  {showDaysWithoutCall ? "Hide" : "Show"} the {formatNumber(daysWithoutCall.length)} expiry days without a Call sold
                </button>
                {showDaysWithoutCall && (
                  <div className="mt-2">
                    <DataTable
                      tableId="analysis-v4-expiry-days-without-call"
                      columns={daysWithoutCallColumns}
                      rows={daysWithoutCall}
                      rowKey={([date]) => date}
                      defaultSort={{ key: "date", direction: "desc" }}
                      maxVisibleRows={10}
                      dense
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AnalysisCard>
  );
}
