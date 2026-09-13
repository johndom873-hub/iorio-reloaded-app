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
import { fetchAccountValue, fetchDashboardSummary, fetchAvailableCash, type AccountValue, type AvailableCash, type DashboardSummary } from "../api/dashboard";
import { fetchExposure, fetchStrategySettings, type ExposureData, type StrategySettings } from "../api/riskLimits";
import { fetchPositions, openUnrealizedPnlStream, openGreeksStream, fetchOrder, type Position, type UnrealizedPnlResult, type Greeks } from "../api/positions";
import { fetchTradeAlerts, isRollAlert, type NewTradeCandidate, type TradeAlert } from "../api/tradeAlerts";
import { fetchTradeBlotter, type Trade } from "../api/tradeBlotter";
import { openNotificationStream, type AppNotification } from "../api/notifications";
import {
  fetchPresence,
  fetchDbHealth,
  fetchGenosukeHealth,
  fetchWebDynoHealth,
  fetchGatewayHealth,
  type PresenceUser,
  type DbHealth,
  type GenosukeHealth,
  type WebDynoHealth,
  type GatewayHealth,
} from "../api/systemHealth";
import { daysToExpiry, todayInEasternIso, formatSignedPnl, formatSignedPercentageValue, formatCompactDollars, formatDate } from "../lib/formatters";
import { positionExpiryDate } from "../lib/positionPnl";
import { TopologyMap, type PulseEvent } from "../components/pulse/TopologyMap";
import { TotalPnlChart } from "../components/pulse/TotalPnlChart";
import { PositionDeltasChart, type DeltaSeries } from "../components/pulse/PositionDeltasChart";

const CHART_SAMPLE_INTERVAL_MS = 75_000;
const CHART_MAX_SAMPLES = 40;
const HEALTH_POLL_INTERVAL_MS = 30_000;

function strategyAbbrev(strategyKey: string): "CC" | "CSP" {
  return strategyKey === "covered_call" ? "CC" : "CSP";
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
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Fixed 9:30-16:00 America/New_York assumption — no intraday market-hours
// data exists anywhere in the app (market_calendar is day-granular only),
// so this is a deliberately approximate decorative chip, wrong on
// early-close days (approved tradeoff, 2026-09-13).
function useMarketStatus() {
  const [status, setStatus] = useState({ open: false, label: "closed" });
  useEffect(() => {
    function compute() {
      const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = nowEastern.getDay();
      const minutesSinceMidnight = nowEastern.getHours() * 60 + nowEastern.getMinutes();
      const isWeekday = day >= 1 && day <= 5;
      const open = isWeekday && minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
      if (!open) {
        setStatus({ open: false, label: "closed" });
        return;
      }
      const minutesToClose = 16 * 60 - minutesSinceMidnight;
      const hours = Math.floor(minutesToClose / 60);
      const minutes = minutesToClose % 60;
      setStatus({ open: true, label: hours > 0 ? `closes in ${hours}h ${minutes}m` : `closes in ${minutes}m` });
    }
    compute();
    const interval = window.setInterval(compute, 60_000);
    return () => window.clearInterval(interval);
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
  const [isNew, setIsNew] = useState(true);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsNew(false));
    });
    return () => cancelAnimationFrame(raf1);
  }, []);
  return (
    <div className={`event-row${isNew ? " event-new" : ""}`}>
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
  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [strategySettings, setStrategySettings] = useState<StrategySettings[]>([]);

  useEffect(() => {
    fetchAccountValue().then(setAccountValue).catch(() => {});
    fetchDashboardSummary().then(setSummary).catch(() => {});
    fetchAvailableCash().then(setAvailableCash).catch(() => {});
    fetchExposure().then(setExposure).catch(() => {});
    fetchStrategySettings().then(setStrategySettings).catch(() => {});
  }, []);

  // Today's P&L (KPI) and the Total P&L chart are intentionally different
  // numbers: this is day-over-day snapshot delta, the chart is a live
  // mark-to-market sum of currently-open positions since each one's own
  // entry. Don't "fix" them to agree.
  const todaysPnl = summary?.periods.day !== null && summary?.periods.day !== undefined ? Number(summary.periods.day) : null;

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

  // --- Top Alerts by yield ---
  const [pendingAlerts, setPendingAlerts] = useState<TradeAlert[]>([]);
  useEffect(() => {
    fetchTradeAlerts({ status: "pending", sort: "yield" }).then(setPendingAlerts).catch(() => {});
  }, []);
  const topAlerts = pendingAlerts.slice(0, 5);

  // --- Trades ---
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    fetchTradeBlotter({}).then((data) => setTrades(data.trades.slice(0, 6))).catch(() => {});
  }, []);

  // --- System health (30s poll) ---
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [genosukeHealth, setGenosukeHealth] = useState<GenosukeHealth | null>(null);
  const [webDynoHealth, setWebDynoHealth] = useState<WebDynoHealth | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

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
          setOnlineUsers(presence.online);
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
    const durationMs = opts?.durationMs ?? 1100;
    setPulses((prev) => [...prev, { key, edgeId, color, reverse: opts?.reverse, durationMs }]);
    window.setTimeout(() => setPulses((prev) => prev.filter((pulse) => pulse.key !== key)), durationMs + 150);
  }, []);

  const appendEvent = useCallback((text: string, color: string) => {
    eventIdRef.current += 1;
    setEvents((prev) => [{ id: eventIdRef.current, time: new Date().toLocaleTimeString("en-US", { hour12: false }), text, color }, ...prev].slice(0, 17));
  }, []);

  useEffect(() => {
    return openNotificationStream((notification: AppNotification) => {
      switch (notification.type) {
        case "job_completed": {
          const color = notification.status === "success" ? "var(--accent-glow)" : "var(--danger)";
          firePulse("heroku-gateway", color);
          appendEvent(`Job ${notification.status === "success" ? "done" : "failed"} — ${notification.jobName}`, color);
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
              appendEvent(`Order ${order.status.replace(/_/g, " ")} — ${order.payload.symbol}`, "var(--success)");
              if (order.status === "filled" || order.status === "partially_filled") {
                fetchTradeBlotter({}).then((data) => setTrades(data.trades.slice(0, 6))).catch(() => {});
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
        case "presence": {
          fetchPresence().then((result) => setOnlineUsers(result.online)).catch(() => {});
          break;
        }
      }
    });
  }, [appendEvent, firePulse, loadPositions]);

  const activeEdgeIds = useMemo(() => new Set(pulses.map((pulse) => pulse.edgeId)), [pulses]);

  // --- Charts: live client-side rolling sample of the already-open SSE
  // streams above — no persisted intraday history exists on the backend
  // (approved tradeoff, 2026-09-13). Starts empty and fills in as the tab
  // stays open. ---
  const [pnlSeries, setPnlSeries] = useState<number[]>([]);
  // Keyed by position id, not symbol — a rolled position can leave two
  // distinct open positions sharing one ticker (confirmed in dev data: two
  // separate SPCX positions), which would otherwise collide.
  const [deltaSeriesByPositionId, setDeltaSeriesByPositionId] = useState<Record<string, number[]>>({});
  const latestDataRef = useRef({ unrealizedPnlByPositionId, greeksByLegId, positions });
  useEffect(() => {
    latestDataRef.current = { unrealizedPnlByPositionId, greeksByLegId, positions };
  }, [unrealizedPnlByPositionId, greeksByLegId, positions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const { unrealizedPnlByPositionId: pnlMap, greeksByLegId: greeksMap, positions: posList } = latestDataRef.current;
      const totalPnl = Object.values(pnlMap).reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0);
      setPnlSeries((prev) => [...prev, totalPnl].slice(-CHART_MAX_SAMPLES));

      setDeltaSeriesByPositionId((prev) => {
        const next = { ...prev };
        for (const position of posList) {
          const optionLeg = position.legs.find((leg) => leg.legType === "option");
          if (!optionLeg) continue;
          const delta = greeksMap[optionLeg.id]?.delta;
          if (delta === null || delta === undefined) continue;
          next[position.id] = [...(next[position.id] ?? []), Math.abs(delta)].slice(-CHART_MAX_SAMPLES);
        }
        return next;
      });
    }, CHART_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const deltaLimit = strategySettings.length > 0 ? Math.max(...strategySettings.map((row) => Number(row.deltaTargetMax))) : 0.3;
  const deltaSeriesForChart: DeltaSeries[] = positions
    .filter((position) => (deltaSeriesByPositionId[position.id]?.length ?? 0) >= 2)
    .map((position, index, arr) => ({
      id: position.id,
      symbol: position.symbol,
      color: colorForIndex(index, arr.length),
      values: deltaSeriesByPositionId[position.id]!,
    }));

  return (
    <div className="iorio-pulse-page">
      <div className="pulse-header">
        <div className="pulse-header-left">
          <span className="brand-title">
            IORIO PULSE<span className="dot">.</span>
          </span>
          <span className="brand-eyebrow">REALTIME SYSTEM MONITORING</span>
        </div>
        <div className="pulse-header-right">
          <div className="status-pill">
            <span className="led" />
            ALL SYSTEMS NOMINAL
          </div>
          <div className="clock">{clock}</div>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-tile">
          <span className="kpi-label">Account Value</span>
          <div className="kpi-value-row">
            <span className="kpi-value">{formatSignedPnl(accountValue?.netLiquidationValue ?? null, 0).replace("+", "")}</span>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Available Cash</span>
          <div className="kpi-value-row">
            <span className="kpi-value">{formatSignedPnl(availableCash?.availableCashToTrade ?? null, 0).replace("+", "")}</span>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Today&apos;s P&amp;L</span>
          <div className="kpi-value-row">
            <span className="kpi-value" style={{ color: todaysPnl === null ? undefined : todaysPnl >= 0 ? "var(--success)" : "var(--danger)" }}>
              {formatSignedPnl(todaysPnl, 0)}
            </span>
            <span className={`kpi-delta ${summary?.dayPnlPercent && summary.dayPnlPercent >= 0 ? "up" : "down"}`}>
              {formatSignedPercentageValue(summary?.dayPnlPercent ?? null, 2)}
            </span>
          </div>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Allocation</span>
          <div className="alloc-bar">
            <span className="alloc-seg" style={{ width: `${ccPct}%`, background: "var(--accent)" }} data-label={`Covered Calls — ${ccPct.toFixed(0)}%`} />
            <span className="alloc-seg" style={{ width: `${cspPct}%`, background: "var(--warning)" }} data-label={`Cash-Secured Puts — ${cspPct.toFixed(0)}%`} />
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
                  {position.strategyKey === "unstructured" ? (
                    <span className="strat-badge" style={{ background: "rgba(169,183,204,0.14)", color: "var(--text-secondary)" }}>
                      ?
                    </span>
                  ) : (
                    <span className={`strat-badge ${position.strategyKey === "covered_call" ? "cc" : "csp"}`}>{strategyAbbrev(position.strategyKey)}</span>
                  )}
                  <span className="pos-num">{dte ?? "—"}</span>
                  <span className="pos-exp">{formatCompactDollars(capitalAtRisk)}</span>
                  <span className="pos-pct">{expPct !== null ? `${expPct.toFixed(1)}%` : "—"}</span>
                  <span className={`pos-pnl ${pnl !== null && pnl < 0 ? "neg" : "pos"}`}>{formatSignedPnl(pnl, 0)}</span>
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
            <span className="mk-name">NASDAQ · NYSE</span>
            <span className="mk-status">
              <span className={`led${marketStatus.open ? "" : " led-off"}`} />
              {marketStatus.open ? "OPEN" : "CLOSED"}
            </span>
            <span className="mk-close">{marketStatus.label}</span>
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
              <span className="sub-value">{dbHealth ? `${dbHealth.activeConnections} / ${dbHealth.maxConnections}` : "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Open positions</span>
              <span className="sub-value">{dbHealth?.openPositionCount ?? "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">DB size</span>
              <span className="sub-value">{formatBytes(dbHealth?.databaseSizeBytes)}</span>
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
              <span className="sub-value">{genosukeHealth?.messagesToday ?? "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Chat sessions</span>
              <span className="sub-value ok">{genosukeHealth ? `${genosukeHealth.activeSessions} active` : "—"}</span>
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
              <span className="sub-value">{genosukeHealth ? `${genosukeHealth.llm.callsPerMinute} / min` : "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Avg latency</span>
              <span className="sub-value">{genosukeHealth?.llm.avgLatencyMs ? `${(genosukeHealth.llm.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</span>
            </div>
          </div>

          <div className="charts-row">
            <div className="chart-panel">
              <div className="chart-panel-title">
                <span>Total P&amp;L · live</span>
                <span className="cur-val">{formatSignedPnl(pnlSeries.at(-1) ?? null, 0)}</span>
              </div>
              <div className="chart-svg-wrap">
                <TotalPnlChart series={pnlSeries} />
              </div>
            </div>
            <div className="chart-panel">
              <div className="chart-panel-title">
                <span>Position Deltas · live</span>
                <span className="cur-val">limit {deltaLimit.toFixed(2)}</span>
              </div>
              <PositionDeltasChart seriesByPosition={deltaSeriesForChart} deltaLimit={deltaLimit} />
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
              <span className="sub-name">Buying power</span>
              <span className="sub-value">{formatSignedPnl(exposure?.account?.netLiquidationValue ?? null, 0).replace("+", "")}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Margin excess</span>
              <span className="sub-value ok">{exposure?.account?.excessLiquidity ? formatCompactDollars(exposure.account.excessLiquidity) : "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Cash</span>
              <span className="sub-value">{availableCash?.totalCashValue ? formatCompactDollars(availableCash.totalCashValue) : "—"}</span>
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
                  <span className="sub-value warn">{gatewayHealth ? `${gatewayHealth.inFlightOrderCount} orders` : "—"}</span>
                </div>
                <div className="sub-row">
                  <span className="sub-name">Reconnects</span>
                  <span className="sub-value">{gatewayHealth?.totalReconnects ?? "—"} lifetime</span>
                </div>
                <div className="sub-row">
                  <span className="sub-name">Uptime</span>
                  <span className="sub-value">{formatDurationShort(gatewayHealth?.uptimeMs)}</span>
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
              <span className="sub-value">{webDynoHealth ? `${webDynoHealth.requestsPerMinute} / min` : "—"}</span>
            </div>
            <div className="sub-row">
              <span className="sub-name">Connections</span>
              <span className="sub-value ok">{webDynoHealth?.notificationStreamConnections ?? "—"}</span>
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
              {onlineUsers.length === 0 && <span className="avatar-name">No one online</span>}
              {onlineUsers.map((user) => (
                <div className="avatar-item" key={user.id}>
                  <div className="avatar-circle" style={{ background: "#7DD3FC" }}>
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="avatar-name">{user.displayName}</span>
                  <span className="avatar-status">
                    <span className="led" />
                    online
                  </span>
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
                  {trade.strikePrice ? ` ${trade.strikePrice}${trade.optionType === "call" ? "C" : "P"}` : ""}
                  {trade.expiryDate ? ` ${formatDate(trade.expiryDate)}` : ""} @ {trade.price}
                </span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-title">System Events</div>
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
