import { pluralize } from "../../lib/formatters";
import { ConfirmModal } from "../ConfirmModal";

interface PlutoStopsManagingConfirmProps {
  symbol: string;
  openPositionCount: number;
  /** The Signals switch: turning it off turns Pluto off too. */
  viaSignals: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Whether switching Pluto off (directly, or by turning Signals off) needs the warning: Pluto manages every open position on its tickers. */
export function plutoStopsManagingPositions(botEnabled: boolean, openPositionCount: number): boolean {
  return botEnabled && openPositionCount > 0;
}

/** Warns before Pluto drops a ticker it manages open positions on (Marcelo, 2026-10-07: warn only). */
export function PlutoStopsManagingConfirm({ symbol, openPositionCount, viaSignals, onConfirm, onCancel }: PlutoStopsManagingConfirmProps) {
  return (
    <ConfirmModal
      title={`Stop Pluto managing ${symbol}?`}
      message={
        <>
          {viaSignals && <>Turning Signals off also switches Pluto off for <strong>{symbol}</strong>. </>}
          Pluto is managing {pluralize(openPositionCount, "open position")} on <strong>{symbol}</strong>. Once it is off for {symbol}, Pluto will not close or roll {openPositionCount === 1 ? "it" : "them"}; {openPositionCount === 1 ? "it stays" : "they stay"} open for you to manage.
        </>
      }
      confirmLabel="Switch off"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
