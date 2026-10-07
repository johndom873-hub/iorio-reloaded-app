import { useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistBotEnabled } from "../../api/pluto";
import { ToggleSwitch } from "../ToggleSwitch";
import { PlutoStopsManagingConfirm, plutoStopsManagingPositions } from "./PlutoStopsManagingConfirm";

interface PlutoBotToggleProps {
  entryId: string;
  symbol: string;
  enabled: boolean;
  /** Switching Pluto off with open positions on the ticker asks first: Pluto stops managing them. */
  openPositionCount: number;
  /** Pluto only trades Signals tickers: the switch is disabled while Signals is off (the API refuses too). */
  disabledReason?: string | null;
  onChanged: (enabled: boolean) => void;
  onError?: (message: string) => void;
}

/** The per-ticker "Pluto may trade this" switch on the Shortlist tab. Saves on click; the cap error comes back from the API. */
export function PlutoBotToggle({ entryId, symbol, enabled, openPositionCount, disabledReason, onChanged, onError }: PlutoBotToggleProps) {
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function requestToggle() {
    if (saving) return;
    if (plutoStopsManagingPositions(enabled, openPositionCount)) setConfirming(true);
    else void toggle();
  }

  async function toggle() {
    setConfirming(false);
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateShortlistBotEnabled(entryId, !enabled);
      onChanged(result.botEnabled);
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : `Could not update Pluto for ${symbol}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ToggleSwitch
        checked={enabled}
        saving={saving}
        disabled={Boolean(disabledReason)}
        disabledReason={disabledReason ?? undefined}
        ariaLabel={`Pluto ${enabled ? "enabled" : "disabled"} for ${symbol}`}
        onToggle={requestToggle}
      />
      {confirming && <PlutoStopsManagingConfirm symbol={symbol} openPositionCount={openPositionCount} viaSignals={false} onConfirm={() => void toggle()} onCancel={() => setConfirming(false)} />}
    </>
  );
}
