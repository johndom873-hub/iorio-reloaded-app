import type { BacktestAccuracyBand } from "../../api/backtest";
import { formatNumber, formatRatio, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { accuracyCapture, sumAccuracyBands } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { BacktestCardTitle } from "./backtestBits";

const columns: DataTableColumn<BacktestAccuracyBand>[] = [
  { key: "band", header: "Edge margin", headerTitle: "The edge margin at the open: 1 − fair value ÷ mid, before costs. It sets the grade: Strong 30% or more, Good 20%, Weak 10%.", render: (band) => band.label },
  { key: "trades", header: "Trades", align: "right", render: (band) => formatNumber(band.tradeCount) },
  {
    key: "predicted",
    header: "Predicted Edge $",
    headerTitle: "Σ Edge $ the model predicted at the open: the expected profit held to expiry, after costs.",
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
  { key: "made", header: "Made", headerTitle: "Σ the trades' P&L, held to expiry.", align: "right", render: (band) => <span className={pnlTextClass(band.realizedPnlDollars)}>{formatSignedPnl(band.realizedPnlDollars, 0)}</span> },
  { key: "capture", header: "Capture", headerTitle: "Made ÷ predicted Edge $ (1.0 = the model was exactly right on average).", align: "right", render: (band) => formatRatio(accuracyCapture(band), 2) },
];

/** Model accuracy: closed trades grouped by the edge margin at the open, what the model predicted vs what they made. */
export function BacktestAccuracyTable({ bands }: { bands: BacktestAccuracyBand[] }) {
  const all = sumAccuracyBands(bands);
  return (
    <DataTable
      tableId="backtest-accuracy"
      columns={columns}
      rows={bands}
      rowKey={(band) => band.label}
      emptyMessage="No closed trades yet."
      dense
      toolbar={<BacktestCardTitle title="Model accuracy" description="what the model predicted for these trades vs what they made" />}
      footerCells={{
        band: "All",
        trades: formatNumber(all.tradeCount),
        predicted: formatSignedPnl(all.predictedPnlDollars, 0),
        calibrated: formatSignedPnl(all.calibratedPnlDollars, 0),
        made: <span className={pnlTextClass(all.realizedPnlDollars)}>{formatSignedPnl(all.realizedPnlDollars, 0)}</span>,
        capture: formatRatio(accuracyCapture(all), 2),
      }}
      afterTable={
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          Totals per band, closed trades only. Capture = made ÷ predicted Edge $; Hist Edge $ is the prediction after history's correction.
        </div>
      }
    />
  );
}
