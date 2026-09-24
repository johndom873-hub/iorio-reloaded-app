import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { StrategyBadge } from "../components/StrategyBadge";
import type { PositionStrategyKey } from "../api/positions";
import { Spinner } from "../components/Spinner";
import { ApexChart, textColorByTheme } from "../components/charts/ApexChart";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { DottedLabelTooltip, HelpTooltip } from "../components/HelpTooltip";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { useTheme } from "../contexts/ThemeContext";
import { ApiError } from "../api/client";
import {
  fetchAvailableCash,
  fetchDashboardEvents,
  fetchDashboardSummary,
  fetchPeriodPnlByStrategy,
  fetchPnlHistory,
  type AvailableCash,
  type DashboardSummary,
  type PeriodPnlByStrategy,
  type PnlHistoryPoint,
  type PositionEvent,
  type StrategyPeriodPnlRow,
} from "../api/dashboard";
import { openTradeAlertCurrentPricesStream } from "../api/tradeAlerts";
import { fetchPositions, fetchUnrealizedPnl, type Position, type UnrealizedPnlResult } from "../api/positions";
import { AVAILABLE_CASH_PERCENT_BANDS, lowerIsWorseStatus, statusTextClass } from "../lib/statusThresholds";
import { fetchExposure, type ConcentrationRow, type ExposureData, type StrategyAllocationRow, type TopPositionRow } from "../api/riskLimits";
import {
  formatCurrency,
  formatDateTime,
  formatExpiryWithDte,
  formatPercentage,
  formatPercentageValue,
  formatRelativeDate,
  formatSignedPercentageValue,
  formatSignedPnl,
  pnlTextClass,
} from "../lib/formatters";
import { portfolioFromExposure } from "../lib/portfolioFromExposure";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import { TooltipSpan } from "../components/TooltipSpan";

const strategyLabels: Record<string, string> = {
  covered_call: "Covered Calls",
  cash_secured_put: "Cash-Secured Puts",
  unstructured: "No strategy",
  unallocated: "Unallocated (cash)",
};

const closeReasonLabels: Record<string, string> = {
  assigned: "Assigned",
  expired_worthless: "Expired",
  closed_via_app: "closed",
  closed_via_external_trade: "closed outside the app",
  stock_rolled_into_covered_call: "shares rolled into a covered call",
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
  rows: {
    key: string;
    label: string;
    sublabel?: string;
    notionalValue: string;
    isUnallocated?: boolean;
    tickerSymbol?: string;
    focusPositionId?: string;
  }[];
  // Overrides the donut's center label — e.g. "Top 5" for a truncated
  // list, so its total doesn't read as "the full account total" when it
  // deliberately isn't (found confusing 2026-08-28: Top Positions and By
  // Industry showed different totals with no visual explanation why).
  donutTotalLabel?: string;
  // Only "Top Positions" rows carry a tickerSymbol — that's what makes them
  // clickable, matching the platform-wide convention that any displayed
  // ticker opens TickerDetailModal (By Strategy/By Industry labels aren't
  // tickers, so they stay plain text).
  onTickerClick?: (ticker: { symbol: string; focusPositionId?: string }) => void;
}

// Strategy series colours follow the StrategyBadge palette (CC blue, CSP purple, N/S orange).
function tablerColor(variableName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
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

function AllocationDonut({
  rows,
  colors,
  totalLabel = "Total",
}: {
  rows: AllocationListProps["rows"];
  colors: string[];
  totalLabel?: string;
}) {
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
        // val is the slice's share of THIS donut's own series sum -- the same
        // basis as the wedge angles themselves, so labels always add up to
        // 100% (matches the legend rows below, which use the same basis).
        dataLabels: { enabled: rows.length <= 6, formatter: (val: number) => formatPercentageValue(val, 0) },
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

function AllocationList({ title, emptyMessage, rows, donutTotalLabel, onTickerClick }: AllocationListProps) {
  const { theme } = useTheme();
  const colors = allocationColors(rows, theme);
  // Same basis as the donut's wedge angles (that section's own total, not
  // the whole account) so the two always agree and add up to 100%.
  const sectionTotal = rows.reduce((sum, row) => sum + Number(row.notionalValue), 0);
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
              const fraction = sectionTotal ? Number(row.notionalValue) / sectionTotal : null;
              return (
                <li key={row.key} className="list-group-item d-flex justify-content-between align-items-center px-0">
                  <span className={`d-inline-flex align-items-center gap-2 ${row.isUnallocated ? "text-muted" : ""}`}>
                    <span
                      aria-hidden="true"
                      style={{ width: "0.6rem", height: "0.6rem", borderRadius: "50%", backgroundColor: colors[index], flexShrink: 0 }}
                    />
                    {row.tickerSymbol && onTickerClick ? (
                      <button
                        type="button"
                        className="btn btn-link p-0"
                        onClick={() => onTickerClick({ symbol: row.tickerSymbol!, focusPositionId: row.focusPositionId })}
                      >
                        {row.label}
                      </button>
                    ) : (
                      row.label
                    )}
                    {row.sublabel && <span className="text-muted ms-1" style={{ fontSize: "0.72rem" }}>{row.sublabel}</span>}
                  </span>
                  <span className="text-muted text-nowrap font-mono" style={{ fontSize: "0.8rem" }}>
                    {formatCurrency(Number(row.notionalValue), 0)}
                    {fraction !== null && ` (${formatPercentage(fraction, 0)})`}
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
  // Small secondary figure next to the value (a % of account, etc.), coloured independently of the value.
  delta?: string | null;
  deltaClassName?: string;
}

function TopStat({ label, value, loading, valueClassName, tooltip, delta, deltaClassName }: TopStatProps) {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          {/* HelpTooltip's own hit-target padding (4px) is taller than a
              plain text line, which was making this card noticeably taller
              than its siblings — the negative margin below cancels the
              padding's layout contribution without shrinking the actual
              hoverable target. The gap-1 on the container supplies the
              visible space between label and icon instead. */}
          <div className="text-muted text-uppercase fw-semibold mb-1 d-flex align-items-center gap-1" style={{ fontSize: "0.75rem", lineHeight: 1 }}>
            {label}
            {tooltip && (
              <span style={{ margin: "-4px" }}>
                <HelpTooltip text={tooltip} />
              </span>
            )}
          </div>
          {loading ? (
            <Spinner size="sm" label={`Loading ${label}`} />
          ) : (
            <div className="d-flex align-items-baseline gap-2 flex-wrap">
              <span className={`fw-bold font-mono ${valueClassName ?? ""}`} style={{ fontSize: "1.25rem" }}>
                {value}
              </span>
              {delta && (
                <span className={`font-mono ${deltaClassName ?? ""}`} style={{ fontSize: "0.75rem" }}>
                  {delta}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioTile({ label, value, swatchColor }: { label: string; value: number | null; swatchColor: string }) {
  return (
    <div className="col-6 col-md-3">
      <div className="text-muted mb-1 d-flex align-items-center gap-2" style={{ fontSize: "0.75rem" }}>
        <span className="allocation-swatch" style={{ background: swatchColor }} />
        {label}
      </div>
      <div className="fw-bold font-mono">{formatCurrency(value, 0)}</div>
    </div>
  );
}

// Same segment colours as Pulse's Allocation bar.
const ALLOCATION_COLORS = {
  coveredCalls: "var(--tblr-blue)",
  cashSecuredPuts: "var(--tblr-purple)",
  unstructured: "var(--tblr-orange)",
  cash: "var(--tblr-gray-500)",
} as const;

const periodColumns: { key: keyof StrategyPeriodPnlRow; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "WTD" },
  { key: "month", label: "MTD" },
  { key: "year", label: "YTD" },
];

// Footnote for the Residual row on both P&L cards. Residual = the account's own P&L (change in net liquidation value)
// minus the three strategy rows, so it is a plug: it holds whatever the strategy cycles don't attribute. Interest and
// dividends are deliberately not named: Flex shows none on this paper account (see PROGRESS.md, 2026-09-11 / 2026-09-21).
const residualTooltipHtml =
  "<strong>Residual</strong> = account P&amp;L (change in net liquidation value) minus the three strategy rows." +
  "<br/><br/>It holds what the strategy cycles don't attribute: commissions (cycles are gross) and timing differences " +
  "between IBKR's account value and this platform's price marks, which are captured at slightly different moments." +
  "<br/><br/>Positions open at the start of a period with no stored option mark are also left out of that period's strategy rows, " +
  "so they land here too (affects Week and Month until the mark history builds up).";

function PeriodPnlRow({ label, row, bold }: { label: ReactNode; row: StrategyPeriodPnlRow; bold?: boolean }) {
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
  closed_assigned_unwanted: "bg-danger-lt",
};

// showExitPrice must come from the EVENT's type, not just "does this leg
// have an exit price" — the same leg row is reused for both an "opened"
// and a later "closed" event on the same position, and by the time the
// position has closed, exitPrice is already populated on both. An
// "opened" event must always describe the entry, never the eventual exit
// (found 2026-08-28: closed positions' "opened" row was showing exit
// prices instead of what was actually paid/collected at open).
function formatLegDescription(
  leg: PositionEvent["legs"][number],
  showExitPrice: boolean,
  closeReason: string | null,
  dteAsOf: string,
): string {
  const sideLabel = leg.side === "long" ? "Long" : "Short";
  // An expired option's exit price is always $0.00 (definitionally worthless,
  // no closing trade) -- showing it adds nothing the "Expired" badge doesn't
  // already say. Assignment isn't the same: exit price there is usually but
  // not always zero, so it still gets shown.
  const priceLabel =
    showExitPrice && closeReason === "expired_worthless"
      ? null
      : showExitPrice && leg.exitPrice !== null
        ? `exit $${leg.exitPrice.toFixed(2)}`
        : `@ $${leg.entryPrice.toFixed(2)}`;
  const priceSuffix = priceLabel ? ` ${priceLabel}` : "";
  if (leg.legType === "stock") return `${sideLabel} ${leg.quantity} sh${priceSuffix}`;
  const strikeLabel = leg.strikePrice !== null ? `$${leg.strikePrice}` : "—";
  const rightLabel = leg.optionType === "call" ? "C" : "P";
  const expiryLabel = leg.expiryDate ? `, exp ${formatExpiryWithDte(leg.expiryDate, dteAsOf)}` : "";
  return `${sideLabel} ${leg.quantity}x ${strikeLabel}${rightLabel}${expiryLabel}${priceSuffix}`;
}

function EventRow({ event, onSymbolClick }: { event: PositionEvent; onSymbolClick: (ticker: { symbol: string; focusPositionId?: string }) => void }) {
  const description = event.legs
    .map((leg) => formatLegDescription(leg, event.eventType === "closed", event.closeReason, event.openedAt))
    .join(" / ");

  let statusLabel: string;
  let statusBadgeClass: string;
  if (event.eventType === "opened") {
    statusLabel = "Opened";
    statusBadgeClass = eventStatusBadge.opened;
  } else if (event.eventType === "unstructured") {
    statusLabel = "No strategy";
    statusBadgeClass = eventStatusBadge.unstructured;
  } else {
    statusLabel = closeReasonLabels[event.closeReason ?? ""] ?? event.closeReason ?? "Closed";
    if (event.closeReason === "unknown" || event.closeReason === "closed_via_external_trade") {
      statusBadgeClass = eventStatusBadge.closed_flagged;
    } else if (event.closeReason === "assigned" && event.strategyKey === "cash_secured_put") {
      // CSP assignment means the put strike was breached, forcing a stock
      // purchase — the undesired CSP outcome, unlike CC assignment (called
      // away at the target strike, the desired CC outcome).
      statusBadgeClass = eventStatusBadge.closed_assigned_unwanted;
    } else {
      statusBadgeClass = eventStatusBadge.closed_good;
    }
  }

  // Full market value across both legs (same standard as Portfolio/
  // Allocation) for CC/CSP, priced at entry for an open and exit for a
  // close — null for unstructured (no clean cash-lock rule to apply).
  const value = event.fullMarketValue;

  return (
    <tr>
      <TooltipSpan as="td" className="text-nowrap" text={formatDateTime(event.eventAt)}>
        {formatRelativeDate(event.eventAt)}
      </TooltipSpan>
      <td className="text-nowrap">{event.attributedTo ?? "—"}</td>
      <td className="text-nowrap fw-bold">
        <button
          type="button"
          className="btn btn-link p-0 fw-bold"
          onClick={() => onSymbolClick({ symbol: event.symbol, focusPositionId: event.positionId })}
        >
          {event.symbol}
        </button>
      </td>
      <td className="text-nowrap">
        <TooltipSpan
          className={`badge ${statusBadgeClass} text-truncate d-inline-block align-bottom me-1`}
          style={{ fontSize: "0.72rem", maxWidth: "8rem", padding: "0.2em 0.45em" }}
          text={statusLabel}
        >
          {statusLabel}
        </TooltipSpan>
        <StrategyBadge strategyKey={event.strategyKey as PositionStrategyKey} className="align-bottom" />
      </td>
      <TooltipSpan
        as="td"
        style={{
          fontSize: "0.8rem",
          whiteSpace: "normal",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        text={description}
      >
        {description}
        {event.eventType === "unstructured" && event.unstructuredReason && (
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>
            {" "}
            ({unstructuredReasonLabels[event.unstructuredReason] ?? event.unstructuredReason})
          </span>
        )}
      </TooltipSpan>
      <td className="text-end font-mono">{value === null ? "—" : formatCurrency(value, 0)}</td>
      <td className={`text-end font-mono ${event.realizedPnl === null ? "" : pnlTextClass(event.realizedPnl)}`}>
        {event.realizedPnl === null ? "—" : formatSignedPnl(event.realizedPnl, 0)}
      </td>
    </tr>
  );
}

// ApexCharts insets a y-axis annotation by half a column on each side on a datetime bar chart while the gridlines run
// edge to edge, so stretch the $0 line to the full plot width after every render/resize.
// ApexCharts' TypeScript types don't expose the internal `w.globals` used here, hence the cast.
function extendZeroLineToFullPlotWidth(chartContext: unknown) {
  const { globals } = (chartContext as { w: { globals: { barPadForNumericAxis?: number; gridWidth: number; dom: { baseEl: Element } } } }).w;
  const zeroLine = globals.dom.baseEl.querySelector(".apexcharts-yaxis-annotations line");
  if (!zeroLine) return;
  const inset = globals.barPadForNumericAxis ?? 0;
  zeroLine.setAttribute("x1", String(-inset));
  zeroLine.setAttribute("x2", String(globals.gridWidth + inset));
}

export function DashboardPage() {
  const { theme } = useTheme();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [history, setHistory] = useState<PnlHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // One fetch feeds both the allocation cards and the Portfolio tiles — see
  // portfolioFromExposure. Snapshot, not live (approved 2026-09-24) — Pulse
  // and Risk & Limits keep the SSE version via useExposureStream.
  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  const [exposureError, setExposureError] = useState<string | null>(null);
  const portfolio = useMemo(() => (exposure ? portfolioFromExposure(exposure) : null), [exposure]);
  const portfolioLoading = exposureLoading;
  const portfolioError = exposureError;

  const [cash, setCash] = useState<AvailableCash | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState<string | null>(null);

  const [periodPnl, setPeriodPnl] = useState<PeriodPnlByStrategy | null>(null);
  const [periodPnlLoading, setPeriodPnlLoading] = useState(true);
  const [periodPnlError, setPeriodPnlError] = useState<string | null>(null);

  // One-shot mark-to-market of every open position (snapshot/fallback
  // prices, no stream) — Dashboard's tiles load once, unlike Pulse's live ones.
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult> | null>(null);
  const [unrealizedLoading, setUnrealizedLoading] = useState(true);

  const [events, setEvents] = useState<PositionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [needsAttention, setNeedsAttention] = useState<Position[]>([]);
  const [needsAttentionLoading, setNeedsAttentionLoading] = useState(true);
  const [needsAttentionError, setNeedsAttentionError] = useState<string | null>(null);
  const [needsAttentionPriceBySymbol, setNeedsAttentionPriceBySymbol] = useState<Record<string, number | null>>({});
  const [needsAttentionPriceStreamFailed, setNeedsAttentionPriceStreamFailed] = useState(false);
  const [detailSymbol, setDetailSymbol] = useTickerDetailSymbol();
  // Not persisted across a refresh (unlike detailSymbol) -- it's a one-shot
  // "scroll to this position" aid, not state worth surviving a reload.
  const [focusPositionId, setFocusPositionId] = useState<string | undefined>(undefined);
  const openTickerDetail = useCallback(
    (ticker: { symbol: string; focusPositionId?: string }) => {
      setDetailSymbol(ticker.symbol);
      setFocusPositionId(ticker.focusPositionId);
    },
    [setDetailSymbol],
  );

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(err instanceof ApiError ? err.message : "Failed to load dashboard summary."))
      .finally(() => setSummaryLoading(false));
  }, []);

  useEffect(() => {
    fetchExposure()
      .then(setExposure)
      .catch((err) => setExposureError(err instanceof ApiError ? err.message : "Failed to load account allocation."))
      .finally(() => setExposureLoading(false));
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
    fetchPnlHistory()
      .then(setHistory)
      .catch((err) => setHistoryError(err instanceof ApiError ? err.message : "Failed to load P&L history."))
      .finally(() => setHistoryLoading(false));
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
      fetchUnrealizedPnl(openPositions.map((position) => position.id))
        .then(setUnrealizedPnlByPositionId)
        .catch(() => setUnrealizedPnlByPositionId(null))
        .finally(() => setUnrealizedLoading(false));
      setNeedsAttention(
        openPositions.filter((position) => {
          if (position.strategyKey !== "unstructured") return false;
          const openLegs = position.legs.filter((leg) => !leg.exitAt);
          return openLegs.some((leg) => leg.legType === "stock") && !openLegs.some((leg) => leg.legType === "option");
        }),
      );
    } catch (err) {
      setUnrealizedLoading(false);
      setNeedsAttentionError(err instanceof ApiError ? err.message : "Failed to load positions needing attention.");
    } finally {
      setNeedsAttentionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNeedsAttention();
  }, [loadNeedsAttention]);

  const needsAttentionSymbols = Array.from(new Set(needsAttention.map((position) => position.symbol))).sort().join(",");

  useEffect(() => {
    if (!needsAttentionSymbols) return;
    setNeedsAttentionPriceStreamFailed(false);
    return openTradeAlertCurrentPricesStream(
      needsAttentionSymbols.split(","),
      (result) => {
        setNeedsAttentionPriceStreamFailed(false);
        setNeedsAttentionPriceBySymbol(result);
      },
      () => setNeedsAttentionPriceStreamFailed(true),
    );
  }, [needsAttentionSymbols]);

  const accountValueNumber = summary?.netLiquidationValue ? Number(summary.netLiquidationValue) : null;
  const yesterdaysPnl = summary?.periods.day ? Number(summary.periods.day) : null;
  const availableCashPercent =
    accountValueNumber !== null && accountValueNumber > 0 && cash?.availableCashToTrade != null ? (cash.availableCashToTrade / accountValueNumber) * 100 : null;
  // Same formula Pulse uses (approved 2026-09-19): % is against the account
  // value excluding this open gain/loss.
  const totalUnrealizedPnl = unrealizedPnlByPositionId
    ? Object.values(unrealizedPnlByPositionId).reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0)
    : null;
  const accountValueBeforeUnrealizedPnl = totalUnrealizedPnl !== null && accountValueNumber !== null ? accountValueNumber - totalUnrealizedPnl : null;
  const totalUnrealizedPnlPercent =
    totalUnrealizedPnl !== null && accountValueBeforeUnrealizedPnl ? (totalUnrealizedPnl / accountValueBeforeUnrealizedPnl) * 100 : null;

  // Same basis as Pulse's Allocation bar: each strategy's notional over total account value.
  const allocationPercentFor = (strategyKey: string) => {
    if (!exposure?.totalAccountValue) return 0;
    const row = exposure.strategyAllocation.find((candidate) => candidate.strategyKey === strategyKey);
    return ((row ? Number(row.notionalValue) : 0) / exposure.totalAccountValue) * 100;
  };
  const allocationSegments = [
    { label: "Covered Calls", percent: allocationPercentFor("covered_call"), color: ALLOCATION_COLORS.coveredCalls },
    { label: "Cash-Secured Puts", percent: allocationPercentFor("cash_secured_put"), color: ALLOCATION_COLORS.cashSecuredPuts },
    { label: "No strategy", percent: allocationPercentFor("unstructured"), color: ALLOCATION_COLORS.unstructured },
    { label: "Cash", percent: allocationPercentFor("unallocated"), color: ALLOCATION_COLORS.cash },
  ];

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
          value={formatCurrency(accountValueNumber, 0)}
        />
        <TopStat
          label="Available Cash"
          loading={cashLoading || summaryLoading}
          value={formatCurrency(cash?.availableCashToTrade ?? null, 0)}
          delta={availableCashPercent === null ? null : `(${availableCashPercent.toFixed(1)}%)`}
          deltaClassName={statusTextClass[lowerIsWorseStatus(availableCashPercent, ...AVAILABLE_CASH_PERCENT_BANDS)]}
          tooltip="Total cash minus cash reserved to cover assignment on open cash-secured puts."
        />
        <TopStat
          label="Yesterday's P&L"
          loading={summaryLoading}
          value={formatSignedPnl(yesterdaysPnl, 0)}
          valueClassName={pnlTextClass(yesterdaysPnl)}
          delta={formatSignedPercentageValue(summary?.dayPnlPercent ?? null, 2)}
          deltaClassName={pnlTextClass(summary?.dayPnlPercent ?? null)}
          tooltip="Change in account value between the last two nightly snapshots, taken at 22:30 UTC (after the US close, so after-hours moves are included). Blank when the previous session's snapshot is missing."
        />
        <TopStat
          label="Unrealised P&L"
          loading={summaryLoading || unrealizedLoading}
          value={formatSignedPnl(totalUnrealizedPnl, 0)}
          valueClassName={pnlTextClass(totalUnrealizedPnl)}
          delta={formatSignedPercentageValue(totalUnrealizedPnlPercent, 2)}
          deltaClassName={pnlTextClass(totalUnrealizedPnlPercent)}
        />
      </div>

      <CollapsibleCard title="Allocation" storageKey="portfolio" className="mb-3">
        {portfolioError && <div className="alert alert-danger mb-0">{portfolioError}</div>}
        {!portfolioError && portfolioLoading && <Spinner size="sm" label="Loading allocation" />}
        {!portfolioError && !portfolioLoading && (
          <>
            <div className="allocation-bar mt-2 mb-3">
              {allocationSegments.map((segment) => (
                <span
                  key={segment.label}
                  className="allocation-seg"
                  style={{ width: `${segment.percent}%`, background: segment.color }}
                  data-label={`${segment.label} — ${segment.percent.toFixed(0)}%`}
                />
              ))}
            </div>
            {/* Keep this order identical to allocationSegments (the bar above). */}
            <div className="row g-3">
              <PortfolioTile label="Covered Calls" value={portfolio?.coveredCalls ?? null} swatchColor={ALLOCATION_COLORS.coveredCalls} />
              <PortfolioTile label="Cash-Secured Puts" value={portfolio?.cashSecuredPuts ?? null} swatchColor={ALLOCATION_COLORS.cashSecuredPuts} />
              <PortfolioTile label="No strategy" value={portfolio?.unstructured ?? null} swatchColor={ALLOCATION_COLORS.unstructured} />
              <PortfolioTile label="Available Cash" value={portfolio?.availableCash ?? null} swatchColor={ALLOCATION_COLORS.cash} />
            </div>
          </>
        )}
      </CollapsibleCard>

      {needsAttentionLoading || needsAttentionError || needsAttention.length > 0 ? (
        <CollapsibleCard title="Needs Attention" storageKey="needs-attention" className="mb-3">
          {needsAttentionError && <div className="alert alert-danger mb-0">{needsAttentionError}</div>}
          {!needsAttentionError && needsAttentionLoading && <Spinner size="sm" label="Loading positions needing attention" />}
          {!needsAttentionError && !needsAttentionLoading && (
            <div className="table-responsive table-flush">
              <table className="table table-sm table-vcenter card-table mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Ticker</th>
                    <th>Shares</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Reason</th>
                    <th className="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  {needsAttention.map((position) => {
                    const stockLeg = position.legs.find((leg) => leg.legType === "stock" && !leg.exitAt);
                    const shares = stockLeg?.quantity ?? null;
                    const currentPrice = needsAttentionPriceBySymbol[position.symbol];
                    const value = shares !== null && currentPrice != null ? shares * currentPrice : null;
                    return (
                      <tr key={position.id}>
                        <td>
                          <button
                            type="button"
                            className="btn btn-link px-0 py-0 text-decoration-none fw-bold"
                            onClick={() => openTickerDetail({ symbol: position.symbol, focusPositionId: position.id })}
                          >
                            {position.symbol}
                          </button>
                        </td>
                        <td className="font-mono">{shares ?? "—"}</td>
                        <td className="font-mono">
                          {currentPrice === undefined ? (
                            needsAttentionPriceStreamFailed ? "—" : <Spinner size="sm" label="Loading current price" />
                          ) : currentPrice === null ? (
                            "—"
                          ) : (
                            <TickColoredPrice value={currentPrice} initialReference={null} precision={2} title="Live current price">
                              {formatCurrency(currentPrice)}
                            </TickColoredPrice>
                          )}
                        </td>
                        <td className="font-mono">{value !== null ? formatCurrency(value, 0) : "—"}</td>
                        <td className="text-secondary">
                          {(position.unstructuredReason && unstructuredReasonLabels[position.unstructuredReason]) ?? "cause unclear — flagged for review"}
                        </td>
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-warning"
                            onClick={() => openTickerDetail({ symbol: position.symbol, focusPositionId: position.id })}
                          >
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

      <CollapsibleCard title="Latest Transactions" storageKey="latest-events" className="mb-3">
        {eventsError && <div className="alert alert-danger">{eventsError}</div>}
        {eventsLoading ? (
          <Spinner size="sm" label="Loading events" />
        ) : events.length === 0 ? (
          <div className="text-muted">No recent activity.</div>
        ) : (
          <div className="table-responsive table-flush" style={{ maxHeight: "26rem", overflowY: "auto" }}>
            <table className="table table-sm table-vcenter card-table mb-0" style={{ tableLayout: "fixed", minWidth: "62rem" }}>
              <colgroup>
                <col style={{ width: "5.5rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "4.5rem" }} />
                <col style={{ width: "11rem" }} />
                <col style={{ width: "40%" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "5.5rem" }} />
              </colgroup>
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
                  <EventRow key={`${event.positionId}-${event.eventType}-${event.eventAt}`} event={event} onSymbolClick={openTickerDetail} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-8">
          <CollapsibleCard title="P&L by Period" storageKey="pnl-by-period">
            {periodPnlError && <div className="alert alert-danger mb-0">{periodPnlError}</div>}
            {!periodPnlError && periodPnlLoading && <Spinner size="sm" label="Loading P&L" />}
            {!periodPnlError && !periodPnlLoading && periodPnl && (
              <div className="table-responsive table-flush">
                <table className="table table-sm table-vcenter card-table mb-0">
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
                    <PeriodPnlRow label={<StrategyBadge strategyKey="covered_call" />} row={periodPnl.coveredCalls} />
                    <PeriodPnlRow label={<StrategyBadge strategyKey="cash_secured_put" />} row={periodPnl.cashSecuredPuts} />
                    <PeriodPnlRow label={<StrategyBadge strategyKey="unstructured" />} row={periodPnl.unstructured} />
                    <PeriodPnlRow label={<DottedLabelTooltip label="Residual" tooltipHtml={residualTooltipHtml} />} row={periodPnl.residual} />
                    <PeriodPnlRow label="Total" row={periodPnl.total} bold />
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleCard>
        </div>
        <div className="col-12 col-lg-4">
          <CollapsibleCard title="P&L by Strategy (YTD)" storageKey="pnl-by-strategy">
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
                const knownRealizedTotal = knownRows.reduce((sum, row) => sum + row.realizedPnl, 0);
                const knownUnrealizedTotal = knownRows.reduce((sum, row) => sum + row.unrealizedPnl, 0);
                const residualRealized = summary.accountRealizedYtd - knownRealizedTotal;
                const residualUnrealized = summary.accountUnrealizedYtd - knownUnrealizedTotal;

                return (
                  <div className="table-responsive table-flush">
                    <table className="table table-sm table-vcenter card-table mb-0">
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
                            <td><StrategyBadge strategyKey={row.strategyKey} /></td>
                            <td className={`text-end font-mono ${pnlTextClass(row.realizedPnl)}`}>{formatSignedPnl(row.realizedPnl, 0)}</td>
                            <td className={`text-end font-mono ${pnlTextClass(row.unrealizedPnl)}`}>{formatSignedPnl(row.unrealizedPnl, 0)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="fw-bold"><DottedLabelTooltip label="Residual" tooltipHtml={residualTooltipHtml} /></td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(residualRealized)}`}>
                            {formatSignedPnl(residualRealized, 0)}
                          </td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(residualUnrealized)}`}>
                            {formatSignedPnl(residualUnrealized, 0)}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-bold">Total</td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(summary.accountRealizedYtd)}`}>
                            {formatSignedPnl(summary.accountRealizedYtd, 0)}
                          </td>
                          <td className={`text-end font-mono fw-bold ${pnlTextClass(summary.accountUnrealizedYtd)}`}>
                            {formatSignedPnl(summary.accountUnrealizedYtd, 0)}
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

      <CollapsibleCard title="Allocation" storageKey="allocation" className="mb-3">
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
                onTickerClick={openTickerDetail}
                rows={(() => {
                  const topRows = (exposure?.topPositions ?? []).map((row: TopPositionRow) => ({
                    key: row.positionId,
                    label: row.symbol,
                    sublabel: strategyLabels[row.strategyKey] ?? row.strategyKey,
                    notionalValue: row.notionalValue,
                    tickerSymbol: row.symbol,
                    focusPositionId: row.positionId,
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

      <CollapsibleCard title="P&L Over Time" storageKey="pnl-over-time" className="mb-3">
        {historyError && <div className="alert alert-danger">{historyError}</div>}

        {historyLoading ? (
          <div className="d-flex justify-content-center py-3">
            <Spinner label="Loading history" />
          </div>
        ) : history.length < 2 ? (
          <div className="text-muted">Not enough snapshot history yet to chart a trend.</div>
        ) : (
          <ApexChart
            type="bar"
            height={260}
            series={[
              { name: "Covered Calls", data: history.map((point) => ({ x: point.snapshotDate, y: point.coveredCalls })) },
              { name: "Cash-Secured Puts", data: history.map((point) => ({ x: point.snapshotDate, y: point.cashSecuredPuts })) },
              { name: "No strategy", data: history.map((point) => ({ x: point.snapshotDate, y: point.unstructured })) },
              {
                name: "Residual",
                data: history.map((point) => ({ x: point.snapshotDate, y: point.residual === null ? null : point.residual })),
              },
            ]}
            options={{
              // Stacked columns rather than stacked areas: ApexCharts stacks positives up and negatives down
              // for bars, but sums mixed-sign area series cumulatively, so the bands cross each other.
              chart: { stacked: true, events: { mounted: extendZeroLineToFullPlotWidth, updated: extendZeroLineToFullPlotWidth } },
              // A solid line at $0 so it is obvious which side of zero each column sits on.
              annotations: { yaxis: [{ y: 0, borderColor: textColorByTheme[theme], borderWidth: 1.5, strokeDashArray: 0 }] },
              plotOptions: { bar: { columnWidth: "70%" } },
              fill: { opacity: 1 }, // ApexCharts' bar default is 0.85, which lets the dark card show through and mutes the colours
              colors: [tablerColor("--tblr-blue"), tablerColor("--tblr-purple"), tablerColor("--tblr-orange"), tablerColor("--tblr-secondary")],
              xaxis: {
                type: "datetime",
                tickAmount: Math.min(history.length - 1, 7),
                labels: { datetimeUTC: false, format: "dd MMM" },
              },
              yaxis: { labels: { formatter: (value: number) => formatCurrency(value, 0) } },
              tooltip: {
                shared: true,
                intersect: false,
                x: { format: "dd MMM yyyy" },
                y: { formatter: (value: number) => formatSignedPnl(value, 0) },
              },
              dataLabels: { enabled: false },
              stroke: { width: 0 },
              legend: { position: "top" },
              responsive: [{ breakpoint: 768, options: { legend: { position: "bottom" }, chart: { height: 220 } } }],
            }}
          />
        )}
      </CollapsibleCard>

      {detailSymbol && (
        <TickerDetailModal
          symbol={detailSymbol}
          focusPositionId={focusPositionId}
          onClose={() => {
            setDetailSymbol(null);
            setFocusPositionId(undefined);
            loadNeedsAttention();
          }}
        />
      )}
    </>
  );
}
