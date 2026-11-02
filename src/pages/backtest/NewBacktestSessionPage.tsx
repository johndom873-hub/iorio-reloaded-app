import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { isRetiredBacktestSettingSection, labelSettingPaths, sessionSettingSectionOf } from "../../lib/backtestSettingGroups";
import {
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
  type BacktestSettingsTemplate,
  type BacktestTablesMode,
  type BacktestVolFarmerV2Settings,
  type CreateBacktestBatchRequest,
  type CreateBacktestBatchResponse,
  type CreateBacktestSessionRequest,
} from "../../api/backtest";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard, BacktestSegmentedSwitch } from "../../components/backtest/backtestBits";
import { BacktestSettingsTable } from "../../components/backtest/BacktestSettingsTable";
import { BacktestStartSessionConfirmBody } from "../../components/backtest/BacktestStartSessionConfirmBody";
import { BacktestSymbolPicker } from "../../components/backtest/BacktestSymbolPicker";
import { BacktestVolFarmerV2TickersCard } from "../../components/backtest/BacktestVolFarmerV2TickersCard";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatCurrency, formatInputNumber, formatNumber, pluralizeCount } from "../../lib/formatters";
import {
  buildBacktestOverrides,
  decidedByPhrase,
  decisionMakerCanRun,
  decisionMakerHint,
  decisionMakerLabel,
  describeOverrideChanges,
  describeRetiredVolFarmerV2Research,
  describeUnavailableChoices,
  describeYearOption,
  formatSettingRowValue,
  isSettingChanged,
  parseDollarAmountText,
  runsVolFarmerV2Steps,
  sessionDecisionMaker,
  settingInputText,
  settingValueProblem,
  valueAtSettingsPath,
  volFarmerAllocationSection,
  volFarmerExcessAllowancePathOf,
  wholeYearsContaining,
  wholeYearsDates,
  wholeYearsMatching,
  yearsInPeriod,
  type BacktestPeriodMode,
} from "../../lib/backtestPresentation";
import { typedAllocationProblems, typedAllocationsBySymbol } from "../../lib/tickerAllocation";

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

/** The form's values: the lab's, with a copied session's own changes when its decision maker can still run. */
function initialValueByPath(template: BacktestSettingsTemplate, source: BacktestSessionDetail | null): Record<string, string> {
  const values: Record<string, string> = {};
  const copied = source && decisionMakerCanRun(sessionDecisionMaker(source.session)) ? source : null;
  for (const row of template.rows) {
    const fromSource = row.editable && copied ? valueAtSettingsPath(copied.session.overrides, row.path) : undefined;
    values[row.path] = settingInputText(fromSource ?? row.now);
  }
  return values;
}

/**
 * A copied Vol Farmer v2 session's allocations as the Tickers card types them (v3's, and v4's from its own values). A
 * session from before allocations, sized by a dollar pot per ticker (volFarmerV2.tickerPotDollars), comes back as the
 * values that give the same pots: an equal share with the excess allowance (pot × tickers ÷ starting value − 1) when the
 * pots add up to the starting value or more, else every ticker's allocation at pot ÷ starting value.
 * $100,000 × 24 ÷ $1,900,000 − 1 = 26.3158%.
 */
function copiedVolFarmerV2Allocations(source: BacktestSessionDetail["session"], symbols: string[]): { textBySymbol: Record<string, string>; allowanceText: string | null; note: string | null } {
  const volFarmerV2 = source.overrides[volFarmerAllocationSection(sessionDecisionMaker(source))] as (Partial<BacktestVolFarmerV2Settings> & { tickerPotDollars?: number }) | undefined;
  const textBySymbol = Object.fromEntries(
    Object.entries(volFarmerV2?.tickerAllocationPct ?? {})
      .filter(([symbol]) => symbols.includes(symbol))
      .map(([symbol, pct]) => [symbol, formatInputNumber(pct, 4)]),
  );
  const pot = volFarmerV2?.tickerPotDollars;
  if (typeof pot !== "number" || !(pot > 0) || !(source.startingValue > 0)) return { textBySymbol, allowanceText: null, note: null };
  const potsShare = (pot * Math.max(1, source.symbols.length)) / source.startingValue;
  const retired = `This session sized each ticker from a ${formatCurrency(pot, 0)} pot, a setting the lab no longer has.`;
  if (potsShare >= 1) {
    const allowanceText = formatInputNumber((potsShare - 1) * 100, 4);
    return { textBySymbol, allowanceText, note: `${retired} It comes back as an equal share with a ${allowanceText}% excess allowance: the same pots.` };
  }
  const allocationText = formatInputNumber((pot / source.startingValue) * 100, 4);
  return { textBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, allocationText])), allowanceText: "0", note: `${retired} It comes back as each ticker's allocation, ${allocationText}%: the same pots.` };
}

// New session (mockups approved 2026-10-12, without the CC + Put Ladder 2026-11-02): the period, the decision maker (the
// Steady Stake or Vol Farmer v4), the starting value, the history tables, and the lab's settings with the session's own
// changes: the rows every session reads and the decision maker's own group. Every start is a batch of one run. "Run again
// with changes" opens it with ?from=<sessionId> or ?fromBatch=<batchId>, prefilled from it; the Data files card's Backtest
// opens it with ?symbols=<SYMBOL,SYMBOL>, those symbols picked.
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
  const [tablesMode, setTablesMode] = useState<BacktestTablesMode>("walk_forward");
  const [valueByPath, setValueByPath] = useState<Record<string, string>>({});
  // Vol Farmer v2 deciding: each ticker's allocation as typed on the Tickers card (empty: an equal share).
  const [allocationTextBySymbol, setAllocationTextBySymbol] = useState<Record<string, string>>({});
  // A copied session sized by a dollar pot per ticker (before allocations): what it came back as.
  const [retiredTickerPotNote, setRetiredTickerPotNote] = useState<string | null>(null);
  const [retiredResearchNote, setRetiredResearchNote] = useState<string | null>(null);
  // A copied session whose decision maker was retired: its period and tickers come back, its settings from the lab.
  const [retiredDecisionMakerNote, setRetiredDecisionMakerNote] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBacktestBatchResponse | null>(null);
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
    const sourceSymbols = (source ? (source.symbols.length > 0 ? source.symbols : [source.symbol]) : []).filter((picked) =>
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
    }
    if (sourceBatch) setName(sourceBatch.batch.name);
    const runnable = source !== null && decisionMakerCanRun(sessionDecisionMaker(source));
    if (source && !runnable) setRetiredDecisionMakerNote(`This session was decided by ${decidedByPhrase[sessionDecisionMaker(source)]}, since retired: its period and tickers come back, its settings from the lab.`);
    const copiedAllocations = source && runnable && runsVolFarmerV2Steps(sessionDecisionMaker(source)) ? copiedVolFarmerV2Allocations(source, sourceSymbols) : null;
    if (copiedAllocations) {
      setAllocationTextBySymbol(copiedAllocations.textBySymbol);
      setRetiredTickerPotNote(copiedAllocations.note);
    }
    // A Vol Farmer v2 session run with research settings since retired cannot be rerun as it was: say so (2026-10-28).
    const retiredResearch = source && runnable && runsVolFarmerV2Steps(sessionDecisionMaker(source)) ? describeRetiredVolFarmerV2Research(source.overrides) : [];
    if (retiredResearch.length > 0) setRetiredResearchNote(`This session used research settings the lab no longer has (${retiredResearch.join("; ")}). A rerun uses today's rules: the LEAPS bought once the price is half a Step below B-E2, one per holding, sold when the second position is called away; Calls and Puts on the next expiry only.`);
    const copiedAllowance: Record<string, string> = source && copiedAllocations?.allowanceText != null ? { [volFarmerExcessAllowancePathOf(sessionDecisionMaker(source))]: copiedAllocations.allowanceText } : {};
    setValueByPath({ ...initialValueByPath(template, sourceSession), ...copiedAllowance });
    setInitialized(true);
  }, [initialized, overview, template, sourceLoaded, sourceSession, sourceBatch, requestedSymbolsParam]);

  /** Picking or dropping a symbol: custom dates become all that the picked files share; years narrowed by hand stay while they
   *  are still inside that period, and otherwise (or when they were all of the old period) become all of it. With no shared
   *  period the dates are cleared and the years cannot be picked. */
  const changeSymbols = (nextSymbols: string[]) => {
    setSymbols(nextSymbols);
    // A dropped symbol takes its allocation with it (the API refuses one for a symbol not in the session).
    setAllocationTextBySymbol((previous) => Object.fromEntries(Object.entries(previous).filter(([symbol]) => nextSymbols.includes(symbol))));
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
  // The retired decision makers' rows change no session that can still run.
  const allRows = useMemo(() => (template?.rows ?? []).filter((row) => !isRetiredBacktestSettingSection(row.section)), [template]);
  const decisionMakerRow = allRows.find((row) => row.path === decisionMakerPath) ?? null;
  const decisionMaker = (valueByPath[decisionMakerPath] ?? "vol_farmer_v4") as BacktestDecisionMaker;
  // Vol Farmer v2 (or v3, on v2's values; v4, on its own) deciding (mockup approved 2026-10-28): the Tickers card holds each
  // ticker's allocation and, beside the starting value, the excess allowance, which leaves the Settings table.
  const allocationSection = volFarmerAllocationSection(decisionMaker);
  const allowancePath = volFarmerExcessAllowancePathOf(decisionMaker);
  const allowanceRow = allRows.find((row) => row.path === allowancePath) ?? null;
  const showVolFarmerV2TickersCard = runsVolFarmerV2Steps(decisionMaker) && selectedFiles.length > 0 && allowanceRow !== null;
  // The Settings card (Marcelo 2026-11-02): the rows every session reads and the decision maker's own group only.
  const decisionMakerSection = sessionSettingSectionOf(decisionMaker);
  const settingRows = allRows.filter((row) => row.path !== decisionMakerPath && (row.section === "every_session" || row.section === decisionMakerSection) && !(showVolFarmerV2TickersCard && row.path === allowancePath));

  // The estimate: what the session will do differently because of its files. The latest answer stays on screen while the
  // next is worked out.
  const [estimate, setEstimate] = useState<{ requestText: string; result: BacktestSessionEstimateResponse | null; error: string | null } | null>(null);
  const settingsOverrides = useMemo(() => (template ? buildBacktestOverrides(template.rows, valueByPath) : {}), [template, valueByPath]);
  const allowanceText = valueByPath[allowancePath] ?? (allowanceRow ? String(allowanceRow.now) : "0");
  // What the session overrides: the settings changed, and with Vol Farmer v2, v3 or v4 deciding each allocation typed on the Tickers card.
  const tickerAllocationPct = useMemo(() => (runsVolFarmerV2Steps(decisionMaker) ? typedAllocationsBySymbol(symbols, allocationTextBySymbol) : {}), [decisionMaker, symbols, allocationTextBySymbol]);
  const overrides = useMemo<BacktestSettingsOverrides>(
    () => (Object.keys(tickerAllocationPct).length === 0 ? settingsOverrides : { ...settingsOverrides, [allocationSection]: { ...settingsOverrides[allocationSection], tickerAllocationPct } }),
    [settingsOverrides, tickerAllocationPct, allocationSection],
  );
  const requestText = useMemo(() => {
    if (!template || symbols.length === 0 || !sessionStartDate || !sessionEndDate || !(startingValue > 0)) return null;
    // The endpoint needs no name (an unnamed form still gets its estimate).
    const request: CreateBacktestSessionRequest = { name: name.trim(), symbols, startDate: sessionStartDate, endDate: sessionEndDate, startingValue, tablesMode, overrides };
    return JSON.stringify(request);
  }, [template, name, symbols, sessionStartDate, sessionEndDate, startingValue, tablesMode, overrides]);
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
  if (!(startingValue > 0)) problems.push("The starting account value must be a positive dollar amount.");
  if (showVolFarmerV2TickersCard) problems.push(...typedAllocationProblems(symbols, allocationTextBySymbol, allowanceText));
  for (const row of settingRows) {
    // The Tickers card checks the allowance it shows.
    if (showVolFarmerV2TickersCard && row.path === allowancePath) continue;
    const problem = row.editable ? settingValueProblem(row, valueByPath[row.path] ?? String(row.now)) : null;
    if (problem) problems.push(problem);
  }

  /** What Start sends: every start is a batch of one run. Null while the session cannot be asked for yet. */
  const batchRequest = ((): CreateBacktestBatchRequest | null => {
    if (requestText === null) return null;
    const { symbols: runSymbols, startingValue: runStartingValue, name: runName, startDate: runStart, endDate: runEnd, tablesMode: runTables, overrides: runOverrides } = JSON.parse(requestText) as CreateBacktestSessionRequest;
    return { name: runName, startDate: runStart, endDate: runEnd, tablesMode: runTables, overrides: runOverrides, startingValue: runStartingValue, runs: [{ symbols: runSymbols }] };
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
      setSubmitError(refusalText(err, "Could not start the session."));
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

  // The Settings card resets what it shows: not the decision maker, nor the allowance while the Tickers card holds it.
  const resetAllSettings = () =>
    setValueByPath((previous) => ({
      ...initialValueByPath(template, null),
      [decisionMakerPath]: previous[decisionMakerPath] ?? String(decisionMakerRow?.now ?? "vol_farmer_v4"),
      ...(showVolFarmerV2TickersCard && previous[allowancePath] !== undefined ? { [allowancePath]: previous[allowancePath] } : {}),
    }));
  const unavailableDecisionMakers = decisionMakerRow ? describeUnavailableChoices(decisionMakerRow) : [];

  // The confirmation: what changed for the session (the decision maker is a fact of its own).
  const { decisionMaker: _decisionMaker, ...overridesBesideDecisionMaker } = overrides;
  const changes = describeOverrideChanges(overridesBesideDecisionMaker, template.settings, template.rows);
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
      {retiredTickerPotNote && <div className="iorio-note-amber mb-2">{retiredTickerPotNote}</div>}
      {retiredResearchNote && <div className="iorio-note-amber mb-2">{retiredResearchNote}</div>}
      {retiredDecisionMakerNote && <div className="iorio-note-amber mb-2">{retiredDecisionMakerNote}</div>}
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
                  {showVolFarmerV2TickersCard && selectedFiles.length > 1 ? "the tickers share one account, each with its share of the starting value (Tickers, below)" : decisionMakerHint[decisionMaker]}
                  {unavailableDecisionMakers.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
              <div className="col-12 col-lg-6">
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
              {positionsField}
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

        {showVolFarmerV2TickersCard && allowanceRow && (
          <BacktestVolFarmerV2TickersCard
            symbols={symbols}
            startingValue={startingValue}
            allocationTextBySymbol={allocationTextBySymbol}
            onAllocationChange={(symbol, text) => setAllocationTextBySymbol((previous) => ({ ...previous, [symbol]: text }))}
            onResetAllocations={() => setAllocationTextBySymbol({})}
            allowanceRow={allowanceRow}
            allowanceText={allowanceText}
            onAllowanceChange={(text) => setValueByPath((previous) => ({ ...previous, [allowancePath]: text }))}
          />
        )}

        <BacktestCard
          title="Settings"
          description={changedCount === 0 ? `the lab's settings as they are now: every session's, then ${decisionMakerLabel[decisionMaker]}'s own` : `${pluralizeCount(changedCount, "setting")} changed for this session`}
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
          <button type="submit" className="btn btn-primary">
            Start session
          </button>
        </div>
        <div className="text-secondary text-end mt-2" style={{ fontSize: "0.78rem" }}>
          Runs in the background; its progress shows under Background jobs.
        </div>
      </form>
      {confirmOpen && (
        <ConfirmModal
          title="Start this session?"
          size="lg"
          danger={false}
          confirmLabel="Start session"
          confirming={submitting}
          confirmDisabled={estimatePending}
          onConfirm={() => void startSession()}
          onCancel={() => setConfirmOpen(false)}
          message={
            <BacktestStartSessionConfirmBody
              name={name.trim()}
              startDate={sessionStartDate}
              endDate={sessionEndDate}
              periodNote={periodNote}
              decisionMakerLabel={decisionMakerRow?.choices?.find((choice) => choice.value === decisionMaker)?.label ?? decisionMaker}
              startingValue={startingValue}
              symbolCount={selectedFiles.length}
              tablesMode={tablesMode}
              estimateError={estimateIsCurrent ? estimate.error : null}
              changes={changes}
              warnings={currentResult?.warnings ?? []}
            />
          }
        />
      )}
    </div>
  );
}
