import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { updatePlutoSettings, type PlutoSettings, type PlutoSettingsAuditRow, type PlutoSettingsInput } from "../../api/pluto";
import { formatDateTime, formatRelativeTime } from "../../lib/formatters";
import { changedSettingsFields, plutoParameterCount, plutoParameterGroups, settingsInputValue, settingsToFormState, type PlutoSettingsFormState } from "../../lib/plutoParameters";
import { ConfirmModal } from "../ConfirmModal";
import { HelpTooltip } from "../HelpTooltip";
import { Spinner } from "../Spinner";

interface PlutoParametersCardProps {
  settings: PlutoSettings | null;
  lastChange: PlutoSettingsAuditRow | null;
  loading: boolean;
  error: string | null;
  onSaved: (settings: PlutoSettings) => void;
}

/** Every Pluto parameter, always shown (Marcelo, 2026-09-28), grouped as on the approved mockup. Save confirms the exact old → new list. */
export function PlutoParametersCard({ settings, lastChange, loading, error, onSaved }: PlutoParametersCardProps) {
  const [form, setForm] = useState<PlutoSettingsFormState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the form from the server whenever the settings row changes and nothing is being edited.
  useEffect(() => {
    if (settings && (form === null || changedSettingsFields(settings, form).length === 0)) setForm(settingsToFormState(settings));
  }, [settings]);

  const changes = settings && form ? changedSettingsFields(settings, form) : [];

  async function save() {
    if (!settings || !form || changes.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const input: PlutoSettingsInput = {};
    for (const change of changes) input[change.field] = settingsInputValue(change.field, change.to);
    try {
      const saved = await updatePlutoSettings(input);
      onSaved(saved);
      setForm(settingsToFormState(saved));
      setConfirming(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save the parameters.");
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mb-3">
      <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <h3 className="card-title m-0">Parameters</h3>
        <span className="text-muted" style={{ fontSize: "0.75rem" }}>
          all {plutoParameterCount}
          {lastChange && ` · last change: ${lastChange.userDisplayName ?? "an operator"}, ${formatRelativeTime(lastChange.changedAt) ?? formatDateTime(lastChange.changedAt)} · ${lastChange.field} ${lastChange.oldValue ?? "—"} → ${lastChange.newValue ?? "—"}`}
        </span>
      </div>
      <div className="card-body">
        {loading || !form || !settings ? (
          error ? <div className="alert alert-danger mb-0">{error}</div> : <Spinner size="sm" label="Loading parameters" />
        ) : (
          <>
            {(error || saveError) && <div className="alert alert-danger">{error ?? saveError}</div>}
            <div className="row g-4">
              {plutoParameterGroups.map((group) => (
                <div key={group.title} className="col-12 col-md-6 col-xl-3">
                  <h4 className="text-muted text-uppercase mb-2" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>{group.title}</h4>
                  {group.parameters.map((parameter) => {
                    const id = `pluto-${parameter.field}`;
                    const value = form[parameter.field];
                    const changed = String(settings[parameter.field]) !== value.trim();
                    const inputStyle = { maxWidth: parameter.kind === "text" ? "12rem" : parameter.kind === "select" ? "8rem" : "6.5rem", fontSize: "0.82rem", textAlign: parameter.kind === "text" || parameter.kind === "select" ? "left" : "right" } as const;
                    return (
                      <div key={parameter.field} className="d-flex align-items-center justify-content-between gap-2 mb-2">
                        <label htmlFor={id} className={`form-label m-0 d-inline-flex align-items-center${changed ? " fw-bold" : ""}`} style={{ fontSize: "0.82rem" }}>
                          {parameter.label}
                          <HelpTooltip text={parameter.help} />
                        </label>
                        {parameter.kind === "select" ? (
                          <select id={id} className="form-select" style={inputStyle} value={value} onChange={(event) => setForm({ ...form, [parameter.field]: event.target.value })}>
                            {parameter.options!.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            type={parameter.kind === "text" || parameter.kind === "time" ? "text" : "number"}
                            inputMode={parameter.kind === "text" ? undefined : "decimal"}
                            step={parameter.step}
                            className={`form-control${parameter.kind === "text" ? "" : " font-monospace"}`}
                            style={inputStyle}
                            value={value}
                            onChange={(event) => setForm({ ...form, [parameter.field]: event.target.value })}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button type="button" className="btn btn-outline-secondary" disabled={changes.length === 0 || saving} onClick={() => setForm(settingsToFormState(settings))}>
                Discard
              </button>
              <button type="button" className="btn btn-primary" disabled={changes.length === 0 || saving} onClick={() => setConfirming(true)}>
                Save changes{changes.length > 0 ? ` (${changes.length})` : ""}
              </button>
            </div>
          </>
        )}
      </div>
      {confirming && settings && (
        <ConfirmModal
          title="Save Pluto parameters?"
          danger={false}
          confirmLabel="Save"
          confirming={saving}
          message={
            <>
              <div className="mb-2">These changes take effect at Pluto's next look, within its coalescing window:</div>
              <ul className="mb-0 ps-3" style={{ fontSize: "0.85rem" }}>
                {changes.map((change) => (
                  <li key={change.field}>
                    {change.label}: <span className="font-monospace">{change.from}</span> → <span className="font-monospace fw-bold">{change.to}</span>
                  </li>
                ))}
              </ul>
            </>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </div>
  );
}
