import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EnvironmentBadges } from "../layout/EnvironmentBadges";
import type { EnvironmentStatus } from "../../hooks/useEnvironmentStatus";
import { formatSignedPnl } from "../../lib/formatters";
import { PulseCollapsiblePanel } from "./PulseCollapsiblePanel";
import { PnlSparkline } from "./PnlSparkline";

// Trades and Latest Events start at this many rows on the phone; "Show N
// more" reveals the rest of what the page already fetched.
const FEED_ROWS_BEFORE_SHOW_MORE = 8;

export interface PhoneSystemLed {
  nodeId: string;
  label: string;
  /** "" (green), "led-amber", "led-warn" or "led-off" — the same modifiers the desktop LEDs use. */
  ledClass: string;
}

export interface PulsePhoneLayoutProps {
  clock: string;
  environmentStatus: EnvironmentStatus;
  attentionPill: ReactNode;
  marketLine: ReactNode;
  kpiTiles: ReactNode;
  allocation: { ccPct: number; cspPct: number; unstructuredPct: number; cashPct: number };
  charts: { pnlSeries: number[]; pnlChart: ReactNode; deltaChart: ReactNode };
  positions: { count: number; totalPnl: number | null; exposurePercent: number | null; head: ReactNode; rows: ReactNode; empty: ReactNode };
  signals: { shownCount: number; scoredCount: number; bestRow: ReactNode; head: ReactNode; rows: ReactNode; empty: ReactNode };
  trades: { latestSummary: ReactNode; rows: ReactNode[]; empty: ReactNode };
  events: { latestTime: string | null; rows: ReactNode[]; empty: ReactNode };
  systems: { leds: PhoneSystemLed[]; activeNodeIds: Set<string>; cards: ReactNode };
}

function AllocationLegendItem({ color, label, percent }: { color: string; label: string; percent: number }) {
  return (
    <span>
      <span className="phone-alloc-swatch" style={{ background: color }} />
      {label} {percent.toFixed(0)}%
    </span>
  );
}

/**
 * The approved phone layout for Pulse (mockup 2026-09-28): pinned two-row
 * header, 2×2 KPI grid with a slim allocation bar, then one collapsible
 * panel per desktop panel in the order Charts, Positions, Top Signals,
 * Trades, Latest Events, Systems. PulsePage owns every number and row;
 * this component only arranges them.
 */
export function PulsePhoneLayout({
  clock,
  environmentStatus,
  attentionPill,
  marketLine,
  kpiTiles,
  allocation,
  charts,
  positions,
  signals,
  trades,
  events,
  systems,
}: PulsePhoneLayoutProps) {
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const visibleTrades = showAllTrades ? trades.rows : trades.rows.slice(0, FEED_ROWS_BEFORE_SHOW_MORE);
  const visibleEvents = showAllEvents ? events.rows : events.rows.slice(0, FEED_ROWS_BEFORE_SHOW_MORE);
  const hiddenTradeCount = trades.rows.length - visibleTrades.length;
  const hiddenEventCount = events.rows.length - visibleEvents.length;
  const currentPnl = charts.pnlSeries.at(-1) ?? null;

  return (
    <>
      <header className="phone-header">
        <div className="phone-header-row1">
          <Link to="/" className="phone-brand" aria-label="Back to the app">
            <img className="brand-logo" src="/brand/iorio-icon.svg" alt="" />
            <span className="brand-title">
              IORIO Pulse<span className="dot">.</span>
            </span>
          </Link>
          <div className="phone-header-right">
            {attentionPill}
            <div className="clock">{clock}</div>
          </div>
        </div>
        <div className="phone-header-row2">
          <EnvironmentBadges status={environmentStatus} />
          {marketLine}
        </div>
      </header>

      <div className="phone-kpis">{kpiTiles}</div>

      <div className="kpi-tile phone-alloc">
        <div className="phone-alloc-head">
          <span className="kpi-label">Allocation</span>
          <span className="phone-alloc-legend">
            <AllocationLegendItem color="var(--tblr-blue)" label="CC" percent={allocation.ccPct} />
            <AllocationLegendItem color="var(--tblr-purple)" label="CSP" percent={allocation.cspPct} />
            <AllocationLegendItem color="var(--tblr-orange)" label="N/S" percent={allocation.unstructuredPct} />
            <AllocationLegendItem color="var(--border-strong)" label="Cash" percent={allocation.cashPct} />
          </span>
        </div>
        <div className="alloc-bar">
          <span className="alloc-seg" style={{ width: `${allocation.ccPct}%`, background: "var(--tblr-blue)" }} />
          <span className="alloc-seg" style={{ width: `${allocation.cspPct}%`, background: "var(--tblr-purple)" }} />
          <span className="alloc-seg" style={{ width: `${allocation.unstructuredPct}%`, background: "var(--tblr-orange)" }} />
          <span className="alloc-seg" style={{ width: `${allocation.cashPct}%`, background: "var(--border-strong)" }} />
        </div>
      </div>

      <PulseCollapsiblePanel
        storageKey="charts"
        title="Charts"
        defaultOpen={false}
        summary={
          <>
            <PnlSparkline series={charts.pnlSeries} />
            <span className={currentPnl === null ? "" : currentPnl >= 0 ? "up" : "down"} style={{ fontWeight: 600 }}>
              {formatSignedPnl(currentPnl, 0)}
            </span>
          </>
        }
      >
        <div className="phone-charts">
          <div className="phone-chart phone-chart-pnl">{charts.pnlChart}</div>
          <div className="phone-chart phone-chart-delta">{charts.deltaChart}</div>
        </div>
      </PulseCollapsiblePanel>

      <PulseCollapsiblePanel
        storageKey="positions"
        title="Positions"
        count={positions.count}
        defaultOpen
        summary={
          <>
            <span className={positions.totalPnl === null ? "" : positions.totalPnl >= 0 ? "up" : "down"} style={{ fontWeight: 600 }}>
              {formatSignedPnl(positions.totalPnl, 0)}
            </span>
            <span className="muted">·</span>
            <span>{positions.exposurePercent === null ? "—" : `${positions.exposurePercent.toFixed(1)}% exposed`}</span>
          </>
        }
      >
        {positions.head}
        {positions.count === 0 ? positions.empty : positions.rows}
      </PulseCollapsiblePanel>

      <PulseCollapsiblePanel
        storageKey="signals"
        title="Top Signals"
        count={`${signals.shownCount} of ${signals.scoredCount}`}
        defaultOpen={false}
        summary={signals.bestRow}
      >
        {signals.head}
        {signals.shownCount === 0 ? signals.empty : signals.rows}
      </PulseCollapsiblePanel>

      <PulseCollapsiblePanel storageKey="trades" title="Trades" defaultOpen={false} summary={trades.latestSummary}>
        {trades.rows.length === 0 ? trades.empty : visibleTrades}
        {hiddenTradeCount > 0 && (
          <button type="button" className="phone-show-more" onClick={() => setShowAllTrades(true)}>
            Show {hiddenTradeCount} more
          </button>
        )}
      </PulseCollapsiblePanel>

      <PulseCollapsiblePanel
        storageKey="events"
        title="Latest Events"
        defaultOpen
        summary={
          events.latestTime ? (
            <>
              <span className="muted">last</span>
              <span>{events.latestTime}</span>
            </>
          ) : undefined
        }
      >
        {events.rows.length === 0 ? events.empty : visibleEvents}
        {hiddenEventCount > 0 && (
          <button type="button" className="phone-show-more" onClick={() => setShowAllEvents(true)}>
            Show {hiddenEventCount} more
          </button>
        )}
      </PulseCollapsiblePanel>

      <PulseCollapsiblePanel
        storageKey="systems"
        title="Systems"
        defaultOpen={false}
        summary={
          <span className="phone-led-row">
            {systems.leds.map((led) => (
              <span key={led.nodeId} className="phone-led-item">
                <span className={`led ${led.ledClass}${systems.activeNodeIds.has(led.nodeId) ? " led-flash" : ""}`} />
                {led.label}
              </span>
            ))}
          </span>
        }
      >
        <div className="phone-systems">{systems.cards}</div>
      </PulseCollapsiblePanel>
    </>
  );
}
