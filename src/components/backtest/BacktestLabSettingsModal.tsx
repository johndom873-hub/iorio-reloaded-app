import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BacktestDecisionMaker, BacktestSettingRow, BacktestSettingSection } from "../../api/backtest";
import {
  fetchBacktestLabGlobalAudit,
  fetchBacktestLabSettings,
  previewBacktestLabSettings,
  saveBacktestLabSettings,
  type AnalysisLabSaveOutcome,
  type BacktestLabAuditRow,
  type BacktestLabChangePreview,
  type BacktestLabSettingsView,
} from "../../api/backtestAnalysis";
import { buildBacktestOverrides, decisionMakerLabel, formatSettingRowValue, gradeOptions, isSettingChanged, settingInputText, settingValueProblem, tradeGradeLabel } from "../../lib/backtestPresentation";
import { ApiError } from "../../api/client";
import {
  backtestSettingGroupSummary,
  backtestSettingLines,
  backtestSettingSectionNotes,
  backtestSettingSectionTitles,
  groupBacktestSettingRows,
  isRetiredBacktestSettingSection,
  labelSettingPaths,
  retiredSectionNames,
  settingAppliesNow,
  settingPathsInMessage,
  type BacktestSettingLine,
} from "../../lib/backtestSettingGroups";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, pluralizeCount } from "../../lib/formatters";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";
import { CheckIcon, CollapseButton, InfoIcon, ToggleHeader } from "../pluto/plutoBits";
import "../pluto/PlutoPage.css";

// The Backtesting screen's Lab settings (mockups approved 2026-10-19, without the CC + Put Ladder, v2 and v3 2026-11-02):
// every setting a new session and the Analyse window start from, in Pluto's settings editor (section nav, one group open
// at a time, unsaved changes highlighted, review before saving): the rows every session reads, the Steady Stake's and
// Vol Farmer v4's. Separate from Pluto's live settings. Saving marks out of date the stored analyses whose values it
// changes (Vol Farmer v4, Marcelo 2026-11-01); Data files' Re-run out of date runs them again.

const potPath = "lab.defaultPotDollars";
const spreadCostPath = "trading.spreadCostChargedPct";
const labDefaultsKey = "lab-defaults";

interface EditorGroup {
  key: string;
  title: string;
  section: BacktestSettingSection;
  rows: BacktestSettingRow[];
}

/** The analysis's starting account as a settings row, so it reads and validates like the template's rows. */
function potRow(lab: BacktestLabSettingsView): BacktestSettingRow {
  return { path: potPath, group: "How the session runs", section: "every_session", label: "Analysis starting account", unit: "dollars", now: lab.defaultPotDollars, editable: true, note: "the account each ticker's analysis starts with; a trial in the Analyse window can try another" };
}

/** Lab defaults first (the analysis's account and the fill's spread share), then the template's groups that can still change a session. */
function editorGroups(lab: BacktestLabSettingsView): EditorGroup[] {
  const spreadRow = lab.rows.find((row) => row.path === spreadCostPath);
  const defaults: EditorGroup = { key: labDefaultsKey, title: "Lab defaults", section: "every_session", rows: [potRow(lab), ...(spreadRow ? [spreadRow] : [])] };
  const rest = groupBacktestSettingRows(lab.rows.filter((row) => row.path !== spreadCostPath && !isRetiredBacktestSettingSection(row.section))).map((group) => ({ key: group.group, title: group.group, section: group.section, rows: group.rows }));
  return [defaults, ...rest];
}

const initialValues = (groups: EditorGroup[]) => Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [row.path, settingInputText(row.now)])));
const fieldId = (path: string) => `lab-setting-${path.replace(/\./g, "-")}`;
const groupDomId = (key: string) => `lab-settings-${key.replace(/\W+/g, "-").toLowerCase()}`;

/** "AAOI, BE, BMNR, COIN, CSCO and 13 more". */
function listSymbols(symbols: readonly string[], shown = 5): string {
  if (symbols.length <= shown + 1) return symbols.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${symbols.slice(0, shown).join(", ")} and ${symbols.length - shown} more`;
}

function describeOutOfDate(change: BacktestLabChangePreview): string {
  return change.outOfDate.length === 0 ? "No stored analysis goes out of date with it." : `Puts the stored analyses of ${pluralizeCount(change.outOfDate.length, "ticker")} out of date: ${listSymbols(change.outOfDate)}.`;
}

const unitSuffix: Partial<Record<BacktestSettingRow["unit"], string>> = { percent: "%", days: "days", time: "ET" };

function FieldInput({ row, value, onChange, id }: { row: BacktestSettingRow; value: string; onChange: (value: string) => void; id: string }) {
  if (!row.editable) {
    return (
      <div className="pm-input lab-settings-fixed">
        <span className="lab-settings-fixed-value">{row.unit === "time" ? String(row.now) : formatSettingRowValue(row, row.now)}</span>
        {row.unit === "time" && <span className="unit">ET</span>}
      </div>
    );
  }
  if (row.unit === "choice" || row.unit === "grade") {
    const options = row.unit === "grade" ? gradeOptions.map((grade) => ({ value: grade, label: tradeGradeLabel(grade), unavailableReason: undefined as string | undefined })) : (row.choices ?? []);
    return (
      <div className="pm-input">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {!options.some((option) => option.value === value) && <option value={value}>{value}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={Boolean(option.unavailableReason)} title={option.unavailableReason}>
              {option.unavailableReason ? `${option.label} (${option.unavailableReason})` : option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const suffix = unitSuffix[row.unit];
  return (
    <div className="pm-input">
      {row.unit === "dollars" && <span className="unit lab-settings-prefix">$</span>}
      <input id={id} type="text" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
      {suffix && <span className="unit">{suffix}</span>}
    </div>
  );
}

/** stacked: opened over another window (the Analyse window), so above its backdrop. */
export function BacktestLabSettingsModal({ onClose, stacked = false }: { onClose: () => void; stacked?: boolean }) {
  const [lab, setLab] = useState<BacktestLabSettingsView | null>(null);
  const [audit, setAudit] = useState<BacktestLabAuditRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  // Lab defaults open on every opening (Marcelo 2026-10-19), one group at a time.
  const [openGroup, setOpenGroup] = useState<string | null>(labDefaultsKey);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ changes: BacktestLabChangePreview[]; outOfDate: string[] } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AnalysisLabSaveOutcome | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  const load = useCallback(async () => {
    try {
      const [nextLab, nextAudit] = await Promise.all([fetchBacktestLabSettings(), fetchBacktestLabGlobalAudit()]);
      setLab(nextLab);
      setAudit(nextAudit);
      setValueByPath(initialValues(editorGroups(nextLab)));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the lab settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => (lab ? editorGroups(lab) : []), [lab]);
  const rowByPath = useMemo(() => new Map(groups.flatMap((group) => group.rows.map((row) => [row.path, row] as const))), [groups]);
  const textOf = useCallback((path: string) => valueByPath[path] ?? (rowByPath.has(path) ? settingInputText(rowByPath.get(path)!.now) : ""), [valueByPath, rowByPath]);
  const changedPaths = useMemo(() => groups.flatMap((group) => group.rows.filter((row) => row.editable && isSettingChanged(row, textOf(row.path))).map((row) => row.path)), [groups, textOf]);
  const problems = useMemo(
    () =>
      groups.flatMap((group) =>
        group.rows.flatMap((row) => {
          const text = textOf(row.path);
          if (row.path === potPath) return Number(text.trim()) > 0 ? [] : ["Analysis starting account needs a dollar amount above 0."];
          const problem = row.editable ? settingValueProblem(row, text) : null;
          return problem ? [problem] : [];
        }),
      ),
    [groups, textOf],
  );
  const hasChanges = changedPaths.length > 0;

  const requestClose = useCallback(() => {
    if (busy !== null) return;
    if (hasChanges) setConfirmingDiscard(true);
    else onClose();
  }, [busy, hasChanges, onClose]);

  // ESC closes, asking first when there are unsaved changes; the review and the discard question ignore it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && preview === null && !confirmingDiscard) requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose, preview, confirmingDiscard]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Scroll once the group has opened and the one above it has closed, so the target lands where the layout settles.
  useEffect(() => {
    if (scrollTarget === null) return;
    groupRefs.current[scrollTarget]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTarget(null);
  }, [scrollTarget, openGroup]);

  const shownValue = (path: string, text = textOf(path)) => {
    const row = rowByPath.get(path);
    if (!row) return text;
    if (path === potPath) return formatCurrency(Number(text), 0);
    return formatSettingRowValue(row, row.unit === "choice" || row.unit === "grade" || row.unit === "time" ? text : Number(text));
  };
  // The history holds the retired decision makers' changes too: their rows are no longer edited here, but still named.
  const retiredRowByPath = useMemo(() => new Map((lab?.rows ?? []).filter((row) => isRetiredBacktestSettingSection(row.section)).map((row) => [row.path, row] as const)), [lab]);
  const formatAuditValue = (field: string, value: string | null) => {
    if (value === null) return "—";
    if (field === "decisionMaker") return `${decisionMakerLabel[value as BacktestDecisionMaker] ?? value}${rowByPath.get(field)?.choices?.some((choice) => choice.value === value) ? "" : " (retired)"}`;
    const retiredRow = retiredRowByPath.get(field);
    return retiredRow ? formatSettingRowValue(retiredRow, retiredRow.unit === "choice" || retiredRow.unit === "grade" || retiredRow.unit === "time" ? value : Number(value)) : shownValue(field, value);
  };
  const rowLabel = (field: string) => {
    const retiredRow = retiredRowByPath.get(field);
    if (retiredRow) return `${retiredSectionNames[retiredRow.section] ?? retiredRow.group} · ${retiredRow.label} (retired)`;
    return rowByPath.get(field)?.label ?? field;
  };
  const groupTitleOf = (field: string) => groups.find((group) => group.rows.some((row) => row.path === field))?.title ?? "";

  const requestBody = () => {
    const pot = valueByPath[potPath];
    const templateRows = groups.flatMap((group) => group.rows).filter((row) => row.path !== potPath);
    return { overrides: buildBacktestOverrides(templateRows, valueByPath), ...(changedPaths.includes(potPath) && pot !== undefined ? { defaultPotDollars: Number(pot.trim()) } : {}) };
  };
  const allRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  /** The API's refusal with the settings it names written as their labels. */
  const refusal = (message: string) => labelSettingPaths(message, allRows);

  // The server's own checks as you edit (Marcelo 2026-10-19): half a second after the last change the values go to the
  // preview (nothing written), and a refusal shows on the rows it names and holds Review and save.
  const requestBodyText = hasChanges && problems.length === 0 ? JSON.stringify(requestBody()) : null;
  const [serverCheck, setServerCheck] = useState<{ bodyText: string; problem: string | null } | null>(null);
  useEffect(() => {
    if (requestBodyText === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewBacktestLabSettings(JSON.parse(requestBodyText))
        .then(() => {
          if (!cancelled) setServerCheck({ bodyText: requestBodyText, problem: null });
        })
        .catch((error) => {
          // Only a refusal of the values counts; a network failure leaves Review and save to say so.
          if (!cancelled && error instanceof ApiError && error.status === 400) setServerCheck({ bodyText: requestBodyText, problem: error.message });
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [requestBodyText]);
  const serverProblem = serverCheck !== null && serverCheck.bodyText === requestBodyText ? serverCheck.problem : null;
  const serverProblemPaths = serverProblem ? settingPathsInMessage(serverProblem) : [];
  const startSave = async () => {
    setBusy("preview");
    setActionError(null);
    try {
      setPreview(await previewBacktestLabSettings(requestBody()));
    } catch (error) {
      setActionError(error instanceof Error ? refusal(error.message) : "Could not check the changes.");
    } finally {
      setBusy(null);
    }
  };
  const confirmSave = async () => {
    setBusy("save");
    try {
      const result = await saveBacktestLabSettings(requestBody());
      setPreview(null);
      setSaved(result.analyses);
      await load();
    } catch (error) {
      setPreview(null);
      setActionError(error instanceof Error ? refusal(error.message) : "Could not save the lab settings.");
    } finally {
      setBusy(null);
    }
  };
  const setValue = (path: string, value: string) => {
    setSaved(null);
    setActionError(null);
    setValueByPath((current) => ({ ...current, [path]: value }));
  };
  const discard = () => {
    setValueByPath(initialValues(groups));
    setActionError(null);
  };
  const jumpTo = (key: string) => {
    setOpenGroup(key);
    setScrollTarget(key);
  };

  const groupSummary = (group: EditorGroup) =>
    group.key === labDefaultsKey ? `${shownValue(potPath)} analysis account · spread cost ${shownValue(spreadCostPath)}` : backtestSettingGroupSummary(group.rows[0]!.group, textOf, (path) => shownValue(path));

  const fieldLine = (line: BacktestSettingLine, index: number) => {
    const lead = line.rows[0]!;
    const lineChanged = line.rows.filter((row) => changedPaths.includes(row.path));
    const applies = line.rows.every((row) => settingAppliesNow(row, textOf));
    const notes = [...new Set(line.rows.map((row) => row.note).filter((note): note is string => note !== null))];
    return (
      <div key={lead.path} className={`pm-field${index === 0 ? " first" : ""}${lineChanged.length > 0 ? " changed" : ""}`}>
        <div>
          <label htmlFor={fieldId(lead.path)} className="lab-settings-label">
            {line.label}
            {!lead.editable && <span className="pm-b neutral">Fixed</span>}
            {!applies && <span className="pm-b info">Not applied now</span>}
          </label>
          {notes.map((note) => (
            <div key={note} className="pm-help">
              {note}
            </div>
          ))}
          {!applies && lead.appliesWhen && <div className="pm-help lab-settings-condition">{lead.appliesWhen.explanation}</div>}
          {serverProblem && line.rows.some((row) => serverProblemPaths.includes(row.path)) && <div className="pm-help t-bad">{refusal(serverProblem)}</div>}
        </div>
        <div>
          {line.rows.length > 1 && line.rows.every((row) => row.editable) ? (
            <div className="pm-pair">
              {line.rows.map((row) => (
                <FieldInput key={row.path} row={row} id={fieldId(row.path)} value={textOf(row.path)} onChange={(value) => setValue(row.path, value)} />
              ))}
            </div>
          ) : line.rows.length > 1 ? (
            <div className="pm-input lab-settings-fixed">
              <span className="lab-settings-fixed-value">{line.rows.map((row) => String(row.now)).join(" – ")}</span>
              {lead.unit === "time" && <span className="unit">ET</span>}
            </div>
          ) : (
            <FieldInput row={lead} id={fieldId(lead.path)} value={textOf(lead.path)} onChange={(value) => setValue(lead.path, value)} />
          )}
          {lineChanged.length > 0 && <div className="pm-was">was {lineChanged.map((row) => shownValue(row.path, settingInputText(row.now))).join(" / ")}</div>}
        </div>
      </div>
    );
  };

  const groupCard = (group: EditorGroup) => {
    const isOpen = openGroup === group.key;
    const changedCount = group.rows.filter((row) => changedPaths.includes(row.path)).length;
    // Opening a group scrolls its title to the top, so its settings come into view.
    const toggle = () => {
      if (isOpen) return setOpenGroup(null);
      setOpenGroup(group.key);
      setScrollTarget(group.key);
    };
    return (
      <section
        key={group.key}
        className="pm-card lab-settings-group"
        id={groupDomId(group.key)}
        ref={(element) => {
          groupRefs.current[group.key] = element;
        }}
      >
        <ToggleHeader className={`pm-card-h${isOpen ? "" : " flat"}`} onToggle={toggle}>
          <h3 className="pm-card-t">
            {group.title}
            {changedCount > 0 && <span className="pm-b warn">{changedCount} unsaved</span>}
            {!isOpen && (
              <span className="pm-group-sum">
                · {pluralizeCount(group.rows.length, "setting")} · {groupSummary(group)}
              </span>
            )}
          </h3>
          <CollapseButton open={isOpen} onToggle={toggle} label={group.title} />
        </ToggleHeader>
        {isOpen && backtestSettingLines(group.rows).map(fieldLine)}
      </section>
    );
  };

  const sections: BacktestSettingSection[] = ["every_session", "steady_stake", "vol_farmer_v4"];

  let body;
  if (loadError) body = <div className="alert alert-danger">{loadError}</div>;
  else if (!lab || !audit) {
    body = (
      <div className="d-flex justify-content-center py-5">
        <Spinner label="Loading the lab settings" />
      </div>
    );
  } else {
    const auditRows = showAllAudit ? audit : audit.slice(0, 6);
    body = (
      <>
        <div className="pm-settings">
          <nav className="pm-card pm-snav lab-settings-snav" aria-label="Setting groups">
            {sections.map((section) => (
              <div key={section} className="lab-settings-snav-section">
                <div className="lab-settings-snav-title">{backtestSettingSectionTitles[section]}</div>
                {groups
                  .filter((group) => group.section === section)
                  .map((group) => {
                    const pending = group.rows.some((row) => changedPaths.includes(row.path));
                    return (
                      <a
                        key={group.key}
                        href={`#${groupDomId(group.key)}`}
                        className={openGroup === group.key ? "active" : undefined}
                        aria-current={openGroup === group.key ? "true" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          jumpTo(group.key);
                        }}
                      >
                        {group.title}
                        {pending ? <i className="pend" title="Unsaved change" /> : <span>{group.rows.length}</span>}
                      </a>
                    );
                  })}
              </div>
            ))}
          </nav>
          <div className="pm-stack tight">
            {hasChanges && (
              <div className="pm-savebar" role="status">
                <i className="pend" aria-hidden="true" />
                <div className="body">
                  <span className="strong">
                    {changedPaths.length} unsaved {changedPaths.length === 1 ? "change" : "changes"}
                  </span>{" "}
                  <span className="muted">· {changedPaths.map((path) => `${rowLabel(path)} ${shownValue(path, settingInputText(rowByPath.get(path)!.now))} → ${shownValue(path)}`).join(" · ")}</span>
                  {problems.length > 0 && <div className="t-bad pm-wrap">{problems[0]}</div>}
                  {serverProblem && <div className="t-bad pm-wrap">{refusal(serverProblem)}</div>}
                  {actionError && actionError !== (serverProblem && refusal(serverProblem)) && <div className="t-bad pm-wrap">{actionError}</div>}
                </div>
                <button type="button" className="pm-btn" onClick={discard} disabled={busy !== null}>
                  Discard
                </button>
                <button type="button" className="pm-btn primary" onClick={() => void startSave()} disabled={busy !== null || problems.length > 0 || serverProblem !== null}>
                  {busy === "preview" && <Spinner size="sm" />}
                  Review and save
                </button>
              </div>
            )}
            {saved && !hasChanges && (
              <div className="pm-alert info" role="status">
                <CheckIcon className="ic" />
                <div className="pm-alert-body">
                  <div className="pm-alert-text">
                    <strong>Saved.</strong>{" "}
                    {saved.markedOutOfDate.length > 0 ? `${pluralizeCount(saved.markedOutOfDate.length, "stored analysis is", "stored analyses are")} out of date now (${listSymbols(saved.markedOutOfDate)}): Data files' Re-run out of date runs them again.` : "No stored analysis reads the values changed."} Past sessions keep their own settings.
                  </div>
                </div>
              </div>
            )}
            {!hasChanges && actionError && <div className="alert alert-danger mb-0">{actionError}</div>}
            {sections.map((section) => (
              <div key={section} className="pm-stack tight">
                {backtestSettingSectionNotes[section] && (
                  <>
                    <h3 className="lab-settings-section-title">{backtestSettingSectionTitles[section]}</h3>
                    <div className="pm-alert info">
                      <InfoIcon />
                      <div className="pm-alert-body">
                        <div className="pm-alert-text">{backtestSettingSectionNotes[section]}</div>
                      </div>
                    </div>
                  </>
                )}
                {groups.filter((group) => group.section === section).map(groupCard)}
              </div>
            ))}
          </div>
          <div className="pm-stack tight">
            <section className="pm-card">
              <div className="pm-card-h">
                <h3 className="pm-card-t">Recent changes</h3>
                {audit.length > 6 && (
                  <button type="button" className="pm-link small" onClick={() => setShowAllAudit((open) => !open)}>
                    {showAllAudit ? "Fewer" : "All"}
                  </button>
                )}
              </div>
              {audit.length === 0 ? (
                <div className="pm-empty">No changes yet.</div>
              ) : (
                <ul className="pm-audit">
                  {auditRows.map((row) => (
                    <li key={row.id}>
                      <span className="medium">{rowLabel(row.field)}</span>
                      <div className="lab-settings-audit-change">
                        {formatAuditValue(row.field, row.oldValue)} → {formatAuditValue(row.field, row.newValue)}
                      </div>
                      <div className="who">
                        {row.userDisplayName ?? "—"} · {formatBrowserDayMonth(row.changedAt)} {formatBrowserClockTime(row.changedAt)}
                        {row.analysesRerun !== null && row.analysesRerun > 0 && ` · re-ran ${pluralizeCount(row.analysesRerun, "analysis", "analyses")}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="pm-alert info">
              <InfoIcon />
              <div className="pm-alert-body">
                <div className="pm-alert-text">These values are separate from Pluto's live settings and never sync. A session can still change any of them for itself on New session.</div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: stacked ? 1100 : 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block lab-settings-modal" style={{ zIndex: stacked ? 1100 : 1050 }} role="dialog" aria-modal="true" aria-labelledby="lab-settings-title">
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-inset">
          <div className="modal-content">
            <div className="modal-header">
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <h5 className="modal-title" id="lab-settings-title">
                  Lab settings
                </h5>
                <div className="text-secondary lab-settings-subtitle">The starting values of every new backtesting session and of the Analyse window. They never sync with Pluto's live settings.</div>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={requestClose} disabled={busy !== null} />
            </div>
            <div className="modal-body pm">{body}</div>
          </div>
        </div>
      </div>
      {preview && (
        <ConfirmModal
          stacked
          title={`Save ${pluralizeCount(preview.changes.length, "change")}?`}
          size="lg"
          danger={false}
          confirming={busy === "save"}
          confirmLabel="Save"
          message={
            <div className="d-flex flex-column gap-2">
              {preview.changes.map((change) => (
                <div key={change.field} className="backtest-lab-confirm-change">
                  <div>
                    <strong>{rowLabel(change.field)}</strong>
                    <span className="text-secondary"> · {groupTitleOf(change.field)}</span>
                  </div>
                  <div>{`${formatAuditValue(change.field, change.oldValue)} → ${formatAuditValue(change.field, change.newValue)}`}</div>
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    {describeOutOfDate(change)}
                  </div>
                </div>
              ))}
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                {preview.outOfDate.length > 0 ? `${pluralizeCount(preview.outOfDate.length, "stored analysis goes", "stored analyses go")} out of date; none re-runs until you choose Re-run out of date on Data files. ` : ""}New sessions start from these values; past sessions keep their own settings.
              </div>
            </div>
          }
          onConfirm={() => void confirmSave()}
          onCancel={() => setPreview(null)}
        />
      )}
      {confirmingDiscard && (
        <ConfirmModal
          stacked
          title="Discard your changes?"
          message={`${pluralizeCount(changedPaths.length, "unsaved change")} will be lost: ${changedPaths.map(rowLabel).join(", ")}.`}
          cancelLabel="Keep editing"
          confirmLabel="Discard and close"
          onCancel={() => setConfirmingDiscard(false)}
          onConfirm={() => {
            setConfirmingDiscard(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
