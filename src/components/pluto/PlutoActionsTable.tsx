import { Link } from "react-router-dom";
import type { PlutoAction } from "../../api/pluto";
import { formatFeedTime, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { describePlutoActionContract, gatesPassedLabel, plutoActionKindLabel, plutoOutcomeBadgeClass, plutoOutcomeLabel } from "../../lib/plutoPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { TooltipSpan } from "../TooltipSpan";

interface PlutoActionsTableProps {
  actions: PlutoAction[];
  loading: boolean;
  error: string | null;
  onOpenTickerDetail: (symbol: string) => void;
}

const columns = (onOpenTickerDetail: (symbol: string) => void): DataTableColumn<PlutoAction>[] => [
  { key: "when", header: "When", render: (row) => <span className="font-monospace">{formatFeedTime(row.createdAt)}</span> },
  {
    key: "symbol",
    header: "Symbol",
    render: (row) =>
      row.kind === "no_trade" ? (
        <span className="text-muted">—</span>
      ) : (
        <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => onOpenTickerDetail(row.symbol)}>
          {row.symbol}
        </button>
      ),
  },
  { key: "action", header: "Action", render: (row) => (row.kind === "no_trade" ? "No trade" : `${plutoActionKindLabel(row)} ${describePlutoActionContract(row)}`) },
  { key: "quantity", header: "Qty", align: "right", render: (row) => (row.quantity === null ? "—" : <span className="font-monospace">{row.quantity}{row.sizeTier === "half" ? " (half)" : ""}</span>) },
  { key: "limit", header: "Limit", align: "right", render: (row) => (row.limitPrice === null ? "—" : <span className="font-monospace">{row.limitPrice.toFixed(2)}</span>) },
  { key: "fill", header: "Fill", align: "right", render: (row) => (row.fillPrice === null ? "—" : <span className="font-monospace">{row.fillPrice.toFixed(2)}</span>) },
  {
    key: "outcome",
    header: "Outcome",
    render: (row) => (
      <>
        {row.orderRequestId ? (
          <Link to={`/trade-blotter?order=${row.orderRequestId}`} className="text-decoration-none" title="Open in the Trade Blotter">
            <span className={`badge ${plutoOutcomeBadgeClass(row.outcome)}`} style={{ fontSize: "0.72rem" }}>{plutoOutcomeLabel(row.outcome)} ↗</span>
          </Link>
        ) : (
          <span className={`badge ${plutoOutcomeBadgeClass(row.outcome)}`} style={{ fontSize: "0.72rem" }}>{plutoOutcomeLabel(row.outcome)}</span>
        )}
        {row.blockReason && row.kind !== "no_trade" && (
          <TooltipSpan text={row.blockReason} className="ms-1 text-muted">
            {row.blockReason.length > 40 ? `${row.blockReason.slice(0, 40)}…` : row.blockReason}
          </TooltipSpan>
        )}
      </>
    ),
  },
  { key: "pessimistic", header: "Pessimistic", headerTitle: "P&L difference had the order filled at the worse side of the market it was placed into", align: "right", render: (row) => (row.pessimisticPnl === null ? "—" : <span className={`font-monospace ${pnlTextClass(row.pessimisticPnl)}`}>{formatSignedPnl(row.pessimisticPnl)}</span>) },
  {
    key: "realized",
    header: "Realized",
    headerTitle: "Realized P&L of the legs this action opened, net of closing commissions; 'open' until they close",
    align: "right",
    render: (row) => {
      if (row.realizedPnl === null) return row.openLegCount > 0 ? <span className="text-muted">open</span> : "—";
      const partial = row.openLegCount > 0 ? ` (${row.openLegCount} leg${row.openLegCount === 1 ? "" : "s"} open)` : "";
      return (
        <span className={`font-monospace ${pnlTextClass(row.realizedPnl)}`}>
          {formatSignedPnl(row.realizedPnl)}
          {partial && <span className="text-muted" style={{ fontSize: "0.72rem" }}>{partial}</span>}
        </span>
      );
    },
  },
  {
    key: "gates",
    header: "Gates",
    headerTitle: "Post-model gates passed",
    align: "center",
    render: (row) => (
      <TooltipSpan text={row.gateResults.length > 0 ? row.gateResults.map((gate) => `${gate.ok ? "✓" : "✗"} ${gate.gate}: ${gate.detail}`).join("\n") : null}>
        <span className="font-monospace">{gatesPassedLabel(row)}</span>
      </TooltipSpan>
    ),
  },
];

export function PlutoActionsTable({ actions, loading, error, onOpenTickerDetail }: PlutoActionsTableProps) {
  if (error) return <div className="alert alert-danger">{error}</div>;
  return (
    <DataTable
      tableId="pluto-actions"
      columns={columns(onOpenTickerDetail)}
      rows={actions}
      rowKey={(row) => row.id}
      loading={loading}
      emptyMessage="No actions yet."
      dense
      maxVisibleRows={12}
      toolbar={
        <div className="d-flex align-items-center gap-2">
          <h3 className="card-title m-0">Actions</h3>
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>every order Pluto built, with gates and outcome</span>
        </div>
      }
    />
  );
}
