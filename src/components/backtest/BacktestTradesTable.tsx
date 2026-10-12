import { IconDownload } from "@tabler/icons-react";
import type { BacktestTrade } from "../../api/backtest";
import { buildCsvText, downloadTextFile, type CsvColumn } from "../../lib/csvExport";
import { formatCurrency, formatNumber, formatPercentage, formatQuotePrice, formatSignedPercentage, formatSignedPnl, pluralize, pnlTextClass } from "../../lib/formatters";
import { describeBacktestTradeContract, describeTradeSettlement, tradeGradeBadgeClass, tradeGradeLabel } from "../../lib/backtestPresentation";
import { modelColumnExplanation } from "../../lib/signalsPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle } from "./backtestBits";

/** Every field of every trade, for a spreadsheet. */
const tradeCsvColumns: CsvColumn<BacktestTrade>[] = [
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
  { header: "settled_on", value: (trade) => trade.settledOn },
  { header: "settlement_close", value: (trade) => trade.settlementClose },
  { header: "in_the_money_at_expiry", value: (trade) => trade.inTheMoneyAtExpiry },
  { header: "pnl_dollars", value: (trade) => trade.pnlDollars },
];

function fileNamePart(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
}

interface BacktestTradesTableProps {
  symbol: string;
  sessionName: string;
  trades: BacktestTrade[];
}

/** Every trade the session opened, newest first, with a CSV of all their fields. */
export function BacktestTradesTable({ symbol, sessionName, trades }: BacktestTradesTableProps) {
  const newestFirst = [...trades].sort((a, b) => b.openedOn.localeCompare(a.openedOn) || b.id - a.id);

  const columns: DataTableColumn<BacktestTrade>[] = [
    { key: "opened", header: "Opened", cellClassName: "font-mono text-nowrap", render: (trade) => trade.openedOn },
    { key: "contract", header: "Contract", cellClassName: "text-nowrap", render: (trade) => describeBacktestTradeContract(symbol, trade) },
    { key: "qty", header: "Qty", align: "right", render: (trade) => formatNumber(trade.contracts) },
    { key: "soldAt", header: "Sold at", headerTitle: "Sale price = mid − spread cost share × (ask − bid) ÷ 2, before the commission.", align: "right", render: (trade) => formatQuotePrice(trade.fillPrice) },
    { key: "exposure", header: "EXP $", headerTitle: "Exposure, net of premium: a put's (strike − premium) × 100 × contracts; a covered call's (share price − premium) × 100 × contracts.", align: "right", render: (trade) => formatCurrency(trade.exposureDollars, 0) },
    { key: "grade", header: "Grade", headerTitle: modelColumnExplanation.grade, render: (trade) => <span className={`badge ${tradeGradeBadgeClass(trade.grade)}`}>{tradeGradeLabel(trade.grade)}</span> },
    { key: "margin", header: "Edge margin", headerTitle: modelColumnExplanation.margin, align: "right", render: (trade) => formatPercentage(trade.edgeMargin, 0) },
    { key: "edgeYield", header: "Edge Yield", headerTitle: modelColumnExplanation.edgeYield, align: "right", render: (trade) => formatSignedPercentage(trade.edgeYield, 0) },
    { key: "histYield", header: "Hist Yield", headerTitle: modelColumnExplanation.histYield, align: "right", render: (trade) => formatSignedPercentage(trade.histYield, 0) },
    { key: "predicted", header: "Predicted Edge $", headerTitle: "Edge $ at the open: the expected profit held to expiry, after costs.", align: "right", render: (trade) => formatSignedPnl(trade.expectedPnlDollars, 0) },
    { key: "expiry", header: "Expiry", cellClassName: "font-mono text-secondary text-nowrap", render: (trade) => trade.expiry },
    { key: "settledAt", header: "Settled at", headerTitle: "Held to expiry: \"expired\" when it ended out of the money, else that day's closing price.", align: "right", render: (trade) => describeTradeSettlement(trade) },
    { key: "pnl", header: "P&L", align: "right", render: (trade) => <span className={pnlTextClass(trade.pnlDollars)}>{formatSignedPnl(trade.pnlDollars, 0)}</span> },
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
          <BacktestCardTitle title="Trades" description={`${pluralize(trades.length, "trade")} · newest first`} />
          <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={trades.length === 0} onClick={downloadCsv}>
            <IconDownload size={16} aria-hidden="true" />
            Download CSV
          </button>
        </>
      }
    />
  );
}
