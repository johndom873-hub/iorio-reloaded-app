import type { ReactNode } from "react";
import type { BacktestAccuracyBand, BacktestCycle, BacktestMetrics, BacktestMonthlyReturn, BacktestPnlBasis, BacktestPnlSource, BacktestPnlSources, BacktestSessionDay, BacktestTickerStatistics, BacktestTrade } from "../../api/backtest";
import { formatCompactDollarsTrimmed, formatNumber, formatPercentage, formatRatio, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import {
  backtestCycleMetricExplanation,
  backtestMetricExplanation,
  closedTradeTotals,
  describeAverageWinLoss,
  describeDeepestDrawdown,
  describeEdgeCaptureTotals,
  describeOpenCycles,
  isCycleBasis,
  signedPercentDisplay,
  sumAccuracyBands,
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
  trades: BacktestTrade[];
  monthlyReturns: BacktestMonthlyReturn[];
  accuracyBands: BacktestAccuracyBand[];
  cycles: BacktestCycle[];
  allSymbolsStatistics: BacktestTickerStatistics | null;
  /** Shares, Covered Calls and Hedge (approved 2026-10-26): each tile when the session held it. */
  pnlSources: BacktestPnlSources | null;
}

/** The headline figures, led by the wheel cycle P&L (whether the book made money, as the platform counts it). The win rate,
 *  averages and edge capture are measured on closed cycles, or per option on sessions run before cycles carried the P&L.
 *  Buy and hold sits in its own comparison table, not on the tiles. "—" until the run has finished. */
export function BacktestKpiTiles({ pnlBasis, metrics, days, trades, monthlyReturns, accuracyBands, cycles, allSymbolsStatistics, pnlSources }: BacktestKpiTilesProps) {
  const cycleBasis = isCycleBasis(pnlBasis);
  const cycleTotals = summarizeCycleTotals(cycles);
  const hasBook = allSymbolsStatistics !== null || cycles.length > 0;
  const cyclePnl = allSymbolsStatistics?.totalPnlDollars ?? cycleTotals.closedDollars + cycleTotals.openDollars;
  const deepestDrawdown = describeDeepestDrawdown(days);
  const worstMonth = worstMonthOf(monthlyReturns);
  const bandTotals = sumAccuracyBands(accuracyBands);
  const edgeCaptureTotals = cycleBasis ? { madeDollars: bandTotals.realizedPnlDollars, predictedDollars: bandTotals.predictedPnlDollars } : closedTradeTotals(trades);
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

  const cyclesTile: KpiTileProps = {
    label: "Wheel cycles",
    explanation: backtestCycleMetricExplanation.cycles,
    value: formatNumber(metrics?.cycleCount ?? cycles.length),
    lines: [
      metrics?.winRate === null || metrics?.winRate === undefined ? "none closed yet" : `${formatNumber(metrics.closedCycleCount ?? cycleTotals.closedCount)} closed, ${formatPercentage(metrics.winRate, 0)} in profit`,
      openCyclesLine,
      `${pluralizeCount(metrics?.tradeCount ?? trades.length, "option")} sold`,
    ],
  };

  const tradesTile: KpiTileProps = {
    label: "Trades",
    explanation: backtestMetricExplanation.trades,
    value: formatNumber(metrics?.tradeCount),
    lines: [metrics?.winRate === null || metrics?.winRate === undefined ? "none closed yet" : `${formatPercentage(metrics.winRate, 0)} ended in profit`],
  };

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
      label: "Worst month",
      explanation: backtestMetricExplanation.worstMonth,
      value: signedPercentDisplay(metrics?.worstMonth).text,
      valueClassName: signedPercentDisplay(metrics?.worstMonth).className,
      lines: [worstMonth ?? "the lowest monthly return"],
    },
    cycleBasis ? cyclesTile : tradesTile,
    {
      label: "Average win / loss",
      explanation: cycleBasis ? backtestCycleMetricExplanation.averageWinLoss : backtestMetricExplanation.averageWinLoss,
      value: metrics ? describeAverageWinLoss(metrics) : "—",
      lines: [cycleBasis ? "per closed cycle" : "per trade"],
    },
    {
      label: "Edge capture",
      explanation: cycleBasis ? backtestCycleMetricExplanation.edgeCapture : backtestMetricExplanation.edgeCapture,
      value: formatRatio(metrics?.edgeCapture, 2),
      lines: [!cycleBasis ? describeEdgeCaptureTotals(edgeCaptureTotals) : bandTotals.cycleCount ? `${describeEdgeCaptureTotals(edgeCaptureTotals)}, closed cycles; share gains count` : "no closed cycles"],
    },
    {
      label: "Capital in use",
      explanation: cycleBasis ? backtestCycleMetricExplanation.capitalInUse : backtestMetricExplanation.capitalInUse,
      value: formatPercentage(metrics?.capitalInUse, 0),
      lines: ["of the account value, on average", metrics?.returnOnCapitalInUse === null || metrics?.returnOnCapitalInUse === undefined ? null : `earning ${signedPercentDisplay(metrics.returnOnCapitalInUse).text} a year`],
    },
    {
      label: "In the money at expiry",
      explanation: cycleBasis ? backtestCycleMetricExplanation.inTheMoneyAtExpiry : backtestMetricExplanation.inTheMoneyAtExpiry,
      value: formatPercentage(metrics?.inTheMoneyAtExpiryShare, 0),
      lines: [cycleBasis ? "of options sold that expired, settled at the close" : "of expired contracts, settled at the close"],
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
