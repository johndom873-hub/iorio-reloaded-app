import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { TickerModal } from "../components/TickerModal";
import { TickerModalContext, useTickerModal, type PositionsMayHaveChangedListener, type TickerModalContextValue } from "../hooks/useTickerModal";

/**
 * Mounts the Signals ticker modal once for every page under AppLayout, driven by the URL params of
 * useTickerModal. Pages that show positions subscribe with useRefreshAfterTickerModal to
 * reload when the modal closes (however it closes, including browser navigation) or when an order fills
 * or a position is closed/edited inside it.
 */
export function TickerModalProvider({ children }: { children: ReactNode }) {
  const { symbol, rollLegId, focusPositionId, close } = useTickerModal();
  const listenersRef = useRef(new Set<PositionsMayHaveChangedListener>());

  const notifyPositionsMayHaveChanged = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const previousSymbolRef = useRef(symbol);
  useEffect(() => {
    const previousSymbol = previousSymbolRef.current;
    previousSymbolRef.current = symbol;
    if (previousSymbol !== null && previousSymbol !== symbol) notifyPositionsMayHaveChanged();
  }, [symbol, notifyPositionsMayHaveChanged]);

  const contextValue = useMemo<TickerModalContextValue>(
    () => ({
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );

  return (
    <TickerModalContext.Provider value={contextValue}>
      {children}
      {symbol && (
        <TickerModal
          key={`${symbol}|${rollLegId ?? ""}|${focusPositionId ?? ""}`}
          symbol={symbol}
          initialRollLegId={rollLegId}
          focusPositionId={focusPositionId}
          onPositionsChanged={notifyPositionsMayHaveChanged}
          onClose={close}
        />
      )}
    </TickerModalContext.Provider>
  );
}
