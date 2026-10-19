import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconChartCandle, IconCircle, IconCircleCheck, IconRefresh } from "@tabler/icons-react";
import { errorMessage } from "../../../api/client";
import { createBacktestSession, startBacktestDownload, type BacktestSettingsOverrides } from "../../../api/backtest";
import {
  analysisStepLabels,
  analysisSteps,
  cancelTickerAnalysis,
  fetchAnalysisEarnings,
  fetchAnalysisSessions,
  fetchBacktestLabSettings,
  fetchLabTickerOverrides,
  fetchTickerAnalysis,
  saveLabTickerOverrides,
  startTickerAnalysis,
  type AnalysisBaselineValues,
  type AnalysisRunView,
  type AnalysisSessionRow,
  type BacktestLabSettingsView,
  type BacktestLabTickerOverrides,
  type StoredAnalysis,
} from "../../../api/backtestAnalysis";
import { analysisBacktestName, analysisTickerKeys, differingAnalysisKeys, type AnalysisPanelKey, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatBrowserClockTime, formatDayMonthYear, formatNumber } from "../../../lib/formatters";
import { useSignalsTickerModal } from "../../../hooks/useSignalsTickerModal";
import { useIsAdmin } from "../../../hooks/useAuth";
import { TickerSuitabilityModal } from "../TickerSuitabilityModal";
import { AnalysisTickerIdentity } from "./AnalysisTickerHeader";
import { Spinner } from "../../Spinner";
import { usePolledBacktestResource } from "../useBacktestPolling";
import { AnalysisCard, AnalysisNote, AnalysisProgressBar } from "./analysisBits";
import { AnalysisBacktestConfirm } from "./AnalysisBacktestConfirm";
import { AnalysisChainMapCard } from "./AnalysisChainMapCard";
import { AnalysisFitCard, AnalysisPotCard, AnalysisShockCard, AnalysisTooLargeCard } from "./AnalysisFitCards";
import { AnalysisCorrelationCard, AnalysisDataQualityCard, AnalysisEarningsCard, AnalysisProfileCard } from "./AnalysisInfoCards";
import { AnalysisLiquidityCards } from "./AnalysisLiquidityCards";
import { AnalysisClaudeCards, AnalysisFitTiles, AnalysisKpiTiles } from "./AnalysisOverviewCards";
import { AnalysisPriceCards } from "./AnalysisPriceCards";
import { AnalysisSessionsCard } from "./AnalysisSessionsCard";
import { AnalysisSettingsCard, draftFromValues, type AnalysisDraft } from "./AnalysisSettingsCard";

// The Analyse window (Backtesting → Data files; mockup approved 2026-10-15): the stored analysis of one ticker at its
// backtesting (lab) values, recomputed by Update Analysis or by saving the ticker's values, with a settings panel to try
// values (Analyse Only, never saved) or save them for the ticker and analyse (Save and Analyse): both run the same analysis. Near full screen like the
// Signals ticker window; full screen on a phone. Informational: closes on ESC and the backdrop.

/** A run's lab values as the settings panel's values. */
function panelValuesOf(baseline: AnalysisBaselineValues, potDollars: number): AnalysisPanelValues {
  return {
    potDollars,
    ladderSharesPct: baseline.ladderSharesPct,
    ladderRungs: baseline.ladderRungs,
    ladderShockPct: baseline.ladderShock === "fixed" ? baseline.ladderShockPct : null,
    minAbsDelta: baseline.minAbsDelta,
    maxAbsDelta: baseline.maxAbsDelta,
    minDte: baseline.minDte,
    maxDte: baseline.maxDte,
    maxSpreadPctOfMid: baseline.maxSpreadPctOfMid,
  };
}

function globalPanelValues(lab: BacktestLabSettingsView): AnalysisPanelValues {
  return panelValuesOf(lab.settings.baseline as unknown as AnalysisBaselineValues, lab.defaultPotDollars);
}

function configuredPanelValues(global: AnalysisPanelValues, overrides: BacktestLabTickerOverrides | null): AnalysisPanelValues {
  if (!overrides) return global;
  return {
    ...global,
    potDollars: overrides.potDollars ?? global.potDollars,
    ladderSharesPct: overrides.ladderSharesPct ?? global.ladderSharesPct,
    ladderRungs: overrides.ladderRungs ?? global.ladderRungs,
    ladderShockPct: overrides.ladderShockPct ?? global.ladderShockPct,
    minAbsDelta: overrides.minAbsDelta ?? global.minAbsDelta,
    maxAbsDelta: overrides.maxAbsDelta ?? global.maxAbsDelta,
  };
}

const runFraction = (run: AnalysisRunView) => {
  const index = run.step ? analysisSteps.indexOf(run.step) : 0;
  const within = run.progressTotal > 0 ? run.progressDone / run.progressTotal : 0.5;
  return (index + Math.min(1, Math.max(0, within))) / analysisSteps.length;
};

function describeRunStep(run: AnalysisRunView): string {
  if (!run.step) return "starting";
  const label = analysisStepLabels[run.step].toLowerCase();
  if ((run.step === "chains" || run.step === "backtest") && run.progressTotal > 0) return `${label}, day ${formatNumber(run.progressDone)} of ${formatNumber(run.progressTotal)}`;
  return label;
}

interface TickerAnalysisModalProps {
  symbol: string;
  onClose: () => void;
  onEditGlobalSettings: () => void;
  /** After a Suitability save from the header: the opener's table reloads (otherwise it shows on its next poll). */
  onSuitabilitySaved?: () => Promise<void>;
}

export function TickerAnalysisModal({ symbol, onClose, onEditGlobalSettings, onSuitabilitySaved }: TickerAnalysisModalProps) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [suitabilityOpen, setSuitabilityOpen] = useState(false);
  const signalsTicker = useSignalsTickerModal();
  const isActive = useCallback((view: { active: AnalysisRunView[] }) => view.active.length > 0, []);
  const fetchView = useCallback(() => fetchTickerAnalysis(symbol), [symbol]);
  const { data: view, loadError, reload } = usePolledBacktestResource(fetchView, isActive, `Could not load ${symbol}'s analysis.`);
  const [lab, setLab] = useState<BacktestLabSettingsView | null>(null);
  const [overrides, setOverrides] = useState<BacktestLabTickerOverrides | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AnalysisSessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnalysisDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => window.matchMedia("(min-width: 576px)").matches);
  const [putsCapped, setPutsCapped] = useState(false);
  const [trialRunId, setTrialRunId] = useState<string | null>(null);
  const [showTrial, setShowTrial] = useState(false);
  const [busy, setBusy] = useState<"save" | "run" | "update" | "cancel" | "earnings" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [earningsMessage, setEarningsMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ values: AnalysisPanelValues } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [startingBacktest, setStartingBacktest] = useState(false);
  const [queuedBacktest, setQueuedBacktest] = useState<{ name: string; sessionId: string } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const [labView, tickerOverrides] = await Promise.all([fetchBacktestLabSettings(), fetchLabTickerOverrides(symbol)]);
      setLab(labView);
      setOverrides(tickerOverrides.overrides);
      setSettingsError(null);
      return { labView, tickerOverrides: tickerOverrides.overrides };
    } catch (err) {
      setSettingsError(errorMessage(err, "Could not load the backtesting settings."));
      return null;
    }
  }, [symbol]);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      if (loaded) setDraft(draftFromValues(configuredPanelValues(globalPanelValues(loaded.labView), loaded.tickerOverrides)));
    });
  }, [loadSettings]);

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

  // A trial that finished is shown as soon as it lands.
  useEffect(() => {
    if (trialRunId && view?.trial?.id === trialRunId) setShowTrial(true);
  }, [trialRunId, view?.trial?.id]);

  // ESC closes the window, unless the Signals ticker window, the confirmation or the Suitability window is open over it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirm && !signalsTicker.symbol && !suitabilityOpen) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, confirm, signalsTicker.symbol, suitabilityOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const global = useMemo(() => (lab ? globalPanelValues(lab) : null), [lab]);
  const configured = useMemo(() => (global ? configuredPanelValues(global, overrides) : null), [global, overrides]);
  const overriddenKeys = useMemo<AnalysisPanelKey[]>(() => (overrides ? analysisTickerKeys.filter((key) => overrides[key as keyof BacktestLabTickerOverrides] !== null) : []), [overrides]);
  const stored = view?.stored ?? null;
  const trial = showTrial && view?.trial ? view.trial : null;
  const shownAnalysis: StoredAnalysis | null = trial ?? stored;
  const shownFigures = shownAnalysis?.figures ?? null;
  const shown = shownAnalysis ? panelValuesOf(shownAnalysis.labValues.effective.baseline, shownAnalysis.labValues.effective.potDollars) : null;
  const storedValues = stored ? panelValuesOf(stored.labValues.effective.baseline, stored.labValues.effective.potDollars) : null;
  const savedRun = view?.active.find((run) => run.reason !== "trial") ?? null;
  const trialRun = view?.active.find((run) => run.reason === "trial") ?? null;
  const ruleShock = shownFigures?.shock.shock ?? 0.8;
  const stale = savedRun !== null && stored !== null;

  const run = async (kind: "update" | "run" | "cancel" | "earnings", work: () => Promise<void>) => {
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
  const updateAnalysis = () => run("update", async () => void (await startTickerAnalysis(symbol)));
  const runTrial = (values: AnalysisPanelValues) =>
    run("run", async () => {
      const started = await startTickerAnalysis(symbol, values);
      setTrialRunId(started.id);
    });
  const cancelRun = (target: AnalysisRunView) => run("cancel", async () => void (await cancelTickerAnalysis(target.id)));
  const fetchEarnings = () =>
    run("earnings", async () => {
      const result = await fetchAnalysisEarnings(symbol);
      setEarningsMessage(`Fetched ${result.written} report${result.written === 1 ? "" : "s"}; the analysis is updating with them.`);
    });

  const saveForTicker = async (values: AnalysisPanelValues) => {
    if (!global) return;
    setBusy("save");
    setActionError(null);
    try {
      // A ticker value equal to the global one clears the override.
      const body = Object.fromEntries(analysisTickerKeys.map((key) => [key, values[key] === global[key] ? null : values[key]]));
      await saveLabTickerOverrides(symbol, body);
      setShowTrial(false);
      await Promise.all([loadSettings(), reload()]);
    } catch (err) {
      setActionError(errorMessage(err, `Could not save ${symbol}'s values.`));
    } finally {
      setBusy(null);
    }
  };

  const figuresForDates = stored?.figures ?? shownFigures;
  const startBacktest = async () => {
    if (!confirm || !configured || !global || !lab || !figuresForDates?.dataQuality.firstDate || !figuresForDates.dataQuality.lastDate) return;
    const values = confirm.values;
    setStartingBacktest(true);
    setConfirmError(null);
    try {
      const sessionBaseline: Partial<Record<"minDte" | "maxDte" | "maxSpreadPctOfMid", number>> = {};
      for (const key of ["minDte", "maxDte", "maxSpreadPctOfMid"] as const) if (values[key] !== global[key]) sessionBaseline[key] = values[key];
      const overridesForSession: BacktestSettingsOverrides = {
        ...(lab.settings.decisionMaker === "baseline" ? {} : { decisionMaker: "baseline" as const }),
        ...(Object.keys(sessionBaseline).length > 0 ? { baseline: sessionBaseline } : {}),
      };
      const name = analysisBacktestName(symbol, values, differingAnalysisKeys(values, configured), ruleShock);
      const created = await createBacktestSession({
        name,
        symbols: [symbol],
        startDate: figuresForDates.dataQuality.firstDate,
        endDate: figuresForDates.dataQuality.lastDate,
        tablesMode: "walk_forward",
        overrides: overridesForSession,
        settingsSource: "per_ticker",
        symbolSettings: {
          [symbol]: {
            potDollars: values.potDollars,
            baseline: {
              ladderSharesPct: values.ladderSharesPct,
              ladderRungs: values.ladderRungs,
              minAbsDelta: values.minAbsDelta,
              maxAbsDelta: values.maxAbsDelta,
              ...(values.ladderShockPct === null ? { ladderShock: (lab.settings.baseline?.ladderShock ?? "history") as "history" | "fixed" } : { ladderShock: "fixed" as const, ladderShockPct: values.ladderShockPct }),
            },
          },
        },
      });
      setQueuedBacktest({ name, sessionId: created.session.id });
      setConfirm(null);
    } catch (err) {
      setConfirmError(errorMessage(err, "Could not start the backtest."));
    } finally {
      setStartingBacktest(false);
    }
  };

  const statusLine = (
    <div className="analysis-status-line">
      {stored && (
        <span>
          Computed {formatDayMonthYear((stored.finishedAt ?? stored.createdAt).slice(0, 10))}, {formatBrowserClockTime(stored.finishedAt ?? stored.createdAt)} · option data to {stored.optionLastDate ? formatDayMonthYear(stored.optionLastDate) : "—"}
        </span>
      )}
      {savedRun ? (
        <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void cancelRun(savedRun)}>
          <Spinner size="sm" />
          Updating · Stop
        </button>
      ) : (
        stored && (
          <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void updateAnalysis()}>
            {busy === "update" ? <Spinner size="sm" /> : <IconRefresh size={16} aria-hidden="true" />}
            Update Analysis
          </button>
        )
      )}
    </div>
  );

  const notices = [];
  if (view && stored && view.fileLastDate && stored.optionLastDate && view.fileLastDate > stored.optionLastDate && !savedRun) {
    notices.push(
      <AnalysisNote key="newer" tone="warn">
        <p>The data file now runs to {formatDayMonthYear(view.fileLastDate)}, past this analysis's last day ({formatDayMonthYear(stored.optionLastDate)}). Update Analysis to include the new days.</p>
      </AnalysisNote>,
    );
  }
  if (view && stored && !savedRun && stored.labValuesHash !== view.currentHash) {
    notices.push(
      <AnalysisNote key="values" tone="warn">
        <p>{symbol}'s backtesting settings have changed since this analysis was computed. Update Analysis to recompute it with the current ones.</p>
      </AnalysisNote>,
    );
  }
  if (view && stored && stored.formulasVersion < view.currentFormulasVersion && !savedRun) {
    notices.push(
      <AnalysisNote key="formulas" tone="info">
        <p>Computed with an older version of the analysis's formulas. Update Analysis for the current figures.</p>
      </AnalysisNote>,
    );
  }
  if (savedRun && stored) {
    notices.push(
      <AnalysisNote key="updating" tone="warn" icon="progress" live>
        <p className="d-inline-flex flex-wrap align-items-center gap-2">
          <Spinner size="sm" />
          <span>
            <b>Updating{savedRun.reason === "ticker_settings" ? ` with ${symbol}'s saved settings` : savedRun.reason === "global_settings" ? " with the saved global settings" : ""}:</b> {describeRunStep(savedRun)}. Until it finishes, the figures below are the previous analysis's. A background job: closing the window does not stop it.
          </span>
        </p>
        <AnalysisProgressBar fraction={runFraction(savedRun)} label="Updating the analysis" />
      </AnalysisNote>,
    );
  }
  if (view?.latestProblem && !savedRun) {
    notices.push(
      <div key="problem" className="alert alert-danger mb-0">
        The last update {view.latestProblem.status === "stopped" ? "stopped reporting (its process ended)" : "failed"}
        {view.latestProblem.error ? `: ${view.latestProblem.error}` : "."} {stored ? "The figures below are from the analysis before it." : ""}
      </div>,
    );
  }
  if (queuedBacktest) {
    notices.push(
      <AnalysisNote key="queued" tone="info" icon="done" live>
        <p>
          <b>Backtest started:</b> “{queuedBacktest.name}”. It runs as a background job like other backtests.{" "}
          <button type="button" className="analysis-link" onClick={() => navigate(`/backtest/sessions/${queuedBacktest.sessionId}`)}>
            Open the session
          </button>
        </p>
      </AnalysisNote>,
    );
  }

  let body;
  if (loadError) body = <div className="alert alert-danger mb-0">{loadError}</div>;
  else if (!view) {
    body = (
      <div className="d-flex justify-content-center py-5">
        <Spinner label={`Loading ${symbol}'s analysis`} />
      </div>
    );
  } else if (!stored) {
    if (savedRun) {
      const currentIndex = savedRun.step ? analysisSteps.indexOf(savedRun.step) : 0;
      body = (
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
      );
    } else {
      body = (
        <>
          {notices}
          {actionError && <div className="alert alert-danger mb-0">{actionError}</div>}
          <div className="card">
            <div className="analysis-empty-state">
              <IconChartCandle size={32} className="text-secondary" aria-hidden="true" />
              <h3>{symbol} hasn't been analysed yet</h3>
              <p>The analysis reads the data file with {symbol}'s backtesting values, runs a backtest of them over the whole file and stores the result, with Claude's summary. It runs as a background job, so you can close this window.</p>
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={busy !== null} onClick={() => void updateAnalysis()}>
                {busy === "update" ? <Spinner size="sm" /> : <IconChartCandle size={16} aria-hidden="true" />}
                Analyse now
              </button>
            </div>
          </div>
        </>
      );
    }
  } else if (!shownFigures || !shown || !storedValues) {
    body = <div className="alert alert-danger mb-0">The stored analysis has no figures.</div>;
  } else {
    const missingBars = shownFigures.bars.length === 0 ? { message: `${symbol} has no IBKR daily bars yet. The data file's download writes them at its end; updating the file fetches them.`, action: <button type="button" className="btn btn-outline-primary" onClick={() => void startBacktestDownload({ symbol, startDate: shownFigures.dataQuality.firstDate ?? undefined }).then(() => setActionError(null)).catch((err: unknown) => setActionError(errorMessage(err, "Could not start the download.")))}>Update the data file</button> } : null;
    body = (
      <>
        {notices}
        <AnalysisKpiTiles figures={shownFigures} />
        {settingsError && <div className="alert alert-danger mb-0">{settingsError}</div>}
        {draft && configured && global && (
          <AnalysisSettingsCard
            symbol={symbol}
            draft={draft}
            onDraftChange={setDraft}
            configured={configured}
            global={global}
            overriddenKeys={overriddenKeys}
            displayed={shown}
            showingTrial={trial !== null}
            ruleShock={ruleShock}
            lastPrice={shownFigures.chains.lastDay?.spot ?? null}
            lastDate={shownFigures.chains.lastDay?.date ?? null}
            open={settingsOpen}
            onToggleOpen={() => setSettingsOpen(!settingsOpen)}
            updateRunning={savedRun !== null}
            trialRun={trialRun}
            busy={busy === "save" || busy === "run" ? busy : null}
            actionError={actionError}
            onSave={(values) => void saveForTicker(values)}
            onRun={(values) => void runTrial(values)}
            onBackToStored={() => setShowTrial(false)}
            onEditGlobal={onEditGlobalSettings}
          />
        )}
        <AnalysisFitTiles figures={shownFigures} shown={shown} showingTrial={trial !== null} />
        <AnalysisClaudeCards symbol={symbol} analysis={shownAnalysis!} shown={shown} ruleShock={ruleShock} stale={stale} onTry={(values) => {
            setDraft(draftFromValues(global ? { ...values, minDte: global.minDte, maxDte: global.maxDte, maxSpreadPctOfMid: global.maxSpreadPctOfMid } : values));
            // Show where the values went (Marcelo 2026-10-19): the Settings card, opened, scrolled to the top of the window.
            setSettingsOpen(true);
            requestAnimationFrame(() =>
              document
                .getElementById("analysis-settings-body")
                ?.closest(".card")
                ?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }),
            );
          }} onBacktest={(values) => setConfirm({ values })} />
        <AnalysisPriceCards symbol={symbol} figures={shownFigures} shown={shown} showingTrial={trial !== null} stale={stale} missingBars={missingBars} />
        <AnalysisLiquidityCards symbol={symbol} figures={shownFigures} computedWith={shown} putsCapped={putsCapped} onPutsCappedChange={setPutsCapped} stale={stale} />
        <AnalysisChainMapCard figures={shownFigures} computedWith={shown} putsCapped={putsCapped} onPutsCappedChange={setPutsCapped} stale={stale} />
        <div className="analysis-two-col">
          <AnalysisFitCard symbol={symbol} figures={shownFigures} shown={shown} showingTrial={trial !== null} stale={stale} />
          <AnalysisPotCard symbol={symbol} figures={shownFigures} shown={shown} showingTrial={trial !== null} stale={stale} />
        </div>
        <div className="analysis-two-col">
          <AnalysisTooLargeCard figures={shownFigures} stale={stale} onOpenSession={(sessionId) => navigate(`/backtest/sessions/${sessionId}`)} />
          <AnalysisShockCard figures={shownFigures} ladderShockMinPct={shownAnalysis!.labValues.effective.baseline.ladderShockMinPct} ladderShockMaxPct={shownAnalysis!.labValues.effective.baseline.ladderShockMaxPct} lookbackYears={shownAnalysis!.labValues.effective.baseline.ladderShockLookbackYears} />
        </div>
        <AnalysisSessionsCard symbol={symbol} sessions={sessions} loadError={sessionsError} analysisSessionId={stored.sessionId} />
        <div className="analysis-two-col">
          <AnalysisEarningsCard symbol={symbol} figures={shownFigures} onFetchEarnings={() => void fetchEarnings()} fetching={busy === "earnings"} fetchMessage={earningsMessage} />
          <AnalysisCorrelationCard symbol={symbol} figures={shownFigures} />
        </div>
        <div className="analysis-two-col">
          <AnalysisProfileCard figures={shownFigures} />
          <AnalysisDataQualityCard figures={shownFigures} />
        </div>
      </>
    );
  }

  const confirmValues = confirm?.values ?? null;
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
      {confirmValues && configured && figuresForDates?.dataQuality.firstDate && figuresForDates.dataQuality.lastDate && (
        <AnalysisBacktestConfirm
          symbol={symbol}
          values={confirmValues}
          changed={differingAnalysisKeys(confirmValues, configured)}
          ruleShock={ruleShock}
          name={analysisBacktestName(symbol, confirmValues, differingAnalysisKeys(confirmValues, configured), ruleShock)}
          firstDate={figuresForDates.dataQuality.firstDate}
          lastDate={figuresForDates.dataQuality.lastDate}
          tradingDays={figuresForDates.dataQuality.completeDays}
          starting={startingBacktest}
          error={confirmError}
          onStart={() => void startBacktest()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {suitabilityOpen && view && (
        <TickerSuitabilityModal
          symbol={symbol}
          suitability={view.suitability}
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
