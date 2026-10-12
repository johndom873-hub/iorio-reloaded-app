import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import {
  createBacktestSession,
  fetchBacktestSession,
  fetchBacktestSettingsTemplate,
  type BacktestDataFileSummary,
  type BacktestSessionDetail,
  type BacktestSettingsTemplate,
  type BacktestTablesMode,
} from "../../api/backtest";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard } from "../../components/backtest/backtestBits";
import { BacktestSettingsTable } from "../../components/backtest/BacktestSettingsTable";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { formatNumber, pluralize } from "../../lib/formatters";
import { buildBacktestOverrides, isSettingChanged, settingInputText, settingValueProblem, valueAtSettingsPath } from "../../lib/backtestPresentation";

const pageTitle = "New session";
const pageSubtitle = "Starts from Pluto's settings as they are now (saved with the session). Change any of them for this session only; Pluto itself is not touched.";
const defaultStartingValue = 1_000_000;

function usableFiles(files: BacktestDataFileSummary[]): BacktestDataFileSummary[] {
  return files.filter((file) => file.firstDate !== null && file.lastDate !== null);
}

function describeFileOption(file: BacktestDataFileSummary): string {
  return `${file.symbol} · ${file.firstDate} → ${file.lastDate}`;
}

function parseDollarText(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

function initialValueByPath(template: BacktestSettingsTemplate, source: BacktestSessionDetail | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of template.rows) {
    const fromSource = row.editable && source ? valueAtSettingsPath(source.session.overrides, row.path) : undefined;
    values[row.path] = settingInputText(fromSource ?? row.now);
  }
  return values;
}

// New session (mockup approved 2026-10-12): the period, the start, the history tables, and Pluto's settings with the session's
// own changes. "Run again with changes" opens it with ?from=<sessionId>, prefilled from that session.
export function NewBacktestSessionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceSessionId = searchParams.get("from");
  const { data: overview, loadError: overviewError } = useBacktestOverview();

  const [template, setTemplate] = useState<BacktestSettingsTemplate | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [sourceSession, setSourceSession] = useState<BacktestSessionDetail | null>(null);
  const [sourceLoaded, setSourceLoaded] = useState(sourceSessionId === null);
  const [initialized, setInitialized] = useState(false);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startingValueText, setStartingValueText] = useState(formatNumber(defaultStartingValue));
  const [tablesMode, setTablesMode] = useState<BacktestTablesMode>("walk_forward");
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBacktestSettingsTemplate()
      .then((loaded) => !cancelled && setTemplate(loaded))
      .catch((err) => !cancelled && setTemplateError(errorMessage(err, "Could not load Pluto's settings.")));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sourceSessionId === null) return;
    let cancelled = false;
    fetchBacktestSession(sourceSessionId)
      .then((loaded) => !cancelled && setSourceSession(loaded))
      .catch(() => undefined)
      .finally(() => !cancelled && setSourceLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [sourceSessionId]);

  const files = usableFiles(overview?.files ?? []);
  const selectedFile = files.find((file) => file.symbol === symbol) ?? null;

  useEffect(() => {
    if (initialized || !overview || !template || !sourceLoaded) return;
    const candidates = usableFiles(overview.files);
    const source = sourceSession?.session ?? null;
    const file = candidates.find((candidate) => candidate.symbol === source?.symbol) ?? candidates[0] ?? null;
    setSymbol(file?.symbol ?? "");
    setStartDate(source && file ? source.startDate : (file?.firstDate ?? ""));
    setEndDate(source && file ? source.endDate : (file?.lastDate ?? ""));
    if (source) {
      setName(source.name);
      setStartingValueText(formatNumber(source.startingValue));
      setTablesMode(source.tablesMode);
    }
    setValueByPath(initialValueByPath(template, sourceSession));
    setInitialized(true);
  }, [initialized, overview, template, sourceLoaded, sourceSession]);

  const changeSymbol = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    const file = files.find((candidate) => candidate.symbol === nextSymbol);
    if (file?.firstDate && file.lastDate) {
      setStartDate(file.firstDate);
      setEndDate(file.lastDate);
    }
  };

  const startingValue = parseDollarText(startingValueText);
  const settingRows = template?.rows ?? [];
  const changedCount = settingRows.filter((row) => row.editable && isSettingChanged(row, valueByPath[row.path] ?? String(row.now))).length;

  const problems: string[] = [];
  if (name.trim() === "") problems.push("Name the session.");
  if (!selectedFile) problems.push("Choose a symbol with a downloaded file.");
  if (!startDate || !endDate) problems.push("Choose a start and an end date.");
  else if (startDate >= endDate) problems.push("The start date must be before the end date.");
  else if (selectedFile && (startDate < selectedFile.firstDate! || endDate > selectedFile.lastDate!)) {
    problems.push(`The period must fall within ${selectedFile.symbol}'s file: ${selectedFile.firstDate} → ${selectedFile.lastDate}.`);
  }
  if (!(startingValue > 0)) problems.push("The starting account value must be a positive dollar amount.");
  for (const row of settingRows) {
    const problem = row.editable ? settingValueProblem(row, valueByPath[row.path] ?? String(row.now)) : null;
    if (problem) problems.push(problem);
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    if (problems.length > 0 || !template) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createBacktestSession({
        name: name.trim(),
        symbol,
        startDate,
        endDate,
        startingValue,
        tablesMode,
        overrides: buildBacktestOverrides(template.rows, valueByPath),
      });
      navigate("/backtest");
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not start the backtest."));
      setSubmitting(false);
    }
  };

  const loadError = overviewError ?? templateError;
  if (loadError) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <div className="alert alert-danger mt-3">{loadError}</div>
      </>
    );
  }

  if (!initialized || !template) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <div className="d-flex justify-content-center py-5">
          <Spinner label="Loading the session form" />
        </div>
      </>
    );
  }

  if (files.length === 0) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <div className="alert alert-info mt-3">
          No downloaded data files yet. Add a symbol under Data files on the <Link to="/backtest">Backtesting</Link> page first.
        </div>
      </>
    );
  }

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BacktestBackLink />
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />
      {sourceSessionId && !sourceSession && <div className="iorio-note-amber mb-2">The session to copy could not be loaded; the form starts from Pluto's settings.</div>}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <BacktestCard title="Session" className="mb-3">
          <div className="card-body">
            <div className="row g-3">
              <div className="col-12 col-lg-5">
                <label htmlFor="backtest-session-name" className="form-label">
                  Name
                </label>
                <input
                  id="backtest-session-name"
                  type="text"
                  className={`form-control${submitAttempted && name.trim() === "" ? " is-invalid" : ""}`}
                  placeholder="e.g. Edge Yield 20%"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-lg-4">
                <label htmlFor="backtest-session-symbol" className="form-label">
                  Symbol (downloaded files)
                </label>
                <select id="backtest-session-symbol" className="form-select" value={symbol} onChange={(event) => changeSymbol(event.target.value)}>
                  {files.map((file) => (
                    <option key={file.symbol} value={file.symbol}>
                      {describeFileOption(file)}
                    </option>
                  ))}
                </select>
                {selectedFile && selectedFile.missingWeekdays > 0 && (
                  <div className="iorio-note-amber mt-1" style={{ fontSize: "0.75rem" }}>
                    {pluralize(selectedFile.missingWeekdays, "weekday")} missing in this file: Update it first, or the session has gaps.
                  </div>
                )}
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <label htmlFor="backtest-session-capital" className="form-label">
                  Starting account value
                </label>
                <div className="input-group">
                  <span className="input-group-text">$</span>
                  <input
                    id="backtest-session-capital"
                    type="text"
                    inputMode="numeric"
                    className={`form-control font-mono${submitAttempted && !(startingValue > 0) ? " is-invalid" : ""}`}
                    value={startingValueText}
                    onChange={(event) => setStartingValueText(event.target.value)}
                    onBlur={() => startingValue > 0 && setStartingValueText(formatNumber(startingValue))}
                  />
                </div>
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <label htmlFor="backtest-session-start" className="form-label">
                  Start date
                </label>
                <input
                  id="backtest-session-start"
                  type="date"
                  className="form-control font-mono"
                  min={selectedFile?.firstDate ?? undefined}
                  max={selectedFile?.lastDate ?? undefined}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <label htmlFor="backtest-session-end" className="form-label">
                  End date
                </label>
                <input
                  id="backtest-session-end"
                  type="date"
                  className="form-control font-mono"
                  min={selectedFile?.firstDate ?? undefined}
                  max={selectedFile?.lastDate ?? undefined}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <label htmlFor="backtest-session-time" className="form-label">
                  Decision time
                </label>
                <input id="backtest-session-time" type="text" className="form-control font-mono" value="10:00 ET" disabled readOnly />
              </div>
              <div className="col-12 col-sm-6 col-lg-3">
                <label htmlFor="backtest-session-positions" className="form-label">
                  Positions
                </label>
                <select id="backtest-session-positions" className="form-select" value="held" onChange={() => undefined}>
                  <option value="held">Held to expiry</option>
                  <option value="managed" disabled>
                    Pluto's buybacks and rolls (later)
                  </option>
                </select>
              </div>
            </div>
            <fieldset className="row g-3 mt-1">
              <legend className="visually-hidden">History tables</legend>
              <div className="col-12 col-md-6">
                <label className="d-flex gap-2 align-items-start p-3 border rounded h-100" style={{ cursor: "pointer" }}>
                  <input type="radio" className="form-check-input mt-1 flex-shrink-0" name="backtest-tables-mode" checked={tablesMode === "walk_forward"} onChange={() => setTablesMode("walk_forward")} />
                  <span>
                    <strong>Walk-forward history</strong> <span className="text-secondary">(recommended)</span>
                    <span className="d-block text-secondary" style={{ fontSize: "0.8rem" }}>
                      Each year is tested with history tables built only from the years before it, so the results never use what was learned later.
                    </span>
                  </span>
                </label>
              </div>
              <div className="col-12 col-md-6">
                <label className="d-flex gap-2 align-items-start p-3 border rounded h-100" style={{ cursor: "pointer" }}>
                  <input type="radio" className="form-check-input mt-1 flex-shrink-0" name="backtest-tables-mode" checked={tablesMode === "current"} onChange={() => setTablesMode("current")} />
                  <span>
                    <strong>Current tables</strong>
                    <span className="d-block text-secondary" style={{ fontSize: "0.8rem" }}>
                      The tables Pluto uses today: quicker, but they have seen the answers, so results look better than they would have been.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </div>
        </BacktestCard>

        <BacktestCard
          title="Settings"
          description={changedCount === 0 ? "Pluto's settings as they are now" : `${pluralize(changedCount, "setting")} changed for this session`}
          actions={
            changedCount > 0 && (
              <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.8rem" }} onClick={() => setValueByPath(initialValueByPath(template, null))}>
                Reset all to Pluto's
              </button>
            )
          }
          className="mb-3"
        >
          <BacktestSettingsTable
            rows={template.rows}
            valueByPath={valueByPath}
            onValueChange={(path, value) => setValueByPath((previous) => ({ ...previous, [path]: value }))}
            onReset={(path) => {
              const row = template.rows.find((candidate) => candidate.path === path);
              if (row) setValueByPath((previous) => ({ ...previous, [path]: settingInputText(row.now) }));
            }}
          />
          {template.notReplayed.length > 0 && (
            <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
              <strong>Not replayed in a session:</strong>
              <ul className="mb-0 mt-1 ps-3">
                {template.notReplayed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </BacktestCard>

        {submitAttempted && problems.length > 0 && (
          <div className="alert alert-danger">
            <ul className="mb-0 ps-3">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {submitError && <div className="alert alert-danger">{submitError}</div>}
        <div className="d-flex gap-2 justify-content-end flex-wrap">
          <Link to="/backtest" className="btn btn-outline-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={submitting}>
            {submitting && <Spinner size="sm" />}
            Start backtest
          </button>
        </div>
        <div className="text-secondary text-end mt-2" style={{ fontSize: "0.78rem" }}>
          Runs in the background; its progress shows under Background jobs.
        </div>
      </form>
    </div>
  );
}
