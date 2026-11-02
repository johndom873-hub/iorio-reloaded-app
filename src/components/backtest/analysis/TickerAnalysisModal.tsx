import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconChartCandle, IconCircle, IconCircleCheck, IconFlask, IconRefresh } from "@tabler/icons-react";
import { errorMessage } from "../../../api/client";
import { startBacktestDownload } from "../../../api/backtest";
import {
  analysisStepLabels,
  analysisSteps,
  cancelTickerAnalysis,
  fetchAnalysisEarnings,
  fetchAnalysisFileFigures,
  fetchAnalysisSessions,
  fetchBacktestLabGlobalAudit,
  fetchBacktestLabSettings,
  fetchTickerAnalysis,
  saveTickerOwnValues,
  startTickerAnalysis,
  type AnalysisBacktestFigures,
  type AnalysisFileFigures,
  type AnalysisRunView,
  type AnalysisSessionRow,
  type StoredAnalysis,
  type TickerFieldValues,
} from "../../../api/backtestAnalysis";
import { describeLabChangesSince, describeTickerValuesDifferingFromLab, mergeTickerOwnValues, tickerFieldValuesOfVolFarmerV4, tickerValueGroupsDiffering } from "../../../lib/analysisPresentation";
import { formatBrowserClockTime, formatCurrency, formatDayMonth, formatDayMonthYear, formatNumber, joinWithAnd } from "../../../lib/formatters";
import { useTickerModal } from "../../../hooks/useTickerModal";
import { useIsAdmin } from "../../../hooks/useAuth";
import { TickerSuitabilityModal } from "../TickerSuitabilityModal";
import { AnalysisTickerIdentity } from "./AnalysisTickerHeader";
import { Spinner } from "../../Spinner";
import { usePolledBacktestResource } from "../useBacktestPolling";
import { AnalysisCard, AnalysisNote, AnalysisProgressBar } from "./analysisBits";
import { AnalysisBacktestCard, AnalysisMonthByMonthCard, AnalysisWheelCyclesCard } from "./AnalysisBacktestCards";
import { AnalysisFallsCard } from "./AnalysisFallsCard";
import { AnalysisHoldingChart } from "./AnalysisHoldingChart";
import { holdingRangeStart, type HoldingChartRange } from "./analysisHoldingChartModel";
import { AnalysisCorrelationCard, AnalysisDataQualityCard, AnalysisEarningsCard } from "./AnalysisInfoCards";
import { AnalysisSessionsCard } from "./AnalysisSessionsCard";
import { AnalysisSourcesCard } from "./AnalysisSourcesCard";
import { AnalysisStockProfileCard } from "./AnalysisStockProfileCard";
import { AnalysisTickerValuesCard, type AnalysisShownValuesTrial } from "./AnalysisTickerValuesCard";
import { AnalysisCanTradeCard, AnalysisSizeCard, AnalysisTodayCard } from "./AnalysisTradingCards";
import { AnalysisRuleCard, AnalysisVerdictBand } from "./AnalysisVerdictCards";
import { AnalysisVolatilityCard } from "./AnalysisVolatilityCard";

// The Analyse window (Backtesting → Data files): one ticker judged for Vol Farmer v4 at the lab's values, with the
// ticker's own on top (mockups approved 2026-11-01 and 2026-11-02). The stored analysis is re-run by Re-run analysis or
// Save and Analyse, or marked out of date when the values it read change; a trial runs at another starting value or with
// other values (Analyse Only) and is never saved as the ticker's analysis. Near full screen like the Signals ticker
// window; full screen on a phone. Informational: closes on ESC and the backdrop.

const runFraction = (run: AnalysisRunView) => {
  const index = run.step ? analysisSteps.indexOf(run.step) : 0;
  const within = run.progressTotal > 0 ? run.progressDone / run.progressTotal : 0.5;
  return (index + Math.min(1, Math.max(0, within))) / analysisSteps.length;
};

function describeRunStep(run: AnalysisRunView): string {
  if (!run.step) return "starting";
  const label = analysisStepLabels[run.step].toLowerCase();
  if ((run.step === "calls" || run.step === "backtest") && run.progressTotal > 0) return `${label}, day ${formatNumber(run.progressDone)} of ${formatNumber(run.progressTotal)}`;
  return label;
}

const backtestOf = (analysis: StoredAnalysis | null): AnalysisBacktestFigures | null => {
  const backtest = analysis?.figures?.analysisBacktest ?? null;
  return backtest && "sessionId" in backtest ? backtest : null;
};

/** A run's five as it ran them, and the lab's five of that moment. */
function runTickerValues(run: Pick<AnalysisRunView, "labValues">): { ran: TickerFieldValues; lab: TickerFieldValues } {
  const ran = tickerFieldValuesOfVolFarmerV4(run.labValues.effective.v4);
  const labSection = run.labValues.settings.volFarmerV4;
  return { ran, lab: labSection ? tickerFieldValuesOfVolFarmerV4(labSection) : ran };
}

/** What a run ran apart from the lab's values: "Calls' |delta| 0.10 to 0.40"; "" when nothing. */
const describeRunOwnValues = (run: Pick<AnalysisRunView, "labValues">) => {
  const { ran, lab } = runTickerValues(run);
  return describeTickerValuesDifferingFromLab(ran, lab);
};

/** A trial's name in the notes: "Trial at $200,000", with the values it ran apart from the lab's. */
const describeTrialRun = (run: Pick<AnalysisRunView, "labValues">) => {
  const values = run.labValues.trial?.volFarmerV4 ? describeRunOwnValues(run) : "";
  return `at ${formatCurrency(run.labValues.effective.accountDollars, 0)}${values ? ` with ${values}` : ""}`;
};

interface TickerAnalysisModalProps {
  symbol: string;
  onClose: () => void;
  /** After a Suitability save from the header: the opener's table reloads (otherwise it shows on its next poll). */
  onSuitabilitySaved?: () => Promise<void>;
}

export function TickerAnalysisModal({ symbol, onClose, onSuitabilitySaved }: TickerAnalysisModalProps) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [suitabilityOpen, setSuitabilityOpen] = useState(false);
  const signalsTicker = useTickerModal();
  const isActive = useCallback((view: { active: AnalysisRunView[] }) => view.active.length > 0, []);
  const fetchView = useCallback(() => fetchTickerAnalysis(symbol), [symbol]);
  const { data: view, loadError, reload } = usePolledBacktestResource(fetchView, isActive, `Could not load ${symbol}'s analysis.`);
  const [sessions, setSessions] = useState<AnalysisSessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [trialRunId, setTrialRunId] = useState<string | null>(null);
  const [showTrial, setShowTrial] = useState(false);
  const [busy, setBusy] = useState<"rerun" | "trial" | "values-trial" | "save-values" | "cancel" | "earnings" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [earningsMessage, setEarningsMessage] = useState<string | null>(null);
  const [range, setRange] = useState<HoldingChartRange>("Backtest");
  const [labChanges, setLabChanges] = useState<string[] | null>(null);

  const storedId = view?.stored?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    fetchAnalysisSessions(symbol)
      .then((rows) => {
        if (!cancelled) {
          setSessions(rows);
          setSessionsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setSessionsError(errorMessage(err, "Could not load the backtests."));
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, storedId]);

  // Before the first analysis, the figures the data file gives on its own (mockup approved 2026-10-25): read while nothing
  // is stored, then the view again, for the split lines the read caches.
  const [fileFigures, setFileFigures] = useState<AnalysisFileFigures | null>(null);
  const [fileFiguresError, setFileFiguresError] = useState<string | null>(null);
  const nothingStored = view ? view.stored === null : false;
  useEffect(() => {
    if (!nothingStored) return;
    let cancelled = false;
    fetchAnalysisFileFigures(symbol).then(
      (figures) => {
        if (cancelled) return;
        setFileFigures(figures);
        setFileFiguresError(null);
        void reload();
      },
      (err: unknown) => {
        if (!cancelled) setFileFiguresError(errorMessage(err, `Could not read ${symbol}'s data file.`));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [symbol, nothingStored, reload]);

  // A trial that finished is shown as soon as it lands.
  useEffect(() => {
    if (trialRunId && view?.trial?.id === trialRunId) setShowTrial(true);
  }, [trialRunId, view?.trial?.id]);

  const stored = view?.stored ?? null;
  const savedRun = view?.active.find((run) => run.reason !== "trial") ?? null;
  const trialRun = view?.active.find((run) => run.reason === "trial") ?? null;
  const outOfDate = Boolean(view?.outOfDate && stored && !savedRun);
  const ranWithOlderFormulas = Boolean(view && stored && stored.formulasVersion < view.currentFormulasVersion);

  // What changed in the lab since the stored analysis ran, for the out-of-date note.
  const storedRanAt = stored ? (stored.finishedAt ?? stored.createdAt) : null;
  useEffect(() => {
    if (!outOfDate || !storedRanAt) {
      setLabChanges(null);
      return;
    }
    let cancelled = false;
    Promise.all([fetchBacktestLabGlobalAudit(), fetchBacktestLabSettings()]).then(
      ([audit, lab]) => {
        if (!cancelled) setLabChanges(describeLabChangesSince(audit, lab.rows, storedRanAt));
      },
      () => {
        if (!cancelled) setLabChanges([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [outOfDate, storedRanAt]);

  // ESC closes the window, unless the Signals ticker window or the Suitability window is open over it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !signalsTicker.symbol && !suitabilityOpen) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, signalsTicker.symbol, suitabilityOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const trial = showTrial && view?.trial ? view.trial : null;
  const shownAnalysis: StoredAnalysis | null = trial ?? stored;
  const shownFigures = shownAnalysis?.figures ?? null;
  const shownBacktest = backtestOf(shownAnalysis);

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await work();
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, "The request failed."));
    } finally {
      setBusy(null);
    }
  };
  const rerunAnalysis = () => run("rerun", async () => void (await startTickerAnalysis(symbol)));
  const runTrial = (accountDollars: number) =>
    run("trial", async () => {
      const started = await startTickerAnalysis(symbol, { accountDollars });
      setTrialRunId(started.id);
    });
  const cancelRun = (target: AnalysisRunView) => run("cancel", async () => void (await cancelTickerAnalysis(target.id)));
  // Save and Analyse: the boxes' values kept for the ticker (null where they are the lab's), its analysis re-run with them.
  const saveOwnValues = (values: TickerFieldValues) =>
    run("save-values", async () => {
      const lab = view!.labTickerFieldValues;
      await saveTickerOwnValues(symbol, Object.fromEntries(Object.entries(values).map(([field, value]) => [field, value === lab[field as keyof TickerFieldValues] ? null : value])));
      setShowTrial(false);
      setTrialRunId(null);
    });
  // Analyse Only: a trial with the boxes' values at the account of the analysis shown.
  const tryOwnValues = (values: TickerFieldValues) =>
    run("values-trial", async () => {
      const started = await startTickerAnalysis(symbol, { accountDollars: (shownAnalysis ?? stored)?.labValues.effective.accountDollars ?? stored!.labValues.defaultPotDollars, volFarmerV4: values });
      setTrialRunId(started.id);
    });
  const fetchEarnings = () =>
    run("earnings", async () => {
      const result = await fetchAnalysisEarnings(symbol);
      setEarningsMessage(`Fetched ${result.written} report${result.written === 1 ? "" : "s"}; the analysis is re-running with them.`);
    });

  // A new session on the New session form: the analysis backtest's own (a trial's when one is shown) to start from.
  const openNewSession = () => navigate(shownBacktest ? `/backtest/new?from=${encodeURIComponent(shownBacktest.sessionId)}` : `/backtest/new?symbols=${encodeURIComponent(symbol)}`);

  const storedOwnValuesText = stored ? describeRunOwnValues(stored) : "";
  // The ticker's own values now against those the stored analysis read: changed since, it is out of date for that.
  const currentTickerValues = view ? mergeTickerOwnValues(view.labTickerFieldValues, view.tickerValues?.values) : null;
  const ownValuesChangedSinceStored = Boolean(stored && view && currentTickerValues && tickerValueGroupsDiffering(mergeTickerOwnValues(runTickerValues(stored).lab, stored.labValues.tickerValues), mergeTickerOwnValues(runTickerValues(stored).lab, view.tickerValues?.values)).length > 0);
  // The values trial the cards show, for the values card's note.
  const shownValuesTrial: AnalysisShownValuesTrial | null = trial?.labValues.trial?.volFarmerV4 ? { values: runTickerValues(trial).ran, accountDollars: trial.labValues.effective.accountDollars, atLabAccount: trial.labValues.effective.accountDollars === trial.labValues.defaultPotDollars } : null;
  const valuesCard = view && (
    <AnalysisTickerValuesCard
      symbol={symbol}
      labValues={view.labTickerFieldValues}
      ownValues={view.tickerValues?.values ?? null}
      shownTrial={shownValuesTrial}
      showingTrial={trial !== null}
      savedAnalysisRunning={savedRun !== null}
      trialRunning={trialRun !== null}
      busy={busy !== null}
      saving={busy === "save-values"}
      tryingValues={busy === "values-trial"}
      onSave={(values) => void saveOwnValues(values)}
      onAnalyseOnly={(values) => void tryOwnValues(values)}
      onBackToStored={() => setShowTrial(false)}
    />
  );

  const statusLine = (
    <div className="analysis-status-line">
      {stored && (
        <>
          <span>
            Analysed {formatDayMonthYear((stored.finishedAt ?? stored.createdAt).slice(0, 10))}, {formatBrowserClockTime(stored.finishedAt ?? stored.createdAt)}
          </span>
          <span aria-hidden="true">·</span>
          <span>option data to {stored.optionLastDate ? formatDayMonthYear(stored.optionLastDate) : "—"}</span>
          <span aria-hidden="true">·</span>
          <span>{trial ? `a trial ${describeTrialRun(trial)}` : storedOwnValuesText ? `${symbol}'s own values: ${storedOwnValuesText}` : "the lab's Vol Farmer v4 values"}</span>
        </>
      )}
      {savedRun ? (
        <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void cancelRun(savedRun)}>
          <Spinner size="sm" />
          Re-running · Stop
        </button>
      ) : (
        stored && (
          <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void rerunAnalysis()}>
            {busy === "rerun" ? <Spinner size="sm" /> : <IconRefresh size={16} aria-hidden="true" />}
            Re-run analysis
          </button>
        )
      )}
      <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" title={shownBacktest ? `A new backtest session starting from ${trial ? "this trial's" : "this analysis's"} backtest` : `A new backtest session of ${symbol}`} onClick={openNewSession}>
        <IconFlask size={16} aria-hidden="true" />
        Backtest
      </button>
    </div>
  );

  const notices = [];
  if (view && stored && view.fileLastDate && stored.optionLastDate && view.fileLastDate > stored.optionLastDate && !savedRun) {
    notices.push(
      <AnalysisNote key="newer" tone="warn">
        <p>The data file now runs to {formatDayMonthYear(view.fileLastDate)}, past this analysis's last day ({formatDayMonthYear(stored.optionLastDate)}). Re-run the analysis to include the new days.</p>
      </AnalysisNote>,
    );
  }
  if (outOfDate && view) {
    const labSaved = view.labSavedAt;
    notices.push(
      <AnalysisNote
        key="out-of-date"
        tone="warn"
        actions={
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void rerunAnalysis()}>
            {busy === "rerun" ? <Spinner size="sm" /> : <IconRefresh size={16} aria-hidden="true" />}
            Re-run analysis
          </button>
        }
      >
        <p>
          <b>Out of date.</b>{" "}
          {ranWithOlderFormulas && stored!.labValuesHash === view.currentHash
            ? "Computed with an older version of the analysis's formulas."
            : ownValuesChangedSinceStored && currentTickerValues
              ? `${symbol}'s own values changed after this analysis ran: ${describeTickerValuesDifferingFromLab(currentTickerValues, view.labTickerFieldValues) || "the lab's values"} now.${ranWithOlderFormulas ? " Its formulas are an older version too." : ""}`
              : `The lab's v4 values changed on ${formatDayMonth(labSaved.slice(0, 10))} at ${formatBrowserClockTime(labSaved)}, after this analysis ran${labChanges && labChanges.length > 0 ? `: ${joinWithAnd(labChanges)}` : ""}.${ranWithOlderFormulas ? " Its formulas are an older version too." : ""}`}{" "}
          Everything below is from the values it ran with.
        </p>
      </AnalysisNote>,
    );
  }
  const savedRunOwnValuesText = savedRun ? describeRunOwnValues(savedRun) : "";
  if (savedRun && stored) {
    notices.push(
      <AnalysisNote key="updating" tone="warn" icon="progress" live>
        <p className="d-inline-flex flex-wrap align-items-center gap-2">
          <Spinner size="sm" />
          <span>
            <b>{savedRun.reason === "ticker_settings" ? `Saved for ${symbol}; re-running with ${savedRunOwnValuesText ? `its own values (${savedRunOwnValuesText})` : "the lab's values"}` : `Re-running${savedRun.reason === "global_settings" ? " with the lab's saved values" : ""}`}:</b> {describeRunStep(savedRun)}. Until it finishes, the figures below are the previous analysis's. A background job: closing the window does not stop it.
          </span>
        </p>
        <AnalysisProgressBar fraction={runFraction(savedRun)} label="Re-running the analysis" />
      </AnalysisNote>,
    );
  }
  if (trialRun) {
    notices.push(
      <AnalysisNote
        key="trial-running"
        tone="info"
        icon="progress"
        live
        actions={
          <button type="button" className="btn btn-outline-secondary" disabled={busy !== null} onClick={() => void cancelRun(trialRun)}>
            Stop the trial
          </button>
        }
      >
        <p className="d-inline-flex flex-wrap align-items-center gap-2">
          <Spinner size="sm" />
          <span>
            <b>Trial {describeTrialRun(trialRun)}:</b> {describeRunStep(trialRun)}. It shows here when it finishes; nothing is saved as {symbol}'s analysis.
          </span>
        </p>
        <AnalysisProgressBar fraction={runFraction(trialRun)} label="Running the trial" />
      </AnalysisNote>,
    );
  }
  if (trial && !shownValuesTrial) {
    notices.push(
      <AnalysisNote
        key="trial-shown"
        tone="info"
        actions={
          <button type="button" className="btn btn-outline-primary" onClick={() => setShowTrial(false)}>
            Back to the analysis
          </button>
        }
      >
        <p>
          <b>A trial at {formatCurrency(trial.labValues.effective.accountDollars, 0)}</b> (a {formatCurrency(trial.labValues.effective.potDollars, 0)} pot): the analysis backtest at another starting value. Nothing is saved as {symbol}'s analysis; the figures that don't depend on the backtest are the analysis's own.
        </p>
      </AnalysisNote>,
    );
  } else if (!trial && view?.trial && !trialRun) {
    notices.push(
      <AnalysisNote
        key="trial-available"
        tone="plain"
        actions={
          <button type="button" className="btn btn-outline-secondary" onClick={() => setShowTrial(true)}>
            Show the trial
          </button>
        }
      >
        <p>The last trial, {describeTrialRun(view.trial)}, is kept until the next one.</p>
      </AnalysisNote>,
    );
  }
  if (view?.latestProblem && !savedRun) {
    notices.push(
      <div key="problem" className="alert alert-danger mb-0">
        The last run {view.latestProblem.status === "stopped" ? "stopped reporting (its process ended)" : "failed"}
        {view.latestProblem.error ? `: ${view.latestProblem.error}` : "."} {stored ? "The figures below are from the analysis before it." : ""}
      </div>,
    );
  }

  // No daily bars: why, and the download that fetches them.
  const missingBarsOf = (figures: AnalysisFileFigures) =>
    figures.bars.length === 0
      ? {
          message: `${symbol} has no IBKR daily bars yet. The data file's download writes them at its end; updating the file fetches them.`,
          action: (
            <button type="button" className="btn btn-outline-primary" onClick={() => void startBacktestDownload({ symbol, startDate: figures.dataQuality.firstDate ?? undefined }).then(() => setActionError(null)).catch((err: unknown) => setActionError(errorMessage(err, "Could not start the download.")))}>
              Update the data file
            </button>
          ),
        }
      : null;

  /** The cards every state shows: the price chart (with the backtest's marks when there is one) and the file's own figures. */
  const fileCards = (figures: AnalysisFileFigures, backtest: AnalysisBacktestFigures | null, effective: StoredAnalysis["labValues"]["effective"] | null) => {
    const targetShare = effective?.firstPositionShare ?? 0.8;
    const bandShare = (effective?.v4.rebalanceBandPct ?? 5) / 100;
    const shownRange: HoldingChartRange = range === "Backtest" && !backtest ? "All" : range;
    return {
      holding: <AnalysisHoldingChart symbol={symbol} figures={figures} backtest={backtest} range={shownRange} onRangeChange={setRange} targetShare={targetShare} bandShare={bandShare} missingBars={missingBarsOf(figures)} />,
      falls: <AnalysisFallsCard symbol={symbol} figures={figures} backtest={backtest} />,
      profile: <AnalysisStockProfileCard figures={figures} backtest={backtest} profile={view?.profile ?? null} splits={view?.detectedSplits ?? null} />,
      rest: (
        <>
          <div className="analysis-two-col">
            <AnalysisVolatilityCard figures={figures} fromDate={holdingRangeStart(shownRange, figures.bars, backtest?.startDate ?? null)} />
            <AnalysisCorrelationCard symbol={symbol} figures={figures} />
            <AnalysisEarningsCard symbol={symbol} figures={figures} onFetchEarnings={() => void fetchEarnings()} fetching={busy === "earnings"} fetchMessage={earningsMessage} />
            <AnalysisDataQualityCard figures={figures} />
          </div>
          <AnalysisSessionsCard symbol={symbol} sessions={sessions} loadError={sessionsError} analysisSessionId={backtest?.sessionId ?? null} />
        </>
      ),
    };
  };

  let body;
  if (loadError) body = <div className="alert alert-danger mb-0">{loadError}</div>;
  else if (!view) {
    body = (
      <div className="d-flex justify-content-center py-5">
        <Spinner label={`Loading ${symbol}'s analysis`} />
      </div>
    );
  } else if (!stored) {
    const fromFile = fileFiguresError ? (
      <div className="alert alert-danger mb-0">{fileFiguresError}</div>
    ) : !fileFigures ? (
      <div className="d-flex justify-content-center py-4">
        <Spinner label={`Reading ${symbol}'s data file`} />
      </div>
    ) : (
      (() => {
        const cards = fileCards(fileFigures, null, null);
        return (
          <>
            {cards.holding}
            {cards.falls}
            {cards.profile}
            {cards.rest}
          </>
        );
      })()
    );
    if (savedRun) {
      const currentIndex = savedRun.step ? analysisSteps.indexOf(savedRun.step) : 0;
      body = (
        <>
          <AnalysisCard title={`Analysing ${symbol}`} description="First analysis of this ticker. It runs as a background job, so closing this window does not stop it.">
            <div className="card-body">
              <ol className="analysis-steps">
                {analysisSteps.map((step, index) => {
                  const state = index < currentIndex ? "done" : index === currentIndex ? "run" : "wait";
                  return (
                    <li key={step}>
                      <span className={state === "done" ? "is-done" : state === "wait" ? "is-wait" : undefined}>{state === "done" ? <IconCircleCheck size={18} aria-hidden="true" /> : state === "run" ? <Spinner size="sm" /> : <IconCircle size={18} aria-hidden="true" />}</span>
                      <span className={state === "wait" ? "text-secondary" : undefined}>{analysisStepLabels[step]}</span>
                      <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
                        {state === "run" && savedRun.progressTotal > 0 ? `day ${formatNumber(savedRun.progressDone)} of ${formatNumber(savedRun.progressTotal)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3">
                <AnalysisProgressBar fraction={runFraction(savedRun)} label={`Analysing ${symbol}`} />
              </div>
              <button type="button" className="btn btn-outline-secondary mt-3" disabled={busy !== null} onClick={() => void cancelRun(savedRun)}>
                Cancel
              </button>
            </div>
          </AnalysisCard>
          {fromFile}
        </>
      );
    } else {
      body = (
        <>
          {notices}
          {actionError && <div className="alert alert-danger mb-0">{actionError}</div>}
          <AnalysisNote
            tone="info"
            actions={
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void rerunAnalysis()}>
                {busy === "rerun" ? <Spinner size="sm" /> : <IconChartCandle size={16} aria-hidden="true" />}
                Analyse now
              </button>
            }
          >
            <p>
              <b>{symbol} hasn't been analysed yet.</b> The cards below come straight from the data file. The analysis adds the rest: whether it suits Vol Farmer v4 over the last 12, 6 and 3 months, a v4 backtest from the start of steady weeklies, the Calls v4 could sell on each expiry day, the pot that fits and what v4 would do today. It runs as a background job, so you can close this window.
            </p>
          </AnalysisNote>
          {valuesCard}
          {fromFile}
        </>
      );
    }
  } else if (!shownFigures || !shownAnalysis) {
    body = <div className="alert alert-danger mb-0">The stored analysis has no figures.</div>;
  } else {
    const effective = shownAnalysis.labValues.effective;
    const cards = fileCards(shownFigures, shownBacktest, effective);
    const backtestProblem = shownFigures.analysisBacktest && "error" in shownFigures.analysisBacktest ? shownFigures.analysisBacktest.error : shownFigures.analysisBacktest === null ? "no backtest ran" : null;
    const splits = view.detectedSplits ?? [];
    body = (
      <>
        {notices}
        {actionError && <div className="alert alert-danger mb-0">{actionError}</div>}
        {valuesCard}
        {backtestProblem && <div className="alert alert-danger mb-0">The analysis backtest didn't finish ({backtestProblem}), so the verdict and the backtest's cards are missing. Re-run the analysis.</div>}
        {shownBacktest && (
          <>
            <AnalysisVerdictBand symbol={symbol} figures={shownFigures} backtest={shownBacktest} potDollars={effective.potDollars} firstPositionShare={effective.firstPositionShare} onSetFlag={isAdmin ? () => setSuitabilityOpen(true) : null} />
            <AnalysisRuleCard backtest={shownBacktest} splits={splits} />
            <AnalysisSourcesCard symbol={symbol} backtest={shownBacktest} putsStartCallYieldPct={effective.v4.putsStartCallYieldPct} bandFloorShare={effective.firstPositionShare - effective.v4.rebalanceBandPct / 100} bandTopShare={effective.firstPositionShare + effective.v4.rebalanceBandPct / 100} />
          </>
        )}
        {cards.holding}
        {shownBacktest && (
          <>
            <AnalysisBacktestCard symbol={symbol} backtest={shownBacktest} steadyWeekliesFrom={shownFigures.expiryWeeks.steadyWeekliesFrom} isTrial={trial !== null} onOpenSession={() => navigate(`/backtest/sessions/${shownBacktest.sessionId}`)} />
            <AnalysisMonthByMonthCard symbol={symbol} backtest={shownBacktest} />
            <AnalysisWheelCyclesCard symbol={symbol} backtest={shownBacktest} />
          </>
        )}
        {cards.falls}
        <div className="analysis-two-col">
          <AnalysisCanTradeCard symbol={symbol} figures={shownFigures} backtest={shownBacktest} effective={effective} />
          <AnalysisSizeCard figures={shownFigures} effective={effective} onRunTrial={(accountDollars) => void runTrial(accountDollars)} trialRunning={trialRun !== null} busy={busy !== null} />
        </div>
        <AnalysisTodayCard symbol={symbol} figures={shownFigures} />
        {cards.profile}
        {cards.rest}
      </>
    );
  }

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div
        className="modal show d-block analysis-modal"
        style={{ zIndex: 1050 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-modal-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-inset">
          <div className="modal-content">
            <div className="modal-header">
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="analysis-header-title-row">
                  <h5 className="modal-title" id="analysis-modal-title">
                    {symbol}
                  </h5>
                  {view && <AnalysisTickerIdentity symbol={symbol} profile={view.profile} suitability={view.suitability} onOpenSuitability={isAdmin ? () => setSuitabilityOpen(true) : null} />}
                </div>
              </div>
              <div className="d-none d-sm-block">{statusLine}</div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <div className="d-sm-none">{statusLine}</div>
              {body}
            </div>
          </div>
        </div>
      </div>
      {suitabilityOpen && view && (
        <TickerSuitabilityModal
          symbol={symbol}
          suitability={view.suitability}
          ruleVerdict={shownBacktest?.rule.verdict ?? null}
          stacked
          onSaved={async () => {
            await Promise.all([reload(), onSuitabilitySaved?.()]);
          }}
          onClose={() => setSuitabilityOpen(false)}
        />
      )}
    </>
  );
}
