import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { ApexChart } from "../components/charts/ApexChart";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { HelpTooltip } from "../components/HelpTooltip";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { useTheme } from "../contexts/ThemeContext";
import { ApiError } from "../api/client";
import {
  fetchAvailableCash,
  fetchDashboardEvents,
  fetchDashboardSummary,
  fetchPeriodPnlByStrategy,
  fetchPnlHistory,
  fetchPortfolio,
  type AvailableCash,
  type DashboardSummary,
  type PeriodPnlByStrategy,
  type PnlHistoryPoint,
  type Portfolio,
  type PositionEvent,
  type StrategyPeriodPnlRow,
} from "../api/dashboard";
import { fetchPositions, type Position } from "../api/positions";
import { fetchExposure, type ConcentrationRow, type ExposureData, type StrategyAllocationRow, type TopPositionRow } from "../api/riskLimits";
import {
  formatCurrency,
  formatDateTime,
  formatExpiryWithDte,
  formatPercentage,
  formatRelativeDate,
  formatSignedPercentageValue,
  formatSignedPnl,
  pnlTextClass,
} from "../lib/formatters";

const strategyLabels: Record<string, string> = {
  covered_call: "Covered Calls",
  cash_secured_put: "Cash-Secured Puts",
  unstructured: "Unstructured",
  unallocated: "Unallocated (cash)",
};

const closeReasonLabels: Record<string, string> = {
  assigned: "assigned",
  expired_worthless: "expired worthless",
  closed_via_app: "closed",
  closed_via_external_trade: "closed outside the app",
  unknown: "closed (reason unclear)",
};

const unstructuredReasonLabels: Record<string, string> = {
  cc_expired_leftover_stock: "covered call expired without assignment, shares remain",
  csp_assigned_stock: "cash-secured put assigned, shares received",
  unknown: "cause unclear — flagged for review",
};

// Fixed-order categorical palette (blue, orange, aqua, yellow, magenta,
// green, violet, red) — validated for adjacent-pair colorblind safety in
// this exact order; assigned in sequence, never cycled or reordered per
// chart. "Unallocated" isn't a real category (it's the absence of one) so
// it never takes a slot — it always renders as the same neutral gray.
const categoricalByTheme = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;
const unallocatedGrayByTheme = { light: "#9099ab", dark: "#8b96a8" } as const;

// Shared row shape for the three allocation lists below — a plain label
// (ticker/sector/strategy) plus a $ value, rendered as $ + % of total
// account value with an "Unallocated" row styled as muted rather than a
// real holding.
interface AllocationListProps {
  title: string;
  emptyMessage: string;
  totalAccountValue: number | null;
  rows: { key: string; label: string; sublabel?: string; notionalValue: string; isUnallocated?: boolean }[];
  // Overrides the donut's center label — e.g. "Top 5" for a truncated
  // list, so its total doesn't read as "the full account total" when it
  // deliberately isn't (found confusing 2026-08-28: Top Positions and By
  // Industry showed different totals with no visual explanation why).
  donutTotalLabel?: string;
}

// Assigns the fixed-order categorical palette to each real row (skipping
// "Unallocated", which always gets the neutral gray) — computed once and
// shared between the donut's slices and the list's swatches below it, so
// identity is never color-alone: every slice has a same-colored dot next
// to its label and $ value.
function allocationColors(rows: AllocationListProps["rows"], theme: "light" | "dark"): string[] {
  const categorical = categoricalByTheme[theme];
  let nextSlot = 0;
  return rows.map((row) => (row.isUnallocated ? unallocatedGrayByTheme[theme] : categorical[nextSlot++ % categorical.length]));
}

function AllocationDonut({ rows, colors, totalLabel = "Total" }: { rows: AllocationListProps["rows"]; colors: string[]; totalLabel?: string }) {
  const series = rows.map((row) => Number(row.notionalValue));
  const total = series.reduce((sum, value) => sum + value, 0);

  return (
    <ApexChart
      type="donut"
      height={200}
      series={series}
      options={{
        labels: rows.map((row) => row.label),
        colors,
        stroke: { show: true, width: 2 }, // surface gap between slices
        dataLabels: { enabled: rows.length <= 4, formatter: (val: number) => `${val.toFixed(0)}%` },
        legend: { show: false }, // the list below doubles as the legend (label + swatch)
        tooltip: { y: { formatter: (val: number) => formatCurrency(val, 0) } },
        plotOptions: {
          pie: {
            donut: {
              size: "68%",
              labels: {
                show: true,
                total: { show: true, label: totalLabel, formatter: () => formatCurrency(total, 0) },
                value: { formatter: (val: string) => formatCurrency(Number(val), 0) },
              },
            },
          },
        },
      }}
    />
  );
}

function AllocationList({ title, emptyMessage, totalAccountValue, rows, donutTotalLabel }: AllocationListProps) {
  const { theme } = useTheme();
  const colors = allocationColors(rows, theme);
  return (
    <div className="col-12 col-md-4">
      <h4 style={{ fontSize: "0.9rem" }}>{title}</h4>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
          {emptyMessage}
        </div>
      ) : (
        <>
          <AllocationDonut rows={rows} colors={colors} totalLabel={donutTotalLabel} />
          <ul className="list-group list-group-flush">
            {rows.map((row, index) => {
              const fraction = totalAccountValue ? Number(row.notionalValue) / totalAccountValue : null;
              return (
                <li key={row.key} className="list-group-item d-flex justify-content-between align-items-center px-0">
                  <span className={`d-inline-flex align-items-center gap-2 ${row.isUnallocated ? "text-muted" : ""}`}>
                    <span
                      aria-hidden="true"
                      style={{ width: "0.6rem", height: "0.6rem", borderRadius: "50%", backgroundColor: colors[index], flexShrink: 0 }}
                    />
                    {row.label}
                    {row.sublabel && <span className="text-muted ms-1" style={{ fontSize: "0.72rem" }}>{row.sublabel}</span>}
                  </span>
                  <span className="text-muted text-nowrap font-mono" style={{ fontSize: "0.8rem" }}>
                    {formatCurrency(Number(row.notionalValue), 0)}
                    {fraction !== null && ` (${formatPercentage(fraction)})`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

interface TopStatProps {
  label: string;
  value: string;
  loading?: boolean;
  valueClassName?: string;
  tooltip?: string;
}

function TopStat({ label, value, loading, valueClassName, tooltip }: TopStatProps) {
  return (
    <div className="col-12 col-sm-4">
      <div className="card">
        <div className="card-body">
          {/* HelpTooltip's own hit-target padding (10px) is taller than a
              plain text line, which was making this card noticeably taller
              than its siblings — the negative margin below cancels the
              padding's layout contribution without shrinking the actual
              hoverable target. */}
          <div className="text-muted mb-1 d-flex align-items-center" style={{ fontSize: "0.75rem", lineHeight: 1 }}>
            {label}
            {tooltip && (
              <span style={{ marginTop: "-10px", marginRight: "-10px", marginBottom: "-10px", marginLeft: "-6px" }}>
                <HelpTooltip text={tooltip} />
              </span>
            )}
          </div>
          {loading ? (
            <Spinner size="sm" label={`Loading ${label}`} />
          ) : (
            <div className={`fw-bold font-mono ${valueClassName ?? ""}`} style={{ fontSize: "1.25rem" }}>
              {value}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="col-6 col-md-3">
      <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>
        {label}
      </div>
      <div className="fw-bold font-mono">{formatCurrency(value, 0)}</div>
    </div>
  );
}

const periodColumns: { key: keyof StrategyPeriodPnlRow; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "WTD" },
  { key: "month", label: "MTD" },
  { key: "year", label: "YTD" },
];

function PeriodPnlRow({ label, row, bold }: { label: string; row: StrategyPeriodPnlRow; bold?: boolean }) {
  return (
    <tr>
      <td className={bold ? "fw-bold" : undefined}>{label}</td>
      {periodColumns.map((column) => (
        <td key={column.key} className={`text-end font-mono ${pnlTextClass(row[column.key])} ${bold ? "fw-bold" : ""}`}>
          {formatSignedPnl(row[column.key], 0)}
        </td>
      ))}
    </tr>
  );
}

// Dark-safe badge classes only — the plain bg-*-lt variants (e.g.
// bg-blue-lt) have no contrast override in theme.css and render nearly
// invisible in dark mode; only success/danger/warning-yellow/azure/
// secondary are covered there, so status badges are restricted to those.
const eventStatusBadge: Record<string, string> = {
  opened: "bg-azure-lt",
  unstructured: "bg-warning-lt",
  closed_good: "bg-success-lt",
  closed_flagged: "bg-warning-lt",
};

// showExitPrice must come from the EVENT's type, not just "does this leg
// have an exit price" — the same leg row is reused for both an "opened"
// and a later "closed" event on the same position, and by the time the
// position has closed, exitPrice is already populated on both. An
// "opened" event must always describe the entry, never the eventual exit
// (found 2026-08-28: closed positions' "opened" row was showing exit
// prices instead of what was actually paid/collected at open).
function formatLegDescription(leg: PositionEvent["legs"][number], showExitPrice: boolean, dteAsOf: string): string {
  const sideLabel = leg.side === "long" ? "Long" : "Short";
  const priceLabel = showExitPrice && leg.exitPrice !== null ? `exit $${leg.exitPrice.toFixed(2)}` : `@ $${leg.entryPrice.toFixed(2)}`;
  if (leg.legType === "stock") return `${sideLabel} ${leg.quantity} sh ${priceLabel}`;
  const strikeLabel = leg.strikePrice !== null ? `$${leg.strikePrice}` : "—";
  const rightLabel = leg.optionType === "call" ? "C" : "P";
  const expiryLabel = leg.expiryDate ? `, exp ${formatExpiryWithDte(leg.expiryDate, dteAsOf)}` : "";
  return `${sideLabel} ${leg.quantity}x ${strikeLabel}${rightLabel}${expiryLabel} ${priceLabel}`;
}

function EventRow({ event }: { event: PositionEvent }) {
  const strategyLabel = strategyLabels[event.strategyKey] ?? event.strategyKey;
  const description = event.legs.map((leg) => formatLegDescription(leg, event.eventType === "closed", event.openedAt)).join(" / ");

  let statusLabel: string;
  let statusBadgeClass: string;
  if (event.eventType === "opened") {
    statusLabel = "Opened";
    statusBadgeClass = eventStatusBadge.opened;
  } else if (event.eventType === "unstructured") {
    statusLabel = "Unstructured";
    statusBadgeClass = eventStatusBadge.unstructured;
  } else {
    statusLabel = closeReasonLabels[event.closeReason ?? ""] ?? event.closeReason ?? "Closed";
    statusBadgeClass =
      event.closeReason === "unknown" || event.closeReason === "closed_via_external_trade"
        ? eventStatusBadge.closed_flagged
        : eventStatusBadge.closed_good;
  }

  // Full market value across both legs (same standard as Portfolio/
  // Allocation) for CC/CSP, priced at entry for an open and exit for a
  // close — null for unstructured (no clean cash-lock rule to apply).
  const value = event.fullMarketValue;

  return (
    <tr>
      <td className="text-nowrap" title={formatDateTime(event.eventAt)}>
        {formatRelativeDate(event.eventAt)}
      </td>
      <td className="text-nowrap">{event.attributedTo ?? "—"}</td>
      <td className="text-nowrap fw-bold">{event.symbol}</td>
      <td className="text-nowrap">
        <span className={`badge ${statusBadgeClass} me-1`} style={{ fontSize: "0.72rem" }}>
          {statusLabel}
        </span>
        <span className="badge bg-secondary-lt" style={{ fontSize: "0.72rem" }}>
          {strategyLabel}
        </span>
      </td>
      <td style={{ fontSize: "0.8rem", maxWidth: "22rem", whiteSpace: "normal" }}>
        {description}
        {event.eventType === "unstructured" && event.unstructuredReason && (
          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
            {unstructuredReasonLabels[event.unstructuredReason] ?? event.unstructuredReason}
          </div>
        )}
      </td>
      <td className="text-end font-mono">{value === null ? "—" : formatCurrency(value, 0)}</td>
      <td className={`text-end font-mono ${event.realizedPnl === null ? "" : pnlTextClass(event.realizedPnl)}`}>
        {event.realizedPnl === null ? "—" : formatSignedPnl(event.realizedPnl, 0)}
      </td>
    </tr>
  );
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [history, setHistory] = useState<PnlHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  const [exposureError, setExposureError] = useState<string | null>(null);

  const [cash, setCash] = useState<AvailableCash | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState<string | null>(null);

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const [periodPnl, setPeriodPnl] = useState<PeriodPnlByStrategy | null>(null);
  const [periodPnlLoading, setPeriodPnlLoading] = useState(true);
  const [periodPnlError, setPeriodPnlError] = useState<string | null>(null);

  const [events, setEvents] = useState<PositionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [needsAttention, setNeedsAttention] = useState<Position[]>([]);
  const [needsAttentionLoading, setNeedsAttentionLoading] = useState(true);
  const [needsAttentionError, setNeedsAttentionError] = useState<string | null>(null);
  const [sellCallSymbol, setSellCallSymbol] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(err instanceof ApiError ? err.message : "Failed to load dashboard summary."))
      .finally(() => setSummaryLoading(false));
  }, []);

  // Live IBKR round trip (approved 2026-08-27, see fetchAvailableCash) --
  // same figure shown on Order Review, here as a plain breakdown rather than
  // netted against a specific pending order's capital requirement.
  useEffect(() => {
    fetchAvailableCash()
      .then(setCash)
      .catch((err) => setCashError(err instanceof ApiError ? err.message : "Failed to load available cash."))
      .finally(() => setCashLoading(false));
  }, []);

  useEffect(() => {
    fetchExposure()
      .then(setExposure)
      .catch((err) => setExposureError(err instanceof ApiError ? err.message : "Failed to load account allocation."))
      .finally(() => setExposureLoading(false));
  }, []);

  useEffect(() => {
    fetchPnlHistory()
      .then(setHistory)
      .catch((err) => setHistoryError(err instanceof ApiError ? err.message : "Failed to load P&L history."))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    fetchPortfolio()
      .then(setPortfolio)
      .catch((err) => setPortfolioError(err instanceof ApiError ? err.message : "Failed to load portfolio."))
      .finally(() => setPortfolioLoading(false));
  }, []);

  useEffect(() => {
    fetchPeriodPnlByStrategy()
      .then(setPeriodPnl)
      .catch((err) => setPeriodPnlError(err instanceof ApiError ? err.message : "Failed to load P&L by strategy."))
      .finally(() => setPeriodPnlLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboardEvents()
      .then(setEvents)
      .catch((err) => setEventsError(err instanceof ApiError ? err.message : "Failed to load recent events."))
      .finally(() => setEventsLoading(false));
  }, []);

  // "unstructured" positions with a bare stock leg and no open option leg —
  // e.g. a covered call's short call expired worthless, or a CSP got
  // assigned — never surface anywhere persistent otherwise: the Events feed
  // above is a 7-day rolling window, so a leftover position older than that
  // is invisible except folded into the Unstructured $ tile. Filtered
  // client-side (open-legs-only, same convention as PositionsPage's own
  // Close/Sell Call action-column gating) rather than a new backend route,
  // since GET /positions already returns everything needed.
  const loadNeedsAttention = useCallback(async () => {
    try {
      setNeedsAttentionError(null);
      // No strategy filter here — GET /positions?strategy= only accepts
      // covered_call/cash_secured_put (validStrategyKeys), "unstructured"
      // isn't a filterable value server-side, so this fetches every open
      // position and filters client-side instead.
      const openPositions = await fetchPositions({ status: "open" });
      setNeedsAttention(
        openPositions.filter((position) => {
          if (position.strategyKey !== "unstructured") return false;
          const openLegs = position.legs.filter((leg) => !leg.exitAt);
          return openLegs.some((leg) => leg.legType === "stock") && !openLegs.some((leg) => leg.legType === "option");
        }),
      );
    } catch (err) {
      setNeedsAttentionError(err instanceof ApiError ? err.message : "Failed to load positions needing attention.");
    } finally {
      setNeedsAttentionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNeedsAttention();
  }, [loadNeedsAttention]);

  const sectorRows = (exposure?.concentrationBySector ?? []).filter((row: ConcentrationRow) => row.sector !== "Unallocated");

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Aggregate P&L across all strategies" />

      {summaryError && <div className="alert alert-danger">{summaryError}</div>}
      {cashError && <div className="alert alert-danger">{cashError}</div>}

      <div className="row g-3 mb-3">
        <TopStat
          label="Account Value"
          loading={summaryLoading}
          value={formatCurrency(summary?.netLiquidationValue ? Number(summary.netLiquidationValue) : null, 0)}
        />
        <TopStat
          label="Available Cash"
          loading={cashLoading}
          value={formatCurrency(cash?.availableCashToTrade ?? null, 0)}
          tooltip="Total cash minus cash reserved to cover assignment on open cash-secured puts."
        />
        <TopStat
          label="Day P&L"
          loading={summaryLoading}
          value={`${formatSignedPnl(summary?.periods.day ? Number(summary.periods.day) : null, 0)} (${formatSignedPercentageValue(summary?.dayPnlPercent ?? null)})`}
          valueClassName={pnlTextClass(summary?.periods.day ? Number(summary.periods.day) : null)}
        />
      </div>

      <CollapsibleCard title="Portfolio" className="mb-3">
        {portfolioError && <div className="alert alert-danger mb-0">{portfolioError}</div>}
        {!portfolioError && portfolioLoading && <Spinner size="sm" label="Loading portfolio" />}
        {!portfolioError && !portfolioLoading && (
          <div className="row g-3">
            <PortfolioTile label="Available Cash" value={portfolio?.availableCash ?? null} />
            <PortfolioTile label="Cash-Secured Puts" value={portfolio?.cashSecuredPuts ?? null} />
            <PortfolioTile label="Covered Calls" value={portfolio?.coveredCalls ?? null} />
            <PortfolioTile label="Unstructured" value={portfolio?.unstructured ?? null} />
          </div>
        )}
      </CollapsibleCard>

      {needsAttentionLoading || needsAttentionError || needsAttention.length > 0 ? (
        <CollapsibleCard title="Needs Attention" className="mb-3">
          {needsAttentionError && <div className="alert alert-danger mb-0">{needsAttentionError}</div>}
          {!needsAttentionError && needsAttentionLoading && <Spinner size="sm" label="Loading positions needing attention" />}
          {!needsAttentionError && !needsAttentionLoading && (
            <div className="table-responsive">
              <table className="table table-vcenter mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Ticker</th>
                    <th>Shares</th>
                    <th>Reason</th>
                    <th className="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  {needsAttention.map((position) => {
                    const stockLeg = position.legs.find((leg) => leg.legType === "stock" && !leg.exitAt);
                    return (
                      <tr key={position.id}>
                        <td className="fw-semibold">{position.symbol}</td>
                        <td className="font-mono">{stockLeg?.quantity ?? "—"}</td>
                        <td className="text-secondary">
                          {(position.unstructuredReason && unstructuredReasonLabels[position.unstructuredReason]) ?? "cause unclear — flagged for review"}
                        </td>
                        <td className="text-end">
                          <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => setSellCallSymbol(position.symbol)}>
                            Sell Call
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleCard>
      ) : null}

      <CollapsibleCard title="Latest Events" className="mb-3">
        {eventsError && <div className="alert alert-danger">{eventsError}</div>}
        {eventsLoading ? (
          <Spinner size="sm" label="Loading events" />
        ) : events.length === 0 ? (
          <div className="text-muted">No recent activity.</div>
        ) : (
          <div className="table-responsive" style={{ maxHeight: "26rem", overflowY: "auto" }}>
            <table className="table table-vcenter mb-0">
              <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Ticker</th>
                  <th>Event</th>
                  <th>Description</th>
                  <th className="text-end">Value</th>
                  <th className="text-end">P&L</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <EventRow key={`${event.positionId}-${event.eventType}-${event.eventAt}`} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-8">
          <CollapsibleCard title="P&L by Period">
            {periodPnlError && <div className="alert alert-danger mb-0">{periodPnlError}</div>}
            {!periodPnlError && periodPnlLoading && <Spinner size="sm" label="Loading P&L" />}
            {!periodPnlError && !periodPnlLoading && periodPnl && (
              <div className="table-responsive">
                <table className="table table-vcenter mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Strategy</th>
                      {periodColumns.map((column) => (
                        <th key={column.key} className="text-end">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <PeriodPnlRow label="Covered Calls" row={periodPnl.coveredCalls} />
                    <PeriodPnlRow label="Cash-Secured Puts" row={periodPnl.cashSecuredPuts} />
                    <PeriodPnlRow label="Unstructured" row={periodPnl.unstructured} />
                    <PeriodPnlRow label="Residual" row={periodPnl.residual} />
                    <PeriodPnlRow label="Total" row={periodPnl.total} bold />
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleCard>
        </div>
        <div className="col-12 col-lg-4">
          <CollapsibleCard title="P&L by Strategy">
            {summaryLoading ? (
              <Spinner size="sm" label="Loading breakdown" />
            ) : !summary ? (
              <div className="text-muted">No data yet.</div>
            ) : (
              (() => {
                // Fixed rows (matching P&L by Period's convention) rather
                // than only rendering whatever strategy_key happens to have
                // a row today — Unstructured otherwise disappears from this
                // table entirely whenever no unstructured position is open.
                const knownRows = (["covered_call", "cash_secured_put", "unstructured"] as const).map((strategyKey) => {
                  const found = summary.strategyBreakdown.find((row) => row.strategyKey === strategyKey);
                  return {
                    strategyKey,
                    realizedPnl: found ? Number(found.realizedPnl) : 0,
                    unrealizedPnl: found ? Number(found.unrealizedPnl) : 0,
                  };
                });
                const cumulativeRealized = summary.cumulativeRealizedPnl ? Number(summary.cumulativeRealizedPnl) : 0;
                const cumulativeUnrealized = summary.cumulativeUnrealizedPnl ? Number(summary.cumulativeUnrealizedPnl) : 0;
                const knownTotal = summary.strategyBreakdown
                  .filter((row) => row.strategyKey !== "unallocated")
                  .reduce((sum, row) => sum + Number(row.realizedPnl ?? 0) + Number(row.unrealizedPnl ?? 0), 0);
                const residual = cumulativeRealized + cumulativeUnrealized - knownTotal;

                return (
                  <div className="table-responsive">
                    <table className="table table-vcenter mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Strategy</th>
                          <th className="text-end">Realized</th>
                          <th className="text-end">Unrealized</th>
                        </tr>
                      </thead>
                      <tbody>
                        {knownRows.map((row) => (
                          <tr key={row.strategyKey}>
                            <td>{strategyLabels[row.strategyKey] ?? row.strategyKey}</td>
                            <td className={`text-end font-mono ${pnlTextClass(row.realizedPnl)}`}>{formatSignedPnl(row.realizedPnl, 0)}</td>
                            <td className={`text-end font-mono ${pnlTextClass(row.unrealizedPnl)}`}>{formatSignedPnl(row.unrealizedPnl, 0)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="fw-bold">Residual</td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(residual)}`} colSpan={2}>
                            {formatSignedPnl(residual, 0)}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-bold">Total</td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(cumulativeRealized)}`}>
                            {formatSignedPnl(cumulativeRealized, 0)}
                          </td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(cumulativeUnrealized)}`}>
                            {formatSignedPnl(cumulativeUnrealized, 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })()
            )}
          </CollapsibleCard>
        </div>
      </div>

      <CollapsibleCard title="Allocation" className="mb-3">
        {exposureLoading ? (
          <Spinner size="sm" label="Loading allocation" />
        ) : (
          <>
            {exposureError && <div className="alert alert-danger">{exposureError}</div>}
            {exposure?.accountDataError && (
              <div className="alert alert-warning">Live account data unavailable: {exposure.accountDataError}</div>
            )}
            <div className="row g-3">
              <AllocationList
                title="By Strategy"
                emptyMessage="No open positions yet."
                totalAccountValue={exposure?.totalAccountValue ?? null}
                rows={(exposure?.strategyAllocation ?? []).map((row: StrategyAllocationRow) => ({
                  key: row.strategyKey,
                  label: strategyLabels[row.strategyKey] ?? row.strategyKey,
                  notionalValue: row.notionalValue,
                  isUnallocated: row.strategyKey === "unallocated",
                }))}
              />
              <AllocationList
                title="Top Positions"
                emptyMessage="No open positions yet."
                totalAccountValue={exposure?.totalAccountValue ?? null}
                rows={(() => {
                  const topRows = (exposure?.topPositions ?? []).map((row: TopPositionRow) => ({
                    key: row.positionId,
                    label: row.symbol,
                    sublabel: strategyLabels[row.strategyKey] ?? row.strategyKey,
                    notionalValue: row.notionalValue,
                  }));
                  // Rest of the book beyond the top 5, by position count —
                  // concentrationByTicker sums every open position's
                  // exposure (unlike topPositions, it isn't pre-truncated),
                  // so the difference is exactly what's outside the top 5.
                  const allExposure = (exposure?.concentrationByTicker ?? []).reduce((sum, row) => sum + Number(row.notionalValue), 0);
                  const topExposure = topRows.reduce((sum, row) => sum + Number(row.notionalValue), 0);
                  const othersValue = allExposure - topExposure;
                  if (othersValue <= 0) return topRows;
                  return [...topRows, { key: "others", label: "Others", notionalValue: String(othersValue), isUnallocated: true }];
                })()}
              />
              <AllocationList
                title="By Industry"
                emptyMessage="No open positions yet."
                totalAccountValue={exposure?.totalAccountValue ?? null}
                rows={sectorRows.map((row: ConcentrationRow) => ({
                  key: row.sector ?? "",
                  label: row.sector ?? "",
                  notionalValue: row.notionalValue,
                }))}
              />
            </div>
            <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>
              % of total account value (net liquidation value, including cash). See Risk &amp; Limits for concentration limits.
            </div>
          </>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="P&L Over Time" className="mb-3">
        {historyError && <div className="alert alert-danger">{historyError}</div>}

        {historyLoading ? (
          <div className="d-flex justify-content-center py-3">
            <Spinner label="Loading history" />
          </div>
        ) : history.length < 2 ? (
          <div className="text-muted">Not enough snapshot history yet to chart a trend.</div>
        ) : (
          <ApexChart
            type="area"
            height={260}
            series={[
              { name: "Covered Calls", data: history.map((point) => ({ x: point.snapshotDate, y: point.coveredCalls })) },
              { name: "Cash-Secured Puts", data: history.map((point) => ({ x: point.snapshotDate, y: point.cashSecuredPuts })) },
              { name: "Unstructured", data: history.map((point) => ({ x: point.snapshotDate, y: point.unstructured })) },
              {
                name: "Residual",
                data: history.map((point) => ({ x: point.snapshotDate, y: point.residual === null ? null : point.residual })),
              },
            ]}
            options={{
              xaxis: {
                type: "datetime",
                tickAmount: Math.min(history.length - 1, 7),
                labels: { datetimeUTC: false, format: "dd MMM" },
              },
              yaxis: { labels: { formatter: (value: number) => formatCurrency(value, 0) } },
              tooltip: {
                x: { format: "dd MMM yyyy" },
                y: { formatter: (value: number) => formatSignedPnl(value, 0) },
              },
              dataLabels: { enabled: false },
              stroke: { curve: "straight", width: 2 },
              legend: { position: "top" },
              responsive: [{ breakpoint: 768, options: { legend: { position: "bottom" }, chart: { height: 220 } } }],
            }}
          />
        )}
      </CollapsibleCard>

      {sellCallSymbol && (
        <TickerDetailModal
          symbol={sellCallSymbol}
          onClose={() => {
            setSellCallSymbol(null);
            loadNeedsAttention();
          }}
        />
      )}
    </>
  );
}
