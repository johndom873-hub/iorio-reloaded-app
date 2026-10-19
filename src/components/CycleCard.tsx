import { useEffect, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { ColumnVisibilityPopover } from "./DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "./DataTable/useColumnVisibility";
import { CycleBucketBadge } from "./CycleBucketBadge";
import { Spinner } from "./Spinner";
import { fetchCycles, type Cycle, type UnrealizedPnlResult } from "../api/positions";
import { liveCycleTimelineRows } from "../lib/cycleLivePnl";
import { daysToExpiry, easternIsoDate, formatCurrency, formatDate, formatExpiryDayMonthWithDte, formatNumber, formatSignedPnl, formatTransactionPrice, pnlTextClass, todayInEasternIso } from "../lib/formatters";
import { TooltipSpan } from "./TooltipSpan";

// Timeline columns; every data table gets the per-column show/hide gear (project rule), saved in localStorage.
const timelineColumns = [
  { key: "date", header: "Date" },
  { key: "type", header: "Type" },
  { key: "event", header: "Event" },
  { key: "owner", header: "Strategy" },
  { key: "quantity", header: "Qty" },
  { key: "strike", header: "Strike" },
  { key: "expiry", header: "Expiry" },
  { key: "stockPrice", header: "Stock price" },
  { key: "premium", header: "Premium" },
  { key: "commission", header: "Commission" },
  { key: "stock", header: "Stock" },
];

// The symbol's wheel cycle (approved 2026-09-19): summary tiles + a dated timeline where every event is owned by
// exactly one bucket (CSP / Unstructured / CC / Hedge). Open shares are marked at the latest daily close and open options
// at the last nightly snapshot, each row dated by its mark; while live prices stream, "Today" rows add the move since
// then and the tiles and totals include it (liveCycleTimelineRows).
export function CycleCard({ symbol, unrealizedPnlByPositionId = {} }: { symbol: string; unrealizedPnlByPositionId?: Record<string, UnrealizedPnlResult> }) {
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
  // A cycle with its live "Today" rows (open cycle only) and the tiles / totals including them.
  const withLiveRows = (base: Cycle) => {
    const liveRows = liveCycleTimelineRows(base, unrealizedPnlByPositionId);
    const livePremium = liveRows.reduce((sum, row) => sum + row.premium, 0);
    const liveStock = liveRows.reduce((sum, row) => sum + row.stock, 0);
    const stock = base.buckets.csp.stock + base.buckets.unstructured.stock + base.buckets.cc.stock + liveStock;
    return { ...base, timeline: [...base.timeline, ...liveRows], total: base.total + livePremium + liveStock, netPremium: base.netPremium + livePremium, stock };
  };
  const cycle = cycles?.[selectedIndex] && withLiveRows(cycles[selectedIndex]);
  const newest = cycles?.[0] && withLiveRows(cycles[0]);
  const summaryItem = (label: string, value: number) => (
    <span key={label} className="text-nowrap" style={{ fontSize: "0.8rem" }}>
      <span className="text-secondary">{label} </span>
      <span className={`fw-bold font-mono ${pnlTextClass(value)}`}>{formatSignedPnl(value)}</span>
    </span>
  );
  const collapsedSummary = newest && (
    <>
      {summaryItem("Cycle P&L", newest.total)}
      {summaryItem("Premium", newest.netPremium)}
      {summaryItem("Stock", newest.stock)}
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
      {failed && <div className="text-secondary">Couldn't load the cycle.</div>}
      {cycle && (
        <div className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0" style={{ fontSize: "0.8rem" }}>
            Every event since this symbol's cycle began, owned by one strategy. Shares are marked at the latest daily close and open options at the last nightly snapshot; while live prices stream, Today rows add the move since then.
          </p>
          {cycles!.length > 1 && (
            <select
              id="cycle-select"
              className="form-select cycle-card-select"
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
              <div className="text-secondary" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Cycle P&amp;L</div>
              <div className={`cycle-card-figure fw-bold font-mono ${pnlTextClass(cycle.total)}`}>{formatSignedPnl(cycle.total)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-secondary" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Net premium</div>
              <div className={`cycle-card-figure fw-bold font-mono ${pnlTextClass(cycle.netPremium)}`}>{formatSignedPnl(cycle.netPremium)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-secondary" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Stock P&amp;L</div>
              <div className={`cycle-card-figure fw-bold font-mono ${pnlTextClass(cycle.stock)}`}>{formatSignedPnl(cycle.stock)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-secondary" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Break-even</div>
              <div className="cycle-card-figure fw-bold font-mono">
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
                  {visible("expiry") && <TooltipSpan as="th" className="text-end" text="Days to expiry counted from the row's date (US Eastern)">{headerLabel("expiry", "Expiry", true)}</TooltipSpan>}
                  {visible("stockPrice") && (
                    <TooltipSpan as="th" className="text-end" text="What the shares behind this row were bought at (IBKR's fills; assigned shares at the strike). Rows marked close use the market close: the shares still held are valued at it">
                      {headerLabel("stockPrice", "Stock price", true)}
                    </TooltipSpan>
                  )}
                  {visible("premium") && <TooltipSpan as="th" className="text-end" text="Premium received or paid, net of the commission beside it">{headerLabel("premium", "Premium", true)}</TooltipSpan>}
                  {visible("commission") && <TooltipSpan as="th" className="text-end" text="Commission IBKR charged on the row's executions">{headerLabel("commission", "Commission", true)}</TooltipSpan>}
                  {visible("stock") && <th className="text-end">{headerLabel("stock", "Stock", true)}</th>}
                </tr>
              </thead>
              <tbody>
                {cycle.timeline.map((row, index) => (
                  <tr key={`${row.at ?? row.markDate ?? "now"}-${index}`}>
                    {visible("date") && <td className="text-nowrap">{row.at ? formatDate(row.at) : row.markDate ? formatDate(row.markDate) : "Today"}</td>}
                    {visible("type") && (
                      <td>
                        <span className={`badge ${row.instrument === "stock" ? "bg-teal text-teal-fg" : "bg-pink text-pink-fg"}`} style={{ fontSize: "0.72rem" }}>
                          {row.instrument === "stock" ? "Stock" : "Option"}
                        </span>
                      </td>
                    )}
                    {visible("event") && <td className="cycle-event-cell">{row.label}</td>}
                    {visible("owner") && <td><CycleBucketBadge bucket={row.bucket} /></td>}
                    {visible("quantity") && <td className="text-end font-mono">{formatNumber(row.quantity)}</td>}
                    {visible("strike") && <td className={`text-end font-mono ${row.strike === null ? "text-secondary" : ""}`}>{row.strike === null ? "—" : formatCurrency(row.strike, 2)}</td>}
                    {visible("expiry") && (
                      <td className={`text-end font-mono text-nowrap ${row.expiryDate === null ? "text-secondary" : ""}`}>
                        {row.expiryDate === null ? "—" : formatExpiryDayMonthWithDte(row.expiryDate, daysToExpiry(row.expiryDate, row.at ? easternIsoDate(row.at) : (row.markDate ?? todayInEasternIso())))}
                      </td>
                    )}
                    {visible("stockPrice") && (
                      <td className={`text-end font-mono text-nowrap ${row.stockPrice === null ? "text-secondary" : ""}`}>
                        {row.stockPrice === null
                          ? "—"
                          : row.stockPriceSource === "close" || row.stockPriceSource === "live"
                            ? formatCurrency(row.stockPrice)
                            : formatTransactionPrice(row.stockPrice, { withDollarSign: true })}
                        {row.stockPrice !== null && (row.stockPriceSource === "close" || row.stockPriceSource === "live") && (
                          <span className="text-secondary ms-1" style={{ fontSize: "0.72rem", fontFamily: "var(--tblr-font-sans-serif)" }}>
                            {row.stockPriceSource}
                          </span>
                        )}
                      </td>
                    )}
                    {visible("premium") && <td className={`text-end font-mono ${row.premium === 0 ? "text-secondary" : pnlTextClass(row.premium)}`}>{row.premium === 0 ? "—" : formatSignedPnl(row.premium)}</td>}
                    {visible("commission") && (
                      <td className={`text-end font-mono ${row.commission === null || row.commission === undefined ? "text-secondary" : ""}`}>
                        {row.commission === null || row.commission === undefined ? "—" : formatCurrency(row.commission)}
                      </td>
                    )}
                    {visible("stock") && <td className={`text-end font-mono ${row.stock === 0 ? "text-secondary" : pnlTextClass(row.stock)}`}>{row.stock === 0 ? "—" : formatSignedPnl(row.stock)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot className="table-totals-row">
                <tr>
                  {timelineColumns
                    .filter((column) => visible(column.key))
                    .map((column) => (
                      <td key={column.key} className={["quantity", "strike", "expiry", "stockPrice", "premium", "commission", "stock"].includes(column.key) ? "text-end font-mono" : undefined}>
                        {column.key === "date" ? "Cycle total" : null}
                        {column.key === "premium" ? <span className={pnlTextClass(cycle.netPremium)}>{formatSignedPnl(cycle.netPremium)}</span> : null}
                        {column.key === "commission" ? formatCurrency(cycle.timeline.reduce((sum, row) => sum + (row.commission ?? 0), 0)) : null}
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
