import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import {
  backtestMaxSymbolsPerSession,
  createBacktestSession,
  estimateBacktestSession,
  fetchBacktestSession,
  fetchBacktestSettingsTemplate,
  type BacktestDataFileSummary,
  type BacktestSessionDetail,
  type BacktestSessionEstimateResponse,
  type BacktestSettingsTemplate,
  type BacktestTablesMode,
  type CreateBacktestSessionResponse,
} from "../../api/backtest";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard } from "../../components/backtest/backtestBits";
import { BacktestSettingsTable } from "../../components/backtest/BacktestSettingsTable";
import { BacktestSymbolPicker } from "../../components/backtest/BacktestSymbolPicker";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatNumber, pluralizeCount } from "../../lib/formatters";
import {
  buildBacktestOverrides,
  describeLlmEstimate,
  formatSettingRowValue,
  isSettingChanged,
  llmSessionNote,
  settingInputText,
  settingValueProblem,
  valueAtSettingsPath,
} from "../../lib/backtestPresentation";

const pageTitle = "New session";
const pageSubtitle = "Starts from Pluto's settings as they are now (saved with the session). Change any of them for this session only; Pluto itself is not touched.";
const defaultStartingValue = 1_000_000;
/** The estimate is asked for once the form has stopped changing this long. */
const estimateDebounceMs = 600;

function usableFiles(files: BacktestDataFileSummary[]): BacktestDataFileSummary[] {
  return files.filter((file) => file.firstDate !== null && file.lastDate !== null);
}

/** The period every picked file covers: the latest first date to the earliest last date; null when they do not overlap. */
function sharedCoverage(files: BacktestDataFileSummary[]): { firstDate: string; lastDate: string } | null {
  if (files.length === 0) return null;
  const firstDate = files.map((file) => file.firstDate!).reduce((latest, date) => (date > latest ? date : latest));
  const lastDate = files.map((file) => file.lastDate!).reduce((earliest, date) => (date < earliest ? date : earliest));
  return firstDate < lastDate ? { firstDate, lastDate } : null;
}

/** "10:00 – 15:30 ET": Pluto's window from the settings rows; null when the template has none. */
function describeLooks(template: BacktestSettingsTemplate): string | null {
  const from = template.rows.find((row) => row.path === "pluto.windowStartEt");
  const until = template.rows.find((row) => row.path === "pluto.windowEndEt");
  if (!from || !until) return null;
  return `${String(from.now)} – ${formatSettingRowValue(until, until.now)}`;
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
  const [symbols, setSymbols] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startingValueText, setStartingValueText] = useState(formatNumber(defaultStartingValue));
  const [tablesMode, setTablesMode] = useState<BacktestTablesMode>("walk_forward");
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBacktestSessionResponse | null>(null);

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
  const selectedFiles = symbols.map((picked) => files.find((file) => file.symbol === picked)).filter((file): file is BacktestDataFileSummary => file !== undefined);
  const coverage = sharedCoverage(selectedFiles);

  useEffect(() => {
    if (initialized || !overview || !template || !sourceLoaded) return;
    const candidates = usableFiles(overview.files);
    const source = sourceSession?.session ?? null;
    const sourceSymbols = (source ? (source.symbols.length > 0 ? source.symbols : [source.symbol]) : []).filter((picked) => candidates.some((candidate) => candidate.symbol === picked));
    const initialSymbols = sourceSymbols.length > 0 ? sourceSymbols : candidates[0] ? [candidates[0].symbol] : [];
    const initialCoverage = sharedCoverage(initialSymbols.map((picked) => candidates.find((candidate) => candidate.symbol === picked)!));
    setSymbols(initialSymbols);
    setStartDate(source && sourceSymbols.length > 0 ? source.startDate : (initialCoverage?.firstDate ?? ""));
    setEndDate(source && sourceSymbols.length > 0 ? source.endDate : (initialCoverage?.lastDate ?? ""));
    if (source) {
      setName(source.name);
      setStartingValueText(formatNumber(source.startingValue));
      setTablesMode(source.tablesMode);
    }
    setValueByPath(initialValueByPath(template, sourceSession));
    setInitialized(true);
  }, [initialized, overview, template, sourceLoaded, sourceSession]);

  /** Picking or dropping a symbol sets the period to all that the picked files share, as picking one did. */
  const changeSymbols = (nextSymbols: string[]) => {
    setSymbols(nextSymbols);
    const nextCoverage = sharedCoverage(nextSymbols.map((picked) => files.find((file) => file.symbol === picked)).filter((file): file is BacktestDataFileSummary => file !== undefined));
    if (nextCoverage) {
      setStartDate(nextCoverage.firstDate);
      setEndDate(nextCoverage.lastDate);
    }
  };

  const startingValue = parseDollarText(startingValueText);
  const settingRows = template?.rows ?? [];

  // With the AI model deciding: the model calls and hours the session may take, and its warnings, before anything starts.
  const decidedByModel = valueByPath["decisionMaker"] === "llm";
  const estimateRequestText = useMemo(() => {
    if (!template || !decidedByModel || symbols.length === 0 || !startDate || !endDate || !(startingValue > 0)) return null;
    // The endpoint needs no name (an unnamed form still gets its estimate).
    return JSON.stringify({ name: name.trim(), symbols, startDate, endDate, startingValue, tablesMode, overrides: buildBacktestOverrides(template.rows, valueByPath) });
  }, [template, decidedByModel, name, symbols, startDate, endDate, startingValue, tablesMode, valueByPath]);
  const debouncedEstimateRequestText = useDebouncedValue(estimateRequestText, estimateDebounceMs);
  const [estimate, setEstimate] = useState<{ requestText: string; result: BacktestSessionEstimateResponse | null; error: string | null } | null>(null);
  useEffect(() => {
    if (debouncedEstimateRequestText === null) return;
    let cancelled = false;
    estimateBacktestSession(JSON.parse(debouncedEstimateRequestText))
      .then((result) => !cancelled && setEstimate({ requestText: debouncedEstimateRequestText, result, error: null }))
      .catch((err) => !cancelled && setEstimate({ requestText: debouncedEstimateRequestText, result: null, error: errorMessage(err, "Could not estimate the session.") }));
    return () => {
      cancelled = true;
    };
  }, [debouncedEstimateRequestText]);
  const estimateIsCurrent = estimate !== null && estimate.requestText === estimateRequestText;
  const changedCount = settingRows.filter((row) => row.editable && isSettingChanged(row, valueByPath[row.path] ?? String(row.now))).length;

  const problems: string[] = [];
  if (name.trim() === "") problems.push("Name the session.");
  if (selectedFiles.length === 0) problems.push("Pick at least one symbol with a downloaded file.");
  else if (selectedFiles.length > backtestMaxSymbolsPerSession) problems.push(`Pick at most ${backtestMaxSymbolsPerSession} symbols.`);
  else if (!coverage) problems.push("The picked files share no period: drop the symbol whose file starts after another's ends.");
  if (!startDate || !endDate) problems.push("Choose a start and an end date.");
  else if (startDate >= endDate) problems.push("The start date must be before the end date.");
  else if (coverage && (startDate < coverage.firstDate || endDate > coverage.lastDate)) {
    problems.push(`The period must fall within every picked file: ${coverage.firstDate} → ${coverage.lastDate}.`);
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
      const response = await createBacktestSession({
        name: name.trim(),
        symbols,
        startDate,
        endDate,
        startingValue,
        tablesMode,
        overrides: buildBacktestOverrides(template.rows, valueByPath),
      });
      // What the session will do differently because of its files (it still runs) stays on screen; otherwise straight back.
      if (response.warnings.length > 0) {
        setCreated(response);
        setSubmitting(false);
        window.scrollTo({ top: 0 });
      } else {
        navigate("/backtest");
      }
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not start the backtest."));
      setSubmitting(false);
    }
  };

  const loadError = overviewError ?? templateError;
  const looks = template ? describeLooks(template) : null;
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

  if (created) {
    return (
      <div style={{ maxWidth: "1100px" }}>
        <BacktestBackLink />
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        {/* Tabler's .alert is a flex row: each alert's content sits in one block so it reads top to bottom. */}
        <div className="alert alert-success" role="status">
          <div>
            <strong>{created.session.name}</strong> ({created.session.symbol}) is queued; its progress shows under Background jobs.
            {created.llmEstimate && <div className="mt-1">The AI model decides. {describeLlmEstimate(created.llmEstimate)}.</div>}
          </div>
        </div>
        <div className="alert alert-warning" role="status">
          <div>
            <div className="fw-semibold mb-1">It runs, with {created.warnings.length === 1 ? "this difference" : "these differences"} from what its files hold:</div>
            <ul className="mb-0 ps-3">
              {created.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap justify-content-end">
          <Link to="/backtest" className="btn btn-outline-secondary">
            Back to Backtesting
          </Link>
          <Link to={`/backtest/sessions/${created.session.id}`} className="btn btn-primary">
            Open the session
          </Link>
        </div>
      </div>
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
              <div className="col-12 col-lg-6">
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
                <label htmlFor="backtest-session-positions" className="form-label">
                  Positions
                </label>
                <input id="backtest-session-positions" type="text" className="form-control" value="The full wheel" disabled readOnly aria-describedby="backtest-session-positions-hint" />
                <div id="backtest-session-positions-hint" className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                  assignment, calls on the shares, rolls and buybacks
                </div>
              </div>
              <div className="col-12 col-lg-6">
                <BacktestSymbolPicker files={files} selected={symbols} onChange={changeSymbols} invalid={submitAttempted && (selectedFiles.length === 0 || !coverage)} />
                {selectedFiles.length > 1 && (
                  <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                    {symbols.join(", ")} share one book: one cash balance, one account.
                  </div>
                )}
              </div>
              <div className="col-12 col-lg-6">
                <div className="row g-3">
                  <div className="col-12 col-sm-6">
                    <label htmlFor="backtest-session-start" className="form-label">
                      Start date
                    </label>
                    <input
                      id="backtest-session-start"
                      type="date"
                      className="form-control font-mono"
                      min={coverage?.firstDate}
                      max={coverage?.lastDate}
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                  </div>
                  <div className="col-12 col-sm-6">
                    <label htmlFor="backtest-session-end" className="form-label">
                      End date
                    </label>
                    <input
                      id="backtest-session-end"
                      type="date"
                      className="form-control font-mono"
                      min={coverage?.firstDate}
                      max={coverage?.lastDate}
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                    />
                  </div>
                  <div className="col-12 text-secondary" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    {coverage
                      ? `${selectedFiles.length > 1 ? "Every picked file covers" : "The file covers"} ${coverage.firstDate} → ${coverage.lastDate}; the period must lie inside it.`
                      : selectedFiles.length > 1
                        ? "The picked files share no period."
                        : "Pick a symbol to set the period."}
                  </div>
                  {looks && (
                    <div className="col-12">
                      <label htmlFor="backtest-session-looks" className="form-label">
                        Looks
                      </label>
                      <input id="backtest-session-looks" type="text" className="form-control font-mono" value={looks} disabled readOnly aria-describedby="backtest-session-looks-hint" />
                      <div id="backtest-session-looks-hint" className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                        a look every 30 minutes in Pluto's window on the days a file holds intraday quotes; one look at 10:00 on the others
                      </div>
                    </div>
                  )}
                </div>
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
          description={changedCount === 0 ? "Pluto's settings as they are now" : `${pluralizeCount(changedCount, "setting")} changed for this session`}
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

        {decidedByModel && (
          <BacktestCard title="The AI model" description="what the session may take, before it starts" className="mb-3">
            <div className="card-body py-2" style={{ fontSize: "0.85rem", lineHeight: 1.5 }} aria-live="polite">
              {estimateRequestText === null ? (
                <div className="text-secondary">Pick the symbols, the period and the starting value for an estimate.</div>
              ) : !estimateIsCurrent ? (
                <Spinner size="sm" label="Estimating the model calls" />
              ) : estimate.error ? (
                <div className="text-danger">{estimate.error}</div>
              ) : estimate.result?.llmEstimate ? (
                <div className="fw-semibold">
                  {describeLlmEstimate(estimate.result.llmEstimate)}
                  <span className="text-secondary fw-normal"> · over {pluralizeCount(estimate.result.llmEstimate.tradingDays, "trading day")}, an upper bound</span>
                </div>
              ) : (
                <div className="text-secondary">No estimate: the session would run on the rules.</div>
              )}
              <div className="text-secondary mt-1">{llmSessionNote}</div>
              {estimateIsCurrent && estimate.result && estimate.result.warnings.length > 0 && (
                <ul className="mb-0 mt-2 ps-3 iorio-note-amber">
                  {estimate.result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </BacktestCard>
        )}
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
