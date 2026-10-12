import type { ReactNode } from "react";
import type { BacktestMetrics, BacktestMonthlyReturn, BacktestSessionDay, BacktestTrade } from "../../api/backtest";
import { formatCompactDollarsTrimmed, formatNumber, formatPercentage, formatRatio } from "../../lib/formatters";
import {
  backtestMetricExplanation,
  closedTradeTotals,
  describeAverageWinLoss,
  describeDeepestDrawdown,
  describeEdgeCaptureTotals,
  signedPercentDisplay,
  worstMonthOf,
} from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";
import { DottedLabelTooltip } from "../HelpTooltip";

interface KpiTileProps {
  label: string;
  explanation: string;
  value: string;
  valueClassName?: string;
  lines: ReactNode[];
}

function KpiTile({ label, explanation, value, valueClassName = "", lines }: KpiTileProps) {
  return (
    <div className="card">
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

interface BacktestKpiTilesProps {
  metrics: BacktestMetrics | null;
  baselineMetrics: BacktestMetrics | null;
  days: BacktestSessionDay[];
  trades: BacktestTrade[];
  monthlyReturns: BacktestMonthlyReturn[];
}

/** The ten headline figures, with buy and hold beside the account-level ones. "—" until the run has finished. */
export function BacktestKpiTiles({ metrics, baselineMetrics, days, trades, monthlyReturns }: BacktestKpiTilesProps) {
  const buyAndHold = (text: string) => (baselineMetrics ? `buy and hold ${text}` : null);
  const totals = closedTradeTotals(trades);
  const deepestDrawdown = describeDeepestDrawdown(days);
  const worstMonth = worstMonthOf(monthlyReturns);

  const tiles: KpiTileProps[] = [
    {
      label: "Total return",
      explanation: backtestMetricExplanation.totalReturn,
      value: signedPercentDisplay(metrics?.totalReturn).text,
      valueClassName: signedPercentDisplay(metrics?.totalReturn).className,
      lines: [
        metrics ? `${formatCompactDollarsTrimmed(metrics.startValue)} → ${formatCompactDollarsTrimmed(metrics.endValue)} after costs, ${formatCompactDollarsTrimmed(metrics.interestDollars)} of it interest` : "after costs",
        buyAndHold(signedPercentDisplay(baselineMetrics?.totalReturn).text),
      ],
    },
    {
      label: "CAGR",
      explanation: backtestMetricExplanation.cagr,
      value: signedPercentDisplay(metrics?.cagr).text,
      valueClassName: signedPercentDisplay(metrics?.cagr).className,
      lines: ["a year, on calendar time", buyAndHold(signedPercentDisplay(baselineMetrics?.cagr).text)],
    },
    {
      label: "Sortino",
      explanation: backtestMetricExplanation.sortino,
      value: formatRatio(metrics?.sortino, 2),
      lines: ["yearly, on daily returns", buyAndHold(formatRatio(baselineMetrics?.sortino, 2))],
    },
    {
      label: "Max drawdown",
      explanation: backtestMetricExplanation.maxDrawdown,
      value: signedPercentDisplay(metrics?.maxDrawdown).text,
      valueClassName: signedPercentDisplay(metrics?.maxDrawdown).className,
      lines: [deepestDrawdown ?? "from a previous peak", buyAndHold(signedPercentDisplay(baselineMetrics?.maxDrawdown).text)],
    },
    {
      label: "Worst month",
      explanation: backtestMetricExplanation.worstMonth,
      value: signedPercentDisplay(metrics?.worstMonth).text,
      valueClassName: signedPercentDisplay(metrics?.worstMonth).className,
      lines: [worstMonth ?? "the lowest monthly return", buyAndHold(signedPercentDisplay(baselineMetrics?.worstMonth).text)],
    },
    {
      label: "Trades",
      explanation: backtestMetricExplanation.trades,
      value: formatNumber(metrics?.tradeCount),
      lines: [metrics?.winRate === null || metrics?.winRate === undefined ? "none closed yet" : `${formatPercentage(metrics.winRate, 0)} ended in profit`],
    },
    {
      label: "Average win / loss",
      explanation: backtestMetricExplanation.averageWinLoss,
      value: metrics ? describeAverageWinLoss(metrics) : "—",
      lines: ["per trade"],
    },
    {
      label: "Edge capture",
      explanation: backtestMetricExplanation.edgeCapture,
      value: formatRatio(metrics?.edgeCapture, 2),
      lines: [describeEdgeCaptureTotals(totals)],
    },
    {
      label: "Capital in use",
      explanation: backtestMetricExplanation.capitalInUse,
      value: formatPercentage(metrics?.capitalInUse, 0),
      lines: ["of the account value, on average", metrics?.returnOnCapitalInUse === null || metrics?.returnOnCapitalInUse === undefined ? null : `earning ${signedPercentDisplay(metrics.returnOnCapitalInUse).text} a year`],
    },
    {
      label: "In the money at expiry",
      explanation: backtestMetricExplanation.inTheMoneyAtExpiry,
      value: formatPercentage(metrics?.inTheMoneyAtExpiryShare, 0),
      lines: ["of expired contracts, settled at the close"],
    },
  ];

  return (
    <div className="backtest-kpi-grid mb-3">
      {tiles.map((tile) => (
        <KpiTile key={tile.label} {...tile} lines={tile.lines.filter((line) => line !== null)} />
      ))}
    </div>
  );
}
