import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { updatePlutoSettings, type PlutoSettings, type PlutoSettingsAuditRow, type PlutoSettingsField, type PlutoSettingsInput, type PlutoState } from "../../api/pluto";
import { easternIsoDate, formatDayMonth, formatEasternTime } from "../../lib/formatters";
import { changedSettingsFields, describeSettingsChange, plutoParameterHelp, plutoParameterGroups, plutoParameterLabelByField, plutoParameterSpecByField, settingsInputValue, settingsToFormState, type PlutoParameterGroup, type PlutoParameterSpec, type PlutoSettingsFormState } from "../../lib/plutoParameters";
import { ConfirmModal } from "../ConfirmModal";
import { CollapseButton, InfoIcon, ToggleHeader } from "./plutoBits";

interface PlutoSettingsTabProps {
  settings: PlutoSettings | null;
  audit: PlutoSettingsAuditRow[];
  loading: boolean;
  error: string | null;
  state: PlutoState | null;
  isPhone: boolean;
  onSaved: (settings: PlutoSettings) => void;
}

function FieldInput({ spec, value, onChange, id }: { spec: PlutoParameterSpec; value: string; onChange: (value: string) => void; id: string }) {
  if (spec.kind === "select") {
    return (
      <div className="pm-input">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {spec.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="pm-input">
      <input id={id} type={spec.kind === "time" ? "time" : spec.kind === "text" ? "text" : "number"} inputMode={spec.kind === "number" || spec.kind === "integer" ? "decimal" : undefined} step={spec.step} value={value} onChange={(event) => onChange(event.target.value)} aria-label={spec.unit === "min" || spec.unit === "max" ? plutoParameterLabelByField[spec.field] : undefined} />
      {spec.unit && <span className="unit">{spec.unit}</span>}
    </div>
  );
}

/** One group open at a time (Marcelo, 2026-10-06); which one is remembered per browser. */
const openGroupStorageKey = "iorio-pluto-settings-open-group";

function readStoredOpenGroup(): string | null {
  try {
    const stored = localStorage.getItem(openGroupStorageKey);
    if (stored === "") return null;
    return stored !== null && plutoParameterGroups.some((group) => group.key === stored) ? stored : plutoParameterGroups[0]!.key;
  } catch {
    return plutoParameterGroups[0]!.key;
  }
}

function GroupCard({ group, settings, form, changed, state, onChange, isOpen, onToggle, anchorRef }: { group: PlutoParameterGroup; settings: PlutoSettings; form: PlutoSettingsFormState; changed: Set<string>; state: PlutoState | null; onChange: (field: PlutoSettingsField, value: string) => void; isOpen: boolean; onToggle: () => void; anchorRef: (element: HTMLElement | null) => void }) {
  const changedCount = group.parameters.filter((parameter) => changed.has(parameter.field)).length;
  const context = { netLiquidationValue: state?.book.netLiquidationValue ?? null, settings };
  const rows: PlutoParameterSpec[][] = [];
  for (const parameter of group.parameters) {
    if (parameter.pairedWithPrevious && rows.length > 0) rows[rows.length - 1]!.push(parameter);
    else rows.push([parameter]);
  }
  return (
    <section className="pm-card" ref={anchorRef} id={`pluto-settings-${group.key}`}>
      <ToggleHeader className={`pm-card-h${isOpen ? "" : " flat"}`} onToggle={onToggle}>
        <h2 className="pm-card-t">
          {group.title}
          {changedCount > 0 && <span className="pm-b warn">{changedCount} unsaved</span>}
          {!isOpen && <span className="pm-group-sum">· {group.parameters.length} settings · {group.summary(settings)}</span>}
        </h2>
        <CollapseButton open={isOpen} onToggle={onToggle} label={group.title} />
      </ToggleHeader>
      {isOpen &&
        rows.map((row, index) => {
          const lead = row[0]!;
          const rowChanged = row.some((parameter) => changed.has(parameter.field));
          const id = `pluto-field-${lead.field}`;
          return (
            <div key={lead.field} className={`pm-field${index === 0 ? " first" : ""}${rowChanged ? " changed" : ""}`}>
              <div>
                <label htmlFor={id}>{lead.label}</label>
                <div className="pm-help">{plutoParameterHelp(lead, context)}</div>
              </div>
              <div>
                {row.length > 1 ? (
                  <div className="pm-pair">
                    {row.map((parameter) => (
                      <FieldInput key={parameter.field} spec={parameter} id={parameter === lead ? id : `pluto-field-${parameter.field}`} value={form[parameter.field]} onChange={(value) => onChange(parameter.field, value)} />
                    ))}
                  </div>
                ) : (
                  <FieldInput spec={lead} id={id} value={form[lead.field]} onChange={(value) => onChange(lead.field, value)} />
                )}
                {rowChanged && <div className="pm-was">was {row.filter((parameter) => changed.has(parameter.field)).map((parameter) => String(settings[parameter.field])).join(" / ")}</div>}
              </div>
            </div>
          );
        })}
    </section>
  );
}

export function PlutoSettingsTab({ settings, audit, loading, error, state, isPhone, onSaved }: PlutoSettingsTabProps) {
  const [form, setForm] = useState<PlutoSettingsFormState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(readStoredOpenGroup);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    try {
      localStorage.setItem(openGroupStorageKey, openGroup ?? "");
    } catch {
      // Private window or blocked storage: the open group just isn't remembered.
    }
  }, [openGroup]);

  // Scroll once the group has opened and the one above it has closed, so the target lands where the layout settles.
  useEffect(() => {
    if (scrollTarget === null) return;
    groupRefs.current[scrollTarget]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTarget(null);
  }, [scrollTarget, openGroup]);

  // Loaded settings seed the form; a reload while the user is mid-edit keeps the edits.
  useEffect(() => {
    if (settings && form === null) setForm(settingsToFormState(settings));
  }, [settings, form]);

  const changes = useMemo(() => (settings && form ? changedSettingsFields(settings, form) : []), [settings, form]);
  const changedFields = useMemo(() => new Set(changes.map((change) => change.field as string)), [changes]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (loading || !settings || !form) return <div className="pm-card"><div className="pm-empty">Loading settings…</div></div>;

  function updateField(field: PlutoSettingsField, value: string) {
    setForm((previous) => (previous ? { ...previous, [field]: value } : previous));
    setSaveError(null);
  }

  function discard() {
    setForm(settingsToFormState(settings!));
    setSaveError(null);
  }

  function jumpTo(key: string) {
    setOpenGroup(key);
    setScrollTarget(key);
  }

  async function save() {
    const input: PlutoSettingsInput = {};
    for (const change of changes) input[change.field] = settingsInputValue(change.field, change.to);
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await updatePlutoSettings(input);
      setForm(settingsToFormState(saved));
      setConfirming(false);
      onSaved(saved);
    } catch (err) {
      // The API names the field by its key ("capitalBudgetPct cannot be above 100."); show the label people see.
      setSaveError(err instanceof ApiError ? err.message.replace(/^(\w+)/, (field) => plutoParameterLabelByField[field] ?? field) : "Could not save the settings.");
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const auditRows = showAllAudit ? audit : audit.slice(0, 4);
  const auditCard = (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">Recent changes</h2>
        {audit.length > 4 && (
          <button type="button" className="pm-link small" onClick={() => setShowAllAudit((open) => !open)}>
            {showAllAudit ? "Fewer" : "All"}
          </button>
        )}
      </div>
      {audit.length === 0 ? (
        <div className="pm-empty">No changes yet.</div>
      ) : (
        <ul className="pm-audit">
          {auditRows.map((row) => {
            const spec = plutoParameterSpecByField[row.field];
            const unit = spec?.unit && spec.unit !== "ET" && spec.unit !== "min" && spec.unit !== "max" ? ` ${spec.unit}` : "";
            return (
              <li key={row.id}>
                {plutoParameterLabelByField[row.field] ?? row.field} <code>{row.oldValue ?? "—"} → {row.newValue ?? "—"}</code>{unit}
                <div className="who">
                  {row.userDisplayName ?? "—"} · {formatDayMonth(easternIsoDate(row.changedAt))} {formatEasternTime(row.changedAt).replace(" ET", "")}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const savebar = changes.length > 0 && (
    <div className="pm-savebar" role="status">
      <i className="pend" aria-hidden="true" />
      <div className="body">
        <span className="strong">{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</span> <span className="muted">· {changes.map(describeSettingsChange).join(" · ")}</span>
        {saveError && <div className="t-bad pm-wrap">{saveError}</div>}
      </div>
      <button type="button" className="pm-btn" onClick={discard} disabled={saving}>
        Discard
      </button>
      <button type="button" className="pm-btn primary" onClick={() => setConfirming(true)} disabled={saving}>
        Review and save
      </button>
    </div>
  );

  return (
    <>
      <div className="pm-settings">
        <nav className="pm-card pm-snav" aria-label="Setting groups">
          {plutoParameterGroups.map((group) => {
            const pending = group.parameters.some((parameter) => changedFields.has(parameter.field));
            return (
              <a key={group.key} href={`#pluto-settings-${group.key}`} className={openGroup === group.key ? "active" : undefined} onClick={(event) => { event.preventDefault(); jumpTo(group.key); }}>
                {group.title}
                {pending ? <i className="pend" title="Unsaved change" /> : <span>{group.parameters.length}</span>}
              </a>
            );
          })}
        </nav>
        <div className="pm-stack tight">
          {savebar}
          {plutoParameterGroups.map((group) => (
            <GroupCard key={group.key} group={group} settings={settings} form={form} changed={changedFields} state={state} onChange={updateField} isOpen={openGroup === group.key} onToggle={() => setOpenGroup((current) => (current === group.key ? null : group.key))} anchorRef={(element) => { groupRefs.current[group.key] = element; }} />
          ))}
        </div>
        <div className="pm-stack tight">
          {auditCard}
          <div className="pm-alert info">
            <InfoIcon />
            <div className="pm-alert-body">
              <div className="pm-alert-text">Saved changes apply at Pluto's next analysis. Each one is logged with who made it and shows in the activity feed.</div>
            </div>
          </div>
        </div>
      </div>
      {!isPhone && null}
      {confirming && (
        <ConfirmModal
          title={`Save ${changes.length} ${changes.length === 1 ? "change" : "changes"}?`}
          danger={false}
          confirmLabel="Save"
          confirming={saving}
          message={
            <>
              Pluto uses the new values from its next analysis. Every change is logged with your name.
              <ul className="pm-changes">
                {changes.map((change) => (
                  <li key={change.field}>{describeSettingsChange(change)}</li>
                ))}
              </ul>
            </>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
