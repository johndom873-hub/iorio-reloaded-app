import type { RefObject } from "react";
import type { TickerPositionsData } from "../hooks/useTickerPositions";
import { CollapsibleCard } from "./CollapsibleCard";
import { CycleCard } from "./CycleCard";
import { PositionCard } from "./PositionCard";
import { Spinner } from "./Spinner";

// The Positions card(s) + Wheel cycle card of the Signals modal.

interface TickerPositionsCardsProps {
  symbol: string;
  data: TickerPositionsData;
  currentPrice: number | null;
  /** Scrolls this position's card into view when there is more than one for the symbol. */
  focusPositionId?: string;
  focusedPositionRef?: RefObject<HTMLDivElement | null>;
  forceOpenSignal?: number;
  onSellCall: (prefill?: { strike: number; expiry: string; quantity: number; premium: number }) => void;
  onRollLeg: (legId: string) => void;
  /** After a position is closed or edited from its card. */
  onPositionChanged?: () => void;
}

export function TickerPositionsCards({ symbol, data, currentPrice, focusPositionId, focusedPositionRef, forceOpenSignal = 0, onSellCall, onRollLeg, onPositionChanged }: TickerPositionsCardsProps) {
  const { positions, positionsError } = data;
  if (positionsError) return <div className="alert alert-danger">{positionsError}</div>;
  if (positions === null) {
    return (
      <div className="d-flex justify-content-center py-2">
        <Spinner size="sm" label="Loading positions" />
      </div>
    );
  }
  const openPositions = positions.filter((position) => position.status === "open");
  const closedPositions = positions.filter((position) => position.status === "closed");
  if (openPositions.length === 0 && closedPositions.length === 0) return null;

  return (
    <div className="mb-4 d-flex flex-column gap-3">
      {openPositions.length > 0 && (
        <CollapsibleCard title={openPositions.length === 1 ? "Position" : `Positions (${openPositions.length})`} storageKey="ticker-detail-positions" forceOpenSignal={forceOpenSignal}>
          {openPositions.map((position, index) => (
            <div key={position.id} ref={position.id === focusPositionId ? focusedPositionRef : undefined} className={index < openPositions.length - 1 ? "border-bottom pb-3 mb-3" : undefined}>
              <PositionCard
                position={position}
                greeksByLegId={data.greeksByLegId}
                greeksFetchFailed={data.greeksFetchFailed}
                unrealizedPnlByPositionId={data.unrealizedPnlByPositionId}
                unrealizedPnlFetchFailed={data.unrealizedPnlFetchFailed}
                totalAccountValue={data.totalAccountValue}
                currentPrice={currentPrice}
                onChanged={() => {
                  void data.loadPositions();
                  onPositionChanged?.();
                }}
                onRollLeg={onRollLeg}
                onSellCall={onSellCall}
              />
            </div>
          ))}
        </CollapsibleCard>
      )}
      <CycleCard symbol={symbol} />
    </div>
  );
}
