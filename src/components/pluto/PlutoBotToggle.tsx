import { useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistBotEnabled } from "../../api/pluto";
import { ToggleSwitch } from "../ToggleSwitch";

interface PlutoBotToggleProps {
  entryId: string;
  symbol: string;
  enabled: boolean;
  /** Pluto only trades Signals tickers: the switch is disabled while Signals is off (the API refuses too). */
  disabledReason?: string | null;
  onChanged: (enabled: boolean) => void;
  onError?: (message: string) => void;
}

/** The per-ticker "Pluto may trade this" switch on the Shortlist tab. Saves on click; the cap error comes back from the API. */
export function PlutoBotToggle({ entryId, symbol, enabled, disabledReason, onChanged, onError }: PlutoBotToggleProps) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
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
    <ToggleSwitch
      checked={enabled}
      saving={saving}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason ?? undefined}
      ariaLabel={`Pluto ${enabled ? "enabled" : "disabled"} for ${symbol}`}
      onToggle={() => void toggle()}
    />
  );
}
