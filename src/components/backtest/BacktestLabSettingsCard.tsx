import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
import type { BacktestSettingRow } from "../../api/backtest";
import {
  fetchAllLabTickerOverrides,
  fetchBacktestLabGlobalAudit,
  fetchBacktestLabSettings,
  previewBacktestLabSettings,
  saveBacktestLabSettings,
  type AnalysisRerunOutcome,
  type BacktestLabAuditRow,
  type BacktestLabChangePreview,
  type BacktestLabSettingsView,
  type BacktestLabTickerOverrides,
} from "../../api/backtestAnalysis";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSignalsTickerModal } from "../../hooks/useSignalsTickerModal";
import { buildBacktestOverrides, formatSettingRowValue, isSettingChanged, settingInputText, settingValueProblem } from "../../lib/backtestPresentation";
import { formatCurrency, formatDateTime, formatDayMonthYear, formatNumber } from "../../lib/formatters";
import { ConfirmModal } from "../ConfirmModal";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { TickerAnalysisModal } from "./analysis/TickerAnalysisModal";
import { BacktestCardTitle } from "./backtestBits";
import { SettingInput } from "./BacktestSettingsTable";

// The Backtesting screen's Lab settings (mockup approved 2026-10-15): the global values every backtest and every ticker's
// analysis start from, separate from Pluto's live settings. Only the CC + Put Ladder's values (Marcelo 2026-10-15): the
// default pot, the fill's spread share and the Baseline wheel rows; New session still changes any value for one session.
// Save previews the changes and the analyses they re-run, then re-runs them; tickers keep their own overrides.

const potPath = "lab.defaultPotDollars";
const defaultsGroup = "Lab defaults";
const ladderGroup = "Baseline wheel";
/** Rows outside the Baseline wheel group that the ladder reads: the share of the half-spread a fill gives up. */
const ladderRowsElsewhere = ["trading.spreadCostChargedPct"];

/** The default pot as a settings row, so it reads and validates like the template's rows. */
function potRow(lab: BacktestLabSettingsView): BacktestSettingRow {
  return { path: potPath, group: ladderGroup, label: "Default pot", unit: "dollars", now: lab.defaultPotDollars, editable: true, note: "the dollars each ticker starts with in a backtest and its analysis, unless the ticker overrides it" };
}

interface LabGroup {
  name: string;
  rows: BacktestSettingRow[];
}

function labGroups(lab: BacktestLabSettingsView): LabGroup[] {
  return [
    { name: defaultsGroup, rows: [potRow(lab), ...lab.rows.filter((row) => ladderRowsElsewhere.includes(row.path))] },
    { name: ladderGroup, rows: lab.rows.filter((row) => row.group === ladderGroup) },
  ];
}

const initialValues = (groups: LabGroup[]) => Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [row.path, settingInputText(row.now)])));

/** "AAOI, BE, BMNR, COIN, CSCO and 13 more". */
function listSymbols(symbols: readonly string[], shown = 5): string {
  if (symbols.length <= shown + 1) return symbols.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${symbols.slice(0, shown).join(", ")} and ${symbols.length - shown} more`;
}

function describeRerun(change: BacktestLabChangePreview): string {
  const rerun = change.reruns.length === 0 ? "No stored analysis re-runs." : `Re-runs the stored analyses of ${formatNumber(change.reruns.length)} ticker${change.reruns.length === 1 ? "" : "s"} that don't override it: ${listSymbols(change.reruns)}.`;
  const kept = change.keptOverrides.length === 0 ? "" : ` ${listSymbols(change.keptOverrides)} keep${change.keptOverrides.length === 1 ? "s its" : " their"} own value.`;
  return rerun + kept;
}

export function BacktestLabSettingsCard() {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const { open: openTickerModal } = useSignalsTickerModal();
  const [lab, setLab] = useState<BacktestLabSettingsView | null>(null);
  const [overrides, setOverrides] = useState<BacktestLabTickerOverrides[] | null>(null);
  const [audit, setAudit] = useState<BacktestLabAuditRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ [defaultsGroup]: true, [ladderGroup]: true });
  const [preview, setPreview] = useState<{ changes: BacktestLabChangePreview[]; reruns: string[] } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AnalysisRerunOutcome | null>(null);
  const [analysedSymbol, setAnalysedSymbol] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextLab, nextOverrides, nextAudit] = await Promise.all([fetchBacktestLabSettings(), fetchAllLabTickerOverrides(), fetchBacktestLabGlobalAudit()]);
      setLab(nextLab);
      setOverrides(nextOverrides);
      setAudit(nextAudit);
      setValueByPath(initialValues(labGroups(nextLab)));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the lab settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => (lab ? labGroups(lab) : []), [lab]);
  const rowByPath = useMemo(() => new Map(groups.flatMap((group) => group.rows.map((row) => [row.path, row] as const))), [groups]);
  const changedPaths = useMemo(() => groups.flatMap((group) => group.rows.filter((row) => row.editable && isSettingChanged(row, valueByPath[row.path] ?? settingInputText(row.now))).map((row) => row.path)), [groups, valueByPath]);
  const problems = useMemo(
    () =>
      groups.flatMap((group) =>
        group.rows.flatMap((row) => {
          const text = valueByPath[row.path] ?? settingInputText(row.now);
          if (row.path === potPath) return Number(text.trim()) > 0 ? [] : ["Default pot needs a dollar amount above 0."];
          const problem = row.editable ? settingValueProblem(row, text) : null;
          return problem ? [problem] : [];
        }),
      ),
    [groups, valueByPath],
  );

  if (loadError) {
    return (
      <div className="card mb-3" id="backtest-lab-settings">
        <div className="card-body">
          <div className="alert alert-danger mb-0">{loadError}</div>
        </div>
      </div>
    );
  }
  if (!lab || !overrides || !audit) {
    return (
      <div className="card mb-3" id="backtest-lab-settings">
        <div className="card-body d-flex justify-content-center py-4">
          <Spinner label="Loading the lab settings" />
        </div>
      </div>
    );
  }

  const requestBody = () => {
    const pot = valueByPath[potPath];
    const templateRows = groups.flatMap((group) => group.rows).filter((row) => row.path !== potPath);
    return { overrides: buildBacktestOverrides(templateRows, valueByPath), ...(changedPaths.includes(potPath) && pot !== undefined ? { defaultPotDollars: Number(pot.trim()) } : {}) };
  };
  const startSave = async () => {
    setBusy("preview");
    setActionError(null);
    try {
      setPreview(await previewBacktestLabSettings(requestBody()));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not check the changes.");
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
      setActionError(error instanceof Error ? error.message : "Could not save the lab settings.");
    } finally {
      setBusy(null);
    }
  };
  const setValue = (path: string, value: string) => {
    setSaved(null);
    setValueByPath((current) => ({ ...current, [path]: value }));
  };
  const resetValue = (row: BacktestSettingRow) => setValue(row.path, settingInputText(row.now));
  const discard = () => {
    setValueByPath(initialValues(groups));
    setActionError(null);
  };
  const rowLabel = (field: string) => rowByPath.get(field)?.label ?? field;
  const formatValue = (field: string, value: string | null) => {
    const row = rowByPath.get(field);
    if (!row || value === null) return value ?? "—";
    return formatSettingRowValue(row, row.unit === "choice" || row.unit === "grade" || row.unit === "time" ? value : Number(value));
  };

  const rowControl = (row: BacktestSettingRow) => {
    const text = valueByPath[row.path] ?? settingInputText(row.now);
    const changed = changedPaths.includes(row.path);
    const invalid = row.path === potPath ? !(Number(text.trim()) > 0) : row.editable && settingValueProblem(row, text) !== null;
    if (!row.editable) return <span className="text-secondary">{formatSettingRowValue(row, row.now)} (fixed)</span>;
    return (
      <>
        <SettingInput row={row} value={text} changed={changed} invalid={invalid} onValueChange={(next) => setValue(row.path, next)} ariaLabel={`${row.label}, lab value`} />
        {changed && (
          <div className="backtest-lab-saved-line">
            Saved: {formatSettingRowValue(row, row.now)} ·{" "}
            <button type="button" className="analysis-link" onClick={() => resetValue(row)}>
              Reset
            </button>
          </div>
        )}
      </>
    );
  };

  const groupToggle = (group: LabGroup) => {
    const open = openGroups[group.name] ?? false;
    const changedHere = group.rows.filter((row) => changedPaths.includes(row.path)).length;
    return (
      <button type="button" className="backtest-lab-group-toggle" aria-expanded={open} onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !open }))}>
        {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
        <span className="subheader">{group.name}</span>
        <span className="text-secondary fw-normal">
          {formatNumber(group.rows.length)} setting{group.rows.length === 1 ? "" : "s"}
          {changedHere > 0 && ` · ${formatNumber(changedHere)} changed`}
        </span>
      </button>
    );
  };

  const settingsBody = isPhone ? (
    <div>
      {groups.map((group) => (
        <section key={group.name}>
          <div className="backtest-settings-group-band">{groupToggle(group)}</div>
          {(openGroups[group.name] ?? false) &&
            group.rows.map((row) => (
              <div key={row.path} className={`px-3 py-2 border-bottom${changedPaths.includes(row.path) ? " backtest-setting-changed-block" : ""}`}>
                <div className="fw-medium">{row.label}</div>
                {row.note && (
                  <div className="text-secondary" style={{ fontSize: "0.75rem", lineHeight: 1.35 }}>
                    {row.note}
                  </div>
                )}
                <div className="mt-1 backtest-lab-phone-input">{rowControl(row)}</div>
              </div>
            ))}
        </section>
      ))}
    </div>
  ) : (
    <div className="table-responsive">
      <table className="table table-sm table-vcenter card-table mb-0 backtest-lab-table">
        <thead className="table-light">
          <tr>
            <th>Setting</th>
            <th>Lab value</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="backtest-settings-group-row">
                <td colSpan={3}>{groupToggle(group)}</td>
              </tr>
              {(openGroups[group.name] ?? false) &&
                group.rows.map((row) => (
                  <tr key={row.path} className={changedPaths.includes(row.path) ? "backtest-setting-changed" : undefined}>
                    <td className="fw-medium">{row.label}</td>
                    <td>{rowControl(row)}</td>
                    <td className="text-secondary backtest-wrapping-note">{row.note}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  const overrideColumns: DataTableColumn<BacktestLabTickerOverrides>[] = [
    {
      key: "ticker",
      header: "Ticker",
      render: (row) => (
        <span className="d-inline-flex align-items-center gap-2">
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => openTickerModal(row.symbol)}>
            {row.symbol}
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAnalysedSymbol(row.symbol)}>
            Analyse
          </button>
        </span>
      ),
    },
    { key: "pot", header: "Pot", align: "right", render: (row) => (row.potDollars === null ? <span className="text-secondary">global</span> : formatCurrency(row.potDollars, 0)) },
    { key: "shares", header: "Shares", align: "right", render: (row) => (row.ladderSharesPct === null ? <span className="text-secondary">global</span> : `${formatNumber(row.ladderSharesPct)}%`) },
    { key: "shock", header: "Shock", align: "right", render: (row) => (row.ladderShockPct === null ? <span className="text-secondary">global</span> : `${formatNumber(row.ladderShockPct)}%`) },
    { key: "rungs", header: "Rungs", align: "right", render: (row) => (row.ladderRungs === null ? <span className="text-secondary">global</span> : formatNumber(row.ladderRungs)) },
    {
      key: "delta",
      header: "|delta|",
      align: "right",
      render: (row) => (row.minAbsDelta === null && row.maxAbsDelta === null ? <span className="text-secondary">global</span> : `${row.minAbsDelta?.toFixed(2) ?? "global"}–${row.maxAbsDelta?.toFixed(2) ?? "global"}`),
    },
    { key: "saved", header: "Saved", cellClassName: "font-mono text-secondary text-nowrap", render: (row) => formatDayMonthYear(row.updatedAt.slice(0, 10)) },
  ];

  const auditColumns: DataTableColumn<BacktestLabAuditRow>[] = [
    { key: "saved", header: "Saved", cellClassName: "font-mono text-secondary text-nowrap", render: (row) => formatDateTime(row.changedAt) },
    { key: "setting", header: "Setting", render: (row) => rowLabel(row.field) },
    {
      key: "change",
      header: "From → to",
      cellClassName: "backtest-lab-change-cell",
      render: (row) => {
        const text = `${formatValue(row.field, row.oldValue)} → ${formatValue(row.field, row.newValue)}`;
        // A choice's values are sentences: the text font, at most three lines (the whole change on hover).
        return (
          <span className={`backtest-lab-change${rowByPath.get(row.field)?.unit === "choice" ? "" : " font-mono"}`} title={text}>
            {text}
          </span>
        );
      },
    },
    { key: "by", header: "By", cellClassName: "text-secondary", render: (row) => row.userDisplayName ?? "—" },
    { key: "reruns", header: "Analyses re-run", align: "right", render: (row) => (row.analysesRerun === null ? "—" : formatNumber(row.analysesRerun)) },
  ];

  const changeCount = changedPaths.length;
  return (
    <>
      <div className="card mb-3" id="backtest-lab-settings">
        <div className="card-header">
          <BacktestCardTitle title="Lab settings" description="The global values every backtest and every ticker's analysis start from" />
        </div>
        <div className="card-body pb-2">
          <div className="analysis-note analysis-note-info">
            <IconInfoCircle size={18} className="backtest-lab-icon" aria-hidden="true" />
            <span>
              <strong>Backtesting is the lab.</strong> These values are separate from Pluto's live settings and never sync: changing one never changes the other, and live trading never reads them. A ticker's own overrides (pot, shares, shock, rungs, |delta|) win over them; a session can still change any value for itself on New session. Only the CC + Put Ladder's values are here.
            </span>
          </div>
        </div>
        {settingsBody}
        {actionError && <div className="alert alert-danger m-3 mb-0">{actionError}</div>}
        {saved && changeCount === 0 && (
          <div className="card-footer d-flex align-items-start gap-2" role="status" style={{ fontSize: "0.8rem" }}>
            <IconCircleCheck size={18} className="backtest-lab-icon analysis-ink-good" aria-hidden="true" />
            <span>
              <strong>Saved.</strong>{" "}
              {saved.started.length > 0 ? `Re-running ${formatNumber(saved.started.length)} stored analys${saved.started.length === 1 ? "is" : "es"} as background jobs (see Backtests under Background jobs above).` : "No stored analysis needed re-running."}
              {saved.skipped.length > 0 && ` Not re-run: ${saved.skipped.map((entry) => `${entry.symbol} (${entry.reason})`).join(", ")}.`} Past sessions keep their own settings.
            </span>
          </div>
        )}
        {changeCount > 0 && (
          <div className="card-footer backtest-lab-footer">
            <span className="backtest-lab-pending iorio-note-amber">
              {formatNumber(changeCount)} change{changeCount === 1 ? "" : "s"} not saved
            </span>
            {problems.length > 0 && <span className="backtest-lab-problem">{problems[0]}</span>}
            <span className="ms-auto d-inline-flex gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={discard} disabled={busy !== null}>
                Discard
              </button>
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={() => void startSave()} disabled={busy !== null || problems.length > 0}>
                {busy === "preview" && <Spinner size="sm" />}
                Save changes…
              </button>
            </span>
          </div>
        )}
      </div>
      <div className="row g-3 mb-3">
        <div className="col-lg-6">
          <DataTable
            tableId="backtest-lab-overrides"
            columns={overrideColumns}
            rows={overrides}
            rowKey={(row) => row.symbol}
            toolbar={<BacktestCardTitle title="Ticker overrides" description="Tickers with their own lab values; the rest use the global ones" />}
            emptyMessage="No ticker has its own lab values. They are saved in each ticker's Analyse window."
            dense
          />
          <p className="text-secondary mt-2 mb-0" style={{ fontSize: "0.75rem" }}>
            Overrides are saved in each ticker's Analyse window ("Save for …"). Global values an override doesn't cover still apply.
          </p>
        </div>
        <div className="col-lg-6">
          <DataTable
            tableId="backtest-lab-history"
            columns={auditColumns}
            rows={audit}
            rowKey={(row) => String(row.id)}
            toolbar={<BacktestCardTitle title="Change history" description="Every saved change to the global lab values, newest first" />}
            emptyMessage="No changes saved yet."
            dense
          />
        </div>
      </div>
      {preview && (
        <ConfirmModal
          title={`Save ${formatNumber(preview.changes.length)} change${preview.changes.length === 1 ? "" : "s"}?`}
          size="lg"
          danger={false}
          confirming={busy === "save"}
          confirmLabel={preview.reruns.length > 0 ? "Save and re-run" : "Save"}
          message={
            <div className="d-flex flex-column gap-2">
              {preview.changes.map((change) => (
                <div key={change.field} className="backtest-lab-confirm-change">
                  <div>
                    <strong>{rowLabel(change.field)}</strong>
                    <span className="text-secondary"> · {change.field === potPath || ladderRowsElsewhere.includes(change.field) ? defaultsGroup : ladderGroup}</span>
                  </div>
                  <div className="font-mono">{`${formatValue(change.field, change.oldValue)} → ${formatValue(change.field, change.newValue)}`}</div>
                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                    {describeRerun(change)}
                  </div>
                </div>
              ))}
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                {preview.reruns.length > 0 ? `${formatNumber(preview.reruns.length)} stored analys${preview.reruns.length === 1 ? "is re-runs" : "es re-run"} as background jobs. ` : ""}Past sessions keep their own settings.
              </div>
            </div>
          }
          onConfirm={() => void confirmSave()}
          onCancel={() => setPreview(null)}
        />
      )}
      {analysedSymbol && (
        <TickerAnalysisModal
          symbol={analysedSymbol}
          onClose={() => {
            setAnalysedSymbol(null);
            void load();
          }}
          onEditGlobalSettings={() => {
            setAnalysedSymbol(null);
            document.getElementById("backtest-lab-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}
    </>
  );
}
