import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { ClosePositionModal } from "../components/ClosePositionModal";
import { RollPositionModal } from "../components/RollPositionModal";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import {
  fetchGreeks,
  fetchPositions,
  fetchUnrealizedPnl,
  type Greeks,
  type Position,
  type PositionStatus,
  type UnrealizedPnlResult,
} from "../api/positions";
import { fetchTradeAlerts, isRollAlert, type RollStructure, type TradeAlert } from "../api/tradeAlerts";
import { fetchAccountValue } from "../api/dashboard";
import { openNotificationStream } from "../api/notifications";
import type { StrategyKey } from "../api/strategy";
import {
  daysAgo,
  daysToExpiry,
  todayInEasternIso,
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
  formatDateTime,
  formatDaysAgo,
  formatDaysToExpiry,
  formatNumber,
  formatPercentageValue,
  formatSignedPnl,
  pnlTextClass,
} from "../lib/formatters";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import {
  positionExpiryDate,
  positionHasStockLeg,
  positionPnlAsOfDate,
  positionPremiumPnl,
  positionStockPnl,
  positionTotalPnl,
  positionTotalPnlPercent,
  strategyBadgeClass,
  strategyLabel,
} from "../lib/positionPnl";

type RollAlert = TradeAlert & { suggestedStructure: RollStructure };

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

function structureSummary(position: Position): string {
  // An open position can carry closed legs from a past roll (they stay
  // attached to the same position_id for history) — only summarize what's
  // actually still held. A closed position's legs are all closed by
  // definition, so show the full set there.
  const legs = position.status === "open" ? position.legs.filter((leg) => !leg.exitAt) : position.legs;
  return legs
    .map((leg) => {
      const sideLabel = leg.side === "long" ? "Long" : "Short";
      if (leg.legType === "stock") return `${sideLabel} ${leg.quantity} sh`;
      const strike = leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—";
      const rightLabel = leg.optionType === "call" ? "C" : "P";
      return `${sideLabel} ${leg.quantity}x ${strike}${rightLabel}`;
    })
    .join(" / ");
}

export function PositionsPage() {
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [status, setStatus] = useState<PositionStatus>("open");
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  // Last-known (not live) total account value — see fetchAccountValue's own
  // comment for why EXP% doesn't use a live IBKR round trip here.
  const [totalAccountValue, setTotalAccountValue] = useState<number | null>(null);
  const [greeksFetchFailed, setGreeksFetchFailed] = useState(false);
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});
  const [unrealizedPnlFetchFailed, setUnrealizedPnlFetchFailed] = useState(false);
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
  const [closePosition, setClosePosition] = useState<Position | null>(null);
  // Pending roll alerts, keyed by the position they'd roll — drives the
  // Roll button in the actions column. Not tied to the status/strategy
  // filters above: a roll alert only ever exists for an open position, so
  // fetching the full pending set unfiltered is simplest.
  const [rollAlertsByPositionId, setRollAlertsByPositionId] = useState<Record<string, RollAlert>>({});
  const [rollAlert, setRollAlert] = useState<RollAlert | null>(null);

  const loadPositions = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchPositions({ status, strategyKey: strategy === "all" ? undefined : strategy });
      setPositions(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load positions.");
    }
  }, [status, strategy]);

  const loadRollAlerts = useCallback(async () => {
    try {
      const result = await fetchTradeAlerts({ status: "pending" });
      const byPositionId: Record<string, RollAlert> = {};
      for (const alert of result) {
        if (isRollAlert(alert) && alert.relatedPositionId) byPositionId[alert.relatedPositionId] = alert;
      }
      setRollAlertsByPositionId(byPositionId);
    } catch {
      // Non-critical — the Roll button just won't show if this fails.
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPositions(), loadRollAlerts()]).finally(() => setLoading(false));
  }, [loadPositions, loadRollAlerts]);

  // Same race as TickerDetailModal (see its matching comment): a fill flips
  // order_requests.status to "filled" well before reconcilePositionsFromIbkr
  // actually creates the position row, and nothing else here re-fetches once
  // it does. Refetch on the worker's "position_opened" push instead of
  // relying on this page's own poll/mount timing to catch up eventually.
  useEffect(() => {
    return openNotificationStream((notification) => {
      if (notification.type === "position_opened") loadPositions();
    });
  }, [loadPositions]);

  useEffect(() => {
    fetchAccountValue()
      .then((result) => setTotalAccountValue(result.netLiquidationValue))
      .catch(() => setTotalAccountValue(null));
  }, []);

  useEffect(() => {
    const optionLegIds = positions
      .filter((position) => position.status === "open")
      .flatMap((position) => position.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id));
    if (optionLegIds.length === 0) return;
    setGreeksFetchFailed(false);
    fetchGreeks(optionLegIds)
      .then(setGreeksByLegId)
      .catch(() => setGreeksFetchFailed(true));
  }, [positions]);

  useEffect(() => {
    const openPositionIds = positions.filter((position) => position.status === "open").map((position) => position.id);
    if (openPositionIds.length === 0) return;
    setUnrealizedPnlFetchFailed(false);
    fetchUnrealizedPnl(openPositionIds)
      .then(setUnrealizedPnlByPositionId)
      .catch(() => setUnrealizedPnlFetchFailed(true));
  }, [positions]);

  const columns: DataTableColumn<Position>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link px-2 py-1 text-decoration-none fw-bold"
          onClick={() => openTickerDetail({ symbol: row.symbol, focusPositionId: row.id })}
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: "strategy",
      header: "Strategy",
      render: (row) => (
        <span className={`badge ${strategyBadgeClass(row.strategyKey)}`}>{strategyLabel(row.strategyKey)}</span>
      ),
    },
    { key: "structure", header: "Structure", render: (row) => structureSummary(row) },
    {
      key: "pnl",
      header: "P&L $",
      align: "right",
      render: (row) => {
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") {
          if (unrealizedPnlFetchFailed) {
            return (
              <span className="text-muted" title="Failed to load live P&L data">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading P&L" />;
        }
        if (pnl === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <span className={pnlTextClass(pnl)} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {formatSignedPnl(pnl)}
          </span>
        );
      },
    },
    {
      key: "pnlPercent",
      header: "P&L %",
      align: "right",
      render: (row) => {
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") {
          if (unrealizedPnlFetchFailed) {
            return (
              <span className="text-muted" title="Failed to load live P&L data">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading P&L" />;
        }
        const pct = positionTotalPnlPercent(row, pnl);
        if (pct === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <span className={pnlTextClass(pct)} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {pct > 0 ? "+" : ""}
            {formatPercentageValue(pct, 2)}
          </span>
        );
      },
    },
    {
      key: "premiumPnl",
      header: "Premium P&L",
      headerTitle: "Premium collected vs. current buy-back cost of the option contract(s) — isolated from any stock price movement",
      align: "right",
      render: (row) => {
        const pnl = positionPremiumPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") return <Spinner size="sm" label="Loading premium P&L" />;
        if (pnl === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        return <span className={pnlTextClass(pnl)}>{formatSignedPnl(pnl)}</span>;
      },
    },
    {
      key: "stockPnl",
      header: "Stock P&L",
      headerTitle: "Stock price movement vs. entry — positions with a stock leg only (covered calls, and unstructured stock-only positions); a cash-secured put never has one",
      align: "right",
      render: (row) => {
        if (!positionHasStockLeg(row)) return <span className="text-muted">—</span>;
        const pnl = positionStockPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") return <Spinner size="sm" label="Loading stock P&L" />;
        if (pnl === null)
          return (
            <span className="text-muted" title="No live price or recent snapshot available for this position">
              —
            </span>
          );
        return <span className={pnlTextClass(pnl)}>{formatSignedPnl(pnl)}</span>;
      },
    },
    {
      key: "exposureDollars",
      header: "EXP $",
      headerTitle: "Capital committed to this position — stock cost for covered calls, strike collateral for cash-secured puts",
      align: "right",
      render: (row) => (row.capitalAtRisk === null ? "—" : formatCurrency(Number(row.capitalAtRisk), 0)),
    },
    {
      key: "exposurePercent",
      header: "EXP %",
      headerTitle: "This position's capital as a share of total account value (positions + cash)",
      align: "right",
      render: (row) => {
        if (row.capitalAtRisk === null || totalAccountValue === null) return "—";
        return formatPercentageValue((Number(row.capitalAtRisk) / totalAccountValue) * 100, 1);
      },
    },
    {
      key: "marketValue",
      header: "MV",
      headerTitle: "Market value — capital committed to this position plus its unrealized P&L",
      align: "right",
      render: (row) => {
        if (row.capitalAtRisk === null) return "—";
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") {
          if (unrealizedPnlFetchFailed) {
            return (
              <span className="text-muted" title="Failed to load live P&L data">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading market value" />;
        }
        if (pnl === null) return "—";
        return formatCurrency(Number(row.capitalAtRisk) + pnl, 0);
      },
    },
    {
      key: "openedAt",
      header: "Opened",
      render: (row) => <span title={formatDateTime(row.openedAt)}>{formatDaysAgo(daysAgo(row.openedAt))}</span>,
    },
    {
      key: "expiry",
      header: "Expiry",
      render: (row) => {
        const expiryDate = positionExpiryDate(row);
        if (!expiryDate) return "—";
        return <span title={formatDate(expiryDate)}>{formatDaysToExpiry(daysToExpiry(expiryDate, todayInEasternIso()))}</span>;
      },
    },
    {
      key: "delta",
      header: "Delta",
      align: "right",
      render: (row) => {
        const optionLeg = row.legs.find((leg) => leg.legType === "option");
        if (!optionLeg) return "—";
        // Closed positions never get greeks back from the API (the /greeks
        // endpoint only looks up open positions — a closed leg has no live
        // market data to show), so don't show a spinner that will never resolve.
        if (row.status === "closed") return "—";
        const greeks = greeksByLegId[optionLeg.id];
        if (!greeks) {
          if (greeksFetchFailed) {
            return (
              <span className="text-muted" title="Failed to load delta">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading delta" />;
        }
        if (greeks.delta === null) return <span className="text-muted">—</span>;
        return <span title={greeks.asOfDate ? `As of ${formatDate(greeks.asOfDate)} close` : undefined}>{formatNumber(greeks.delta, 2)}</span>;
      },
    },
    {
      key: "gamma",
      header: "Gamma",
      headerTitle: "Rate of change of delta per $1 move in the underlying — higher gamma means delta (and assignment risk) can shift faster",
      align: "right",
      render: (row) => {
        const optionLeg = row.legs.find((leg) => leg.legType === "option");
        if (!optionLeg) return "—";
        if (row.status === "closed") return "—";
        const greeks = greeksByLegId[optionLeg.id];
        if (!greeks) {
          if (greeksFetchFailed) {
            return (
              <span className="text-muted" title="Failed to load gamma">
                —
              </span>
            );
          }
          return <Spinner size="sm" label="Loading gamma" />;
        }
        if (greeks.gamma === null) return <span className="text-muted">—</span>;
        return <span title={greeks.asOfDate ? `As of ${formatDate(greeks.asOfDate)} close` : undefined}>{formatNumber(greeks.gamma, 3)}</span>;
      },
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link px-2 py-1 text-decoration-none text-body text-start"
          onClick={() => openTickerDetail({ symbol: row.symbol, focusPositionId: row.id })}
        >
          {row.notes ?? "—"}
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => {
        if (row.status !== "open") return null;
        const openLegs = row.legs.filter((leg) => !leg.exitAt);
        const openOptionLeg = openLegs.find((leg) => leg.legType === "option");
        const openStockLeg = openLegs.find((leg) => leg.legType === "stock");

        // Unstructured positions can carry any leg mix (bare stock, a naked
        // call, mismatched stock+call ratios) — ClosePositionModal handles
        // that shape with a per-leg quantity form, so Close is offered
        // whenever there's anything open at all, alongside Sell Call (which
        // is a separate action: opening a new covered call against shares
        // you're already holding, e.g. after a call expired worthless or a
        // CSP got assigned — Juan's domain notes describe both the same way,
        // so one button covers either cause).
        if (row.strategyKey === "unstructured") {
          if (openLegs.length === 0) return null;
          return (
            <div className="d-flex gap-1 justify-content-end">
              {openStockLeg && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-warning"
                  onClick={() => openTickerDetail({ symbol: row.symbol, focusPositionId: row.id })}
                >
                  Sell Call
                </button>
              )}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setClosePosition(row)}>
                Close
              </button>
            </div>
          );
        }

        if (openOptionLeg) {
          const alert = rollAlertsByPositionId[row.id];
          return (
            <div className="d-flex gap-1 justify-content-end">
              {alert && (
                <button
                  type="button"
                  className="btn btn-sm btn-warning"
                  title={alert.rationale ?? "Roll alert pending for this position"}
                  onClick={() => setRollAlert(alert)}
                >
                  Roll
                </button>
              )}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setClosePosition(row)}>
                Close
              </button>
            </div>
          );
        }
        return null;
      },
    },
  ];

  return (
    <>
      <PageHeader title="Positions" subtitle="Open and closed positions across all strategies" />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mb-3">
        <ul className="nav nav-tabs">
          {strategyTabs.map((tabOption) => (
            <li className="nav-item" key={tabOption.key}>
              <button
                type="button"
                className={`nav-link ${strategy === tabOption.key ? "active" : ""}`}
                onClick={() => setStrategy(tabOption.key)}
              >
                {tabOption.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn ${status === "open" ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setStatus("open")}
          >
            Open
          </button>
          <button
            type="button"
            className={`btn ${status === "closed" ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setStatus("closed")}
          >
            Closed
          </button>
        </div>
      </div>

      <DataTable
        tableId="positions"
        columns={columns}
        rows={positions}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage={`No ${status} positions yet.`}
      />

      {closePosition && (
        <ClosePositionModal
          position={closePosition}
          onClose={() => setClosePosition(null)}
          onClosed={() => {
            setClosePosition(null);
            loadPositions();
          }}
        />
      )}

      {detailSymbol && (
        <TickerDetailModal
          symbol={detailSymbol}
          focusPositionId={focusPositionId}
          onClose={() => {
            setDetailSymbol(null);
            setFocusPositionId(undefined);
            loadPositions();
          }}
        />
      )}

      {rollAlert && (
        <RollPositionModal
          alert={{
            id: rollAlert.id,
            symbol: rollAlert.symbol,
            relatedPositionId: rollAlert.relatedPositionId,
            suggestedStructure: rollAlert.suggestedStructure,
          }}
          onClose={() => setRollAlert(null)}
          onRolled={() => {
            setRollAlert(null);
            loadPositions();
            loadRollAlerts();
          }}
        />
      )}
    </>
  );
}
