import type { ReactNode } from "react";
import type { BacktestCycle, BacktestDaysWithNoOptions, BacktestMetrics, BacktestMonthlyReturn, BacktestPnlBasis, BacktestPnlSource, BacktestPnlSources, BacktestSessionDay, BacktestTickerStatistics } from "../../api/backtest";
import { formatCompactDollarsTrimmed, formatDayMonthYear, formatNumber, formatPercentage, formatRatio, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import {
  backtestCycleMetricExplanation,
  backtestMetricExplanation,
  describeDeepestDrawdown,
  describeOpenCycles,
  isCycleBasis,
  signedPercentDisplay,
  summarizeCycleTotals,
  worstMonthOf,
} from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/formatters";
import { DottedLabelTooltip } from "../HelpTooltip";

interface KpiTileProps {
  label: string;
  explanation: string;
  value: string;
  valueClassName?: string;
  lines: ReactNode[];
  /** The headline tile: twice as wide, larger figure. */
  lead?: boolean;
}

function KpiTile({ label, explanation, value, valueClassName = "", lines, lead = false }: KpiTileProps) {
  return (
    <div className={`card${lead ? " backtest-kpi-lead" : ""}`}>
      <div className="card-body p-3 d-flex flex-column gap-1">
        <DottedLabelTooltip label={label} tooltipHtml={escapeTooltipHtml(explanation)} className="subheader align-self-start" />
        <span className={`backtest-kpi-value ${valueClassName}`.trim()}>{value}</span>
        {lines.map((line, index) => (
          <span key={index} className="text-secondary" style={{ fontSize: "0.75rem", lineHeight: 1.35 }}>
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "1 open cycle: +$42,060 at the last marks", its dollars in green or red, so a losing open cycle stands out. */
function OpenCyclesLine({ openCount, openDollars }: { openCount: number; openDollars: number }) {
  if (openCount === 0) return <>{describeOpenCycles(0, 0)}</>;
  return (
    <>
      {pluralizeCount(openCount, "open cycle")}: <span className={`fw-semibold ${pnlTextClass(openDollars)}`}>{formatSignedPnl(openDollars, 0)}</span> at the last marks
    </>
  );
}

/** "of the 11.3% CAGR: +$17,464 after buybacks and commissions", the dollars in green or red; no CAGR when it has no part of it. */
function SourcePnlLine({ cagr, source, after }: { cagr: number | null | undefined; source: BacktestPnlSource; after: string }) {
  return (
    <>
      {source.cagrPart !== null && cagr !== null && cagr !== undefined && `of the ${formatPercentage(cagr, 1)} CAGR: `}
      <span className={pnlTextClass(source.pnlDollars)}>{formatSignedPnl(source.pnlDollars, 0)}</span> {after}
    </>
  );
}

interface BacktestKpiTilesProps {
  pnlBasis: BacktestPnlBasis;
  metrics: BacktestMetrics | null;
  days: BacktestSessionDay[];
  monthlyReturns: BacktestMonthlyReturn[];
  cycles: BacktestCycle[];
  allSymbolsStatistics: BacktestTickerStatistics | null;
  /** Shares, Covered Calls and Hedge (approved 2026-10-26): each tile when the session held it. */
  pnlSources: BacktestPnlSources | null;
  /** Excess Calmar and the days with no options (approved 2026-10-28); null before a run or on an older API. */
  excessCalmar: number | null;
  daysWithNoOptions: BacktestDaysWithNoOptions | null;
}

/** The headline figures, led by the wheel cycle P&L (whether the book made money, as the platform counts it). Capital in
 *  use is measured on the wheel cycles, or per option on sessions run before cycles carried the P&L. Buy and hold sits in
 *  its own comparison table, not on the tiles. "—" until the run has finished. */
export function BacktestKpiTiles({ pnlBasis, metrics, days, monthlyReturns, cycles, allSymbolsStatistics, pnlSources, excessCalmar, daysWithNoOptions }: BacktestKpiTilesProps) {
  const cycleBasis = isCycleBasis(pnlBasis);
  const cycleTotals = summarizeCycleTotals(cycles);
  const hasBook = allSymbolsStatistics !== null || cycles.length > 0;
  const cyclePnl = allSymbolsStatistics?.totalPnlDollars ?? cycleTotals.closedDollars + cycleTotals.openDollars;
  const deepestDrawdown = describeDeepestDrawdown(days);
  const worstMonth = worstMonthOf(monthlyReturns);
  const openCyclesLine = <OpenCyclesLine openCount={cycleTotals.openCount} openDollars={cycleTotals.openDollars} />;

  const leadTile: KpiTileProps | null = hasBook
    ? {
        label: "Wheel cycle P&L",
        explanation: backtestCycleMetricExplanation.cyclePnl,
        value: formatSignedPnl(cyclePnl, 0),
        valueClassName: pnlTextClass(cyclePnl),
        lead: true,
        lines: [
          <>
            {pluralizeCount(cycleTotals.closedCount, "closed cycle")}: <span className={pnlTextClass(cycleTotals.closedDollars)}>{formatSignedPnl(cycleTotals.closedDollars, 0)}</span>
          </>,
          openCyclesLine,
          "after commissions, as the platform's Wheel cycle view counts it; interest on cash not included",
        ],
      }
    : null;

  const tiles: (KpiTileProps | null)[] = [
    leadTile,
    {
      label: "Total return",
      explanation: backtestMetricExplanation.totalReturn,
      value: signedPercentDisplay(metrics?.totalReturn).text,
      valueClassName: signedPercentDisplay(metrics?.totalReturn).className,
      lines: [metrics ? `${formatCompactDollarsTrimmed(metrics.startValue)} → ${formatCompactDollarsTrimmed(metrics.endValue)} after costs, ${formatCompactDollarsTrimmed(metrics.interestDollars)} of it interest` : "after costs"],
    },
    {
      label: "CAGR",
      explanation: backtestMetricExplanation.cagr,
      value: signedPercentDisplay(metrics?.cagr).text,
      valueClassName: signedPercentDisplay(metrics?.cagr).className,
      lines: ["a year, on calendar time"],
    },
    {
      label: "Sortino",
      explanation: backtestMetricExplanation.sortino,
      value: formatRatio(metrics?.sortino, 2),
      lines: ["yearly, on daily returns"],
    },
    {
      label: "Max drawdown",
      explanation: backtestMetricExplanation.maxDrawdown,
      value: signedPercentDisplay(metrics?.maxDrawdown).text,
      valueClassName: signedPercentDisplay(metrics?.maxDrawdown).className,
      lines: [deepestDrawdown ?? "from a previous peak"],
    },
    {
      label: "Excess Calmar",
      explanation: backtestMetricExplanation.excessCalmar,
      value: formatRatio(excessCalmar, 2),
      lines: [],
    },
    {
      label: "Worst month",
      explanation: backtestMetricExplanation.worstMonth,
      value: signedPercentDisplay(metrics?.worstMonth).text,
      valueClassName: signedPercentDisplay(metrics?.worstMonth).className,
      lines: [worstMonth ?? "the lowest monthly return"],
    },
    {
      label: "Capital in use",
      explanation: cycleBasis ? backtestCycleMetricExplanation.capitalInUse : backtestMetricExplanation.capitalInUse,
      value: formatPercentage(metrics?.capitalInUse, 0),
      lines: ["of the account value, on average", metrics?.returnOnCapitalInUse === null || metrics?.returnOnCapitalInUse === undefined ? null : `earning ${signedPercentDisplay(metrics.returnOnCapitalInUse).text} a year`],
    },
    {
      label: "Days with no options",
      explanation: backtestMetricExplanation.daysWithNoOptions,
      value: formatPercentage(daysWithNoOptions?.share, 0),
      lines: daysWithNoOptions
        ? [
            `${formatNumber(daysWithNoOptions.dayCount)} of ${formatNumber(daysWithNoOptions.tradingDayCount)} trading days`,
            daysWithNoOptions.longestRun === null
              ? "a Call or Put open every day"
              : `longest: ${pluralizeCount(daysWithNoOptions.longestRun.days, "trading day")}, ${formatDayMonthYear(daysWithNoOptions.longestRun.from)} to ${formatDayMonthYear(daysWithNoOptions.longestRun.to)}`,
          ]
        : [],
    },
    // Each source's part of the CAGR, then its P&L, what was quoted at the trades and the days it was held.
    pnlSources?.shares
      ? {
          label: "Shares",
          explanation: backtestCycleMetricExplanation.shares,
          value: signedPercentDisplay(pnlSources.shares.cagrPart).text,
          valueClassName: signedPercentDisplay(pnlSources.shares.cagrPart).className,
          lines: [<SourcePnlLine key="source" cagr={metrics?.cagr} source={pnlSources.shares} after="after commissions" />, `shares held on ${formatPercentage(pnlSources.shares.daysHeldShare, 0)} of the session's days`],
        }
      : null,
    pnlSources?.coveredCalls
      ? {
          label: "Covered Calls",
          explanation: backtestCycleMetricExplanation.coveredCalls,
          value: signedPercentDisplay(pnlSources.coveredCalls.cagrPart).text,
          valueClassName: signedPercentDisplay(pnlSources.coveredCalls.cagrPart).className,
          lines: [
            <SourcePnlLine key="source" cagr={metrics?.cagr} source={pnlSources.coveredCalls} after="after buybacks and commissions" />,
            pnlSources.coveredCalls.quotedYieldMedian === null ? null : `quoted at sale: median ${formatPercentage(pnlSources.coveredCalls.quotedYieldMedian, 1)} a year (${pluralizeCount(pnlSources.coveredCalls.quotedCount, "Call")})`,
            `a Call open on ${formatPercentage(pnlSources.coveredCalls.daysHeldShare, 0)} of the session's days`,
          ],
        }
      : null,
    pnlSources?.cashSecuredPuts
      ? {
          label: "Cash-Secured Puts",
          explanation: backtestCycleMetricExplanation.cashSecuredPuts,
          value: signedPercentDisplay(pnlSources.cashSecuredPuts.cagrPart).text,
          valueClassName: signedPercentDisplay(pnlSources.cashSecuredPuts.cagrPart).className,
          lines: [
            <SourcePnlLine key="source" cagr={metrics?.cagr} source={pnlSources.cashSecuredPuts} after="after buybacks and commissions" />,
            pnlSources.cashSecuredPuts.quotedYieldMedian === null ? null : `quoted at sale: median ${formatPercentage(pnlSources.cashSecuredPuts.quotedYieldMedian, 1)} a year (${pluralizeCount(pnlSources.cashSecuredPuts.quotedCount, "Put")})`,
            `a Put open on ${formatPercentage(pnlSources.cashSecuredPuts.daysHeldShare, 0)} of the session's days`,
          ],
        }
      : null,
    pnlSources?.leaps
      ? {
          label: "LEAPS",
          explanation: backtestCycleMetricExplanation.leaps,
          value: signedPercentDisplay(pnlSources.leaps.cagrPart).text,
          valueClassName: signedPercentDisplay(pnlSources.leaps.cagrPart).className,
          lines: [<SourcePnlLine key="source" cagr={metrics?.cagr} source={pnlSources.leaps} after="after what they were sold or settled for" />, `a LEAPS held on ${formatPercentage(pnlSources.leaps.daysHeldShare, 0)} of the session's days`],
        }
      : null,
    pnlSources?.hedge
      ? {
          label: "Hedge",
          explanation: backtestCycleMetricExplanation.hedge,
          value: signedPercentDisplay(pnlSources.hedge.cagrPart).text,
          valueClassName: signedPercentDisplay(pnlSources.hedge.cagrPart).className,
          lines: [
            <SourcePnlLine key="source" cagr={metrics?.cagr} source={pnlSources.hedge} after="after what the Puts paid back" />,
            pnlSources.hedge.quotedCostMedian === null ? null : `quoted at purchase: median ${formatPercentage(-pnlSources.hedge.quotedCostMedian, 1)} a year (${pluralizeCount(pnlSources.hedge.quotedCount, "Put")})`,
            `a Put open on ${formatPercentage(pnlSources.hedge.daysHeldShare, 0)} of the session's days`,
          ],
        }
      : null,
  ];

  return (
    <div className="backtest-kpi-grid mb-3">
      {tiles
        .filter((tile): tile is KpiTileProps => tile !== null)
        .map((tile) => (
          <KpiTile key={tile.label} {...tile} lines={tile.lines.filter((line) => line !== null)} />
        ))}
    </div>
  );
}
