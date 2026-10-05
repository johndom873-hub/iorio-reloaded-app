import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

const SYMBOL_PARAM = "signal";
const ROLL_LEG_PARAM = "roll";
const FOCUS_POSITION_PARAM = "position";
const MODAL_PARAMS = [SYMBOL_PARAM, ROLL_LEG_PARAM, FOCUS_POSITION_PARAM] as const;

export interface SignalsTickerModalOpenOptions {
  /** Pre-selects the best Signals roll of this open short leg once the scores arrive. */
  rollLegId?: string;
  /** Scrolls this position's card into view (forcing the Positions card open). */
  focusPositionId?: string;
}

export interface SignalsTickerModalState {
  symbol: string | null;
  rollLegId: string | null;
  focusPositionId: string | null;
  open: (symbol: string, options?: SignalsTickerModalOpenOptions) => void;
  close: () => void;
}

/**
 * The one ticker modal (mounted once in AppLayout), kept in the URL as `?signal=SYM` plus optional
 * `&roll=<legId>` / `&position=<positionId>` so a browser refresh reopens it where it was. Other query
 * params are preserved, and `replace: true` keeps opening/closing out of the browser history.
 */
export function useSignalsTickerModal(): SignalsTickerModalState {
  const [searchParams, setSearchParams] = useSearchParams();

  const open = useCallback(
    (symbol: string, options: SignalsTickerModalOpenOptions = {}) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          for (const name of MODAL_PARAMS) params.delete(name);
          params.set(SYMBOL_PARAM, symbol);
          if (options.rollLegId) params.set(ROLL_LEG_PARAM, options.rollLegId);
          if (options.focusPositionId) params.set(FOCUS_POSITION_PARAM, options.focusPositionId);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const close = useCallback(() => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        for (const name of MODAL_PARAMS) params.delete(name);
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    symbol: searchParams.get(SYMBOL_PARAM),
    rollLegId: searchParams.get(ROLL_LEG_PARAM),
    focusPositionId: searchParams.get(FOCUS_POSITION_PARAM),
    open,
    close,
  };
}

export type PositionsMayHaveChangedListener = () => void;

export interface SignalsTickerModalContextValue {
  subscribe: (listener: PositionsMayHaveChangedListener) => () => void;
}

/** Provided by SignalsTickerModalProvider (contexts/SignalsTickerModalContext.tsx). */
export const SignalsTickerModalContext = createContext<SignalsTickerModalContextValue | null>(null);

/** Calls `refresh` when the Signals modal closes, and after a fill or a position change inside it. */
export function useRefreshAfterSignalsTickerModal(refresh: () => void): void {
  const context = useContext(SignalsTickerModalContext);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => context?.subscribe(() => refreshRef.current()), [context]);
}
