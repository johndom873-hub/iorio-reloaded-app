import { IconDownload } from "@tabler/icons-react";
import type { BacktestPnlBasis, BacktestTrade } from "../../api/backtest";
import { buildCsvText, downloadTextFile, type CsvColumn } from "../../lib/csvExport";
import { formatCurrency, formatNumber, formatPercentage, formatQuotePrice, formatSignedPercentage, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import {
  backtestCycleMetricExplanation,
  describeBacktestTradeContract,
  describeTradeSettlement,
  isCycleBasis,
  tradeEndedEarlyOn,
  tradeEnding,
  tradeEndingLabel,
  tradeGradeBadgeClass,
  tradeGradeLabel,
  tradeValuationColumnExplanation,
} from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle } from "./backtestBits";

/** Every field of every trade, for a spreadsheet. */
const tradeCsvColumns: CsvColumn<BacktestTrade>[] = [
  { header: "symbol", value: (trade) => trade.symbol },
  { header: "leg_id", value: (trade) => trade.legId },
  { header: "opened_on", value: (trade) => trade.openedOn },
  { header: "strategy", value: (trade) => trade.strategyKey },
  { header: "expiry", value: (trade) => trade.expiry },
  { header: "strike", value: (trade) => trade.strike },
  { header: "right", value: (trade) => trade.optionRight },
  { header: "dte", value: (trade) => trade.dte },
  { header: "contracts", value: (trade) => trade.contracts },
  { header: "bid", value: (trade) => trade.bid },
  { header: "ask", value: (trade) => trade.ask },
  { header: "fill_price", value: (trade) => trade.fillPrice },
  { header: "commission_dollars", value: (trade) => trade.commissionDollars },
  { header: "spot_at_open", value: (trade) => trade.spotAtOpen },
  { header: "share_price_at_open", value: (trade) => trade.sharePriceAtOpen },
  { header: "exposure_dollars", value: (trade) => trade.exposureDollars },
  { header: "delta", value: (trade) => trade.delta },
  { header: "grade", value: (trade) => trade.grade },
  { header: "edge_margin", value: (trade) => trade.edgeMargin },
  { header: "edge_dollars", value: (trade) => trade.expectedPnlDollars },
  { header: "hist_edge_dollars", value: (trade) => trade.calibratedExpectedPnlDollars },
  { header: "edge_yield", value: (trade) => trade.edgeYield },
  { header: "hist_yield", value: (trade) => trade.histYield },
  { header: "kelly_contracts", value: (trade) => trade.kellyContracts },
  { header: "stress_contracts", value: (trade) => trade.stressContracts },
  { header: "ended_by", value: (trade) => trade.endedBy },
  { header: "settled_on", value: (trade) => trade.settledOn },
  { header: "settlement_close", value: (trade) => trade.settlementClose },
  { header: "in_the_money_at_expiry", value: (trade) => trade.inTheMoneyAtExpiry },
  { header: "pnl_dollars", value: (trade) => trade.pnlDollars },
  { header: "position_id", value: (trade) => trade.positionId },
  { header: "position_status", value: (trade) => trade.positionStatus },
  { header: "position_pnl_dollars", value: (trade) => trade.positionPnlDollars },
  { header: "cycle_number", value: (trade) => trade.cycleNumber },
  { header: "cycle_label", value: (trade) => trade.cycleLabel },
  { header: "cycle_status", value: (trade) => trade.cycleStatus },
  { header: "cycle_total_dollars", value: (trade) => trade.cycleTotalDollars },
];

/** A dollar figure with "open" beside it while its position or cycle still runs (the figure is then at the last marks). */
function SignedDollarsWithStatus({ value, status }: { value: number | null; status: "open" | "closed" | null }) {
  if (value === null) return <span className="text-secondary">—</span>;
  return (
    <span className="text-nowrap">
      <span className={pnlTextClass(value)}>{formatSignedPnl(value, 0)}</span>
      {status === "open" && <span className="text-secondary"> open</span>}
    </span>
  );
}

function fileNamePart(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
}

interface BacktestTradesTableProps {
  symbol: string;
  sessionName: string;
  pnlBasis: BacktestPnlBasis;
  trades: BacktestTrade[];
}

/** Every option the session sold (an opening put or call, the new leg of a roll), newest first, with a CSV of all their fields.
 *  Whether a sale made money is its wheel cycle's answer: each row carries its cycle and the cycle's P&L, and its position's
 *  P&L. A session measured per option (run before cycles carried the P&L) shows each option's own P&L instead. */
export function BacktestTradesTable({ symbol, sessionName, pnlBasis, trades }: BacktestTradesTableProps) {
  const cycleBasis = isCycleBasis(pnlBasis);
  const newestFirst = [...trades].sort((a, b) => b.openedOn.localeCompare(a.openedOn) || b.id - a.id);

  const columns: DataTableColumn<BacktestTrade>[] = [
    { key: "opened", header: "Opened", cellClassName: "font-mono text-nowrap", render: (trade) => trade.openedOn },
    { key: "contract", header: "Contract", cellClassName: "text-nowrap", render: (trade) => describeBacktestTradeContract(symbol, trade) },
    ...(cycleBasis
      ? [
          {
            key: "cycle",
            header: "Cycle",
            headerTitle: "The wheel cycle the option was sold in.",
            cellClassName: "text-nowrap",
            render: (trade: BacktestTrade) => trade.cycleLabel ?? <span className="text-secondary">—</span>,
          },
          {
            key: "cyclePnl",
            header: "Cycle P&L",
            headerTitle: `${backtestCycleMetricExplanation.cyclePnl} "open": the cycle still runs, at the session's last marks.`,
            align: "right" as const,
            render: (trade: BacktestTrade) => <SignedDollarsWithStatus value={trade.cycleTotalDollars} status={trade.cycleStatus} />,
          },
          {
            key: "positionPnl",
            header: "Position P&L",
            headerTitle: "Its position's P&L as Positions shows it: realized (premium and stock parts, after commissions), plus what it holds at the session's last marks while open.",
            align: "right" as const,
            render: (trade: BacktestTrade) => <SignedDollarsWithStatus value={trade.positionPnlDollars} status={trade.positionStatus} />,
          },
        ]
      : []),
    { key: "qty", header: "Qty", align: "right", render: (trade) => formatNumber(trade.contracts) },
    { key: "soldAt", header: "Sold at", headerTitle: "Sale price = mid − spread cost share × (ask − bid) ÷ 2, before the commission.", align: "right", render: (trade) => formatQuotePrice(trade.fillPrice) },
    { key: "exposure", header: "EXP $", headerTitle: "EXP $ when it was sold: the position's capital at risk as Positions shows it (a put's strike, or a call's shares at their cost in the book, less the premium after its commission).", align: "right", render: (trade) => formatCurrency(trade.exposureDollars, 0) },
    { key: "grade", header: "Grade", headerTitle: tradeValuationColumnExplanation.grade, render: (trade) => (trade.grade === null ? tradeGradeLabel(null) : <span className={`badge ${tradeGradeBadgeClass(trade.grade)}`}>{tradeGradeLabel(trade.grade)}</span>) },
    { key: "margin", header: "Edge margin", headerTitle: tradeValuationColumnExplanation.margin, align: "right", render: (trade) => formatPercentage(trade.edgeMargin, 0) },
    { key: "edgeYield", header: "Edge Yield", headerTitle: tradeValuationColumnExplanation.edgeYield, align: "right", render: (trade) => formatSignedPercentage(trade.edgeYield, 0) },
    { key: "histYield", header: "Hist Yield", headerTitle: tradeValuationColumnExplanation.histYield, align: "right", render: (trade) => formatSignedPercentage(trade.histYield, 0) },
    { key: "predicted", header: "Predicted Edge $", headerTitle: "Edge $ at the open: the expected profit held to expiry, after costs.", align: "right", render: (trade) => formatSignedPnl(trade.expectedPnlDollars, 0) },
    { key: "expiry", header: "Expiry", cellClassName: "font-mono text-secondary text-nowrap", render: (trade) => trade.expiry },
    {
      key: "ended",
      header: "Ended",
      headerTitle: "How it ended: at expiry (expired worthless or assigned), bought back, or rolled, with the day when that was before its expiry. Open while it still runs.",
      cellClassName: "text-nowrap",
      render: (trade) => {
        const endedEarlyOn = tradeEndedEarlyOn(trade);
        return (
          <>
            {tradeEndingLabel[tradeEnding(trade)]}
            {endedEarlyOn && <span className="font-mono text-secondary"> {endedEarlyOn}</span>}
          </>
        );
      },
    },
    { key: "settledAt", header: "Settled at", headerTitle: "The underlying's close on the expiry day when the option was assigned; \"expired\" when it ended out of the money; — when it ended before its expiry.", align: "right", render: (trade) => describeTradeSettlement(trade) },
    ...(cycleBasis
      ? []
      : [
          {
            key: "pnl",
            header: "P&L",
            headerTitle: "The option's own result: its premium after the commission, less the buyback and its commission, less its intrinsic value at the expiry close when assigned. What assigned shares did afterwards belongs to the wheel cycle.",
            align: "right" as const,
            render: (trade: BacktestTrade) => <span className={pnlTextClass(trade.pnlDollars)}>{formatSignedPnl(trade.pnlDollars, 0)}</span>,
          },
        ]),
  ];

  const downloadCsv = () => {
    downloadTextFile(`backtest-${fileNamePart(symbol)}-${fileNamePart(sessionName)}-trades.csv`, buildCsvText(tradeCsvColumns, newestFirst));
  };

  return (
    <DataTable
      tableId="backtest-trades"
      columns={columns}
      rows={newestFirst}
      rowKey={(trade) => String(trade.id)}
      emptyMessage="No trades yet."
      dense
      maxVisibleRows={15}
      toolbar={
        <>
          <BacktestCardTitle title={cycleBasis ? "Options sold" : "Trades"} description={cycleBasis ? `${pluralizeCount(trades.length, "option")} sold · newest first · each with its cycle` : `${pluralizeCount(trades.length, "trade")} · newest first`} />
          <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={trades.length === 0} onClick={downloadCsv}>
            <IconDownload size={16} aria-hidden="true" />
            Download CSV
          </button>
        </>
      }
    />
  );
}
