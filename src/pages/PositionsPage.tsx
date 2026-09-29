import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { FlashingNumber } from "../components/FlashingNumber";
import { ClosePositionModal } from "../components/ClosePositionModal";
import { RollBadge } from "../components/signals/RollBadge";
import { CycleScoreboard } from "../components/CycleScoreboard";
import { ApiError } from "../api/client";
import {
  fetchCycleMarks,
  fetchPositions,
  openGreeksStream,
  openUnrealizedPnlStream,
  type Greeks,
  type OpenCycleMarks,
  type Position,
  type UnrealizedPnlResult,
} from "../api/positions";
import { fetchSignalsScreen, type SignalsScreenRow } from "../api/signals";
import { fetchAccountValue } from "../api/dashboard";
import { openNotificationStream } from "../api/notifications";
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
import { liveCyclePnl } from "../lib/cycleLivePnl";
import { useRefreshAfterSignalsTickerModal, useSignalsTickerModal } from "../hooks/useSignalsTickerModal";
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

function structureSummary(position: Position): string {
  // An open position can carry closed legs from a past roll (they stay
  // attached to the same position_id for history) — only summarize what's
  // actually still held.
  const legs = position.legs.filter((leg) => !leg.exitAt);
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
  // Stored-mark cycle figures per open ticker (null until loaded); the row's live marks are applied on top in resolveCyclePnl.
  const [cycleMarksBySymbol, setCycleMarksBySymbol] = useState<Record<string, OpenCycleMarks> | null>(null);
  const [cycleMarksFetchFailed, setCycleMarksFetchFailed] = useState(false);
  const { open: openTickerModal } = useSignalsTickerModal();
  const openTickerModalAtPosition = useCallback(
    (ticker: { symbol: string; focusPositionId?: string }) => openTickerModal(ticker.symbol, { focusPositionId: ticker.focusPositionId }),
    [openTickerModal],
  );
  const [closePosition, setClosePosition] = useState<Position | null>(null);
  // Signals screen rows by symbol: the Roll Signals badge of an open option position (its ticker's best roll).
  const [signalsRowBySymbol, setSignalsRowBySymbol] = useState<Record<string, SignalsScreenRow>>({});
  const loadPositions = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchPositions({ status: "open" });
      setPositions(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load positions.");
    }
  }, []);

  const loadSignalsRows = useCallback(async () => {
    try {
      const rows = await fetchSignalsScreen();
      setSignalsRowBySymbol(Object.fromEntries(rows.map((row) => [row.symbol, row])));
    } catch {
      // Non-critical — the roll badges just don't show if this fails.
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPositions(), loadSignalsRows()]).finally(() => setLoading(false));
  }, [loadPositions, loadSignalsRows]);

  const reloadAfterSignalsTickerModal = useCallback(() => {
    void loadPositions();
    void loadSignalsRows();
  }, [loadPositions, loadSignalsRows]);
  useRefreshAfterSignalsTickerModal(reloadAfterSignalsTickerModal);

  // Same race as in the Signals modal's useTickerPositions: a fill flips
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

  // Refetched whenever the position set changes (a fill or a roll changes the cycle), not on every price tick.
  useEffect(() => {
    if (positions.length === 0) return;
    setCycleMarksFetchFailed(false);
    fetchCycleMarks()
      .then(setCycleMarksBySymbol)
      .catch(() => setCycleMarksFetchFailed(true));
  }, [positions]);

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

  // Cycle P&L for a row: the ticker's cycle with THIS row's price and each open option position's live unrealized premium
  // P&L swapped in (see liveCyclePnl). Any mark that isn't available stays at the stored value (last daily close / nightly
  // snapshot), shown with an "As of" date only when the row has no price at all -- the same fallback the other P&L columns use.
  function resolveCyclePnl(row: Position): { state: "loading" } | { state: "unavailable"; reason: string } | { state: "ready"; value: number; storedAsOf: string | null } {
    if (cycleMarksFetchFailed) return { state: "unavailable", reason: "Failed to load cycle data" };
    if (cycleMarksBySymbol === null) return { state: "loading" };
    const marks = cycleMarksBySymbol[row.symbol];
    if (!marks) return { state: "unavailable", reason: "No open cycle for this symbol" };
    if (marks.dataFlags.length > 0) return { state: "unavailable", reason: `Cycle data is inconsistent: ${marks.dataFlags.join("; ")}` };
    const { price } = resolvePrice(row);
    const liveUnrealizedPremiumByPositionId: Record<string, number> = {};
    for (const position of positions) {
      if (position.symbol !== row.symbol || !(position.id in marks.optionMarks)) continue;
      const unrealizedPremiumPnl = unrealizedPnlByPositionId[position.id]?.unrealizedPremiumPnl;
      if (unrealizedPremiumPnl !== null && unrealizedPremiumPnl !== undefined) liveUnrealizedPremiumByPositionId[position.id] = unrealizedPremiumPnl;
    }
    return { state: "ready", value: liveCyclePnl(marks, price, liveUnrealizedPremiumByPositionId), storedAsOf: price === null ? marks.markDate : null };
  }

  function renderNetDelta(row: Position) {
    const optionLeg = row.legs.find((leg) => leg.legType === "option" && !leg.exitAt);
    if (!optionLeg) return <span className="text-muted">—</span>;
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
  // Cycle P&L is per symbol and repeats on every row of that symbol, so the total counts each symbol once.
  const cycleTotalsBySymbol = new Map<string, ReturnType<typeof resolveCyclePnl>>();
  for (const position of positions) if (!cycleTotalsBySymbol.has(position.symbol)) cycleTotalsBySymbol.set(position.symbol, resolveCyclePnl(position));
  const cycleResults = [...cycleTotalsBySymbol.values()];
  const cycleTotal = cycleResults.reduce((sum, result) => sum + (result.state === "ready" ? result.value : 0), 0);
  const cycleSymbolsWithoutFigure = cycleResults.filter((result) => result.state === "unavailable").length;
  const cycleTotalTitle =
    cycleSymbolsWithoutFigure > 0
      ? `Each symbol counted once. Excludes ${cycleSymbolsWithoutFigure} symbol(s) with no cycle figure`
      : "Each symbol counted once";
  const footerCells: Record<string, ReactNode> = {
    symbol: `Total (${positions.length})`,
    pnlPercent: totals.isLoading ? <Spinner size="sm" label="Loading" /> : totals.pnlPercent === null ? "—" : (
      <TooltipSpan className={`font-mono ${pnlTextClass(totals.pnlPercent)}`} text={totalPnlTitle}>
        {totals.pnlPercent > 0 ? "+" : ""}
        {formatPercentageValue(totals.pnlPercent, 2)}
      </TooltipSpan>
    ),
    cyclePnl: cycleResults.some((result) => result.state === "loading") ? (
      <Spinner size="sm" label="Loading" />
    ) : (
      <TooltipSpan className={`font-mono ${pnlTextClass(cycleTotal)}`} text={cycleTotalTitle}>
        {formatSignedPnl(cycleTotal)}
      </TooltipSpan>
    ),
    pnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.totalPnl),
    premiumPnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.premiumPnl),
    stockPnl: totals.isLoading ? <Spinner size="sm" label="Loading" /> : signedTotal(totals.stockPnl),
    exposureDollars: <span className="font-mono">{formatCurrency(totals.exposureDollars, 0)}</span>,
    exposurePercent: totals.exposurePercent === null ? "—" : <span className="font-mono">{formatPercentageValue(totals.exposurePercent, 1)}</span>,
  };

  const columns: DataTableColumn<Position>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link px-2 py-1 text-decoration-none fw-bold"
          onClick={() => openTickerModalAtPosition({ symbol: row.symbol, focusPositionId: row.id })}
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
      key: "cyclePnl",
      header: "Cycle P&L",
      headerTitle:
        "Profit and loss of this symbol's whole wheel cycle (every put, call and share since it began), using this row's Price and live option marks. Repeats on every row of the same symbol. Falls back to the last daily close and nightly snapshot when a mark isn't live.",
      align: "right",
      render: (row) => {
        const result = resolveCyclePnl(row);
        if (result.state === "loading") return <Spinner size="sm" label="Loading cycle P&L" />;
        if (result.state === "unavailable") {
          return (
            <TooltipSpan className="text-muted" text={result.reason}>
              —
            </TooltipSpan>
          );
        }
        return (
          <FlashingNumber value={result.value} className={pnlTextClass(result.value)} title={result.storedAsOf ? `As of ${formatDate(result.storedAsOf)} close` : undefined}>
            {formatSignedPnl(result.value)}
          </FlashingNumber>
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
                  onClick={() => openTickerModalAtPosition({ symbol: row.symbol, focusPositionId: row.id })}
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
          const signalsRow = signalsRowBySymbol[row.symbol];
          return (
            <div className="d-flex gap-1 justify-content-end align-items-center">
              {signalsRow?.bestRoll?.positionId === row.id && <RollBadge row={signalsRow} onClick={(legId) => openTickerModal(row.symbol, { rollLegId: legId })} />}
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
      <PageHeader title="Positions" subtitle="Open positions across all strategies" />

      {error && <div className="alert alert-danger">{error}</div>}

      <DataTable
        tableId="positions"
        columns={columns}
        rows={positions}
        rowKey={(row) => row.id}
        loading={loading}
        footerCells={footerCells}
        emptyMessage="No open positions yet."
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

    </>
  );
}
