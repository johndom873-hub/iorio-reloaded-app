import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchPlutoLadderSettings, fetchPlutoSettingsVersion, updatePlutoSettings, type PlutoLadderTickerSettings, type PlutoSettings, type PlutoSettingsAuditRow, type PlutoSettingsField, type PlutoSettingsInput, type PlutoSettingsVersion, type PlutoState } from "../../api/pluto";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency } from "../../lib/formatters";
import { ladderFit, recommendedShockAt } from "../../lib/plutoLadderPresentation";
import { applySettingsEdit, changedSettingsFields, describeSettingsChange, formatSettingDisplay, formatSettingRowWithUnit, formStateWithEdits, plutoParameterHelp, plutoParameterGroups, plutoParameterLabelByField, plutoParameterSpecByField, settingsChangedElsewhere, settingsInputValue, type PlutoParameterContext, type PlutoParameterGroup, type PlutoParameterSpec, type PlutoSettingsChange, type PlutoSettingsEdits, type PlutoSettingsFormState } from "../../lib/plutoParameters";
import { useIsAdmin } from "../../hooks/useAuth";
import { ConfirmModal } from "../ConfirmModal";
import { HelpTooltip } from "../HelpTooltip";
import { ReadOnlySetting } from "../ReadOnlySetting";
import { ViewOnlyNote } from "../ViewOnlyNote";
import { CollapseButton, InfoIcon, ToggleHeader } from "./plutoBits";

interface PlutoSettingsTabProps {
  settings: PlutoSettings | null;
  audit: PlutoSettingsAuditRow[];
  loading: boolean;
  error: string | null;
  state: PlutoState | null;
  isPhone: boolean;
  onSaved: (settings: PlutoSettings) => void;
  /** The Ticker checks card's link to the Tickers tab, where each ticker's own values are edited. */
  onOpenTickersTab: () => void;
}

/** A ticker whose effective |delta| range the edited strategy values would leave empty (a strategy save refuses it). */
interface BrokenDeltaRange {
  symbol: string;
  from: number;
  to: number;
  ownLimit: "lower" | "upper" | "both";
}

function brokenDeltaRanges(tickers: PlutoLadderTickerSettings[], form: PlutoSettingsFormState): BrokenDeltaRange[] {
  const strategyMin = Number(form.ladderMinAbsDelta);
  const strategyMax = Number(form.ladderMaxAbsDelta);
  return tickers.flatMap((ticker) => {
    const { minAbsDelta, maxAbsDelta } = ticker.tickerOverrides;
    if (minAbsDelta === null && maxAbsDelta === null) return [];
    const from = minAbsDelta ?? strategyMin;
    const to = maxAbsDelta ?? strategyMax;
    return from > to ? [{ symbol: ticker.symbol, from, to, ownLimit: minAbsDelta !== null && maxAbsDelta !== null ? "both" : minAbsDelta !== null ? "lower" : "upper" }] : [];
  });
}

/** Each enabled ticker's fit checks at a set of strategy values: its own overrides and pot, the last close. */
function tickerFitsAt(tickers: PlutoLadderTickerSettings[], values: Pick<PlutoSettings, "ladderSharesPct" | "ladderRungs" | "ladderShockMinPct" | "ladderShockMaxPct" | "ladderShockNoHistoryPct" | "capitalBudgetPct">, savedBudgetPct: number) {
  return tickers.flatMap((ticker) => {
    if (ticker.effectiveStrategy !== "cc_put_ladder" || ticker.potDollars === null || ticker.lastClose === null) return [];
    const shockPct = ticker.overrideShockPct ?? recommendedShockAt(ticker.recommendedShockSource, { minPct: values.ladderShockMinPct, maxPct: values.ladderShockMaxPct, noHistoryPct: values.ladderShockNoHistoryPct });
    if (shockPct === null) return [];
    // The pot is the allocation of the capital budget: it follows a budget being edited.
    const pot = (ticker.potDollars * values.capitalBudgetPct) / savedBudgetPct;
    const fit = ladderFit({ price: ticker.lastClose.price, pot, sharesPct: ticker.tickerOverrides.ladderSharesPct ?? values.ladderSharesPct, rungs: ticker.tickerOverrides.ladderRungs ?? values.ladderRungs, shockPct });
    return [{ symbol: ticker.symbol, pot, fit, fits: fit.lotFits && fit.putFits }];
  });
}

function FieldInput({ spec, value, onChange, id }: { spec: PlutoParameterSpec; value: string; onChange: (value: string) => void; id: string }) {
  if (spec.kind === "select") {
    return (
      <div className="pm-input">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {spec.options?.map((option) => (
            <option key={option} value={option}>
              {spec.optionLabels?.[option] ?? option}
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

/** A trader's group: every setting printed with its unit and the form's help, no inputs. */
function ReadOnlyGroupSettings({ rows, settings, context }: { rows: PlutoParameterSpec[][]; settings: PlutoSettings; context: PlutoParameterContext }) {
  return (
    <div className="pm-ro-grid">
      {rows.map((row) => {
        const lead = row[0]!;
        return (
          <div key={lead.field}>
            <ReadOnlySetting label={lead.label} help={<HelpTooltip text={plutoParameterHelp(lead, context)} />} value={formatSettingRowWithUnit(row, settings)} />
          </div>
        );
      })}
    </div>
  );
}

function GroupCard({ group, settings, form, changed, state, ladderTickers, brokenRanges, onChange, isOpen, onToggle, anchorRef, readOnly }: { group: PlutoParameterGroup; settings: PlutoSettings; form: PlutoSettingsFormState; changed: Set<string>; state: PlutoState | null; ladderTickers: PlutoLadderTickerSettings[] | null; brokenRanges: BrokenDeltaRange[]; onChange: (field: PlutoSettingsField, value: string) => void; isOpen: boolean; onToggle: () => void; anchorRef: (element: HTMLElement | null) => void; readOnly: boolean }) {
  const changedCount = group.parameters.filter((parameter) => changed.has(parameter.field)).length;
  const context: PlutoParameterContext = { netLiquidationValue: state?.book.netLiquidationValue ?? null, settings, ladderTickers };
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
          {!isOpen && <span className="pm-group-sum">· {group.parameters.length} {group.parameters.length === 1 ? "setting" : "settings"} · {group.summary(settings)}</span>}
        </h2>
        <CollapseButton open={isOpen} onToggle={onToggle} label={group.title} />
      </ToggleHeader>
      {isOpen && group.note && <div className="pm-group-note">{group.note}</div>}
      {isOpen && readOnly && <ReadOnlyGroupSettings rows={rows} settings={settings} context={context} />}
      {isOpen &&
        !readOnly &&
        rows.map((row, index) => {
          const lead = row[0]!;
          const rowChanged = row.some((parameter) => changed.has(parameter.field));
          const id = `pluto-field-${lead.field}`;
          return (
            <div key={lead.field} className={`pm-field${index === 0 ? " first" : ""}${rowChanged ? " changed" : ""}`}>
              <div>
                <label htmlFor={id}>{lead.label}</label>
                <div className="pm-help">{plutoParameterHelp(lead, context)}</div>
                {lead.field === "ladderMinAbsDelta" &&
                  brokenRanges.map((range) => (
                    <div key={range.symbol} className="pm-help t-bad">
                      {range.symbol}'s range would be {range.from.toFixed(2)}–{range.to.toFixed(2)}: its {range.ownLimit === "both" ? "limits are" : `${range.ownLimit} limit is`} its own. Change its override on the Tickers tab first.
                    </div>
                  ))}
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
                {rowChanged && <div className="pm-was">was {row.filter((parameter) => changed.has(parameter.field)).map((parameter) => formatSettingDisplay(parameter.field, String(settings[parameter.field]))).join(" / ")}</div>}
              </div>
            </div>
          );
        })}
    </section>
  );
}

export function PlutoSettingsTab({ settings, audit, loading, error, state, isPhone, onSaved, onOpenTickersTab }: PlutoSettingsTabProps) {
  const [edits, setEdits] = useState<PlutoSettingsEdits>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(readStoredOpenGroup);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const [ladderTickers, setLadderTickers] = useState<PlutoLadderTickerSettings[] | null>(null);
  const [version, setVersion] = useState<PlutoSettingsVersion | null>(null);
  // A trader reads the settings, printed, and never edits them (the API refuses a trader's save).
  const isAdmin = useIsAdmin();

  // The ladder's ticker values (overrides, pots, last closes) and the settings version, again whenever the settings change.
  const settingsUpdatedAt = settings?.updatedAt ?? null;
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchPlutoLadderSettings(), fetchPlutoSettingsVersion()])
      .then(([tickers, current]) => {
        if (cancelled) return;
        setLadderTickers(tickers);
        setVersion(current);
      })
      .catch(() => {
        // The ticker checks and the version are extras: the settings stay editable without them.
      });
    return () => {
      cancelled = true;
    };
  }, [settingsUpdatedAt]);

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

  // The form is the live saved settings with the person's own edits on top: a change saved elsewhere shows at once and is
  // never sent back by this person's save. A reload while they are mid-edit keeps the edits.
  const form = useMemo(() => (settings ? formStateWithEdits(settings, edits) : null), [settings, edits]);
  const changedElsewhere = useMemo(() => (settings ? settingsChangedElsewhere(settings, edits) : new Map<PlutoSettingsField, string>()), [settings, edits]);
  const changes = useMemo(() => (settings && form ? changedSettingsFields(settings, form) : []), [settings, form]);
  const changedFields = useMemo(() => new Set(changes.map((change) => change.field as string)), [changes]);
  const brokenRanges = useMemo(() => (ladderTickers && form ? brokenDeltaRanges(ladderTickers, form) : []), [ladderTickers, form]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (loading || !settings || !form) return <div className="pm-card"><div className="pm-empty">Loading settings…</div></div>;

  function updateField(field: PlutoSettingsField, value: string) {
    setEdits((previous) => applySettingsEdit(settings!, previous, field, value));
    setSaveError(null);
  }

  function discard() {
    setEdits({});
    setSaveError(null);
  }

  /** The change as the save bar and the dialog list it, saying so when someone else saved the field during the edit. */
  function describeChange(change: PlutoSettingsChange): string {
    const startedFrom = changedElsewhere.get(change.field);
    return startedFrom === undefined ? describeSettingsChange(change) : `${describeSettingsChange(change)} (someone else changed it from ${startedFrom} while you were editing)`;
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
      setEdits({});
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

  const numberAt = (field: PlutoSettingsField) => {
    const value = Number(form[field]);
    return Number.isFinite(value) && form[field].trim() !== "" ? value : Number(settings[field]);
  };
  const editedValues = { ladderSharesPct: numberAt("ladderSharesPct"), ladderRungs: numberAt("ladderRungs"), ladderShockMinPct: numberAt("ladderShockMinPct"), ladderShockMaxPct: numberAt("ladderShockMaxPct"), ladderShockNoHistoryPct: numberAt("ladderShockNoHistoryPct"), capitalBudgetPct: numberAt("capitalBudgetPct") };
  const fitsNow = ladderTickers ? tickerFitsAt(ladderTickers, editedValues, settings.capitalBudgetPct) : [];
  const fitsSaved = new Map((ladderTickers ? tickerFitsAt(ladderTickers, settings, settings.capitalBudgetPct) : []).map((entry) => [entry.symbol, entry.fits]));
  const flips = fitsNow.filter((entry) => fitsSaved.has(entry.symbol) && fitsSaved.get(entry.symbol) !== entry.fits);
  const checksCard = (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">Ticker checks</h2>
        <span className="pm-card-meta">at these values</span>
      </div>
      {ladderTickers === null ? (
        <div className="pm-empty">Loading the tickers…</div>
      ) : fitsNow.length === 0 ? (
        <div className="pm-empty">No enabled CC + Put Ladder ticker with a pot and a last close.</div>
      ) : (
        <ul className="pm-tk-checks">
          {fitsNow.map((entry) => {
            const flipped = fitsSaved.has(entry.symbol) && fitsSaved.get(entry.symbol) !== entry.fits;
            return (
              <li key={entry.symbol}>
                <b className="strong">{entry.symbol}</b>
                <span className={flipped ? "t-warn" : "muted"}>
                  {entry.fits ? `${formatCurrency(entry.pot, 0)} pot` : !entry.fit.lotFits ? "Shares don't buy a lot" : "A Put doesn't fit a rung"}
                  {flipped ? (entry.fits ? " · now fits" : " · stops fitting") : ""}
                </span>
                <span className={`pm-b ${entry.fits ? "ok" : "bad"}`}>{entry.fits ? "Fits" : "Doesn't fit"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="pm-card-foot">
        {isAdmin ? "Each enabled CC + Put Ladder ticker with its own overrides and pot at its last close, recomputed as you type." : "Each enabled CC + Put Ladder ticker with its own overrides and pot at its last close."}{" "}
        <button type="button" className="pm-link small" onClick={onOpenTickersTab}>
          Open the Tickers tab
        </button>
      </div>
    </section>
  );
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
                {plutoParameterLabelByField[row.field] ?? row.field} <code>{row.oldValue === null ? "—" : formatSettingDisplay(row.field, row.oldValue)} → {row.newValue === null ? "—" : formatSettingDisplay(row.field, row.newValue)}</code>{unit}
                <div className="who">
                  {row.userDisplayName ?? "—"} · {formatBrowserDayMonth(row.changedAt)} {formatBrowserClockTime(row.changedAt)}
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
        <span className="strong">{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</span> <span className="muted">· {changes.map(describeChange).join(" · ")}</span>
        {saveError && <div className="t-bad pm-wrap">{saveError}</div>}
        {brokenRanges.length > 0 && <div className="t-bad pm-wrap">{brokenRanges.map((range) => `${range.symbol}'s |delta| range would be ${range.from.toFixed(2)}–${range.to.toFixed(2)}.`).join(" ")} Change {brokenRanges.length === 1 ? "its override" : "their overrides"} on the Tickers tab first.</div>}
      </div>
      <button type="button" className="pm-btn" onClick={discard} disabled={saving}>
        Discard
      </button>
      <button type="button" className="pm-btn primary" onClick={() => setConfirming(true)} disabled={saving || brokenRanges.length > 0}>
        Review and save
      </button>
    </div>
  );

  return (
    <>
      {!isAdmin && <ViewOnlyNote className="mb-3">Only an admin can change Pluto's settings.</ViewOnlyNote>}
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
          {isAdmin && savebar}
          {plutoParameterGroups.map((group) => (
            <GroupCard key={group.key} group={group} settings={settings} form={form} changed={changedFields} state={state} ladderTickers={ladderTickers} brokenRanges={brokenRanges} onChange={updateField} isOpen={openGroup === group.key} onToggle={() => setOpenGroup((current) => (current === group.key ? null : group.key))} anchorRef={(element) => { groupRefs.current[group.key] = element; }} readOnly={!isAdmin} />
          ))}
        </div>
        <div className="pm-stack tight">
          {checksCard}
          {auditCard}
          <div className="pm-alert info">
            <InfoIcon />
            <div className="pm-alert-body">
              <div className="pm-alert-text">
                Saved changes apply at Pluto's next analysis. Each one is logged with who made it and shows in the activity feed.
                {version && ` Settings version ${version.number}${version.since ? ` · since ${formatBrowserDayMonth(version.since)} ${formatBrowserClockTime(version.since)}` : ""}.`}
              </div>
            </div>
          </div>
        </div>
      </div>
      {!isPhone && null}
      {isAdmin && confirming && (
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
                  <li key={change.field}>{describeChange(change)}</li>
                ))}
              </ul>
              {flips.length > 0 && (
                <>
                  <div className="confirm-sub">Ticker checks</div>
                  <ul className="pm-changes">
                    {flips.map((entry) => (
                      <li key={entry.symbol}>
                        {entry.symbol} {entry.fits ? "starts fitting" : "stops fitting"}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
