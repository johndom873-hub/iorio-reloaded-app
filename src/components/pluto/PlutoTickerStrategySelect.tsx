import { useState } from "react";
import { ApiError } from "../../api/client";
import { savePlutoTickerSettings, type PlutoStrategy } from "../../api/pluto";
import { formatCurrency } from "../../lib/formatters";
import { plutoStrategyLabels } from "../../lib/plutoPresentation";
import { ConfirmModal } from "../ConfirmModal";

// A ticker's strategy on the Tickers tab (approved mockup, 2026-10-28): Vol Farmer v4 by default or the CC + Put Ladder.
// A ticker Pluto may trade asks first, since the switch forgets the strategy's memory of the ticker's cycle; one it may
// not trade saves at once.

interface PlutoTickerStrategySelectProps {
  symbol: string;
  strategy: PlutoStrategy;
  /** Pluto may trade the ticker: the switch takes effect at its next round, so it asks first. */
  enabled: boolean;
  /** B-E¹ as v4 counts it today, for the switch away from v4; null when v4 holds no first position. */
  firstBreakEven: number | null;
  locked: boolean;
  onSaved: (strategy: PlutoStrategy) => void;
  onError: (message: string) => void;
}

export function PlutoTickerStrategySelect({ symbol, strategy, enabled, firstBreakEven, locked, onSaved, onError }: PlutoTickerStrategySelectProps) {
  const [confirming, setConfirming] = useState<PlutoStrategy | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(next: PlutoStrategy) {
    setSaving(true);
    try {
      // Vol Farmer v4 is the default: choosing it clears the ticker's own strategy.
      const saved = await savePlutoTickerSettings(symbol, { strategy: next === "vol_farmer_v4" ? null : next });
      onSaved(saved.strategy ?? "vol_farmer_v4");
      setConfirming(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : `Could not change ${symbol}'s strategy.`);
      setConfirming(null);
    } finally {
      setSaving(false);
    }
  }

  function choose(next: PlutoStrategy) {
    if (next === strategy) return;
    if (enabled) setConfirming(next);
    else void save(next);
  }

  const toLadder = confirming === "cc_put_ladder";
  return (
    <>
      <label className="pm-strategy">
        <span className="visually-hidden">Strategy for {symbol}</span>
        <select className="pm-select" value={strategy} disabled={locked || saving} title={locked ? "Only an admin can change a ticker's strategy." : undefined} onChange={(event) => choose(event.target.value as PlutoStrategy)}>
          <option value="vol_farmer_v4">{plutoStrategyLabels.vol_farmer_v4} (default)</option>
          <option value="cc_put_ladder">{plutoStrategyLabels.cc_put_ladder}</option>
        </select>
      </label>
      {confirming && (
        <ConfirmModal
          title={`Run ${symbol} under ${toLadder ? "the CC + Put Ladder" : "Vol Farmer v4"}?`}
          danger={false}
          confirming={saving}
          confirmLabel={toLadder ? "Switch to the ladder" : "Switch to Vol Farmer v4"}
          message={
            toLadder ? (
              <>
                <p>From its next round, Pluto runs the CC + Put Ladder on {symbol} instead of Vol Farmer v4.</p>
                <p>
                  Vol Farmer v4's memory of {symbol} is forgotten: its first and second positions, their break-evens{firstBreakEven !== null ? ` (B-E¹ ${formatCurrency(firstBreakEven)} today)` : ""} and any LEAPS count. The ladder starts its cycle on {symbol}'s holdings as they are. Orders already working stay working.
                </p>
                <p className="text-secondary mb-0">Switching back later makes v4 adopt {symbol}'s holdings afresh, at the cycle's break-even then.</p>
              </>
            ) : (
              <>
                <p>From its next round, Pluto runs Vol Farmer v4 on {symbol} instead of the CC + Put Ladder.</p>
                <p>
                  v4 adopts {symbol}'s holdings: every share joins the first position at the cycle's break-even, its open Calls stay the first position's and its open Puts the second's. A ticker holding only Puts waits until they expire or are assigned. The ladder's memory of the cycle is forgotten; orders already working stay working.
                </p>
                <p className="text-secondary mb-0">Switching back later starts the ladder's cycle afresh on {symbol}'s holdings then.</p>
              </>
            )
          }
          onConfirm={() => void save(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
