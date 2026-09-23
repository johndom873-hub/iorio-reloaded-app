import { useEffect, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { ColumnVisibilityPopover } from "./DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "./DataTable/useColumnVisibility";
import { CycleBucketBadge } from "./CycleBucketBadge";
import { Spinner } from "./Spinner";
import { fetchCycles, type Cycle } from "../api/positions";
import { formatCurrency, formatDate, formatNumber, formatSignedPnl, pnlTextClass } from "../lib/formatters";
import { TooltipSpan } from "./TooltipSpan";

// Timeline columns; every data table gets the per-column show/hide gear (project rule), saved in localStorage.
const timelineColumns = [
  { key: "date", header: "Date" },
  { key: "type", header: "Type" },
  { key: "event", header: "Event" },
  { key: "owner", header: "Strategy" },
  { key: "quantity", header: "Qty" },
  { key: "strike", header: "Strike" },
  { key: "stockPrice", header: "Stock price" },
  { key: "premium", header: "Premium" },
  { key: "stock", header: "Stock" },
];

// The symbol's wheel cycle (approved 2026-09-19): summary tiles + a dated timeline where every event is owned by
// exactly one bucket (CSP / Unstructured / CC). Figures are as of the latest daily close (open shares marked at it,
// open options at the last nightly snapshot), not live ticks.
export function CycleCard({ symbol }: { symbol: string }) {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    "cycle-timeline",
    timelineColumns.map((column) => column.key),
  );
  const visible = (key: string) => isColumnVisible(key);
  const visibleTimelineKeys = timelineColumns.filter((column) => visible(column.key)).map((column) => column.key);
  const lastVisibleTimelineKey = visibleTimelineKeys[visibleTimelineKeys.length - 1];
  const headerLabel = (key: string, label: string, alignRight = false) =>
    key === lastVisibleTimelineKey ? (
      <div className={`d-flex align-items-center gap-1 ${alignRight ? "justify-content-end" : ""}`}>
        <span>{label}</span>
        <ColumnVisibilityPopover columns={timelineColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
      </div>
    ) : (
      label
    );

  useEffect(() => {
    setCycles(null);
    setFailed(false);
    setSelectedIndex(0);
    fetchCycles(symbol)
      .then((result) => setCycles(result.cycles))
      .catch(() => setFailed(true));
  }, [symbol]);

  if (cycles !== null && cycles.length === 0) return null;
  const cycle = cycles?.[selectedIndex];
  const newest = cycles?.[0];
  const summaryItem = (label: string, value: number) => (
    <span key={label} className="text-nowrap" style={{ fontSize: "0.8rem" }}>
      <span className="text-muted">{label} </span>
      <span className={`fw-bold font-mono ${pnlTextClass(value)}`}>{formatSignedPnl(value)}</span>
    </span>
  );
  const collapsedSummary = newest && (
    <>
      {summaryItem("Cycle P&L", newest.total)}
      {summaryItem("Premium", newest.netPremium)}
      {summaryItem("Stock", newest.buckets.csp.stock + newest.buckets.unstructured.stock + newest.buckets.cc.stock)}
    </>
  );

  return (
    <CollapsibleCard
      title="Wheel cycle"
      storageKey="ticker-detail-cycle"
      defaultOpen={false}
      collapsedSummary={collapsedSummary}
    >
      {cycles === null && !failed && (
        <div className="d-flex justify-content-center py-2">
          <Spinner size="sm" label="Loading cycle" />
        </div>
      )}
      {failed && <div className="text-muted">Couldn't load the cycle.</div>}
      {cycle && (
        <div className="d-flex flex-column gap-3">
          <p className="text-muted mb-0" style={{ fontSize: "0.8rem" }}>
            Every event since this symbol's cycle began, owned by one strategy. Shares are marked at the latest daily close and open options at the last nightly snapshot.
          </p>
          {cycles!.length > 1 && (
            <select
              id="cycle-select"
              className="form-select"
              style={{ maxWidth: "24rem" }}
              value={selectedIndex}
              onChange={(event) => setSelectedIndex(Number(event.target.value))}
              aria-label="Cycle"
            >
              {cycles!.map((option, index) => (
                <option key={option.startAt} value={index}>
                  {formatDate(option.startAt)} – {option.endAt ? formatDate(option.endAt) : "now"} ({option.status})
                </option>
              ))}
            </select>
          )}

          {cycle.dataFlags.length > 0 && (
            <div className="alert alert-warning mb-0">
              Numbers for this cycle may be incomplete: {cycle.dataFlags.join("; ")}.
            </div>
          )}

          <div className="row g-3">
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Cycle P&amp;L</div>
              <div className={`fw-bold font-mono ${pnlTextClass(cycle.total)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(cycle.total)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Net premium</div>
              <div className={`fw-bold font-mono ${pnlTextClass(cycle.netPremium)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(cycle.netPremium)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Stock P&amp;L</div>
              {(() => {
                const stock = cycle.buckets.csp.stock + cycle.buckets.unstructured.stock + cycle.buckets.cc.stock;
                return <div className={`fw-bold font-mono ${pnlTextClass(stock)}`} style={{ fontSize: "1.25rem" }}>{formatSignedPnl(stock)}</div>;
              })()}
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Break-even</div>
              <div className="fw-bold font-mono" style={{ fontSize: "1.25rem" }}>
                {cycle.breakEvenPerShare === null ? "—" : cycle.breakEvenPerShare <= 0 ? "Free" : formatCurrency(cycle.breakEvenPerShare, 2)}
              </div>
            </div>
          </div>

          <div className="table-responsive border rounded">
            <table className="table table-sm table-vcenter card-table mb-0">
              <thead className="table-light">
                <tr>
                  {visible("date") && <th>{headerLabel("date", "Date")}</th>}
                  {visible("type") && <th>{headerLabel("type", "Type")}</th>}
                  {visible("event") && <th>{headerLabel("event", "Event")}</th>}
                  {visible("owner") && <th>{headerLabel("owner", "Strategy")}</th>}
                  {visible("quantity") && <TooltipSpan as="th" className="text-end" text="Shares-equivalent: 1 option contract = 100">{headerLabel("quantity", "Qty", true)}</TooltipSpan>}
                  {visible("strike") && <th className="text-end">{headerLabel("strike", "Strike", true)}</th>}
                  {visible("stockPrice") && <TooltipSpan as="th" className="text-end" text="Real fill for stock trades, otherwise that day's closing price of the stock">{headerLabel("stockPrice", "Stock price", true)}</TooltipSpan>}
                  {visible("premium") && <th className="text-end">{headerLabel("premium", "Premium", true)}</th>}
                  {visible("stock") && <th className="text-end">{headerLabel("stock", "Stock", true)}</th>}
                </tr>
              </thead>
              <tbody>
                {cycle.timeline.map((row, index) => (
                  <tr key={`${row.at ?? "now"}-${index}`}>
                    {visible("date") && <td>{row.at ? formatDate(row.at) : "Today"}</td>}
                    {visible("type") && (
                      <td>
                        <span className={`badge ${row.instrument === "stock" ? "bg-teal text-teal-fg" : "bg-pink text-pink-fg"}`} style={{ fontSize: "0.72rem" }}>
                          {row.instrument === "stock" ? "Stock" : "Option"}
                        </span>
                      </td>
                    )}
                    {visible("event") && <td>{row.label}</td>}
                    {visible("owner") && <td><CycleBucketBadge bucket={row.bucket} /></td>}
                    {visible("quantity") && <td className="text-end font-mono">{formatNumber(row.quantity)}</td>}
                    {visible("strike") && <td className={`text-end font-mono ${row.strike === null ? "text-muted" : ""}`}>{row.strike === null ? "—" : formatCurrency(row.strike, 2)}</td>}
                    {visible("stockPrice") && <td className={`text-end font-mono ${row.stockPrice === null ? "text-muted" : ""}`}>{row.stockPrice === null ? "—" : formatCurrency(row.stockPrice, 2)}</td>}
                    {visible("premium") && <td className={`text-end font-mono ${row.premium === 0 ? "text-muted" : pnlTextClass(row.premium)}`}>{row.premium === 0 ? "—" : formatSignedPnl(row.premium)}</td>}
                    {visible("stock") && <td className={`text-end font-mono ${row.stock === 0 ? "text-muted" : pnlTextClass(row.stock)}`}>{row.stock === 0 ? "—" : formatSignedPnl(row.stock)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot className="table-totals-row">
                <tr>
                  {timelineColumns
                    .filter((column) => visible(column.key))
                    .map((column) => (
                      <td key={column.key} className={["quantity", "strike", "stockPrice", "premium", "stock"].includes(column.key) ? "text-end font-mono" : undefined}>
                        {column.key === "date" ? "Cycle total" : null}
                        {column.key === "premium" ? <span className={pnlTextClass(cycle.netPremium)}>{formatSignedPnl(cycle.netPremium)}</span> : null}
                        {column.key === "stock" ? <span className={pnlTextClass(cycle.total - cycle.netPremium)}>{formatSignedPnl(cycle.total - cycle.netPremium)}</span> : null}
                      </td>
                    ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
