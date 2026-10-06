import { useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistBotEnabled } from "../../api/pluto";
import { Spinner } from "../Spinner";

interface PlutoBotToggleProps {
  entryId: string;
  symbol: string;
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
  onError?: (message: string) => void;
}

/** The per-ticker "Pluto may trade this" switch, shared by the Shortlist tab and the Pluto screen. Saves on click; the cap error comes back from the API. */
export function PlutoBotToggle({ entryId, symbol, enabled, onChanged, onError }: PlutoBotToggleProps) {
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
    <label className="form-check form-switch m-0 d-inline-flex align-items-center gap-2" style={{ cursor: saving ? "wait" : "pointer" }}>
      <input className="form-check-input m-0" type="checkbox" role="switch" checked={enabled} disabled={saving} onChange={() => void toggle()} aria-label={`Pluto ${enabled ? "enabled" : "disabled"} for ${symbol}`} />
      {saving && <Spinner size="sm" />}
    </label>
  );
}
