import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { fetchAccountValue } from "../api/dashboard";
import { openNotificationStream } from "../api/notifications";
import { fetchPositionsBySymbol, openGreeksStream, openUnrealizedPnlStream, type Greeks, type Position, type UnrealizedPnlResult } from "../api/positions";

// One ticker's positions with their live Greeks / unrealized P&L and the
// account value for EXP% — extracted from TickerDetailModal (2026-09-22) so
// the Signals modal shows the same Positions card from the same data.

export interface TickerPositionsData {
  positions: Position[] | null;
  positionsError: string | null;
  greeksByLegId: Record<string, Greeks>;
  greeksFetchFailed: boolean;
  unrealizedPnlByPositionId: Record<string, UnrealizedPnlResult>;
  unrealizedPnlFetchFailed: boolean;
  /** Last-known (not live) total account value, same source/reasoning as PositionsPage's EXP% column. */
  totalAccountValue: number | null;
  /** Re-loads every position for the symbol (after a Close/Roll/Save action or a fill). */
  loadPositions: () => Promise<void>;
}

export function useTickerPositions(symbol: string): TickerPositionsData {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [greeksFetchFailed, setGreeksFetchFailed] = useState(false);
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});
  const [unrealizedPnlFetchFailed, setUnrealizedPnlFetchFailed] = useState(false);
  const [totalAccountValue, setTotalAccountValue] = useState<number | null>(null);

  const loadPositions = useCallback(async () => {
    try {
      setPositionsError(null);
      setPositions(await fetchPositionsBySymbol(symbol));
    } catch (err) {
      setPositionsError(err instanceof ApiError ? err.message : "Failed to load positions.");
    }
  }, [symbol]);

  useEffect(() => {
    setPositions(null);
    void loadPositions();
  }, [loadPositions]);

  // A fill's position row is created asynchronously by the worker, which publishes
  // "position_opened" once it exists — refetch then rather than guessing at a delay
  // (found 2026-09-09: a real SPCX CSP fill left the modal showing no position).
  useEffect(() => {
    return openNotificationStream((notification) => {
      if (notification.type === "position_opened" && notification.symbol === symbol) void loadPositions();
    });
  }, [symbol, loadPositions]);

  // Live-upgrading Greeks/P&L for this symbol's open positions — streamed
  // (FROZEN-then-live) rather than one-shot fetched, same as PositionsPage
  // (approved 2026-09-11). Re-opens whenever the position list changes.
  useEffect(() => {
    const optionLegIds = (positions ?? [])
      .filter((position) => position.status === "open")
      .flatMap((position) => position.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id));
    if (optionLegIds.length === 0) {
      setGreeksByLegId({});
      return;
    }
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
    const openPositionIds = (positions ?? []).filter((position) => position.status === "open").map((position) => position.id);
    if (openPositionIds.length === 0) {
      setUnrealizedPnlByPositionId({});
      return;
    }
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

  useEffect(() => {
    fetchAccountValue()
      .then((result) => setTotalAccountValue(result.netLiquidationValue))
      .catch(() => setTotalAccountValue(null));
  }, []);

  return { positions, positionsError, greeksByLegId, greeksFetchFailed, unrealizedPnlByPositionId, unrealizedPnlFetchFailed, totalAccountValue, loadPositions };
}
