import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { SignalsTickerModal } from "../components/SignalsTickerModal";
import { SignalsTickerModalContext, useSignalsTickerModal, type PositionsMayHaveChangedListener, type SignalsTickerModalContextValue } from "../hooks/useSignalsTickerModal";

/**
 * Mounts the Signals ticker modal once for every page under AppLayout, driven by the URL params of
 * useSignalsTickerModal. Pages that show positions subscribe with useRefreshAfterSignalsTickerModal to
 * reload when the modal closes (however it closes, including browser navigation) or when an order fills
 * or a position is closed/edited inside it.
 */
export function SignalsTickerModalProvider({ children }: { children: ReactNode }) {
  const { symbol, rollLegId, focusPositionId, close } = useSignalsTickerModal();
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

  const contextValue = useMemo<SignalsTickerModalContextValue>(
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
    <SignalsTickerModalContext.Provider value={contextValue}>
      {children}
      {symbol && (
        <SignalsTickerModal
          key={`${symbol}|${rollLegId ?? ""}|${focusPositionId ?? ""}`}
          symbol={symbol}
          initialRollLegId={rollLegId}
          focusPositionId={focusPositionId}
          onPositionsChanged={notifyPositionsMayHaveChanged}
          onClose={close}
        />
      )}
    </SignalsTickerModalContext.Provider>
  );
}
