import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createSavedPortfolio,
  deleteSavedPortfolio,
  fetchPortfolioLibraryStatus,
  fetchPortfolioPots,
  fetchPortfolioTickers,
  fetchSavedPortfolios,
  openPortfolioProjectionStream,
  openPortfolioSuggestionsStream,
  rebuildPortfolioLibrary,
  simulatePortfolio,
  updateSavedPortfolio,
  type PortfolioBookTicker,
  type PortfolioDrift,
  type PortfolioLibraryStatus,
  type PortfolioPots,
  type PortfolioProjection,
  type PortfolioSimulation,
  type PortfolioSuggestion,
  type PortfolioSuggestions,
  type PortfolioTickerListing,
  type SavedPortfolio,
} from "../../api/backtestPortfolio";
import { errorMessage } from "../../api/client";
import { PageHeader } from "../../components/layout/PageHeader";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink } from "../../components/backtest/backtestBits";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePollWhileVisible } from "../../hooks/usePollWhileVisible";
import { PortfolioBar } from "../../components/backtest/portfolio/PortfolioBar";
import { PortfolioControls, type ProjectionRunState } from "../../components/backtest/portfolio/PortfolioControls";
import { PortfolioBookCard } from "../../components/backtest/portfolio/PortfolioBookCard";
import { PortfolioOutcomeCard } from "../../components/backtest/portfolio/PortfolioOutcomeCard";
import { PortfolioReplaysTable } from "../../components/backtest/portfolio/PortfolioReplaysTable";
import { PortfolioTickersTable, type PortfolioTickerRow } from "../../components/backtest/portfolio/PortfolioTickersTable";
import { PortfolioFallTogetherCard } from "../../components/backtest/portfolio/PortfolioFallTogetherCard";
import { PortfolioSuggestionsCard } from "../../components/backtest/portfolio/PortfolioSuggestionsCard";
import { PortfolioAddTickerPicker } from "../../components/backtest/portfolio/PortfolioAddTickerPicker";
import { SavePortfolioAsModal } from "../../components/backtest/portfolio/SavePortfolioAsModal";
import {
  driftLabels,
  driftOrder,
  editedPortfolioOf,
  emptyPortfolio,
  groupLabelBySymbol,
  hasUnsavedChanges,
  projectionKeyOf,
  readLastOpenedPortfolioId,
  readPortfolioViewSettings,
  roundAllocationsKeepingTotal,
  warningCodesBySymbol,
  warningLinesOf,
  writeLastOpenedPortfolioId,
  writePortfolioViewSettings,
  type EditedPortfolio,
  type PortfolioViewSettings,
} from "../../lib/portfolioSimulatorPresentation";

// The lab's portfolio simulator (Marcelo 2026-11-03/04, mockup approved): choose Pluto's tickers and allocations, save them as
// named portfolios, project the book with v4's own steps, compare it with another saved portfolio, and take the suggestions.
// The last portfolio opened in this browser opens again; with none, an empty book. A projection runs on Run projection and
// when a portfolio is opened (instant when the same one was saved in the last 14 days); after it, the compared portfolio's
// projection and the suggestions follow. Every projection runs at both drifts, one after the other, on the same paths.

/** A book's projections at both drifts. */
type ProjectionPair = Record<PortfolioDrift, PortfolioProjection>;

type PendingSwitch = { kind: "open"; id: string } | { kind: "new" };

const idleRun: ProjectionRunState = { running: false, label: null, done: 0, total: 0, error: null };

export function PortfolioSimulatorPage() {
  const navigate = useNavigate();
  const [portfolios, setPortfolios] = useState<SavedPortfolio[] | null>(null);
  const [listing, setListing] = useState<PortfolioTickerListing[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edited, setEdited] = useState<EditedPortfolio>(emptyPortfolio);
  const [view, setView] = useState<PortfolioViewSettings>(readPortfolioViewSettings);
  const [simulation, setSimulation] = useState<PortfolioSimulation | null>(null);
  const [pots, setPots] = useState<PortfolioPots | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [projection, setProjection] = useState<{ key: string; data: ProjectionPair } | null>(null);
  const [compared, setCompared] = useState<{ portfolioId: string; key: string; data: ProjectionPair } | null>(null);
  const [run, setRun] = useState<ProjectionRunState>(idleRun);
  const [suggestions, setSuggestions] = useState<PortfolioSuggestions | null>(null);
  const [suggestionsRunning, setSuggestionsRunning] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [library, setLibrary] = useState<PortfolioLibraryStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const stopStreams = useRef<(() => void)[]>([]);
  const portfoliosRef = useRef<SavedPortfolio[]>([]);
  const comparedRef = useRef<{ portfolioId: string; key: string; data: ProjectionPair } | null>(null);
  portfoliosRef.current = portfolios ?? [];

  const saved = edited.id ? (portfolios?.find((portfolio) => portfolio.id === edited.id) ?? null) : null;
  const unsaved = hasUnsavedChanges(edited, saved);
  const currentKey = projectionKeyOf(edited.tickers, edited.accountDollars, view);
  const compareWith = view.compareWithId ? (portfolios?.find((portfolio) => portfolio.id === view.compareWithId && portfolio.id !== edited.id) ?? null) : null;

  const changeView = (change: Partial<PortfolioViewSettings>) =>
    setView((previous) => {
      const next = { ...previous, ...change };
      writePortfolioViewSettings(next);
      return next;
    });

  // ---- Streams: the book's projection, then the compared portfolio's, then the suggestions ----

  const stopAll = useCallback(() => {
    for (const stop of stopStreams.current) stop();
    stopStreams.current = [];
    setRun((previous) => ({ ...previous, running: false, label: null }));
    setSuggestionsRunning(false);
  }, []);

  useEffect(() => stopAll, [stopAll]);

  /** `book` projected at the neutral drift, then as it happened, the progress counting both; `onDone` with the pair. */
  const projectBothDrifts = useCallback((book: Pick<EditedPortfolio, "tickers" | "accountDollars">, settings: PortfolioViewSettings, label: string, onDone: (pair: ProjectionPair) => void, onFailure: (message: string) => void) => {
    const done: Partial<ProjectionPair> = {};
    const total = settings.pathCount * driftOrder.length;
    const projectAt = (index: number) => {
      const drift = driftOrder[index]!;
      setRun({ running: true, label: `${label} · ${driftLabels[drift]} (${index + 1} of ${driftOrder.length})`, done: index * settings.pathCount, total, error: null });
      stopStreams.current.push(
        openPortfolioProjectionStream(
          { tickers: book.tickers, accountDollars: book.accountDollars, horizonYears: settings.horizonYears, drift, pathCount: settings.pathCount },
          {
            onProgress: (pathsDone) => setRun((current) => ({ ...current, done: index * settings.pathCount + pathsDone })),
            onResult: (data) => {
              done[drift] = data;
              if (index + 1 < driftOrder.length) projectAt(index + 1);
              else onDone(done as ProjectionPair);
            },
            onFailure,
          },
        ),
      );
    };
    projectAt(0);
  }, []);

  const runSuggestions = useCallback((book: EditedPortfolio, settings: PortfolioViewSettings) => {
    setSuggestions(null);
    setSuggestionsError(null);
    setSuggestionsRunning(true);
    stopStreams.current.push(
      openPortfolioSuggestionsStream(
        { tickers: book.tickers, accountDollars: book.accountDollars, horizonYears: settings.horizonYears },
        {
          onProgress: () => {},
          onSuggestions: setSuggestions,
          onResult: (result) => {
            setSuggestions(result);
            setSuggestionsRunning(false);
          },
          onFailure: (message) => {
            setSuggestionsError(message);
            setSuggestionsRunning(false);
          },
        },
      ),
    );
  }, []);

  /** The compared portfolio's projection with the same view settings (kept when it is still the same), then `next`. */
  const runCompared = useCallback((settings: PortfolioViewSettings, next: () => void) => {
    const other = settings.compareWithId ? portfoliosRef.current.find((portfolio) => portfolio.id === settings.compareWithId) : undefined;
    if (!other || other.tickers.length === 0) return next();
    const key = projectionKeyOf(other.tickers, other.accountDollars, settings);
    if (comparedRef.current?.key === key && comparedRef.current.portfolioId === other.id) return next();
    projectBothDrifts(
      other,
      settings,
      `Projecting ${other.name}`,
      (data) => {
        comparedRef.current = { portfolioId: other.id, key, data };
        setCompared(comparedRef.current);
        setRun(idleRun);
        next();
      },
      (message) => setRun({ ...idleRun, error: `${other.name}: ${message}` }),
    );
  }, [projectBothDrifts]);

  const runProjection = useCallback(
    (book: EditedPortfolio, settings: PortfolioViewSettings) => {
      stopAll();
      if (book.tickers.length === 0) return;
      const key = projectionKeyOf(book.tickers, book.accountDollars, settings);
      setSuggestions(null);
      setSuggestionsError(null);
      projectBothDrifts(
        book,
        settings,
        "Projecting the book",
        (data) => {
          setProjection({ key, data });
          setRun(idleRun);
          runCompared(settings, () => runSuggestions(book, settings));
        },
        (message) => setRun({ ...idleRun, error: message }),
      );
    },
    [projectBothDrifts, runCompared, runSuggestions, stopAll],
  );

  // ---- Opening, New, Save, Save as, Delete ----

  const openPortfolio = useCallback(
    (portfolio: SavedPortfolio, settings: PortfolioViewSettings) => {
      const book = editedPortfolioOf(portfolio);
      setEdited(book);
      setLeftOut([]);
      setProjection(null);
      setSuggestions(null);
      writeLastOpenedPortfolioId(portfolio.id);
      runProjection(book, settings);
    },
    [runProjection],
  );

  const startNew = () => {
    stopAll();
    setEdited(emptyPortfolio);
    setLeftOut([]);
    setProjection(null);
    setSuggestions(null);
    setSimulation(null);
    setPots(null);
    writeLastOpenedPortfolioId(null);
  };

  const performSwitch = (target: PendingSwitch) => {
    if (target.kind === "new") return startNew();
    const portfolio = portfoliosRef.current.find((entry) => entry.id === target.id);
    if (portfolio) openPortfolio(portfolio, view);
  };

  const requestSwitch = (target: PendingSwitch) => {
    if (unsaved) setPendingSwitch(target);
    else performSwitch(target);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSavedPortfolios(), fetchPortfolioTickers()])
      .then(([savedPortfolios, tickers]) => {
        if (cancelled) return;
        setPortfolios(savedPortfolios);
        portfoliosRef.current = savedPortfolios;
        setListing(tickers);
        const lastOpened = savedPortfolios.find((portfolio) => portfolio.id === readLastOpenedPortfolioId());
        if (lastOpened) openPortfolio(lastOpened, readPortfolioViewSettings());
        else writeLastOpenedPortfolioId(null);
      })
      .catch((error) => !cancelled && setLoadError(errorMessage(error, "Could not load the saved portfolios.")));
    return () => {
      cancelled = true;
    };
  }, [openPortfolio]);

  const replaceInList = (portfolio: SavedPortfolio) =>
    setPortfolios((previous) => [...(previous ?? []).filter((entry) => entry.id !== portfolio.id), portfolio].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())));

  const continuePendingSwitch = () => {
    const target = pendingSwitch;
    setPendingSwitch(null);
    if (target) performSwitch(target);
  };

  const save = async () => {
    if (edited.id === null || edited.name === null) {
      setSaveError(null);
      setSaveAsOpen(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSavedPortfolio(edited.id, { name: edited.name, tickers: edited.tickers, accountDollars: edited.accountDollars });
      replaceInList(updated);
      if (pendingSwitch) continuePendingSwitch();
    } catch (error) {
      setSaveError(errorMessage(error, "Could not save the portfolio."));
      setPendingSwitch(null);
    } finally {
      setSaving(false);
    }
  };

  const saveAs = async (name: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createSavedPortfolio({ name, tickers: edited.tickers, accountDollars: edited.accountDollars });
      replaceInList(created);
      portfoliosRef.current = [...portfoliosRef.current, created];
      setEdited((previous) => ({ ...previous, id: created.id, name: created.name }));
      writeLastOpenedPortfolioId(created.id);
      setSaveAsOpen(false);
      if (pendingSwitch) continuePendingSwitch();
    } catch (error) {
      setSaveError(errorMessage(error, "Could not save the portfolio."));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (edited.id === null) return;
    setSaving(true);
    try {
      await deleteSavedPortfolio(edited.id);
      const deletedId = edited.id;
      setPortfolios((previous) => (previous ?? []).filter((portfolio) => portfolio.id !== deletedId));
      if (view.compareWithId === deletedId) changeView({ compareWithId: null });
      setDeleteOpen(false);
      startNew();
    } catch (error) {
      setSaveError(errorMessage(error, "Could not delete the portfolio."));
      setDeleteOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // Leaving the page with unsaved changes asks the browser's own question.
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // ---- The book's quick figures: how it moves together, its warnings and its pots (seconds) ----

  const bookRequest = useMemo(() => ({ tickers: edited.tickers, accountDollars: edited.accountDollars, horizonYears: view.horizonYears }), [edited.tickers, edited.accountDollars, view.horizonYears]);
  const debouncedBook = useDebouncedValue(bookRequest, 400);
  useEffect(() => {
    if (debouncedBook.tickers.length === 0) {
      setSimulation(null);
      setPots(null);
      return;
    }
    let cancelled = false;
    setBookError(null);
    Promise.all([simulatePortfolio(debouncedBook), fetchPortfolioPots(debouncedBook)])
      .then(([nextSimulation, nextPots]) => {
        if (cancelled) return;
        setSimulation(nextSimulation);
        setPots(nextPots);
      })
      .catch((error) => !cancelled && setBookError(errorMessage(error, "Could not work out the book's figures.")));
    return () => {
      cancelled = true;
    };
  }, [debouncedBook]);

  // ---- The library ----

  const refreshLibrary = useCallback(() => {
    fetchPortfolioLibraryStatus()
      .then(setLibrary)
      .catch(() => {});
  }, []);
  useEffect(refreshLibrary, [refreshLibrary]);
  const libraryActive = library?.rebuild?.status === "queued" || library?.rebuild?.status === "running";
  usePollWhileVisible(libraryActive ? refreshLibrary : noop, 15_000);
  const rebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildPortfolioLibrary();
      refreshLibrary();
    } catch (error) {
      setSuggestionsError(errorMessage(error, "Could not start the library's rebuild."));
    } finally {
      setRebuilding(false);
    }
  };

  // ---- Derived ----

  const effectiveAllocationPct = simulation ? new Map(simulation.book.tickers.map((ticker) => [ticker.symbol, ticker.allocationPct])) : null;
  const groupLabels = groupLabelBySymbol(simulation?.groups ?? []);
  const warningLines = simulation ? warningLinesOf(simulation.warnings) : [];
  const warningCodes = warningCodesBySymbol(simulation?.warnings ?? []);
  const shownProjection = projection?.data ?? null;
  const projectionStale = projection !== null && projection.key !== currentKey;
  const comparedSummaries =
    compareWith && compared?.portfolioId === compareWith.id && compared.key === projectionKeyOf(compareWith.tickers, compareWith.accountDollars, view) ? { name: compareWith.name, summaries: { neutral: compared.data.neutral.summary, as_it_happened: compared.data.as_it_happened.summary } } : null;
  const tickerRows: PortfolioTickerRow[] = (pots?.pots ?? [])
    .filter((pot) => edited.tickers.some((ticker) => ticker.symbol === pot.symbol))
    .map((pot) => ({
      symbol: pot.symbol,
      allocationPct: pot.allocationPct,
      pot,
      projected: shownProjection?.neutral.tickers.find((ticker) => ticker.symbol === pot.symbol) ?? null,
      year: shownProjection?.[view.chartDrift].summary.tickers.find((ticker) => ticker.symbol === pot.symbol) ?? null,
      warningCodes: warningCodes.get(pot.symbol) ?? [],
    }));

  const changeTickers = (tickers: PortfolioBookTicker[]) => setEdited((previous) => ({ ...previous, tickers }));
  const applySuggestedAllocations = () => {
    if (!pots) return;
    const suggested = roundAllocationsKeepingTotal(pots.suggested.allocationPct);
    setLeftOut(edited.tickers.filter((ticker) => !suggested.has(ticker.symbol)).map((ticker) => ticker.symbol));
    changeTickers(edited.tickers.filter((ticker) => suggested.has(ticker.symbol)).map((ticker) => ({ symbol: ticker.symbol, allocationPct: suggested.get(ticker.symbol)! })));
  };
  const applySuggestion = (suggestion: PortfolioSuggestion) => {
    const allocations = roundAllocationsKeepingTotal(Object.entries(suggestion.allocationsPct).map(([symbol, allocationPct]) => ({ symbol, allocationPct })));
    const kept = edited.tickers.filter((ticker) => allocations.has(ticker.symbol)).map((ticker) => ({ symbol: ticker.symbol, allocationPct: allocations.get(ticker.symbol)! }));
    const added = [...allocations.keys()].filter((symbol) => !edited.tickers.some((ticker) => ticker.symbol === symbol)).map((symbol) => ({ symbol, allocationPct: allocations.get(symbol)! }));
    setLeftOut([]);
    changeTickers([...kept, ...added]);
  };
  const backtestThisBook = () => {
    const params = new URLSearchParams({
      symbols: edited.tickers.map((ticker) => ticker.symbol).join(","),
      allocations: edited.tickers
        .filter((ticker) => ticker.allocationPct !== null)
        .map((ticker) => `${ticker.symbol}:${ticker.allocationPct}`)
        .join(","),
      startingValue: String(edited.accountDollars),
    });
    if (edited.name) params.set("name", edited.name);
    navigate(`/backtest/new?${params.toString()}`);
  };

  if (portfolios === null && loadError === null) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner label="Loading the portfolio simulator" />
      </div>
    );
  }

  return (
    <>
      <BacktestBackLink />
      <PageHeader
        title="Portfolio simulator"
        subtitle="Choose Pluto's tickers and their allocations. The projection runs Vol Farmer v4's own steps, day by day, on simulated sessions after today, from today's prices, chains and expiry calendar."
        actions={
          <button type="button" className="btn btn-primary" disabled={edited.tickers.length === 0} onClick={backtestThisBook}>
            Backtest this book
          </button>
        }
      />
      {loadError && <div className="alert alert-danger">{loadError}</div>}
      <div className="portfolio-page">
        <PortfolioBar
          portfolios={portfolios ?? []}
          openId={edited.id}
          unsaved={unsaved}
          savedAt={saved?.updatedAt ?? null}
          hasTickers={edited.tickers.length > 0}
          saving={saving}
          compareWithId={compareWith?.id ?? null}
          onOpen={(id) => requestSwitch({ kind: "open", id })}
          onSave={() => void save()}
          onSaveAs={() => {
            setSaveError(null);
            setSaveAsOpen(true);
          }}
          onNew={() => requestSwitch({ kind: "new" })}
          onDelete={() => setDeleteOpen(true)}
          onCompareWith={(id) => {
            const next = { ...view, compareWithId: id };
            changeView({ compareWithId: id });
            if (id && projection && !run.running) runCompared(next, () => {});
          }}
        />
        {saveError && !saveAsOpen && <div className="alert alert-danger mb-0">{saveError}</div>}

        {edited.tickers.length === 0 ? (
          <div className="card">
            <div className="portfolio-empty">
              <div className="fw-semibold mb-1">No tickers yet</div>
              <div className="text-secondary mb-3">Add the tickers to simulate. The outcome, warnings and suggestions appear once the book has a ticker.</div>
              <PortfolioAddTickerPicker tickers={listing} inBook={[]} primary onAdd={(symbol) => changeTickers([{ symbol, allocationPct: null }])} />
            </div>
          </div>
        ) : (
          <>
            <PortfolioControls
              accountDollars={edited.accountDollars}
              horizonYears={view.horizonYears}
              pathCount={view.pathCount}
              excessAllowancePct={pots?.excessAllowancePct ?? null}
              hasTickers={edited.tickers.length > 0}
              run={run}
              projection={shownProjection?.neutral ?? null}
              onAccountDollars={(accountDollars) => setEdited((previous) => ({ ...previous, accountDollars }))}
              onHorizonYears={(horizonYears) => changeView({ horizonYears })}
              onPathCount={(pathCount) => changeView({ pathCount })}
              onRun={() => runProjection(edited, view)}
              onStop={stopAll}
            />
            {bookError && <div className="alert alert-danger mb-0">{bookError}</div>}
            {warningLines.length > 0 && (
              <div className="alert alert-warning mb-0">
                <div className="fw-semibold mb-1">{warningLines.length === 1 ? "1 warning" : `${warningLines.length} warnings`}</div>
                <ul className="portfolio-warnings">
                  {warningLines.map((line) => (
                    <li key={`${line.code}-${line.text}`}>
                      <span className="badge bg-warning-lt me-2">{line.code}</span>
                      {line.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="portfolio-main-grid">
              <PortfolioBookCard
                tickers={edited.tickers}
                listing={listing}
                effectiveAllocationPct={effectiveAllocationPct}
                allocationTotalPct={simulation?.book.allocationTotalPct ?? null}
                groupLabels={groupLabels}
                maxAllocationPct={pots?.maxAllocationPct ?? null}
                leftOut={leftOut}
                onChange={changeTickers}
                onSuggestedAllocations={applySuggestedAllocations}
                suggestedAvailable={pots !== null}
              />
              <div className="portfolio-outcome-column">
                {projectionStale && <div className="iorio-note-amber portfolio-stale-note">The book or the view settings changed since this projection: Run projection to update the figures.</div>}
                {shownProjection ? (
                  <PortfolioOutcomeCard
                    summaries={{ neutral: shownProjection.neutral.summary, as_it_happened: shownProjection.as_it_happened.summary }}
                    horizonYears={shownProjection.neutral.horizonYears}
                    accountDollars={shownProjection.neutral.accountDollars}
                    compare={comparedSummaries}
                    chartDrift={view.chartDrift}
                    onChartDrift={(chartDrift) => changeView({ chartDrift })}
                  />
                ) : (
                  <div className="card">
                    <div className="card-body text-secondary">{run.running ? "The outcome appears once the projection finishes." : "Run projection to see the outcome."}</div>
                  </div>
                )}
              </div>
            </div>
            {shownProjection && <PortfolioReplaysTable replays={shownProjection.neutral.replays} />}
            {tickerRows.length > 0 && <PortfolioTickersTable rows={tickerRows} yearDrift={shownProjection ? view.chartDrift : null} />}
            {simulation && <PortfolioFallTogetherCard simulation={simulation} />}
            <PortfolioSuggestionsCard library={library} suggestions={suggestions} running={suggestionsRunning} error={suggestionsError} rebuilding={rebuilding} onRebuild={() => void rebuild()} onApply={applySuggestion} />
          </>
        )}
      </div>

      {saveAsOpen && (
        <SavePortfolioAsModal
          currentName={edited.id ? edited.name : null}
          tickerCount={edited.tickers.length}
          accountDollars={edited.accountDollars}
          portfolios={portfolios ?? []}
          saving={saving}
          error={saveError}
          onSave={(name) => void saveAs(name)}
          onCancel={() => {
            setSaveAsOpen(false);
            setPendingSwitch(null);
          }}
        />
      )}
      {deleteOpen && edited.name && (
        <ConfirmModal
          title={`Delete "${edited.name}"?`}
          message="The portfolio is removed for good. Backtests already run from it are kept. The screen then shows a new, empty portfolio."
          confirmLabel="Delete"
          confirming={saving}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
      {pendingSwitch && !saveAsOpen && (
        <ConfirmModal
          title={edited.name ? `Save changes to "${edited.name}"?` : "Save this portfolio?"}
          message={edited.name ? "You changed its tickers, allocations or account since it was saved. Discard drops those changes." : "This new portfolio isn't saved. Discard drops it."}
          confirmLabel="Save"
          danger={false}
          secondaryLabel="Discard"
          onSecondary={() => {
            const target = pendingSwitch;
            setPendingSwitch(null);
            performSwitch(target);
          }}
          confirming={saving}
          onConfirm={() => void save()}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </>
  );
}

function noop() {}
