import { useState } from "react";
import type { BacktestValueScale } from "../../lib/backtestPresentation";

const storageKey = "iorio-backtest-value-scale";

function readStoredScale(): BacktestValueScale {
  try {
    return localStorage.getItem(storageKey) === "log" ? "log" : "linear";
  } catch {
    return "linear";
  }
}

/** The account value charts' Linear / Log choice, remembered in this browser (Linear until changed); shared by the session
 *  page and Compare. */
export function useBacktestValueScale(): [BacktestValueScale, (scale: BacktestValueScale) => void] {
  const [scale, setScale] = useState<BacktestValueScale>(readStoredScale);
  const choose = (next: BacktestValueScale) => {
    setScale(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Storage blocked (private window): the choice lasts for this page only.
    }
  };
  return [scale, choose];
}
