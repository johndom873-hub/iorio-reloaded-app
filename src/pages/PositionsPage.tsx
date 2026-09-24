import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { FlashingNumber } from "../components/FlashingNumber";
import { ClosePositionModal } from "../components/ClosePositionModal";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { CycleScoreboard } from "../components/CycleScoreboard";
import { ApiError } from "../api/client";
import {
  fetchPositions,
  openGreeksStream,
  openUnrealizedPnlStream,
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
  daysToExpiry,
  todayInEasternIso,
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
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
  positionIsStockOnly,
  positionPremiumPnl,
  positionStockPnl,
  computePositionTotals,
  positionTotalPnl,
  positionTotalPnlPercent,
} from "../lib/positionPnl";
import { StrategyBadge } from "../components/StrategyBadge";
import { TooltipSpan } from "../components/TooltipSpan";
import { useTooltip } from "../hooks/useTooltip";

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

// Extracted so useTooltip (a hook) can be called once per row from inside
// the actions column's render(row) callback (a plain function, not a
// component) without violating the Rules of Hooks -- see FlashingNumber.tsx's
// doc comment for the same constraint.
function RollButton({ rationale, onClick }: { rationale: string | null | undefined; onClick: () => void }) {
  const ref = useTooltip<HTMLButtonElement>(rationale ?? "Roll alert pending for this position");
  return (
    <button ref={ref} type="button" className="btn btn-sm btn-outline-warning" onClick={onClick}>
      Roll
    </button>
  );
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
  // "scroll to this position"/"pre-select this alert" aid, not state worth
  // surviving a reload.
  const [focusPositionId, setFocusPositionId] = useState<string | undefined>(undefined);
  const [initialAlertId, setInitialAlertId] = useState<string | undefined>(undefined);
  const openTickerDetail = useCallback(
    (ticker: { symbol: string; focusPositionId?: string; alertId?: string }) => {
      setDetailSymbol(ticker.symbol);
      setFocusPositionId(ticker.focusPositionId);
      setInitialAlertId(ticker.alertId);
    },
    [setDetailSymbol],
  );
  const [closePosition, setClosePosition] = useState<Position | null>(null);
  // Pending roll alerts, keyed by the position they'd roll — drives the
  // Roll button in the actions column. Not tied to the status/strategy
  // filters above: a roll alert only ever exists for an open position, so
  // fetching the full pending set unfiltered is simplest.
  const [rollAlertsByPositionId, setRollAlertsByPositionId] = useState<Record<string, RollAlert>>({});

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
    return openGreeksStream(
      optionLegIds,
      (result) => {
        setGreeksFetchFailed(false);
        setGreeksByLegId(result);
      },
      () => setGreeksFetchFailed(true),
    );
  }, [positions]);

  useEffect(() => {
    const openPositionIds = positions.filter((position) => position.status === "open").map((position) => position.id);
    if (openPositionIds.length === 0) return;
    setUnrealizedPnlFetchFailed(false);
    return openUnrealizedPnlStream(
      openPositionIds,
      (result) => {
        setUnrealizedPnlFetchFailed(false);
        setUnrealizedPnlByPositionId(result);
      },
      () => setUnrealizedPnlFetchFailed(true),
    );
  }, [positions]);

  // Stock price for a row. Same source the row's own P&L uses first: the stock leg's live market value / shares (the
  // frozen-then-live last trade), so Price and Stock P&L never disagree. Only when that isn't live (no stock leg, or the
  // P&L is a nightly-snapshot fallback with no market value) does it use the option tick's underlying price.
  // `failed` = the stream this depends on errored (show a dash, not a spinner).
  function resolvePrice(row: Position): { price: number | null; failed: boolean } {
    const optionLeg = row.legs.find((leg) => leg.legType === "option" && !leg.exitAt);
    const stockShares = row.legs.filter((leg) => leg.legType === "stock" && !leg.exitAt).reduce((sum, leg) => sum + leg.quantity, 0);
    const stockMarketValue = unrealizedPnlByPositionId[row.id]?.stockMarketValue ?? null;
    let price: number | null = stockShares > 0 && stockMarketValue !== null ? stockMarketValue / stockShares : null;
    if (price === null && optionLeg) price = greeksByLegId[optionLeg.id]?.underlyingPrice ?? null;
    // Everything this row waits on has answered (or errored) and there is still no price: show a dash, not a spinner.
    const dataArrived = row.id in unrealizedPnlByPositionId && (optionLeg ? optionLeg.id in greeksByLegId : true);
    const streamsFailed = optionLeg ? greeksFetchFailed && unrealizedPnlFetchFailed : unrealizedPnlFetchFailed;
    return { price, failed: price === null && (dataArrived || streamsFailed) };
  }

  function renderNetDelta(row: Position) {
    const optionLeg = row.legs.find((leg) => leg.legType === "option" && !leg.exitAt);
    if (!optionLeg || row.status === "closed") return <span className="text-muted">—</span>;
    const greeks = greeksByLegId[optionLeg.id];
    if (!greeks) {
      if (greeksFetchFailed) return <TooltipSpan className="text-muted" text="Failed to load">—</TooltipSpan>;
      return <Spinner size="sm" label="Loading delta" />;
    }
    const value = greeks.delta;
    if (value === null) return <TooltipSpan className="text-muted" text="No delta available">—</TooltipSpan>;
    return (
      <FlashingNumber
        value={value}
        precision={2}
        className={pnlTextClass(value)}
        title={greeks.asOfDate ? `As of ${formatDate(greeks.asOfDate)} close` : undefined}
      >
        {formatNumber(value, 2)}
      </FlashingNumber>
    );
  }

  const totals = computePositionTotals(positions, unrealizedPnlByPositionId, totalAccountValue);
  const totalPnlTitle = totals.positionsWithoutPnl > 0 ? `Excludes ${totals.positionsWithoutPnl} position(s) with no live price or snapshot` : undefined;
  const signedTotal = (value: number) => (
    <TooltipSpan className={`font-mono ${pnlTextClass(value)}`} text={totalPnlTitle}>
      {formatSignedPnl(value)}
    </TooltipSpan>
  );
  // Closed positions' capital was committed at different times and reused, so
  // summing Exp $ / Exp % (and a P&L % on that base) across them is meaningless —
  // only the P&L $ totals are shown there.
  const isOpenView = status === "open";
  const footerCells: Record<string, ReactNode> = {
    symbol: `Total (${positions.length})`,
    pnlPercent: !isOpenView ? null : totals.isLoading ? <Spinner size="sm" label="Loading" /> : totals.pnlPercent === null ? "—" : (
      <TooltipSpan className={`font-mono ${pnlTextClass(totals.pnlPercent)}`} text={totalPnlTitle}>
        {totals.pnlPercent > 0 ? "+" : ""}
        {formatPercentageValue(totals.pnlPercent, 2)}
      </TooltipSpan>
    ),
    pnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.totalPnl),
    premiumPnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.premiumPnl),
    stockPnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.stockPnl),
    exposureDollars: !isOpenView ? null : <span className="font-mono">{formatCurrency(totals.exposureDollars, 0)}</span>,
    exposurePercent: !isOpenView ? null : totals.exposurePercent === null ? "—" : <span className="font-mono">{formatPercentageValue(totals.exposurePercent, 1)}</span>,
  };

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
      render: (row) => <StrategyBadge strategyKey={row.strategyKey} />,
    },
    { key: "structure", header: "Structure", render: (row) => structureSummary(row) },
    {
      key: "price",
      header: "Price",
      headerTitle: "Current stock price",
      align: "right",
      render: (row) => {
        if (row.status === "closed") return "—";
        const { price, failed } = resolvePrice(row);
        if (price === null) {
          if (failed) return <span className="text-muted">—</span>;
          return <Spinner size="sm" label="Loading price" />;
        }
        return <FlashingNumber value={price} precision={2}>{formatCurrency(price, 2)}</FlashingNumber>;
      },
    },
    {
      key: "breakEven",
      header: "Break-Even",
      headerTitle: "Stock price at which this symbol's whole wheel cycle (all puts, calls and stock since it began) nets to zero on the shares still held. Green = price above it, red = below. Free = premium collected already exceeds the cost.",
      align: "right",
      render: (row) => {
        if (row.status === "closed") return "—";
        if (row.breakEven === null || row.breakEven === undefined) {
          return <TooltipSpan className="text-muted" text={row.breakEvenUnavailableReason ?? "No break-even for this position"}>—</TooltipSpan>;
        }
        if (row.breakEven <= 0) return <span className="badge bg-success-lt">Free</span>;
        const { price } = resolvePrice(row);
        const colorClass = price === null ? "" : price >= row.breakEven ? "text-success" : "text-danger";
        return <span className={`font-mono ${colorClass}`}>{formatCurrency(row.breakEven, 2)}</span>;
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
              <TooltipSpan className="text-muted" text="Failed to load live P&L data">
                —
              </TooltipSpan>
            );
          }
          return <Spinner size="sm" label="Loading P&L" />;
        }
        const pct = positionTotalPnlPercent(row, pnl);
        if (pct === null)
          return (
            <TooltipSpan className="text-muted" text="No live price or recent snapshot available for this position">
              —
            </TooltipSpan>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <FlashingNumber value={pct} precision={2} className={pnlTextClass(pct)} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {pct > 0 ? "+" : ""}
            {formatPercentageValue(pct, 2)}
          </FlashingNumber>
        );
      },
    },
    {
      key: "pnl",
      header: "P&L $",
      headerTitle: "Realized + unrealized P&L, net of commissions: opening commissions are already inside entry prices, closing-trade commissions are subtracted once a leg closes",
      align: "right",
      render: (row) => {
        const pnl = positionTotalPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") {
          if (unrealizedPnlFetchFailed) {
            return (
              <TooltipSpan className="text-muted" text="Failed to load live P&L data">
                —
              </TooltipSpan>
            );
          }
          return <Spinner size="sm" label="Loading P&L" />;
        }
        if (pnl === null)
          return (
            <TooltipSpan className="text-muted" text="No live price or recent snapshot available for this position">
              —
            </TooltipSpan>
          );
        const asOfDate = positionPnlAsOfDate(row, unrealizedPnlByPositionId);
        return (
          <FlashingNumber value={pnl} className={pnlTextClass(pnl)} title={asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined}>
            {formatSignedPnl(pnl)}
          </FlashingNumber>
        );
      },
    },
    {
      key: "premiumPnl",
      header: "Premium P&L",
      headerTitle: "Premium collected vs. current buy-back cost of the option contract(s) — isolated from any stock price movement",
      align: "right",
      render: (row) => {
        if (positionIsStockOnly(row))
          return (
            <TooltipSpan className="text-muted" text="No live option leg — all P&L on this position is stock P&L">
              —
            </TooltipSpan>
          );
        const pnl = positionPremiumPnl(row, unrealizedPnlByPositionId);
        if (pnl === "loading") return <Spinner size="sm" label="Loading premium P&L" />;
        if (pnl === null)
          return (
            <TooltipSpan className="text-muted" text="No live price or recent snapshot available for this position">
              —
            </TooltipSpan>
          );
        return (
          <FlashingNumber value={pnl} className={pnlTextClass(pnl)}>
            {formatSignedPnl(pnl)}
          </FlashingNumber>
        );
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
            <TooltipSpan className="text-muted" text="No live price or recent snapshot available for this position">
              —
            </TooltipSpan>
          );
        return (
          <FlashingNumber value={pnl} className={pnlTextClass(pnl)}>
            {formatSignedPnl(pnl)}
          </FlashingNumber>
        );
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
      key: "expiry",
      header: "Expiry",
      render: (row) => {
        const expiryDate = positionExpiryDate(row);
        if (!expiryDate) return "—";
        return <TooltipSpan text={formatDate(expiryDate)}>{formatDaysToExpiry(daysToExpiry(expiryDate, todayInEasternIso()))}</TooltipSpan>;
      },
    },
    {
      key: "netDelta",
      header: "Net Δ",
      headerTitle: "The short option leg's delta, signed as reported (negative for a short call, positive for a short put)",
      align: "right",
      render: (row) => renderNetDelta(row),
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
                <RollButton
                  rationale={alert.rationale}
                  onClick={() => openTickerDetail({ symbol: row.symbol, focusPositionId: row.id, alertId: alert.id })}
                />
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
        footerCells={footerCells}
        emptyMessage={`No ${status} positions yet.`}
      />

      <CycleScoreboard />

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
          initialAlertId={initialAlertId}
          onClose={() => {
            setDetailSymbol(null);
            setFocusPositionId(undefined);
            setInitialAlertId(undefined);
            loadPositions();
            loadRollAlerts();
          }}
        />
      )}
    </>
  );
}
