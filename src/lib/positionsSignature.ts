import type { Position } from "../api/positions";

/** Identity of what a positions list shows (positions, their legs, quantities, exits), so a poll that changed nothing can keep the same array and not restart the streams keyed on it. */
export function openPositionsSignature(positions: Position[]): string {
  return JSON.stringify(
    positions.map((position) => [
      position.id,
      position.strategyKey,
      position.status,
      position.realizedPnl,
      position.legs.map((leg) => [leg.id, leg.quantity, leg.exitAt]),
    ]),
  );
}
