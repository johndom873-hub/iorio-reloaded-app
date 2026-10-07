import { useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistSignalsEnabled, type SignalsEnabledResult } from "../../api/shortlist";
import { ToggleSwitch } from "../ToggleSwitch";

interface SignalsToggleProps {
  entryId: string;
  symbol: string;
  enabled: boolean;
  onChanged: (result: SignalsEnabledResult) => void;
  onError?: (message: string) => void;
}

/** The per-ticker Signals switch. On starts the option-chain setup; off also turns Pluto off (both done by the API). */
export function SignalsToggle({ entryId, symbol, enabled, onChanged, onError }: SignalsToggleProps) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
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

  return <ToggleSwitch checked={enabled} saving={saving} ariaLabel={`Signals ${enabled ? "on" : "off"} for ${symbol}`} onToggle={() => void toggle()} />;
}
