import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { labelSettingPaths } from "../../lib/backtestSettingGroups";
import {
  backtestMaxRunsPerBatch,
  backtestMaxSymbolsPerSession,
  createBacktestBatch,
  estimateBacktestSession,
  fetchBacktestBatch,
  fetchBacktestSession,
  fetchBacktestSettingsTemplate,
  type BacktestBatchDetail,
  type BacktestDataFileSummary,
  type BacktestDecisionMaker,
  type BacktestSessionDetail,
  type BacktestSessionEstimateResponse,
  type BacktestSettingsOverrides,
  type BacktestSettingsSource,
  type BacktestSettingsTemplate,
  type BacktestTablesMode,
  type BacktestTickerValueKey,
  type CreateBacktestBatchRequest,
  type CreateBacktestBatchResponse,
  type CreateBacktestSessionRequest,
} from "../../api/backtest";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard, BacktestSegmentedSwitch } from "../../components/backtest/backtestBits";
import { BacktestSettingsTable } from "../../components/backtest/BacktestSettingsTable";
import { BacktestRunsCard, type BacktestRunView } from "../../components/backtest/BacktestRunsCard";
import { BacktestStartBatchConfirmBody } from "../../components/backtest/BacktestStartBatchConfirmBody";
import { BacktestStartSessionConfirmBody } from "../../components/backtest/BacktestStartSessionConfirmBody";
import { BacktestSymbolPicker } from "../../components/backtest/BacktestSymbolPicker";
import { BacktestTickerValuesCard } from "../../components/backtest/BacktestTickerValuesCard";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatCurrency, formatNumber, pluralizeCount } from "../../lib/formatters";
import {
  buildBacktestOverrides,
  decisionMakerHint,
  describeLlmEstimate,
  describeOverrideChanges,
  describeTickerProblem,
  describeUnavailableChoices,
  describeYearOption,
  formatSettingRowValue,
  isSettingChanged,
  llmSessionNote,
  parseDollarAmountText,
  sessionDecisionMaker,
  settingInputText,
  settingValueProblem,
  tickerValueGroupAllKeys,
  tickerValueInputText,
  tickerValueTextProblem,
  valueAtSettingsPath,
  wholeYearsContaining,
  wholeYearsDates,
  wholeYearsMatching,
  yearsInPeriod,
  type BacktestPeriodMode,
  type BacktestTickerValueGroup,
} from "../../lib/backtestPresentation";
import { batchVaryTargets, describeRunDifferences, describeVaryPreview, parseVaryValues, type BatchRunValues, type BatchVary } from "../../lib/backtestBatchPresentation";
import {
  buildTickerRowModels,
  buildTickerSymbolSettings,
  hasTickerEdits,
  isTickerEditActive,
  tickerEditProblems,
  tickerEditsFromSession,
  tickerValueBelowEdit,
  type BacktestCapitalMode,
  type BacktestTickerEdits,
  type BacktestTickerResolution,
} from "../../lib/backtestTickerValueEdits";

const pageTitle = "New session";
const pageSubtitle = "Starts from the lab's settings as they are now (saved with the session). Change any of them for this session only; the lab itself is not touched.";
const defaultStartingValue = 1_000_000;
/** The estimate is asked for once the form has stopped changing this long. */
const estimateDebounceMs = 600;
/** The Decision maker sits in the Session card, not in the Settings table. */
const decisionMakerPath = "decisionMaker";

const periodModeOptions: { value: BacktestPeriodMode; label: string }[] = [
  { value: "years", label: "Whole years" },
  { value: "custom", label: "Custom dates" },
];

const capitalModeOptions: { value: BacktestCapitalMode; label: string }[] = [
  { value: "pots", label: "Each ticker's pot" },
  { value: "split", label: "Split a starting value equally" },
];

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

function initialValueByPath(template: BacktestSettingsTemplate, source: BacktestSessionDetail | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of template.rows) {
    const fromSource = row.editable && source ? valueAtSettingsPath(source.session.overrides, row.path) : undefined;
    values[row.path] = settingInputText(fromSource ?? row.now);
  }
  return values;
}

/** A run of a batch on the form (mockup approved 2026-10-17): its tickers and the values typed for them; `key` stays with the
 *  run while runs are added, duplicated or removed. */
interface BacktestRunDraft {
  key: string;
  symbols: string[];
  edits: BacktestTickerEdits;
}

type BacktestRunsMode = "one" | "several";

const runsModeOptions: { value: BacktestRunsMode; label: string }[] = [
  { value: "one", label: "One run" },
  { value: "several", label: "Several runs" },
];

/** The overrides without some paths (the decision maker, or the per-ticker baseline values). */
function overridesWithout(overrides: BacktestSettingsOverrides, keep: (path: string) => boolean): BacktestSettingsOverrides {
  const result: Record<string, unknown> = {};
  for (const [root, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === "object") {
      const kept = Object.fromEntries(Object.entries(value).filter(([field]) => keep(`${root}.${field}`)));
      if (Object.keys(kept).length > 0) result[root] = kept;
    } else if (keep(root)) result[root] = value;
  }
  return result as BacktestSettingsOverrides;
}

// New session (mockups approved 2026-10-12, for per-ticker pots 2026-10-15, for several runs 2026-10-17): the period, the
// decision maker, the capital, each ticker's pot and values with the Baseline deciding, the history tables, and the lab's
// settings with the session's own changes. With the Baseline deciding, Several runs starts up to 9 runs on the same period and
// settings, each with its own tickers and values (a batch). Every start is a batch: one run is a batch of one. "Run again with
// changes" opens it with ?from=<sessionId> or ?fromBatch=<batchId>, prefilled from it; the Data files card's Backtest opens it
// with ?symbols=<SYMBOL,SYMBOL>, those symbols picked.
export function NewBacktestSessionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceSessionId = searchParams.get("from");
  const sourceBatchId = searchParams.get("fromBatch");
  const requestedSymbolsParam = searchParams.get("symbols");
  const { data: overview, loadError: overviewError } = useBacktestOverview();

  const [template, setTemplate] = useState<BacktestSettingsTemplate | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  // A refusal names settings by key ("baseline.putsWhenNoCall"); shown by their labels. A ref, so the estimate callbacks read the loaded rows.
  const templateRowsRef = useRef<BacktestSettingsTemplate["rows"]>([]);
  templateRowsRef.current = template?.rows ?? [];
  const refusalText = (err: unknown, fallback: string) => labelSettingPaths(errorMessage(err, fallback), templateRowsRef.current);
  const [sourceSession, setSourceSession] = useState<BacktestSessionDetail | null>(null);
  const [sourceBatch, setSourceBatch] = useState<BacktestBatchDetail | null>(null);
  const [sourceLoaded, setSourceLoaded] = useState(sourceSessionId === null && sourceBatchId === null);
  const [initialized, setInitialized] = useState(false);

  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  // The period: whole years (From / To, the dates derived from the shared period) or custom dates. Opens on whole years.
  const [periodMode, setPeriodMode] = useState<BacktestPeriodMode>("years");
  const [fromYear, setFromYear] = useState<number | null>(null);
  const [toYear, setToYear] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startingValueText, setStartingValueText] = useState(formatNumber(defaultStartingValue));
  // The Baseline deciding: each ticker's pot (the capital their sum), or one starting value split equally.
  const [capitalMode, setCapitalMode] = useState<BacktestCapitalMode>("pots");
  const [settingsSource, setSettingsSource] = useState<BacktestSettingsSource>("per_ticker");
  const [tickerEdits, setTickerEdits] = useState<BacktestTickerEdits>({});
  const [tablesMode, setTablesMode] = useState<BacktestTablesMode>("walk_forward");
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBacktestBatchResponse | null>(null);
  // Several runs (the Baseline deciding): each run's tickers and typed values; the other fields are every run's.
  const [runsMode, setRunsMode] = useState<BacktestRunsMode>("one");
  const [runs, setRuns] = useState<BacktestRunDraft[]>([]);
  const [vary, setVary] = useState<BatchVary>({ key: "ladderSharesPct", ticker: "*", text: "" });
  const nextRunKey = useRef(1);
  const newRunKey = () => `run-${nextRunKey.current++}`;

  useEffect(() => {
    let cancelled = false;
    fetchBacktestSettingsTemplate()
      .then((loaded) => !cancelled && setTemplate(loaded))
      .catch((err) => !cancelled && setTemplateError(errorMessage(err, "Could not load the lab's settings.")));
    return () => {
      cancelled = true;
    };
  }, []);

  // A batch to run again: its first run's session gives the shared fields, its runs the runs.
  useEffect(() => {
    if (sourceBatchId === null) return;
    let cancelled = false;
    fetchBacktestBatch(sourceBatchId)
      .then(async (batch) => {
        if (cancelled) return;
        setSourceBatch(batch);
        const firstRun = batch.runs[0];
        if (firstRun) {
          const session = await fetchBacktestSession(firstRun.session.id);
          if (!cancelled) setSourceSession(session);
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setSourceLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [sourceBatchId]);

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
    const sourceRuns = sourceBatch && sourceBatch.runs.length > 1 ? sourceBatch.runs : null;
    const sourceSymbols = (sourceRuns ? [...new Set(sourceRuns.flatMap((run) => run.session.symbols))] : source ? (source.symbols.length > 0 ? source.symbols : [source.symbol]) : []).filter((picked) =>
      candidates.some((candidate) => candidate.symbol === picked),
    );
    const requestedSymbols = [...new Set((requestedSymbolsParam ?? "").split(",").map((picked) => picked.trim().toUpperCase()))].filter((picked) =>
      candidates.some((candidate) => candidate.symbol === picked),
    );
    const initialSymbols = sourceSymbols.length > 0 ? sourceSymbols : requestedSymbols.length > 0 ? requestedSymbols : candidates[0] ? [candidates[0].symbol] : [];
    const initialCoverage = sharedCoverage(initialSymbols.map((picked) => candidates.find((candidate) => candidate.symbol === picked)!));
    setSymbols(initialSymbols);
    const copiedDates = source && sourceSymbols.length > 0 ? { startDate: source.startDate, endDate: source.endDate } : null;
    setStartDate(copiedDates?.startDate ?? initialCoverage?.firstDate ?? "");
    setEndDate(copiedDates?.endDate ?? initialCoverage?.lastDate ?? "");
    // A copied session opens on whole years when some From / To gives its dates exactly, else on its own dates.
    const copiedYears = copiedDates && initialCoverage ? wholeYearsMatching(copiedDates.startDate, copiedDates.endDate, initialCoverage) : null;
    const coverageYears = initialCoverage ? yearsInPeriod(initialCoverage) : [];
    setPeriodMode(copiedDates && !copiedYears ? "custom" : "years");
    setFromYear(copiedYears?.fromYear ?? coverageYears[0] ?? null);
    setToYear(copiedYears?.toYear ?? coverageYears.at(-1) ?? null);
    if (source) {
      setName(source.name);
      setStartingValueText(formatNumber(source.startingValue));
      setTablesMode(source.tablesMode);
      // A session of per-ticker pots comes back with how it was asked for: its ticker values' source, its capital (a starting
      // value split equally, or each ticker's pot) and the values it gave its tickers itself; the rest come from the lab again.
      if (source.bookMode === "pots") {
        const potsFromStartingValue = source.potsFromStartingValue === true;
        setSettingsSource(source.settingsSource ?? "per_ticker");
        setCapitalMode(potsFromStartingValue ? "split" : "pots");
        setTickerEdits(tickerEditsFromSession(source.symbolSettings, !potsFromStartingValue));
      } else if (sessionDecisionMaker(source) === "baseline") {
        // A Baseline session from before per-ticker pots ran on one starting value.
        setCapitalMode("split");
      }
    }
    if (sourceBatch) setName(sourceBatch.batch.name);
    if (sourceRuns) {
      setRunsMode("several");
      setRuns(
        sourceRuns.map((run) => ({
          key: `run-${nextRunKey.current++}`,
          symbols: run.session.symbols.filter((picked) => sourceSymbols.includes(picked)),
          edits: tickerEditsFromSession(run.symbolSettings, true),
        })),
      );
    }
    setValueByPath(initialValueByPath(template, sourceSession));
    setInitialized(true);
  }, [initialized, overview, template, sourceLoaded, sourceSession, sourceBatch, requestedSymbolsParam]);

  /** Picking or dropping a symbol: custom dates become all that the picked files share; years narrowed by hand stay while they
   *  are still inside that period, and otherwise (or when they were all of the old period) become all of it. With no shared
   *  period the dates are cleared and the years cannot be picked. */
  const changeSymbols = (nextSymbols: string[]) => {
    setSymbols(nextSymbols);
    // With several runs, a symbol picked goes into every run and one dropped leaves every run (D6).
    if (several) {
      const added = nextSymbols.filter((picked) => !symbols.includes(picked));
      const removed = symbols.filter((picked) => !nextSymbols.includes(picked));
      setRuns((previous) =>
        previous.map((run) => ({
          ...run,
          symbols: [...run.symbols.filter((picked) => !removed.includes(picked)), ...added.filter((picked) => !run.symbols.includes(picked))],
          edits: Object.fromEntries(Object.entries(run.edits).filter(([symbol]) => !removed.includes(symbol))),
        })),
      );
    }
    const nextCoverage = sharedCoverage(nextSymbols.map((picked) => files.find((file) => file.symbol === picked)).filter((file): file is BacktestDataFileSummary => file !== undefined));
    setStartDate(nextCoverage?.firstDate ?? "");
    setEndDate(nextCoverage?.lastDate ?? "");
    if (!nextCoverage) return;
    const nextYears = yearsInPeriod(nextCoverage);
    const currentYears = coverage ? yearsInPeriod(coverage) : [];
    const yearsWereAllOfThePeriod = fromYear === currentYears[0] && toYear === currentYears.at(-1);
    if (fromYear === null || toYear === null || yearsWereAllOfThePeriod || !nextYears.includes(fromYear) || !nextYears.includes(toYear)) {
      setFromYear(nextYears[0]!);
      setToYear(nextYears.at(-1)!);
    }
  };

  const yearOptions = coverage ? yearsInPeriod(coverage) : [];
  const yearsPeriod = coverage && fromYear !== null && toYear !== null && yearOptions.includes(fromYear) && yearOptions.includes(toYear) ? wholeYearsDates(fromYear, toYear, coverage) : null;
  // What the session is sent and estimated on: the derived dates on whole years, the date fields on custom dates.
  const sessionStartDate = periodMode === "years" ? (yearsPeriod?.startDate ?? "") : startDate;
  const sessionEndDate = periodMode === "years" ? (yearsPeriod?.endDate ?? "") : endDate;

  /** Whole years → custom: the fields take the derived dates. Custom → whole years: the years holding the dates, clamped to the
   *  shared period. */
  const changePeriodMode = (nextMode: BacktestPeriodMode) => {
    if (nextMode === periodMode) return;
    if (nextMode === "custom" && yearsPeriod) {
      setStartDate(yearsPeriod.startDate);
      setEndDate(yearsPeriod.endDate);
    }
    if (nextMode === "years" && coverage) {
      const containing = wholeYearsContaining(startDate, endDate, coverage);
      setFromYear(containing.fromYear);
      setToYear(containing.toYear);
    }
    setPeriodMode(nextMode);
  };

  /** From moved past To takes To with it; To never lists a year before From. */
  const changeFromYear = (year: number) => {
    setFromYear(year);
    if (toYear === null || toYear < year) setToYear(year);
  };

  const startingValue = parseDollarAmountText(startingValueText);
  const allRows = template?.rows ?? [];
  const settingRows = allRows.filter((row) => row.path !== decisionMakerPath);
  const decisionMakerRow = allRows.find((row) => row.path === decisionMakerPath) ?? null;
  const decisionMaker = (valueByPath[decisionMakerPath] ?? "rules") as BacktestDecisionMaker;
  const decidedByModel = decisionMaker === "llm";
  // The Baseline runs per-ticker pots: each ticker its pot and ladder values. The rules and the AI model run one starting value.
  const perTickerPots = decisionMaker === "baseline";
  // Several runs only with the Baseline deciding (D1): only it has ticker values. Each run's capital is the sum of its pots (D4).
  const several = perTickerPots && runsMode === "several";
  const showTickersCard = perTickerPots && !several && selectedFiles.length > 0;
  const showRunsCard = several && selectedFiles.length > 0;
  const usesStartingValue = !perTickerPots || (!several && capitalMode === "split");

  // The estimate: what the session will do differently because of its files, each ticker's values with the Baseline deciding,
  // and the model's calls with the AI model. The latest answer stays on screen while the next is worked out.
  const [estimate, setEstimate] = useState<{ requestText: string; result: BacktestSessionEstimateResponse | null; error: string | null } | null>(null);
  const [latestResult, setLatestResult] = useState<BacktestSessionEstimateResponse | null>(null);
  const latestResolution = useMemo<BacktestTickerResolution | null>(
    () => (latestResult?.resolvedBySymbol ? { capital: latestResult.capital, bySymbol: latestResult.resolvedBySymbol } : null),
    [latestResult],
  );
  const overrides = useMemo(() => (template ? buildBacktestOverrides(template.rows, valueByPath) : {}), [template, valueByPath]);
  const symbolSettings = useMemo(
    () => (perTickerPots ? buildTickerSymbolSettings(symbols, tickerEdits, latestResolution, capitalMode) : null),
    [perTickerPots, symbols, tickerEdits, latestResolution, capitalMode],
  );
  const requestText = useMemo(() => {
    if (!template || symbols.length === 0 || !sessionStartDate || !sessionEndDate) return null;
    if (usesStartingValue && !(startingValue > 0)) return null;
    // The endpoint needs no name (an unnamed form still gets its estimate).
    const request: CreateBacktestSessionRequest = { name: name.trim(), symbols, startDate: sessionStartDate, endDate: sessionEndDate, tablesMode, overrides };
    if (usesStartingValue) request.startingValue = startingValue;
    if (perTickerPots) {
      request.settingsSource = settingsSource;
      if (symbolSettings && Object.keys(symbolSettings).length > 0) request.symbolSettings = symbolSettings;
    }
    return JSON.stringify(request);
  }, [template, name, symbols, sessionStartDate, sessionEndDate, usesStartingValue, startingValue, tablesMode, overrides, perTickerPots, settingsSource, symbolSettings]);
  // The name does not change the estimate: it is asked again only when something else changes.
  const estimateRequestText = useMemo(() => (requestText === null ? null : JSON.stringify({ ...JSON.parse(requestText), name: "" })), [requestText]);
  const debouncedEstimateRequestText = useDebouncedValue(estimateRequestText, estimateDebounceMs);
  useEffect(() => {
    if (debouncedEstimateRequestText === null) return;
    let cancelled = false;
    estimateBacktestSession(JSON.parse(debouncedEstimateRequestText))
      .then((result) => {
        if (cancelled) return;
        setEstimate({ requestText: debouncedEstimateRequestText, result, error: null });
        setLatestResult(result);
      })
      .catch((err) => !cancelled && setEstimate({ requestText: debouncedEstimateRequestText, result: null, error: refusalText(err, "Could not estimate the session.") }));
    return () => {
      cancelled = true;
    };
  }, [debouncedEstimateRequestText]);
  const estimateIsCurrent = estimate !== null && estimate.requestText === estimateRequestText;
  const currentResult = estimateIsCurrent ? estimate.result : null;
  const estimatePending = estimateRequestText !== null && !estimateIsCurrent;
  const changedCount = settingRows.filter((row) => row.editable && isSettingChanged(row, valueByPath[row.path] ?? String(row.now))).length;
  const orderedSymbols = [...symbols].sort();

  // ---- Several runs: each run estimated on its own, as a session request of its tickers and values ----
  const [runEstimates, setRunEstimates] = useState<Record<string, { requestText: string; result: BacktestSessionEstimateResponse | null; error: string | null }>>({});
  const [runLatestResults, setRunLatestResults] = useState<Record<string, BacktestSessionEstimateResponse>>({});
  const runResolutions = useMemo<Record<string, BacktestTickerResolution | null>>(
    () => Object.fromEntries(Object.entries(runLatestResults).map(([key, result]) => [key, result.resolvedBySymbol ? { capital: result.capital, bySymbol: result.resolvedBySymbol } : null])),
    [runLatestResults],
  );
  const runRequestTexts = useMemo<Record<string, string | null>>(() => {
    if (!several || !template || !sessionStartDate || !sessionEndDate) return {};
    return Object.fromEntries(
      runs.map((run) => {
        if (run.symbols.length === 0) return [run.key, null];
        const runSymbolSettings = buildTickerSymbolSettings(run.symbols, run.edits, runResolutions[run.key] ?? null, "pots");
        const request: CreateBacktestSessionRequest = { name: "", symbols: run.symbols, startDate: sessionStartDate, endDate: sessionEndDate, tablesMode, overrides, settingsSource };
        if (Object.keys(runSymbolSettings).length > 0) request.symbolSettings = runSymbolSettings;
        return [run.key, JSON.stringify(request)];
      }),
    );
  }, [several, template, sessionStartDate, sessionEndDate, runs, runResolutions, tablesMode, overrides, settingsSource]);
  const debouncedRunRequests = useDebouncedValue(JSON.stringify(runRequestTexts), estimateDebounceMs);
  const askedRunTexts = useRef<Record<string, string>>({});
  useEffect(() => {
    const texts = JSON.parse(debouncedRunRequests) as Record<string, string | null>;
    for (const [key, text] of Object.entries(texts)) {
      if (text === null || askedRunTexts.current[key] === text) continue;
      askedRunTexts.current[key] = text;
      estimateBacktestSession(JSON.parse(text) as CreateBacktestSessionRequest)
        .then((result) => {
          setRunEstimates((previous) => ({ ...previous, [key]: { requestText: text, result, error: null } }));
          // An older answer arriving after a newer request does not replace the newer one.
          if (askedRunTexts.current[key] === text) setRunLatestResults((previous) => ({ ...previous, [key]: result }));
        })
        .catch((err) => setRunEstimates((previous) => ({ ...previous, [key]: { requestText: text, result: null, error: refusalText(err, "Could not estimate the run.") } })));
    }
  }, [debouncedRunRequests]);
  const runEstimateIsCurrent = (key: string) => runRequestTexts[key] !== null && runRequestTexts[key] !== undefined && runEstimates[key]?.requestText === runRequestTexts[key];
  const runsEstimatePending = several && runs.some((run) => runRequestTexts[run.key] !== null && !runEstimateIsCurrent(run.key));

  // Each run's rows and values as shown, what makes it different (D7), and its problems.
  const runRows = runs.map((run) => buildTickerRowModels({ symbols: run.symbols, edits: run.edits, resolution: runResolutions[run.key] ?? null, capitalMode: "pots", splitStartingValue: Number.NaN, settingRows: allRows }));
  const runValues: BatchRunValues[] = runs.map((run, index) => ({
    symbols: run.symbols,
    values: Object.fromEntries(runRows[index]!.map((row) => [row.symbol, Object.fromEntries(Object.entries(row.display).map(([key, shown]) => [key, shown.value]))])),
  }));
  const runDescriptions = describeRunDifferences(runValues);
  // The Start confirmation lists each run's tickers in their own column.
  const runDescriptionsBesideTickers = describeRunDifferences(runValues, { includeTickers: false });
  const runProblems = (runIndex: number): string[] => {
    const run = runs[runIndex]!;
    const label = `Run ${runIndex + 1}`;
    const estimate = runEstimates[run.key];
    return [
      ...(run.symbols.length === 0 ? [`${label} has no tickers: add one or remove the run.`] : []),
      ...tickerEditProblems(run.symbols, run.edits, "pots").map((problem) => `${label} · ${problem.symbol}: ${problem.message}`),
      ...[...run.symbols].sort().flatMap((symbol) => (runResolutions[run.key]?.bySymbol[symbol]?.problems ?? []).map((problem) => `${label} · ${describeTickerProblem(symbol, problem, allRows)}`)),
      ...(estimate?.error && runEstimateIsCurrent(run.key) ? [`${label}: ${estimate.error}`] : []),
    ];
  };
  const varyPreview = describeVaryPreview(runValues, vary, backtestMaxRunsPerBatch);

  /** A ticker's problems as the page lists them: values typed that cannot be sent, then what the estimate found. */
  const tickerProblemsOf = (resolution: BacktestTickerResolution | null): string[] => [
    ...tickerEditProblems(symbols, tickerEdits, capitalMode).map((problem) => `${problem.symbol}: ${problem.message}`),
    ...orderedSymbols.flatMap((symbol) => (resolution?.bySymbol[symbol]?.problems ?? []).map((problem) => describeTickerProblem(symbol, problem, allRows))),
  ];

  const problems: string[] = [];
  if (name.trim() === "") problems.push("Name the session.");
  if (selectedFiles.length === 0) problems.push("Pick at least one symbol with a downloaded file.");
  else if (selectedFiles.length > backtestMaxSymbolsPerSession) problems.push(`Pick at most ${backtestMaxSymbolsPerSession} symbols.`);
  else if (!coverage) problems.push("The picked files share no period: drop the symbol whose file starts after another's ends.");
  if (!sessionStartDate || !sessionEndDate) {
    if (coverage) problems.push(periodMode === "years" ? "Choose the From and To years." : "Choose a start and an end date.");
  } else if (sessionStartDate >= sessionEndDate) problems.push("The start date must be before the end date.");
  else if (coverage && (sessionStartDate < coverage.firstDate || sessionEndDate > coverage.lastDate)) {
    problems.push(`The period must fall within every picked file: ${coverage.firstDate} → ${coverage.lastDate}.`);
  }
  if (usesStartingValue && !(startingValue > 0)) problems.push("The starting account value must be a positive dollar amount.");
  if (showTickersCard) problems.push(...tickerProblemsOf(latestResolution));
  if (showRunsCard) runs.forEach((_, runIndex) => problems.push(...runProblems(runIndex)));
  for (const row of allRows) {
    const problem = row.editable ? settingValueProblem(row, valueByPath[row.path] ?? String(row.now)) : null;
    if (problem) problems.push(problem);
  }

  // ---- The Tickers card's edits ----
  const resolutionOf = (symbol: string) => latestResolution?.bySymbol[symbol];
  const changeTickerValue = (symbol: string, key: BacktestTickerValueKey, text: string) => {
    setTickerEdits((previous) => {
      const symbolEdits = { ...previous[symbol] };
      // A choice back on the value under it is no edit at once; a typed number waits for the field to be left.
      if (key === "ladderShock" && !isTickerEditActive(resolutionOf(symbol), key, text)) delete symbolEdits[key];
      else symbolEdits[key] = text;
      return { ...previous, [symbol]: symbolEdits };
    });
  };
  /** Leaving a field: a value equal to the one under it stops being an edit; a pot takes its separators. */
  const settleTickerValue = (symbol: string, key: BacktestTickerValueKey) => {
    setTickerEdits((previous) => {
      const text = previous[symbol]?.[key];
      if (text === undefined) return previous;
      const symbolEdits = { ...previous[symbol] };
      const below = tickerValueBelowEdit(resolutionOf(symbol), key);
      if (below !== undefined && tickerValueTextProblem(key, text) === null && !isTickerEditActive(resolutionOf(symbol), key, text)) delete symbolEdits[key];
      else if (key === "potDollars" && parseDollarAmountText(text) > 0) symbolEdits[key] = tickerValueInputText(key, parseDollarAmountText(text));
      else return previous;
      return { ...previous, [symbol]: symbolEdits };
    });
  };
  const resetTickerGroup = (symbol: string, group: BacktestTickerValueGroup) => {
    setTickerEdits((previous) => {
      const symbolEdits = { ...previous[symbol] };
      for (const key of tickerValueGroupAllKeys(group)) delete symbolEdits[key];
      return { ...previous, [symbol]: symbolEdits };
    });
  };
  /** Switching to a split starting value fills it with the pots' sum, so switching changes no dollar figure. */
  const changeCapitalMode = (nextMode: BacktestCapitalMode) => {
    if (nextMode === capitalMode) return;
    if (nextMode === "split" && latestResolution?.capital) setStartingValueText(formatNumber(latestResolution.capital));
    setCapitalMode(nextMode);
  };

  // ---- Several runs: the Runs switch, each run's edits (as the Tickers card's), its band's actions, Make runs ----
  /** One run → several: the form's tickers and values become Run 1 (runs from before come back, Run 1 taking the values). */
  const changeRunsMode = (nextMode: BacktestRunsMode) => {
    if (nextMode === runsMode) return;
    if (nextMode === "several") setRuns((previous) => (previous.length > 0 ? previous.map((run, index) => (index === 0 ? { ...run, edits: tickerEdits } : run)) : [{ key: newRunKey(), symbols: [...symbols], edits: tickerEdits }]));
    else if (runs[0]) setTickerEdits(runs[0].edits);
    setRunsMode(nextMode);
  };
  const updateRun = (runKey: string, update: (run: BacktestRunDraft) => BacktestRunDraft) => setRuns((previous) => previous.map((run) => (run.key === runKey ? update(run) : run)));
  const withSymbolEdits = (run: BacktestRunDraft, symbol: string, symbolEdits: BacktestTickerEdits[string]): BacktestRunDraft => ({ ...run, edits: { ...run.edits, [symbol]: symbolEdits } });
  const changeRunValue = (runKey: string, symbol: string, key: BacktestTickerValueKey, text: string) =>
    updateRun(runKey, (run) => {
      const symbolEdits = { ...run.edits[symbol] };
      if (key === "ladderShock" && !isTickerEditActive(runResolutions[runKey]?.bySymbol[symbol], key, text)) delete symbolEdits[key];
      else symbolEdits[key] = text;
      return withSymbolEdits(run, symbol, symbolEdits);
    });
  const settleRunValue = (runKey: string, symbol: string, key: BacktestTickerValueKey) =>
    updateRun(runKey, (run) => {
      const text = run.edits[symbol]?.[key];
      if (text === undefined) return run;
      const resolution = runResolutions[runKey]?.bySymbol[symbol];
      const symbolEdits = { ...run.edits[symbol] };
      if (tickerValueBelowEdit(resolution, key) !== undefined && tickerValueTextProblem(key, text) === null && !isTickerEditActive(resolution, key, text)) delete symbolEdits[key];
      else if (key === "potDollars" && parseDollarAmountText(text) > 0) symbolEdits[key] = tickerValueInputText(key, parseDollarAmountText(text));
      else return run;
      return withSymbolEdits(run, symbol, symbolEdits);
    });
  const resetRunGroup = (runKey: string, symbol: string, group: BacktestTickerValueGroup) =>
    updateRun(runKey, (run) => {
      const symbolEdits = { ...run.edits[symbol] };
      for (const key of tickerValueGroupAllKeys(group)) delete symbolEdits[key];
      return withSymbolEdits(run, symbol, symbolEdits);
    });
  const duplicateRun = (runKey: string) => {
    const key = newRunKey();
    setRuns((previous) => {
      const index = previous.findIndex((run) => run.key === runKey);
      if (index === -1 || previous.length >= backtestMaxRunsPerBatch) return previous;
      const source = previous[index]!;
      const copy: BacktestRunDraft = { key, symbols: [...source.symbols], edits: Object.fromEntries(Object.entries(source.edits).map(([symbol, symbolEdits]) => [symbol, { ...symbolEdits }])) };
      return [...previous.slice(0, index + 1), copy, ...previous.slice(index + 1)];
    });
  };
  const removeRun = (runKey: string) => setRuns((previous) => (previous.length > 1 ? previous.filter((run) => run.key !== runKey) : previous));
  const removeRunTicker = (runKey: string, symbol: string) =>
    updateRun(runKey, (run) => ({ ...run, symbols: run.symbols.filter((held) => held !== symbol), edits: Object.fromEntries(Object.entries(run.edits).filter(([held]) => held !== symbol)) }));
  const addRunTicker = (runKey: string, symbol: string) => updateRun(runKey, (run) => (run.symbols.includes(symbol) ? run : { ...run, symbols: [...run.symbols, symbol] }));
  /** Make runs (D5): each run holding the chosen ticker becomes one run per value, the value typed for that ticker (or every ticker). */
  const applyVary = () => {
    const parsed = parseVaryValues(vary.key, vary.text);
    if ("error" in parsed || !varyPreview.ok) return;
    const next: BacktestRunDraft[] = [];
    runs.forEach((run, runIndex) => {
      const targets = batchVaryTargets(runValues[runIndex]!, vary);
      if (targets.length === 0) {
        next.push(run);
        return;
      }
      parsed.values.forEach((value, valueIndex) => {
        const edits: BacktestTickerEdits = Object.fromEntries(Object.entries(run.edits).map(([symbol, symbolEdits]) => [symbol, { ...symbolEdits }]));
        for (const symbol of targets) edits[symbol] = { ...edits[symbol], [vary.key]: tickerValueInputText(vary.key, value) };
        next.push({ key: valueIndex === 0 ? run.key : newRunKey(), symbols: [...run.symbols], edits });
      });
    });
    if (next.length > backtestMaxRunsPerBatch) return;
    setRuns(next);
    // The list is used: cleared, so its preview does not read as a new one.
    setVary((previous) => ({ ...previous, text: "" }));
  };

  /** What Start sends: one run (the form as it was) or every run; every start is a batch. Null while a run cannot be asked for yet. */
  const batchRequest = ((): CreateBacktestBatchRequest | null => {
    if (!several) {
      if (requestText === null) return null;
      const { symbols: runSymbols, symbolSettings: runSymbolSettings, startingValue: runStartingValue, settingsSource: runSettingsSource, name: runName, startDate: runStart, endDate: runEnd, tablesMode: runTables, overrides: runOverrides } = JSON.parse(requestText) as CreateBacktestSessionRequest;
      return {
        name: runName,
        startDate: runStart,
        endDate: runEnd,
        tablesMode: runTables,
        overrides: runOverrides,
        ...(runSettingsSource ? { settingsSource: runSettingsSource } : {}),
        ...(runStartingValue !== undefined ? { startingValue: runStartingValue } : {}),
        runs: [{ symbols: runSymbols, ...(runSymbolSettings ? { symbolSettings: runSymbolSettings } : {}) }],
      };
    }
    if (runs.length === 0 || runs.some((run) => !runRequestTexts[run.key])) return null;
    return {
      name: name.trim(),
      startDate: sessionStartDate,
      endDate: sessionEndDate,
      tablesMode,
      overrides,
      settingsSource,
      runs: runs.map((run, runIndex) => {
        const { symbolSettings: runSymbolSettings } = JSON.parse(runRequestTexts[run.key]!) as CreateBacktestSessionRequest;
        return { label: runDescriptions[runIndex], symbols: run.symbols, ...(runSymbolSettings ? { symbolSettings: runSymbolSettings } : {}) };
      }),
    };
  })();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (problems.length > 0 || !template || batchRequest === null) return;
    setConfirmOpen(true);
  };

  const startSession = async () => {
    if (batchRequest === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await createBacktestBatch(batchRequest);
      // What a run will do differently because of its files (it still runs) stays on screen; otherwise straight to it: one
      // run's session page, or the batch's page (D8).
      if (response.warnings.length > 0) {
        setConfirmOpen(false);
        setCreated(response);
        setSubmitting(false);
        window.scrollTo({ top: 0 });
      } else if (response.runs.length === 1) {
        navigate(`/backtest/sessions/${response.runs[0]!.session.id}`);
      } else {
        navigate(`/backtest/batches/${response.batch.id}`);
      }
    } catch (err) {
      setConfirmOpen(false);
      setSubmitError(refusalText(err, several ? "Could not start the runs." : "Could not start the session."));
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
            {created.runs.length === 1 ? (
              <>
                <strong>{created.runs[0]!.session.name}</strong> ({created.runs[0]!.session.symbol}) is queued; its progress shows under Background jobs.
              </>
            ) : (
              <>
                <strong>{created.batch.name}</strong>: {created.runs.length} runs are queued; their progress shows on the batch's page and under Background jobs.
              </>
            )}
            {created.llmEstimate && <div className="mt-1">The AI model decides. {describeLlmEstimate(created.llmEstimate)}.</div>}
          </div>
        </div>
        <div className="alert alert-warning" role="status">
          <div>
            <div className="fw-semibold mb-1">
              {created.runs.length === 1 ? "It runs" : "They run"}, with {created.warnings.length === 1 ? "this difference" : "these differences"} from what {created.runs.length === 1 ? "its" : "their"} files hold:
            </div>
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
          {created.runs.length === 1 ? (
            <Link to={`/backtest/sessions/${created.runs[0]!.session.id}`} className="btn btn-primary">
              Open the session
            </Link>
          ) : (
            <Link to={`/backtest/batches/${created.batch.id}`} className="btn btn-primary">
              Open the batch
            </Link>
          )}
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

  const resetAllSettings = () => setValueByPath((previous) => ({ ...initialValueByPath(template, null), [decisionMakerPath]: previous[decisionMakerPath] ?? String(decisionMakerRow?.now ?? "rules") }));
  const splitShare = startingValue > 0 && selectedFiles.length > 0 ? startingValue / selectedFiles.length : null;
  const unavailableDecisionMakers = decisionMakerRow ? describeUnavailableChoices(decisionMakerRow) : [];

  // The confirmation: what changed for the whole session (the decision maker is a fact of its own), the per-ticker rows
  // marked as reaching every ticker.
  const perTickerPaths = new Set(allRows.filter((row) => row.perTicker).map((row) => row.path));
  const changes = [
    ...describeOverrideChanges(
      overridesWithout(overrides, (path) => path !== decisionMakerPath && !(perTickerPots && perTickerPaths.has(path))),
      template.settings,
      template.rows,
    ),
    ...(perTickerPots ? describeOverrideChanges(overridesWithout(overrides, (path) => perTickerPaths.has(path)), template.settings, template.rows).map((change) => `${change} · every ticker`) : []),
  ];
  const currentResolution: BacktestTickerResolution | null = currentResult?.resolvedBySymbol ? { capital: currentResult.capital, bySymbol: currentResult.resolvedBySymbol } : null;
  const confirmProblems = perTickerPots && currentResolution ? tickerProblemsOf(currentResolution) : [];
  const positionsField = (
    <div className="col-12 col-lg-6">
      <label htmlFor="backtest-session-positions" className="form-label">
        Positions
      </label>
      <input id="backtest-session-positions" type="text" className="form-control" value="The full wheel" disabled readOnly aria-describedby="backtest-session-positions-hint" />
      <div id="backtest-session-positions-hint" className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
        assignment, Calls on the shares, rolls and buybacks
      </div>
    </div>
  );
  const periodNote = periodMode === "years" && fromYear !== null && toYear !== null ? (fromYear === toYear ? `whole year ${fromYear}` : `whole years ${fromYear} to ${toYear}`) : "custom dates";

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BacktestBackLink />
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />
      {sourceSessionId && !sourceSession && <div className="iorio-note-amber mb-2">The session to copy could not be loaded; the form starts from the lab's settings.</div>}
      <form onSubmit={handleSubmit} noValidate>
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
                {several && (
                  <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                    the batch's name; each run's session is named "{name.trim() || "…"} · Run 1 · …"
                  </div>
                )}
              </div>
              <div className="col-12 col-lg-6">
                <label htmlFor="backtest-session-decision-maker" className="form-label">
                  Decision maker
                </label>
                <select
                  id="backtest-session-decision-maker"
                  className="form-select"
                  aria-describedby="backtest-session-decision-maker-hint"
                  value={decisionMaker}
                  onChange={(event) => setValueByPath((previous) => ({ ...previous, [decisionMakerPath]: event.target.value }))}
                >
                  {(decisionMakerRow?.choices ?? []).map((choice) => (
                    <option key={choice.value} value={choice.value} disabled={Boolean(choice.unavailableReason)} title={choice.unavailableReason}>
                      {choice.unavailableReason ? `${choice.label} (${choice.unavailableReason})` : choice.label}
                    </option>
                  ))}
                </select>
                <div id="backtest-session-decision-maker-hint" className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                  {decisionMakerHint[decisionMaker]}
                  {unavailableDecisionMakers.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
              {perTickerPots && (
                <div className="col-12 col-lg-6">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                    <span className="form-label mb-0" id="backtest-session-runs-label">
                      Runs
                    </span>
                    <BacktestSegmentedSwitch options={runsModeOptions} value={runsMode} onChange={changeRunsMode} ariaLabel="Runs" className="backtest-switch-wrap" />
                  </div>
                  <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
                    {several
                      ? `up to ${backtestMaxRunsPerBatch} runs, each its own account: every run shares the period and the Settings, each has its own tickers and ticker values`
                      : "one account with every picked ticker"}
                  </div>
                </div>
              )}
              <div className="col-12 col-lg-6">
                {several ? (
                  <>
                    <span className="form-label" id="backtest-session-capital-label">
                      Capital
                    </span>
                    <input id="backtest-session-capital" type="text" className="form-control" aria-labelledby="backtest-session-capital-label" value="Each run: the sum of its pots" disabled readOnly />
                    <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                      each run's capital shows on its band (Runs, below)
                    </div>
                  </>
                ) : perTickerPots ? (
                  <>
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                      <span className="form-label mb-0" id="backtest-session-capital-label">
                        Capital
                      </span>
                      <BacktestSegmentedSwitch options={capitalModeOptions} value={capitalMode} onChange={changeCapitalMode} ariaLabel="Capital" className="backtest-switch-wrap" />
                    </div>
                    <div className="input-group">
                      <span className="input-group-text">$</span>
                      {capitalMode === "split" ? (
                        <input
                          id="backtest-session-capital"
                          type="text"
                          inputMode="numeric"
                          className={`form-control font-mono${submitAttempted && !(startingValue > 0) ? " is-invalid" : ""}`}
                          aria-labelledby="backtest-session-capital-label"
                          aria-describedby="backtest-session-capital-hint"
                          value={startingValueText}
                          onChange={(event) => setStartingValueText(event.target.value)}
                          onBlur={() => startingValue > 0 && setStartingValueText(formatNumber(startingValue))}
                        />
                      ) : (
                        <input
                          id="backtest-session-capital"
                          type="text"
                          className="form-control font-mono"
                          aria-labelledby="backtest-session-capital-label"
                          aria-describedby="backtest-session-capital-hint"
                          value={latestResolution?.capital ? formatNumber(latestResolution.capital) : ""}
                          placeholder="—"
                          disabled
                          readOnly
                        />
                      )}
                    </div>
                    <div id="backtest-session-capital-hint" className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                      {capitalMode === "split"
                        ? `split equally: ${splitShare !== null ? `${formatCurrency(splitShare, 0)} for each of ${pluralizeCount(selectedFiles.length, "ticker")}` : "a dollar amount above 0"}`
                        : latestResolution?.capital
                          ? "the sum of the tickers' pots (Tickers, below); each ticker's weight is its pot ÷ this"
                          : "the sum of the tickers' pots, once every ticker has one"}
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              {!perTickerPots && positionsField}
              <div className="col-12 col-lg-6">
                <BacktestSymbolPicker files={files} selected={symbols} onChange={changeSymbols} invalid={submitAttempted && (selectedFiles.length === 0 || !coverage)} />
                {several ? (
                  <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                    the tickers the runs can use: a symbol picked here goes into every run, and can be removed from a run on its band
                  </div>
                ) : (
                  selectedFiles.length > 1 && (
                    <div className="text-secondary mt-1" style={{ fontSize: "0.75rem" }}>
                      {symbols.join(", ")} share one book: one cash balance, one account.
                    </div>
                  )
                )}
              </div>
              <div className="col-12 col-lg-6">
                <div className="row g-3">
                  <div className="col-12">
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                      <span className="form-label mb-0" id="backtest-session-period-label">
                        Period
                      </span>
                      <BacktestSegmentedSwitch options={periodModeOptions} value={periodMode} onChange={changePeriodMode} ariaLabel="Period" />
                    </div>
                  </div>
                  {periodMode === "years" ? (
                    <>
                      <div className="col-12 col-sm-6">
                        <label htmlFor="backtest-session-from-year" className="form-label">
                          From year
                        </label>
                        <select
                          id="backtest-session-from-year"
                          className="form-select font-mono"
                          disabled={!coverage}
                          value={coverage && fromYear !== null ? String(fromYear) : ""}
                          onChange={(event) => changeFromYear(Number(event.target.value))}
                        >
                          {!coverage && <option value="">—</option>}
                          {coverage &&
                            yearOptions.map((year) => (
                              <option key={year} value={year}>
                                {describeYearOption(year, coverage)}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="col-12 col-sm-6">
                        <label htmlFor="backtest-session-to-year" className="form-label">
                          To year
                        </label>
                        <select
                          id="backtest-session-to-year"
                          className="form-select font-mono"
                          disabled={!coverage}
                          value={coverage && toYear !== null ? String(toYear) : ""}
                          onChange={(event) => setToYear(Number(event.target.value))}
                        >
                          {!coverage && <option value="">—</option>}
                          {coverage &&
                            yearOptions
                              .filter((year) => fromYear === null || year >= fromYear)
                              .map((year) => (
                                <option key={year} value={year}>
                                  {describeYearOption(year, coverage)}
                                </option>
                              ))}
                        </select>
                      </div>
                      {yearsPeriod && (
                        <div className="col-12 font-mono" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }} aria-live="polite">
                          {yearsPeriod.startDate} → {yearsPeriod.endDate}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
              {/* With the Baseline deciding, Runs takes Positions' place beside Capital (mockup 2026-10-17); Positions moves here. */}
              {perTickerPots && positionsField}
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

        {showTickersCard && (
          <BacktestTickerValuesCard
            symbols={symbols}
            settingsSource={settingsSource}
            onSettingsSourceChange={setSettingsSource}
            capitalMode={capitalMode}
            splitStartingValue={startingValue}
            resolution={latestResolution}
            resolving={estimatePending}
            resolutionError={estimateIsCurrent ? estimate.error : null}
            edits={tickerEdits}
            onEditChange={changeTickerValue}
            onEditBlur={settleTickerValue}
            onResetGroup={resetTickerGroup}
            onResetAll={() => setTickerEdits({})}
            settingRows={allRows}
          />
        )}

        {showRunsCard && (
          <BacktestRunsCard
            runs={runs.map(
              (run, runIndex): BacktestRunView => ({
                key: run.key,
                runNumber: runIndex + 1,
                rows: runRows[runIndex]!,
                description: runDescriptions[runIndex]!,
                capital: runResolutions[run.key]?.capital ?? null,
                missingSymbols: orderedSymbols.filter((symbol) => !run.symbols.includes(symbol)),
                resolving: runRequestTexts[run.key] !== null && runRequestTexts[run.key] !== undefined && !runEstimateIsCurrent(run.key),
                error: runEstimateIsCurrent(run.key) ? (runEstimates[run.key]?.error ?? null) : null,
                runProblems: run.symbols.length === 0 ? [`Run ${runIndex + 1} has no tickers: add one or remove the run.`] : [],
              }),
            )}
            maxRuns={backtestMaxRunsPerBatch}
            settingsSource={settingsSource}
            onSettingsSourceChange={setSettingsSource}
            vary={vary}
            varyTickers={orderedSymbols}
            varyPreview={varyPreview}
            onVaryChange={setVary}
            onApplyVary={applyVary}
            onEditChange={changeRunValue}
            onEditBlur={settleRunValue}
            onResetGroup={resetRunGroup}
            onDuplicate={duplicateRun}
            onRemove={removeRun}
            onRemoveTicker={removeRunTicker}
            onAddTicker={addRunTicker}
            anyEdit={runs.some((run) => hasTickerEdits(run.edits))}
            onResetAll={() => setRuns((previous) => previous.map((run) => ({ ...run, edits: {} })))}
            settingRows={allRows}
          />
        )}

        <BacktestCard
          title="Settings"
          description={
            changedCount === 0 ? `the lab's settings as they are now${several ? " · for every run" : ""}` : `${pluralizeCount(changedCount, "setting")} changed for ${several ? "every run" : "this session"}`
          }
          actions={
            changedCount > 0 && (
              <button type="button" className="btn btn-outline-secondary" onClick={resetAllSettings}>
                Reset all to the lab's
              </button>
            )
          }
          className="mb-3"
        >
          <BacktestSettingsTable
            rows={settingRows}
            valueByPath={valueByPath}
            showPerTicker={showTickersCard || showRunsCard}
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
                <div className="backtest-ticker-problem">{estimate.error}</div>
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
          <button type="submit" className="btn btn-primary">
            {several && runs.length > 1 ? `Start ${runs.length} runs` : "Start session"}
          </button>
        </div>
        <div className="text-secondary text-end mt-2" style={{ fontSize: "0.78rem" }}>
          {several && runs.length > 1 ? "The runs queue and run in the background; their progress shows on the batch's page." : "Runs in the background; its progress shows under Background jobs."}
        </div>
      </form>
      {confirmOpen && several && (
        <ConfirmModal
          title={runs.length > 1 ? `Start ${runs.length} runs?` : "Start this session?"}
          size="lg"
          danger={false}
          confirmLabel={runs.length > 1 ? `Start ${runs.length} runs` : "Start session"}
          confirming={submitting}
          confirmDisabled={runsEstimatePending || runs.some((_, runIndex) => runProblems(runIndex).length > 0)}
          onConfirm={() => void startSession()}
          onCancel={() => setConfirmOpen(false)}
          message={
            <BacktestStartBatchConfirmBody
              name={name.trim()}
              startDate={sessionStartDate}
              endDate={sessionEndDate}
              periodNote={periodNote}
              decisionMakerLabel={decisionMakerRow?.choices?.find((choice) => choice.value === decisionMaker)?.label ?? decisionMaker}
              settingsSource={settingsSource}
              tablesMode={tablesMode}
              runs={runs.map((run, runIndex) => ({ runNumber: runIndex + 1, symbols: run.symbols, description: runDescriptionsBesideTickers[runIndex]!, capital: runResolutions[run.key]?.capital ?? null }))}
              maxParallel={overview?.maxParallelSessions ?? null}
              estimatePending={runsEstimatePending}
              changes={changes}
              warnings={runs.flatMap((run, runIndex) => (runEstimateIsCurrent(run.key) ? (runEstimates[run.key]?.result?.warnings ?? []).map((warning) => `Run ${runIndex + 1}: ${warning}`) : []))}
              problems={runs.flatMap((_, runIndex) => runProblems(runIndex))}
            />
          }
        />
      )}
      {confirmOpen && !several && (
        <ConfirmModal
          title="Start this session?"
          size="lg"
          danger={false}
          confirmLabel="Start session"
          confirming={submitting}
          confirmDisabled={estimatePending || confirmProblems.length > 0}
          onConfirm={() => void startSession()}
          onCancel={() => setConfirmOpen(false)}
          message={
            <BacktestStartSessionConfirmBody
              name={name.trim()}
              startDate={sessionStartDate}
              endDate={sessionEndDate}
              periodNote={periodNote}
              decisionMakerLabel={decisionMakerRow?.choices?.find((choice) => choice.value === decisionMaker)?.label ?? decisionMaker}
              perTickerPots={perTickerPots}
              capitalMode={capitalMode}
              startingValue={startingValue}
              symbolCount={selectedFiles.length}
              settingsSource={settingsSource}
              tablesMode={tablesMode}
              resolution={currentResolution}
              estimatePending={estimatePending}
              estimateError={estimateIsCurrent ? estimate.error : null}
              changes={changes}
              warnings={currentResult?.warnings ?? []}
              problems={confirmProblems}
            />
          }
        />
      )}
    </div>
  );
}
