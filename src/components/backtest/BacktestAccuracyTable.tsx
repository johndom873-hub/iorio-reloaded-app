import type { BacktestAccuracyBand, BacktestPnlBasis } from "../../api/backtest";
import { formatNumber, formatRatio, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { accuracyCapture, describeOpenCycles, isCycleBasis, sumAccuracyBands } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle } from "./backtestBits";

const bandColumn: DataTableColumn<BacktestAccuracyBand> = {
  key: "band",
  header: "Edge margin",
  headerTitle: "The edge margin at the open: 1 − fair value ÷ mid, before costs. It sets the grade: Strong 20% or more, Good 10% to 20%, Weak 0% to 10%.",
  render: (band) => band.label,
};

function accuracyColumns(cycleBasis: boolean): DataTableColumn<BacktestAccuracyBand>[] {
  return [
    cycleBasis ? { ...bandColumn, headerTitle: `${bandColumn.headerTitle} Here: the margin of each cycle's first option sold.` } : bandColumn,
    ...(cycleBasis ? [{ key: "cycles", header: "Cycles", headerTitle: "Closed cycles whose first option sold had this margin.", align: "right" as const, render: (band: BacktestAccuracyBand) => formatNumber(band.cycleCount) }] : []),
    {
      key: "trades",
      header: cycleBasis ? "Options sold" : "Trades",
      headerTitle: cycleBasis ? "Options sold in the band's cycles: opening puts and calls and the new leg of each roll." : "Closed trades with this margin at the open.",
      align: "right",
      render: (band) => formatNumber(band.tradeCount),
    },
    {
      key: "predicted",
      header: "Predicted Edge $",
      headerTitle: cycleBasis ? "Σ Edge $ the model predicted for the options sold in these cycles: the expected profit held to expiry, after costs." : "Σ Edge $ the model predicted at the open: the expected profit held to expiry, after costs.",
      align: "right",
      render: (band) => formatSignedPnl(band.predictedPnlDollars, 0),
    },
    {
      key: "calibrated",
      header: "Hist Edge $",
      headerTitle: "Σ the history-corrected Edge $: what sales with the same margin and time left actually earned.",
      align: "right",
      render: (band) => formatSignedPnl(band.calibratedPnlDollars, 0),
    },
    {
      key: "made",
      header: "Made",
      headerTitle: cycleBasis
        ? "Σ the cycles' totals: the wheel cycle P&L, as the platform counts it, share gains included on purpose (what the shares made while held after an assignment or under a covered call)."
        : "Σ the trades' P&L: each option's own result, however it ended.",
      align: "right",
      render: (band) => <span className={pnlTextClass(band.realizedPnlDollars)}>{formatSignedPnl(band.realizedPnlDollars, 0)}</span>,
    },
    { key: "capture", header: "Capture", headerTitle: "Made ÷ predicted Edge $ (1.0 = the model was exactly right on average).", align: "right", render: (band) => formatRatio(accuracyCapture(band), 2) },
  ];
}

interface BacktestAccuracyTableProps {
  bands: BacktestAccuracyBand[];
  pnlBasis: BacktestPnlBasis;
  /** The open cycles, which the table leaves out: a cycle only closes in profit, so a loss would sit there. */
  openCycleCount: number;
  openCycleDollars: number;
}

/** Model accuracy: what the model predicted vs what was made, in bands of edge margin. On the wheel-cycle basis a row groups
 *  closed cycles (made = the cycle's total); on the option basis, closed options (made = each option's own result). */
export function BacktestAccuracyTable({ bands, pnlBasis, openCycleCount, openCycleDollars }: BacktestAccuracyTableProps) {
  const cycleBasis = isCycleBasis(pnlBasis);
  const all = sumAccuracyBands(bands);
  const columns = accuracyColumns(cycleBasis);
  return (
    <DataTable
      tableId={cycleBasis ? "backtest-accuracy-cycles" : "backtest-accuracy"}
      columns={columns}
      rows={bands}
      rowKey={(band) => band.label}
      emptyMessage={cycleBasis ? "No closed cycle yet." : "No closed trades yet."}
      dense
      toolbar={<BacktestCardTitle title="Model accuracy" description={cycleBasis ? "what the model predicted for the closed cycles' options vs what the cycles made" : "what the model predicted for these trades vs what they made"} />}
      footerCells={{
        band: "All",
        cycles: formatNumber(all.cycleCount),
        trades: formatNumber(all.tradeCount),
        predicted: formatSignedPnl(all.predictedPnlDollars, 0),
        calibrated: formatSignedPnl(all.calibratedPnlDollars, 0),
        made: <span className={pnlTextClass(all.realizedPnlDollars)}>{formatSignedPnl(all.realizedPnlDollars, 0)}</span>,
        capture: formatRatio(accuracyCapture(all), 2),
      }}
      afterTable={
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          {cycleBasis
            ? `Closed cycles only, grouped by the edge margin of each cycle's first option sold; made = the cycle's total, which counts what the shares made while held, on purpose, while the model predicts only the options. Not in it: ${describeOpenCycles(openCycleCount, openCycleDollars)}. `
            : "Totals per band, closed trades only. "}
          Capture = made ÷ predicted Edge $; Hist Edge $ is the prediction after history's correction.
        </div>
      }
    />
  );
}
