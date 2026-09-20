import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "./PulsePage.css";
import { useExposureStream } from "../hooks/useExposureStream";
import { fetchAccountValue, fetchDashboardSummary, fetchAvailableCash, type AccountValue, type AvailableCash, type DashboardSummary } from "../api/dashboard";
import { fetchPositions, openUnrealizedPnlStream, openGreeksStream, fetchOrder, type Position, type UnrealizedPnlResult, type Greeks, type OrderLeg, type OrderRequestStatus } from "../api/positions";
import { fetchTradeAlerts, isRollAlert, type NewTradeCandidate, type TradeAlert } from "../api/tradeAlerts";
import { fetchTradeBlotter, type Trade } from "../api/tradeBlotter";
import { openNotificationStream, fetchRecentNotifications, type AppNotification } from "../api/notifications";
import {
  fetchPresence,
  fetchDbHealth,
  fetchGenosukeHealth,
  fetchWebDynoHealth,
  fetchGatewayHealth,
  fetchMarketStatus,
  type PresenceUser,
  type DbHealth,
  type GenosukeHealth,
  type WebDynoHealth,
  type GatewayHealth,
  type MarketStatus,
  type MarketSessionState,
} from "../api/systemHealth";
import { daysToExpiry, todayInEasternIso, formatSignedPnl, formatSignedPercentageValue, formatCompactDollars, formatDateTime, formatNumber, formatPercentageValue, formatRelativeDate, ibkrExpiryToIsoDate } from "../lib/formatters";
import { positionExpiryDate, strategyAbbrev as positionStrategyAbbrev, strategyTooltip } from "../lib/positionPnl";
import { FlashingNumber } from "../components/FlashingNumber";
import { higherIsWorseStatus, lowerIsWorseStatus } from "../lib/statusThresholds";
import { TopologyMap, type PulseEvent } from "../components/pulse/TopologyMap";
import { TotalPnlChart } from "../components/pulse/TotalPnlChart";
import { ProfitProbabilityChart, type ProbabilitySeries } from "../components/pulse/ProfitProbabilityChart";

const CHART_SAMPLE_INTERVAL_MS = 60_000;
// 4 hours of history at one sample/minute.
const CHART_MAX_SAMPLES = 240;
const HEALTH_POLL_INTERVAL_MS = 30_000;
const TRADES_LIMIT = 30;
const EVENTS_LIMIT = 30;
// Reference line on the Profit Probability chart — below this a position is
// unlikely to end in profit. Set 2026-09-19; a constant, not a setting, since
// nothing else consumes it.
const PROFIT_PROBABILITY_THRESHOLD = 0.5;
// How long a topology line stays lit: the dot's travel time, which is also how
// long the line glows (set to 300 ms 2026-09-19; was 1100 ms). The extra
// grace lets the last animation frame land before the dot is removed.
const PULSE_DURATION_MS = 300;
const PULSE_REMOVAL_GRACE_MS = 50;
// Dot colour per silent-until-now line (see backend pulseEmitter.ts): plain
// infrastructure traffic in the accent, Genosuke's own traffic in the muted
// tone its Heroku-Genosuke line already uses.
const PULSE_EDGE_COLORS = {
  "ibkr-gateway": "var(--accent-glow)",
  "heroku-browser": "var(--accent-glow)",
  "heroku-db": "var(--accent-glow)",
  "genosuke-db": "var(--text-secondary)",
  "genosuke-llm": "var(--text-secondary)",
} as const;
// Green/amber/red cut-offs for the node stats (approved 2026-09-19). Each pair
// is [greenBelow, amberUpTo]; anything above amberUpTo is red.
const CONNECTIONS_USED_PERCENT_BANDS = [50, 80] as const;
const DB_SIZE_USED_PERCENT_BANDS = [70, 90] as const;
const DB_AVERAGE_RESPONSE_MS_BANDS = [50, 200] as const;
const DB_SLOWEST_RESPONSE_MS_BANDS = [500, 2000] as const;
const GATEWAY_RECONNECT_BANDS = [1, 5] as const;
const GATEWAY_IN_FLIGHT_BANDS = [1, 5] as const;
// Available cash as % of account value: below 15 red, below 30 amber, else green.
const AVAILABLE_CASH_PERCENT_BANDS = [15, 30] as const;
const GATEWAY_HEALTHY_UPTIME_MS = 30 * 60_000;

// Alert notifications only ever carry the two structured strategies.
function strategyAbbrev(strategyKey: string): "CC" | "CSP" {
  return strategyKey === "covered_call" ? "CC" : "CSP";
}

const strategyBadgeModifier: Record<string, string> = { covered_call: "cc", cash_secured_put: "csp", unstructured: "ns" };

// Latest Events' own terse status wording (distinct from
// orderRequestStatusLabel's fuller labels used in OrderReviewPanel/Trade
// Blotter, which have more room) — the three most frequent statuses get a
// short standalone word; everything else keeps the "Order <status>" form.
function orderEventStatusLabel(status: OrderRequestStatus): string {
  switch (status) {
    case "filled":
      return "Filled";
    case "partially_filled":
      return "Part. filled";
    case "submitted":
      return "Sent";
    default:
      return `Order ${status.replace(/_/g, " ")}`;
  }
}

// Latest Events only has room for a short per-leg summary (stock: price;
// option: strike/DTE/premium) — the full per-fill detail already lives in
// the Trades panel. DTE is relative to asOf (the event's own time), not
// "today" — a backfilled historical event for an expiry that's since
// passed should show the DTE it actually had then, not a confusing
// negative countdown (mirrors daysToExpiry's asOf convention).
function formatOrderLegsSummary(legs: OrderLeg[], asOf: string): string {
  return legs
    .map((leg) => {
      if (leg.role === "stock") {
        return `${leg.action} ${leg.quantity} @ ${leg.unitPrice.toFixed(2)}`;
      }
      const expiryIsoDate = leg.expiry ? (leg.expiry.length === 8 ? ibkrExpiryToIsoDate(leg.expiry) : leg.expiry) : null;
      const dte = expiryIsoDate ? `${daysToExpiry(expiryIsoDate, asOf)}d ` : "";
      return `${leg.action} ${leg.quantity} ${leg.strike}${leg.right ?? ""} ${dte}@ ${leg.unitPrice.toFixed(2)}`;
    })
    .join(" + ");
}

function colorForIndex(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `hsl(${hue}, 62%, 64%)`;
}

// A roll alert's yield/strike/expiry live one level deeper, at
// suggestedStructure.replacement (itself shaped like a NewTradeCandidate) —
// see runTradeAlertGeneration.ts. TS can't narrow the false branch of
// isRollAlert's intersection-typed predicate (a known limitation, not a
// discriminated union it can compute Exclude<> over), so this asserts the
// non-roll case explicitly — same pattern TradeAlertsPage.tsx uses via its
// own `.filter((a): a is NewTradeAlert => ...)` predicates.
function alertStructure(alert: TradeAlert): NewTradeCandidate {
  if (isRollAlert(alert)) return alert.suggestedStructure.replacement;
  return alert.suggestedStructure as NewTradeCandidate;
}

function alertYield(alert: TradeAlert): number {
  return alertStructure(alert).annualizedYield;
}

function alertStrikeLabel(alert: TradeAlert): string {
  const structure = alertStructure(alert);
  const right = structure.right === "call" ? "C" : "P";
  const expiry = new Date(structure.expiry);
  const expiryLabel = `${String(expiry.getUTCMonth() + 1).padStart(2, "0")}/${String(expiry.getUTCDate()).padStart(2, "0")}`;
  return `${structure.strike}${right} ${expiryLabel}`;
}

function formatBytes(bytesText: string | null | undefined): string {
  const bytes = Number(bytesText ?? 0);
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb < 1) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${gb.toFixed(1)} GB`;
}

function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface AttentionReason {
  key: string;
  name: string;
  detail: string;
  meta: string;
}

function describeAttentionReasons(gatewayHealth: GatewayHealth | null, accountDataError: string | null | undefined): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (gatewayHealth?.staleOrMissing) {
    const updatedAtMs = gatewayHealth.updatedAt ? new Date(gatewayHealth.updatedAt).getTime() : null;
    reasons.push({
      key: "gateway",
      name: "Gateway worker not reporting",
      detail: "No heartbeat from the IBKR worker. Orders and live prices may be stale.",
      meta: updatedAtMs
        ? `Last update ${formatDurationShort(Date.now() - updatedAtMs)} ago · ${new Date(updatedAtMs).toLocaleTimeString("en-US", { hour12: false })}`
        : "No heartbeat recorded",
    });
  } else if (gatewayHealth && !gatewayHealth.connected) {
    reasons.push({
      key: "gateway",
      name: "Gateway disconnected from IBKR",
      detail: "Worker is running but has lost its IBKR connection; it is retrying.",
      meta: `Status code ${gatewayHealth.lastSystemStatusCode ?? "—"} · reconnects ${gatewayHealth.totalReconnects ?? "—"}`,
    });
  }
  if (accountDataError) {
    reasons.push({
      key: "ibkr-data",
      name: "IBKR account data unavailable",
      detail: "Account value, cash and exposure may be out of date.",
      meta: `Error ${accountDataError}`,
    });
  }
  return reasons;
}

// Touch taps also fire emulated mouseenter/focus before click, so on
// hover-less devices those would open the tooltip and the click toggle would
// immediately close it again.
function deviceCanHover(): boolean {
  return window.matchMedia("(hover: hover)").matches;
}

function AttentionPill({ reasons }: { reasons: AttentionReason[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const degraded = reasons.length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      className="pill-wrap"
      ref={wrapperRef}
      onMouseEnter={degraded && deviceCanHover() ? () => setIsOpen(true) : undefined}
      onMouseLeave={degraded && deviceCanHover() ? () => setIsOpen(false) : undefined}
    >
      <div
        className={`status-pill${degraded ? " status-pill-degraded status-pill-interactive" : ""}`}
        tabIndex={degraded ? 0 : undefined}
        role={degraded ? "button" : undefined}
        aria-expanded={degraded ? isOpen : undefined}
        onFocus={degraded && deviceCanHover() ? () => setIsOpen(true) : undefined}
        onBlur={degraded && deviceCanHover() ? () => setIsOpen(false) : undefined}
        onClick={degraded && !deviceCanHover() ? () => setIsOpen((previous) => !previous) : undefined}
      >
        <span className={`led${degraded ? " led-warn" : ""}`} />
        {degraded ? "ATTENTION NEEDED" : "ALL SYSTEMS NOMINAL"}
      </div>
      {degraded && isOpen && (
        <div className="attention-tip" role="tooltip">
          <div className="tip-title">Needs attention · {reasons.length}</div>
          {reasons.map((reason) => (
            <div className="tip-item" key={reason.key}>
              <span className="led led-warn" />
              <div>
                <div className="tip-name">{reason.name}</div>
                <div className="tip-detail">{reason.detail}</div>
                <div className="tip-meta">{reason.meta}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function marketStatusStyle(state: MarketSessionState | undefined): { badgeLabel: string; ledClass: string; textClass: string } {
  switch (state) {
    case "open":
      return { badgeLabel: "OPEN", ledClass: "", textClass: "mk-status-open" };
    case "pre-market":
      return { badgeLabel: "PRE-MARKET", ledClass: "led-amber", textClass: "mk-status-amber" };
    case "after-hours":
      return { badgeLabel: "AFTER-HOURS", ledClass: "led-amber", textClass: "mk-status-amber" };
    case "closed":
    default:
      return { badgeLabel: "CLOSED", ledClass: "led-warn", textClass: "mk-status-closed" };
  }
}

const MARKET_STATUS_POLL_INTERVAL_MS = 60_000;

// Server-computed from the real exchanges the book actually trades on
// (tickers.primary_exchange) plus market_calendar's holiday coverage — see
// src/lib/marketSessionStatus.ts in the API repo. Polled rather than
// computed client-side since it depends on that DB state, not just the
// current time.
function useMarketStatus() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    function poll() {
      fetchMarketStatus()
        .then((result) => {
          if (!cancelled) setStatus(result);
        })
        .catch(() => {});
    }
    poll();
    const interval = window.setInterval(poll, MARKET_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);
  return status;
}

interface EventItem {
  id: number;
  time: string;
  text: string;
  color: string;
}

function EventRow({ time, text, color }: { time: string; text: string; color: string }) {
  return (
    <div className="event-row">
      <span className="event-dot" style={{ background: color }} />
      <span className="event-time">{time}</span>
      <span className="event-text">{text}</span>
    </div>
  );
}

export function PulsePage() {
  // Always dark, independent of the app-wide theme toggle — restored on
  // unmount so navigating back into the rest of the SPA (if this tab ever
  // does) isn't stuck dark.
  useEffect(() => {
    const previous = document.documentElement.getAttribute("data-bs-theme");
    document.documentElement.setAttribute("data-bs-theme", "dark");
    return () => {
      if (previous) document.documentElement.setAttribute("data-bs-theme", previous);
      else document.documentElement.removeAttribute("data-bs-theme");
    };
  }, []);

  const [clock, setClock] = useState(() => new Date().toLocaleTimeString("en-US", { hour12: false }));
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date().toLocaleTimeString("en-US", { hour12: false })), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const marketStatus = useMarketStatus();

  // --- KPI strip: one-shot on mount, same as DashboardPage — Account
  // Value is a last-night snapshot and genuinely doesn't tick intraday;
  // Available Cash is a live IBKR round trip, not polled tightly (see
  // fetchAvailableCash's own comment on IBKR pacing). ---
  const [accountValue, setAccountValue] = useState<AccountValue | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [availableCash, setAvailableCash] = useState<AvailableCash | null>(null);
  const { exposure } = useExposureStream("Failed to load account exposure.");

  const netLiquidationValue = accountValue?.netLiquidationValue ?? null;
  const availableCashToTrade = availableCash?.availableCashToTrade ?? null;
  const availableCashPercent =
    netLiquidationValue !== null && netLiquidationValue > 0 && availableCashToTrade !== null
      ? (availableCashToTrade / netLiquidationValue) * 100
      : null;

  useEffect(() => {
    fetchAccountValue().then(setAccountValue).catch(() => {});
    fetchDashboardSummary().then(setSummary).catch(() => {});
    fetchAvailableCash().then(setAvailableCash).catch(() => {});
  }, []);

  // Yesterday's P&L (KPI) and the Unrealised P&L chart are intentionally
  // different numbers: this is day-over-day snapshot delta, the chart is a
  // live mark-to-market sum of currently-open positions since each one's
  // own entry. Don't "fix" them to agree.
  const yesterdaysPnl = summary?.periods.day !== null && summary?.periods.day !== undefined ? Number(summary.periods.day) : null;

  const strategyPct = useCallback(
    (key: string) => {
      if (!exposure?.totalAccountValue) return 0;
      const row = exposure.strategyAllocation.find((r) => r.strategyKey === key);
      const value = row ? Number(row.notionalValue) : 0;
      return (value / exposure.totalAccountValue) * 100;
    },
    [exposure],
  );
  const ccPct = strategyPct("covered_call");
  const cspPct = strategyPct("cash_secured_put");
  const unstructuredPct = strategyPct("unstructured");
  const cashPct = strategyPct("unallocated");

  // --- Positions: same fetch + live SSE idiom as PositionsPage.tsx. ---
  const [positions, setPositions] = useState<Position[]>([]);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});

  const loadPositions = useCallback(() => {
    fetchPositions({ status: "open" }).then(setPositions).catch(() => {});
  }, []);
  useEffect(() => loadPositions(), [loadPositions]);

  useEffect(() => {
    const optionLegIds = positions.flatMap((position) => position.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id));
    if (optionLegIds.length === 0) return;
    return openGreeksStream(optionLegIds, setGreeksByLegId);
  }, [positions]);

  useEffect(() => {
    const positionIds = positions.map((position) => position.id);
    if (positionIds.length === 0) return;
    return openUnrealizedPnlStream(positionIds, setUnrealizedPnlByPositionId);
  }, [positions]);

  // Total market value of shares currently held (covered-call stock legs
  // only — CSPs hold no stock) — IBKR node's "Total equity" row. A position
  // with no live/fallback price yet is excluded from the sum via `?? 0`,
  // same convention as the Unrealised P&L chart's totalPnl calc below,
  // rather than blanking the whole total for one stale leg.
  const totalStockValue = Object.values(unrealizedPnlByPositionId).reduce((sum, row) => sum + (row.stockMarketValue ?? 0), 0);

  // Live mark-to-market sum of open positions — same total the Unrealised P&L
  // chart samples. % is against the account value excluding this open
  // gain/loss (mirrors how Yesterday's P&L is measured against the pre-move
  // baseline), formula approved 2026-09-19.
  const hasUnrealizedPnl = Object.keys(unrealizedPnlByPositionId).length > 0;
  const totalUnrealizedPnl = hasUnrealizedPnl ? Object.values(unrealizedPnlByPositionId).reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0) : null;
  const accountValueBeforeUnrealizedPnl =
    totalUnrealizedPnl !== null && accountValue?.netLiquidationValue ? Number(accountValue.netLiquidationValue) - totalUnrealizedPnl : null;
  const totalUnrealizedPnlPercent =
    totalUnrealizedPnl !== null && accountValueBeforeUnrealizedPnl ? (totalUnrealizedPnl / accountValueBeforeUnrealizedPnl) * 100 : null;

  // --- Top Alerts by yield ---
  const [pendingAlerts, setPendingAlerts] = useState<TradeAlert[]>([]);
  useEffect(() => {
    fetchTradeAlerts({ status: "pending", sort: "yield" }).then(setPendingAlerts).catch(() => {});
  }, []);
  // One alert per ticker (the highest-yield one, since pendingAlerts is
  // already server-sorted by yield) rather than the top 5 overall, which
  // could all be the same handful of tickers. No length cap — mirrors the
  // Trades panel's "fetch generously, let overflow:hidden clip" design.
  const topAlerts = Array.from(new Map(pendingAlerts.map((alert) => [alert.tickerId, alert])).values());

  // --- Trades: fetch generously and let the panel's own overflow:hidden
  // clip whatever doesn't fit — no scroll, per the panel design. ---
  const [trades, setTrades] = useState<Trade[]>([]);
  const loadTrades = useCallback(() => {
    fetchTradeBlotter({})
      .then((data) => {
        const sorted = [...data.trades].sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
        setTrades(sorted.slice(0, TRADES_LIMIT));
      })
      .catch(() => {});
  }, []);
  useEffect(() => loadTrades(), [loadTrades]);

  // --- System health (30s poll) ---
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [genosukeHealth, setGenosukeHealth] = useState<GenosukeHealth | null>(null);
  const [webDynoHealth, setWebDynoHealth] = useState<WebDynoHealth | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      Promise.all([fetchDbHealth(), fetchGenosukeHealth(), fetchWebDynoHealth(), fetchGatewayHealth(), fetchPresence()])
        .then(([db, genosuke, webDyno, gateway, presence]) => {
          if (cancelled) return;
          setDbHealth(db);
          setGenosukeHealth(genosuke);
          setWebDynoHealth(webDyno);
          setGatewayHealth(gateway);
          setPresenceUsers(presence.users);
        })
        .catch(() => {});
    }
    poll();
    const interval = window.setInterval(poll, HEALTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // --- Topology pulses + System Events, driven by real notifications ---
  const [pulses, setPulses] = useState<PulseEvent[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [telegramFlash, setTelegramFlash] = useState(false);
  const eventIdRef = useRef(0);

  const firePulse = useCallback((edgeId: string, color: string, opts?: { reverse?: boolean; durationMs?: number }) => {
    const key = `${edgeId}-${Date.now()}-${Math.random()}`;
    const durationMs = opts?.durationMs ?? PULSE_DURATION_MS;
    setPulses((prev) => [...prev, { key, edgeId, color, reverse: opts?.reverse, durationMs }]);
    window.setTimeout(() => setPulses((prev) => prev.filter((pulse) => pulse.key !== key)), durationMs + PULSE_REMOVAL_GRACE_MS);
  }, []);

  const appendEvent = useCallback((text: string, color: string) => {
    eventIdRef.current += 1;
    setEvents((prev) => [{ id: eventIdRef.current, time: new Date().toLocaleTimeString("en-US", { hour12: false }), text, color }, ...prev].slice(0, EVENTS_LIMIT));
  }, []);

  // Fetches the most recent events from the backend and describes them with
  // the same text/color formatting as the live switch below (order_status
  // needs the same fetchOrder lookup), skipping the pulse/side-effect work,
  // which only matters for events as they happen live.
  const fetchDescribedEvents = useCallback(async () => {
    const { events: recentEvents } = await fetchRecentNotifications();
    const described = await Promise.all(
      recentEvents.map(async ({ notification, occurredAt, order }) => {
        switch (notification.type) {
          case "job_completed": {
            if (notification.jobName === "ibkr_health_check") return null;
            const color = notification.status === "success" ? "var(--accent-glow)" : "var(--danger)";
            return { occurredAt, text: `Job ${notification.status === "success" ? "done" : "failed"} — ${notification.jobName}`, color };
          }
          case "alert_generated":
            return {
              occurredAt,
              text: `Alert — ${notification.symbol} ${strategyAbbrev(notification.strategyKey)}, ${(notification.annualizedYield * 100).toFixed(1)}% yield`,
              color: "var(--warning)",
            };
          case "order_status": {
            // Resolved server-side in the same response — no per-order request.
            if (!order) return null;
            const legsSummary = formatOrderLegsSummary(order.payload.legs, occurredAt);
            return {
              occurredAt,
              text: `${orderEventStatusLabel(order.status)} — ${order.payload.symbol}${legsSummary ? `: ${legsSummary}` : ""}`,
              color: "var(--success)",
            };
          }
          case "position_opened":
            return { occurredAt, text: `Position opened — ${notification.symbol}`, color: "var(--success)" };
          case "position_closed":
            return { occurredAt, text: `Position closed — ${notification.symbol}`, color: "var(--success)" };
          case "genosuke_reply":
            return { occurredAt, text: `Genosuke replied: ${notification.preview}`, color: "var(--text-secondary)" };
          default:
            return null;
        }
      }),
    );
    return described
      .filter((item): item is { occurredAt: string; text: string; color: string } => item !== null)
      .map((item) => {
        eventIdRef.current += 1;
        return { id: eventIdRef.current, time: new Date(item.occurredAt).toLocaleTimeString("en-US", { hour12: false }), text: item.text, color: item.color };
      });
  }, []);

  // Backfills Latest Events with history from the backend on load — the SSE
  // stream below only ever carries events from the moment this tab connects,
  // so without this the panel always starts empty.
  useEffect(() => {
    let cancelled = false;
    fetchDescribedEvents()
      .then((initialEvents) => {
        if (cancelled) return;
        // Guards against clobbering events appended live while this request
        // was in flight.
        setEvents((prev) => (prev.length > 0 ? prev : initialEvents));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchDescribedEvents]);

  // Refetches on tab refocus — a laptop closed for hours drops/suspends the
  // SSE connection, so the panel otherwise keeps showing a stale mix: a
  // handful of events received right around sleep/wake sitting atop the
  // backfill snapshot from whenever the tab was first opened, with a dead
  // gap between them for everything that happened while it was backgrounded.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      fetchDescribedEvents()
        .then(setEvents)
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchDescribedEvents]);

  useEffect(() => {
    return openNotificationStream((notification: AppNotification) => {
      switch (notification.type) {
        case "job_completed": {
          const color = notification.status === "success" ? "var(--accent-glow)" : "var(--danger)";
          firePulse("heroku-gateway", color);
          // Runs every 10 minutes — logging it here would crowd out every other
          // event; its own status already surfaces on the Gateway node/status pill.
          if (notification.jobName !== "ibkr_health_check") {
            appendEvent(`Job ${notification.status === "success" ? "done" : "failed"} — ${notification.jobName}`, color);
          }
          break;
        }
        case "alert_generated": {
          firePulse("gateway-db", "var(--warning)");
          appendEvent(`Alert — ${notification.symbol} ${strategyAbbrev(notification.strategyKey)}, ${(notification.annualizedYield * 100).toFixed(1)}% yield`, "var(--warning)");
          fetchTradeAlerts({ status: "pending", sort: "yield" }).then(setPendingAlerts).catch(() => {});
          break;
        }
        case "order_status": {
          fetchOrder(notification.orderId)
            .then((order) => {
              firePulse("heroku-gateway", "var(--success)", { reverse: true });
              const legsSummary = formatOrderLegsSummary(order.payload.legs, todayInEasternIso());
              appendEvent(`${orderEventStatusLabel(order.status)} — ${order.payload.symbol}${legsSummary ? `: ${legsSummary}` : ""}`, "var(--success)");
              if (order.status === "filled" || order.status === "partially_filled") {
                loadTrades();
              }
            })
            .catch(() => {});
          break;
        }
        case "position_opened": {
          firePulse("gateway-db", "var(--success)");
          appendEvent(`Position opened — ${notification.symbol}`, "var(--success)");
          loadPositions();
          break;
        }
        case "position_closed": {
          firePulse("gateway-db", "var(--success)");
          appendEvent(`Position closed — ${notification.symbol}`, "var(--success)");
          loadPositions();
          break;
        }
        case "genosuke_reply": {
          firePulse("heroku-genosuke", "var(--text-secondary)");
          appendEvent(`Genosuke replied: ${notification.preview}`, "var(--text-secondary)");
          setTelegramFlash(true);
          window.setTimeout(() => setTelegramFlash(false), 900);
          break;
        }
        case "pulse": {
          firePulse(notification.edgeId, PULSE_EDGE_COLORS[notification.edgeId]);
          break;
        }
        case "presence": {
          fetchPresence().then((result) => setPresenceUsers(result.users)).catch(() => {});
          break;
        }
      }
    }, { wantsPulses: true });
  }, [appendEvent, firePulse, loadPositions, loadTrades]);

  const activeEdgeIds = useMemo(() => new Set(pulses.map((pulse) => pulse.edgeId)), [pulses]);

  // --- Charts: live client-side rolling sample of the already-open SSE
  // streams above — no persisted intraday history exists on the backend
  // (approved tradeoff, 2026-09-13). Starts empty and fills in as the tab
  // stays open. ---
  const [pnlSeries, setPnlSeries] = useState<number[]>([]);
  const [pnlTimestamps, setPnlTimestamps] = useState<number[]>([]);
  // Keyed by position id, not symbol — a rolled position can leave two
  // distinct open positions sharing one ticker (confirmed in dev data: two
  // separate SPCX positions), which would otherwise collide.
  const [probabilitySeriesByPositionId, setProbabilitySeriesByPositionId] = useState<Record<string, number[]>>({});
  const latestDataRef = useRef({ unrealizedPnlByPositionId, greeksByLegId, positions });
  useEffect(() => {
    latestDataRef.current = { unrealizedPnlByPositionId, greeksByLegId, positions };
  }, [unrealizedPnlByPositionId, greeksByLegId, positions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const { unrealizedPnlByPositionId: pnlMap, greeksByLegId: greeksMap, positions: posList } = latestDataRef.current;
      const totalPnl = Object.values(pnlMap).reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0);
      setPnlSeries((prev) => [...prev, totalPnl].slice(-CHART_MAX_SAMPLES));
      setPnlTimestamps((prev) => [...prev, Date.now()].slice(-CHART_MAX_SAMPLES));

      setProbabilitySeriesByPositionId((prev) => {
        const next = { ...prev };
        for (const position of posList) {
          if (position.strategyKey !== "covered_call" && position.strategyKey !== "cash_secured_put") continue;
          const optionLeg = position.legs.find((leg) => leg.legType === "option");
          if (!optionLeg) continue;
          const probability = greeksMap[optionLeg.id]?.probabilityByD2;
          if (probability === null || probability === undefined) continue;
          next[position.id] = [...(next[position.id] ?? []), probability].slice(-CHART_MAX_SAMPLES);
        }
        return next;
      });
    }, CHART_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const probabilitySeriesForChart: ProbabilitySeries[] = positions
    .filter((position) => position.strategyKey === "covered_call" || position.strategyKey === "cash_secured_put")
    .filter((position) => (probabilitySeriesByPositionId[position.id]?.length ?? 0) >= 2)
    .map((position, index, arr) => ({
      id: position.id,
      symbol: position.symbol,
      color: colorForIndex(index, arr.length),
      values: probabilitySeriesByPositionId[position.id]!,
    }));

  // Real, computed status — not decorative. "Degraded" whenever the Gateway
  // node has no live connection (staleOrMissing means the worker hasn't
  // written a worker_health row recently, connected:false means it has but
  // reports no IBKR connection) or the live IBKR account-data round trip
  // (exposure.accountDataError, from GET /risk-limits/exposure) is failing.
  // Database/Heroku/Genosuke aren't gated on — if the page loaded at all,
  // those are already up.
  const databaseSizeUsedPercent = dbHealth ? (Number(dbHealth.databaseSizeBytes) / Number(dbHealth.maxDatabaseSizeBytes)) * 100 : 0;
  const attentionReasons = describeAttentionReasons(gatewayHealth, exposure?.accountDataError);

  return (
    <div className="iorio-pulse-page">
      <div className="pulse-header">
        <div className="pulse-header-left">
          <img className="brand-logo" src="/brand/iorio-icon.svg" alt="" />
          <span className="brand-title">
            IORIO Pulse<span className="dot">.</span>
          </span>
          <span className="brand-eyebrow">REALTIME SYSTEM MONITORING</span>
        </div>
        <div className="pulse-header-right">
          <AttentionPill reasons={attentionReasons} />
          <div className="clock">{clock}</div>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-tile">
          <span className="kpi-label">Account Value</span>
          <div className="kpi-value-row">
            <FlashingNumber value={accountValue?.netLiquidationValue ?? null} className="kpi-value">
              {formatSignedPnl(accountValue?.netLiquidationValue ?? null, 0).replace("+", "")}
            </FlashingNumber>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Available Cash</span>
          <div className="kpi-value-row">
            <FlashingNumber value={availableCash?.availableCashToTrade ?? null} className="kpi-value">
              {formatSignedPnl(availableCash?.availableCashToTrade ?? null, 0).replace("+", "")}
            </FlashingNumber>
            {availableCashPercent !== null && (
              <span className={`kpi-delta ${lowerIsWorseStatus(availableCashPercent, ...AVAILABLE_CASH_PERCENT_BANDS)}`}>
                ({availableCashPercent.toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Yesterday&apos;s P&amp;L</span>
          <div className="kpi-value-row">
            <FlashingNumber
              value={yesterdaysPnl}
              className="kpi-value"
              style={{ color: yesterdaysPnl === null ? undefined : yesterdaysPnl >= 0 ? "var(--success)" : "var(--danger)" }}
            >
              {formatSignedPnl(yesterdaysPnl, 0)}
            </FlashingNumber>
            <span className={`kpi-delta ${summary?.dayPnlPercent && summary.dayPnlPercent >= 0 ? "up" : "down"}`}>
              {formatSignedPercentageValue(summary?.dayPnlPercent ?? null, 2)}
            </span>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Unrealised P&amp;L</span>
          <div className="kpi-value-row">
            <FlashingNumber
              value={totalUnrealizedPnl}
              className="kpi-value"
              style={{ color: totalUnrealizedPnl === null ? undefined : totalUnrealizedPnl >= 0 ? "var(--success)" : "var(--danger)" }}
            >
              {formatSignedPnl(totalUnrealizedPnl, 0)}
            </FlashingNumber>
            <span className={`kpi-delta ${totalUnrealizedPnlPercent !== null && totalUnrealizedPnlPercent >= 0 ? "up" : "down"}`}>
              {formatSignedPercentageValue(totalUnrealizedPnlPercent, 2)}
            </span>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Allocation</span>
          <div className="alloc-bar">
            <span className="alloc-seg" style={{ width: `${ccPct}%`, background: "var(--tblr-blue)" }} data-label={`Covered Calls — ${ccPct.toFixed(0)}%`} />
            <span className="alloc-seg" style={{ width: `${cspPct}%`, background: "var(--tblr-purple)" }} data-label={`Cash-Secured Puts — ${cspPct.toFixed(0)}%`} />
            <span
              className="alloc-seg"
              style={{ width: `${unstructuredPct}%`, background: "var(--tblr-orange)" }}
              data-label={`No strategy — ${unstructuredPct.toFixed(0)}%`}
            />
            <span className="alloc-seg" style={{ width: `${cashPct}%`, background: "var(--border-strong)" }} data-label={`Cash — ${cashPct.toFixed(0)}%`} />
          </div>
        </div>
      </div>

      <div className="main-grid">
        <div className="rail">
          <div className="panel">
            <div className="panel-title">
              Positions <span className="count">{positions.length}</span>
            </div>
            <div className="pos-head">
              <span>Tkr</span>
              <span>Strat</span>
              <span style={{ textAlign: "right" }}>DTE</span>
              <span style={{ textAlign: "right" }}>Exp $</span>
              <span style={{ textAlign: "right" }}>Exp %</span>
              <span style={{ textAlign: "right" }}>P&amp;L</span>
            </div>
            {positions.length === 0 && <div className="panel-empty">No open positions.</div>}
            {positions.map((position) => {
              const expiryDate = positionExpiryDate(position);
              const dte = expiryDate ? daysToExpiry(expiryDate, todayInEasternIso()) : null;
              const capitalAtRisk = position.capitalAtRisk !== null ? Number(position.capitalAtRisk) : null;
              const expPct = capitalAtRisk !== null && accountValue?.netLiquidationValue ? (capitalAtRisk / accountValue.netLiquidationValue) * 100 : null;
              const pnl = unrealizedPnlByPositionId[position.id]?.unrealizedPnl ?? null;
              return (
                <div className="pos-row" key={position.id}>
                  <span className="pos-sym">{position.symbol}</span>
                  <span className={`strat-badge ${strategyBadgeModifier[position.strategyKey] ?? "ns"}`} title={strategyTooltip(position.strategyKey)}>
                    {positionStrategyAbbrev(position.strategyKey)}
                  </span>
                  <span className="pos-num">{dte ?? "—"}</span>
                  <FlashingNumber value={capitalAtRisk} className="pos-exp">
                    {formatCompactDollars(capitalAtRisk)}
                  </FlashingNumber>
                  <FlashingNumber value={expPct} precision={1} className="pos-pct">
                    {expPct !== null ? `${expPct.toFixed(1)}%` : "—"}
                  </FlashingNumber>
                  <FlashingNumber value={pnl} className={`pos-pnl ${pnl !== null && pnl < 0 ? "neg" : "pos"}`}>
                    {formatSignedPnl(pnl, 0)}
                  </FlashingNumber>
                </div>
              );
            })}
          </div>
          <div className="panel">
            <div className="panel-title">
              Top Alerts <span className="panel-subtitle">by ann. yield</span>
              <span className="count">
                {topAlerts.length} of {pendingAlerts.length}
              </span>
            </div>
            <div className="yield-head">
              <span>Sym</span>
              <span>Type</span>
              <span>Strike / Exp</span>
              <span style={{ textAlign: "right" }}>Yield</span>
            </div>
            {topAlerts.length === 0 && <div className="panel-empty">No pending alerts.</div>}
            {topAlerts.map((alert) => (
              <div className="yield-row" key={alert.id}>
                <span className="yield-sym">{alert.symbol}</span>
                <span className={`strat-badge ${alert.strategyKey === "covered_call" ? "cc" : "csp"}`}>{strategyAbbrev(alert.strategyKey)}</span>
                <span className="yield-strike">{alertStrikeLabel(alert)}</span>
                <span className="yield-pct">{(alertYield(alert) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        <TopologyMap pulses={pulses} activeEdgeIds={activeEdgeIds}>
          <div className="market-chip grid-market">
            <span className="mk-name">{marketStatus ? marketStatus.exchanges.join(" · ") : "—"}</span>
            <span className={`mk-status ${marketStatusStyle(marketStatus?.state).textClass}`}>
              <span className={`led ${marketStatusStyle(marketStatus?.state).ledClass}`} />
              {marketStatusStyle(marketStatus?.state).badgeLabel}
            </span>
            <span className="mk-close">{marketStatus?.label ?? "—"}</span>
          </div>

          <div className="node grid-db" data-node-id="db">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7}>
                  <ellipse cx="12" cy="5.5" rx="8" ry="3" />
                  <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
                  <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
                </svg>
              </div>
              <div>
                <div className="node-title">Database</div>
                <div className="node-sub">Postgres · Essential-1</div>
              </div>
            </div>
            <div className="sub-row">
              <span className="sub-name">Connections</span>
              <FlashingNumber value={dbHealth ? Number(dbHealth.totalConnections) : null} className="sub-value">
                {dbHealth ? (
                  <>
                    <span className={`sub-value ${higherIsWorseStatus((Number(dbHealth.totalConnections) / dbHealth.maxConnections) * 100, ...CONNECTIONS_USED_PERCENT_BANDS)}`}>
                      {dbHealth.totalConnections}
                    </span>{" "}
                    / {dbHealth.maxConnections}
                  </>
                ) : (
                  "—"
                )}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">DB size</span>
              <FlashingNumber value={dbHealth ? Number(dbHealth.databaseSizeBytes) : null} className="sub-value">
                {dbHealth ? (
                  <>
                    {formatBytes(dbHealth.databaseSizeBytes)} (
                    <span className={`sub-value ${higherIsWorseStatus(databaseSizeUsedPercent, ...DB_SIZE_USED_PERCENT_BANDS)}`}>{formatPercentageValue(databaseSizeUsedPercent, 2)}</span> used)
                  </>
                ) : (
                  "—"
                )}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Response time (ms)</span>
              <span className="sub-value">
                {dbHealth ? (
                  <>
                    max{" "}
                    <span className={`sub-value ${higherIsWorseStatus(dbHealth.responseTime.slowestMs, ...DB_SLOWEST_RESPONSE_MS_BANDS)}`}>
                      {formatNumber(dbHealth.responseTime.slowestMs, (dbHealth.responseTime.slowestMs ?? 0) < 10 ? 1 : 0)}
                    </span>{" "}
                    | avg{" "}
                    <span className={`sub-value ${higherIsWorseStatus(dbHealth.responseTime.averageMs, ...DB_AVERAGE_RESPONSE_MS_BANDS)}`}>
                      {formatNumber(dbHealth.responseTime.averageMs, (dbHealth.responseTime.averageMs ?? 0) < 10 ? 1 : 0)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>

          <div className="node grid-genosuke" data-node-id="genosuke">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7}>
                  <path d="M4 5h14v9H9l-4 3.5z" />
                  <path d="M17.5 3.5l0.55 1.3 1.3 0.55-1.3 0.55-0.55 1.3-0.55-1.3-1.3-0.55 1.3-0.55z" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div>
                <div className="node-title">Genosuke</div>
                <div className="node-sub">Chat orchestrator</div>
              </div>
            </div>
            <div className="sub-row">
              <span className="sub-name">Messages today</span>
              <FlashingNumber value={genosukeHealth ? Number(genosukeHealth.messagesToday) : null} className="sub-value">
                {genosukeHealth?.messagesToday ?? "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Chat sessions</span>
              <FlashingNumber value={genosukeHealth ? Number(genosukeHealth.activeSessions) : null} className="sub-value ok">
                {genosukeHealth ? `${genosukeHealth.activeSessions} active` : "—"}
              </FlashingNumber>
            </div>
            <div className={`tg-tag${telegramFlash ? " flash" : ""}`}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6}>
                <path d="M21 4L3 11.5l6 2.2M21 4l-3.2 16-7.8-6.3M21 4L9.8 13.7" />
              </svg>
              outbound → Telegram
            </div>
          </div>

          <div className="node grid-llm" data-node-id="llm">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6}>
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                </svg>
              </div>
              <div>
                <div className="node-title">LLM</div>
                <div className="node-sub">OpenRouter</div>
              </div>
            </div>
            <div className="sub-row">
              <span className="sub-name">Model</span>
              <span className="sub-value" style={{ fontSize: "0.58rem" }}>
                {genosukeHealth?.llm.model ?? "—"}
              </span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Calls</span>
              <FlashingNumber value={genosukeHealth?.llm.callsPerMinute ?? null} className="sub-value">
                {genosukeHealth ? `${genosukeHealth.llm.callsPerMinute} / min` : "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Avg latency</span>
              <FlashingNumber value={genosukeHealth?.llm.avgLatencyMs ?? null} className="sub-value">
                {genosukeHealth?.llm.avgLatencyMs ? `${(genosukeHealth.llm.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
              </FlashingNumber>
            </div>
          </div>

          <div className="charts-row">
            <div className="chart-panel">
              <div className="chart-panel-title">
                <span>Unrealised P&amp;L</span>
                <span
                  className="cur-val"
                  style={{
                    color: pnlSeries.length === 0 ? undefined : (pnlSeries.at(-1) ?? 0) >= 0 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {formatSignedPnl(pnlSeries.at(-1) ?? null, 0)}
                </span>
              </div>
              <div className="chart-svg-wrap">
                <TotalPnlChart series={pnlSeries} timestamps={pnlTimestamps} formatValue={(value) => formatSignedPnl(value, 0)} />
              </div>
            </div>
            <div className="chart-panel">
              <div className="chart-panel-title">
                <span>Profit Probability · live</span>
                <span className="cur-val">threshold {PROFIT_PROBABILITY_THRESHOLD.toFixed(2)}</span>
              </div>
              <ProfitProbabilityChart seriesByPosition={probabilitySeriesForChart} probabilityThreshold={PROFIT_PROBABILITY_THRESHOLD} timestamps={pnlTimestamps} />
            </div>
          </div>

          <div className="node grid-ibkr" data-node-id="ibkr">
            <div className="node-header">
              <div className="node-icon ibkr-mark">
                <span>IB</span>
              </div>
              <div>
                <div className="node-title">IBKR</div>
                <div className="node-sub">Interactive Brokers</div>
              </div>
            </div>
            <div className="sub-row">
              <span className="sub-name">Total equity</span>
              <FlashingNumber value={positions.length > 0 ? totalStockValue : null} className="sub-value">
                {positions.length > 0 ? formatCompactDollars(totalStockValue) : "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Total cash</span>
              <FlashingNumber value={availableCash?.totalCashValue ?? null} className="sub-value">
                {availableCash?.totalCashValue ? formatCompactDollars(availableCash.totalCashValue) : "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Reserved cash</span>
              <FlashingNumber value={availableCash?.cashLockedInCsps ?? null} className="sub-value">
                {availableCash?.cashLockedInCsps ? formatCompactDollars(availableCash.cashLockedInCsps) : "—"}
              </FlashingNumber>
            </div>
          </div>

          <div className="node grid-gateway" data-node-id="gateway">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7}>
                  <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
                  <path d="M8.2 13.6a5.3 5.3 0 0 1 7.6 0" />
                  <path d="M5.3 10.5a9.5 9.5 0 0 1 13.4 0" />
                </svg>
              </div>
              <div>
                <div className="node-title">Gateway</div>
                <div className="node-sub">ibkrGatewayWorker · VPS</div>
              </div>
            </div>
            {gatewayHealth?.staleOrMissing ? (
              <div className="sub-row">
                <span className="sub-name">Status</span>
                <span className="sub-value err">not connected</span>
              </div>
            ) : (
              <>
                <div className="sub-row">
                  <span className="sub-name">In flight</span>
                  <span>
                    <FlashingNumber value={gatewayHealth?.inFlightOrderCount ?? null} className={`sub-value ${higherIsWorseStatus(gatewayHealth?.inFlightOrderCount, ...GATEWAY_IN_FLIGHT_BANDS)}`}>
                      {gatewayHealth ? gatewayHealth.inFlightOrderCount : "—"}
                    </FlashingNumber>
                    {gatewayHealth && <span className="sub-unit"> orders</span>}
                  </span>
                </div>
                <div className="sub-row">
                  <span className="sub-name">Uptime</span>
                  <span className={`sub-value ${gatewayHealth?.uptimeMs == null ? "" : gatewayHealth.uptimeMs >= GATEWAY_HEALTHY_UPTIME_MS ? "ok" : "warn"}`}>
                    {formatDurationShort(gatewayHealth?.uptimeMs)}
                  </span>
                </div>
                <div className="sub-row">
                  <span className="sub-name">Reconnects</span>
                  <FlashingNumber value={gatewayHealth?.totalReconnects ?? null} className={`sub-value ${higherIsWorseStatus(gatewayHealth?.totalReconnects, ...GATEWAY_RECONNECT_BANDS)}`}>
                    {gatewayHealth?.totalReconnects ?? "—"}
                  </FlashingNumber>
                </div>
              </>
            )}
          </div>

          <div className="node grid-heroku" data-node-id="heroku">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7}>
                  <rect x="5" y="5" width="14" height="4.6" rx="1.3" />
                  <rect x="5" y="14.4" width="14" height="4.6" rx="1.3" />
                </svg>
              </div>
              <div>
                <div className="node-title">Heroku</div>
                <div className="node-sub">Web dyno · Eco</div>
              </div>
            </div>
            <div className="sub-row">
              <span className="sub-name">Requests</span>
              <FlashingNumber value={webDynoHealth?.requestsPerMinute ?? null} className="sub-value">
                {webDynoHealth ? `${webDynoHealth.requestsPerMinute} / min` : "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Connections</span>
              <FlashingNumber value={webDynoHealth?.notificationStreamConnections ?? null} className="sub-value ok">
                {webDynoHealth?.notificationStreamConnections ?? "—"}
              </FlashingNumber>
            </div>
            <div className="sub-row">
              <span className="sub-name">Uptime</span>
              <span className="sub-value">{webDynoHealth ? formatDurationShort(webDynoHealth.uptimeSeconds * 1000) : "—"}</span>
            </div>
          </div>

          <div className="node grid-frontend" data-node-id="frontend">
            <div className="node-header">
              <div className="node-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7}>
                  <rect x="3" y="4" width="18" height="14" rx="2" />
                  <path d="M3 8h18" />
                  <circle cx="6" cy="6" r="0.55" fill="currentColor" stroke="none" />
                  <circle cx="8.4" cy="6" r="0.55" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div>
                <div className="node-title">Front End</div>
                <div className="node-sub">Active sessions</div>
              </div>
            </div>
            <div className="avatar-row">
              {presenceUsers.length === 0 && <span className="avatar-name">No users</span>}
              {presenceUsers.map((user) => (
                <div className={`avatar-item${user.online ? "" : " avatar-item-offline"}`} key={user.id}>
                  <div className="avatar-circle" style={{ background: "#7DD3FC" }}>
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="avatar-name">{user.displayName}</span>
                  {user.online ? (
                    <span className="avatar-status">
                      <span className="led" />
                      online
                    </span>
                  ) : (
                    <span className="avatar-status offline" title={user.lastSeenAt ? formatDateTime(user.lastSeenAt) : undefined}>
                      {formatRelativeDate(user.lastSeenAt)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </TopologyMap>

        <div className="rail">
          <div className="panel">
            <div className="panel-title">Trades</div>
            {trades.length === 0 && <div className="panel-empty">No recent trades.</div>}
            {trades.map((trade) => (
              <div className="fill-row" key={trade.id}>
                <span className="fill-time">{new Date(trade.executedAt).toLocaleTimeString("en-US", { hour12: false })}</span>
                <span className="fill-desc">
                  <b>
                    {trade.side.toUpperCase()} {trade.quantity}
                  </b>{" "}
                  {trade.symbol}
                  {trade.strikePrice ? ` ${formatNumber(trade.strikePrice, 2)}${trade.optionType === "call" ? "C" : "P"}` : ""}
                  {trade.expiryDate ? ` ${daysToExpiry(trade.expiryDate, trade.executedAt)}DTE` : ""} @ {formatNumber(trade.price, 2)}
                </span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-title">Latest Events</div>
            <div className="events-list">
              {events.length === 0 && <div className="panel-empty">No events yet.</div>}
              {events.map((event) => (
                <EventRow key={event.id} time={event.time} text={event.text} color={event.color} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
