import { useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistSignalsEnabled, type SignalsEnabledResult } from "../../api/shortlist";
import { ToggleSwitch } from "../ToggleSwitch";
import { PlutoStopsManagingConfirm, plutoStopsManagingPositions } from "../pluto/PlutoStopsManagingConfirm";

interface SignalsToggleProps {
  entryId: string;
  symbol: string;
  enabled: boolean;
  /** With Pluto on and open positions, turning Signals off asks first: it switches Pluto off too. */
  botEnabled: boolean;
  openPositionCount: number;
  onChanged: (result: SignalsEnabledResult) => void;
  onError?: (message: string) => void;
}

/** The per-ticker Signals switch. On starts the option-chain setup; off also turns Pluto off (both done by the API). */
export function SignalsToggle({ entryId, symbol, enabled, botEnabled, openPositionCount, onChanged, onError }: SignalsToggleProps) {
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function requestToggle() {
    if (saving) return;
    if (enabled && plutoStopsManagingPositions(botEnabled, openPositionCount)) setConfirming(true);
    else void toggle();
  }

  async function toggle() {
    setConfirming(false);
    if (saving) return;
    setSaving(true);
    try {
      onChanged(await updateShortlistSignalsEnabled(entryId, !enabled));
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : `Could not update Signals for ${symbol}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ToggleSwitch checked={enabled} saving={saving} ariaLabel={`Signals ${enabled ? "on" : "off"} for ${symbol}`} onToggle={requestToggle} />
      {confirming && <PlutoStopsManagingConfirm symbol={symbol} openPositionCount={openPositionCount} viaSignals onConfirm={() => void toggle()} onCancel={() => setConfirming(false)} />}
    </>
  );
}
