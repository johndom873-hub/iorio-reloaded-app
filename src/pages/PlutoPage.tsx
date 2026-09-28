import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { openNotificationStream } from "../api/notifications";
import {
  fetchPlutoActions,
  fetchPlutoEvents,
  fetchPlutoPasses,
  fetchPlutoScoreboard,
  fetchPlutoSettings,
  fetchPlutoSettingsAudit,
  fetchPlutoState,
  fetchPlutoTickers,
  type PlutoAction,
  type PlutoEvent,
  type PlutoPass,
  type PlutoScoreboard,
  type PlutoSettings,
  type PlutoSettingsAuditRow,
  type PlutoState,
  type PlutoTicker,
} from "../api/pluto";
import { PageHeader } from "../components/layout/PageHeader";
import { PlutoActionsTable } from "../components/pluto/PlutoActionsTable";
import { PlutoChecksBoard } from "../components/pluto/PlutoChecksBoard";
import { PlutoScoreboardCard } from "../components/pluto/PlutoScoreboardCard";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { describePlutoTrigger } from "../lib/plutoPresentation";
import { formatFeedTime } from "../lib/formatters";
import { PlutoControlCard } from "../components/pluto/PlutoControlCard";
import { PlutoDecisions } from "../components/pluto/PlutoDecisions";
import { PlutoParametersCard } from "../components/pluto/PlutoParametersCard";
import { PlutoTickersCard } from "../components/pluto/PlutoTickersCard";
import { PlutoTiles } from "../components/pluto/PlutoTiles";
import { PlutoTimeline } from "../components/pluto/PlutoTimeline";
import { Spinner } from "../components/Spinner";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import { todayInEasternIso } from "../lib/formatters";

const stateRefreshIntervalMs = 30_000;
const notificationRefreshDebounceMs = 400;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** SPY's day change as the agent last saw it: the newest pass today carries it in its market_stress check. */
function spyDayChangeFromPasses(passes: PlutoPass[]): number | null {
  const today = todayInEasternIso();
  for (const pass of passes) {
    if (!pass.startedAt.startsWith(today)) break;
    const detail = pass.systemChecks?.market_stress?.detail ?? "";
    const match = detail.match(/SPY ([-+]?\d+(?:\.\d+)?)%/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function PlutoPage() {
  const [state, setState] = useState<PlutoState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [events, setEvents] = useState<PlutoEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [passes, setPasses] = useState<PlutoPass[]>([]);
  const [passesLoading, setPassesLoading] = useState(true);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [actions, setActions] = useState<PlutoAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [tickers, setTickers] = useState<PlutoTicker[]>([]);
  const [tickersMax, setTickersMax] = useState(0);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [tickersError, setTickersError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlutoSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<PlutoSettingsAuditRow | null>(null);
  const [scoreboard, setScoreboard] = useState<PlutoScoreboard | null>(null);
  const [scoreboardError, setScoreboardError] = useState<string | null>(null);
  const [tickerDetailSymbol, setTickerDetailSymbol] = useTickerDetailSymbol();

  const loadState = useCallback(async () => {
    try {
      setState(await fetchPlutoState());
      setStateError(null);
    } catch (err) {
      setStateError(errorMessage(err, "Could not load Pluto's state."));
    }
  }, []);
  const loadEvents = useCallback(async () => {
    try {
      setEvents(await fetchPlutoEvents(200));
      setEventsError(null);
    } catch (err) {
      setEventsError(errorMessage(err, "Could not load the timeline."));
    } finally {
      setEventsLoading(false);
    }
  }, []);
  const loadPasses = useCallback(async () => {
    try {
      setPasses(await fetchPlutoPasses(30));
      setPassesError(null);
    } catch (err) {
      setPassesError(errorMessage(err, "Could not load the decisions."));
    } finally {
      setPassesLoading(false);
    }
  }, []);
  const loadActions = useCallback(async () => {
    try {
      setActions(await fetchPlutoActions(100));
      setActionsError(null);
    } catch (err) {
      setActionsError(errorMessage(err, "Could not load the actions."));
    } finally {
      setActionsLoading(false);
    }
  }, []);
  const loadScoreboard = useCallback(async () => {
    try {
      setScoreboard(await fetchPlutoScoreboard());
      setScoreboardError(null);
    } catch (err) {
      setScoreboardError(errorMessage(err, "Could not load the scoreboard."));
    }
  }, []);
  const loadTickers = useCallback(async () => {
    try {
      const result = await fetchPlutoTickers();
      setTickers(result.tickers);
      setTickersMax(result.max);
      setTickersError(null);
    } catch (err) {
      setTickersError(errorMessage(err, "Could not load the tickers."));
    } finally {
      setTickersLoading(false);
    }
  }, []);
  const loadSettings = useCallback(async () => {
    try {
      const [loaded, audit] = await Promise.all([fetchPlutoSettings(), fetchPlutoSettingsAudit(1)]);
      setSettings(loaded);
      setLastChange(audit[0] ?? null);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(errorMessage(err, "Could not load the parameters."));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadState(), loadEvents(), loadPasses(), loadActions(), loadTickers(), loadSettings(), loadScoreboard()]);
    const timer = setInterval(() => void loadState(), stateRefreshIntervalMs);
    return () => clearInterval(timer);
  }, [loadState, loadEvents, loadPasses, loadActions, loadTickers, loadSettings, loadScoreboard]);

  // Every pluto_events row is pushed as a notification: refresh what it can have changed, coalesced.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKinds = useRef(new Set<string>());
  useEffect(() => {
    return openNotificationStream((notification) => {
      if (notification.type !== "pluto_event") return;
      pendingKinds.current.add(notification.eventType);
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        const kinds = pendingKinds.current;
        pendingKinds.current = new Set();
        void loadState();
        void loadEvents();
        if ([...kinds].some((kind) => kind.startsWith("pass_") || kind.startsWith("model_") || kind === "no_trade" || kind.startsWith("action_") || kind.startsWith("order_"))) {
          void loadPasses();
          void loadActions();
          void loadScoreboard();
        }
        if (kinds.has("ticker_enabled") || kinds.has("ticker_disabled")) void loadTickers();
        if (kinds.has("settings_changed")) void loadSettings();
      }, notificationRefreshDebounceMs);
    });
  }, [loadState, loadEvents, loadPasses, loadActions, loadTickers, loadSettings, loadScoreboard]);

  const workingActions = useMemo(() => actions.filter((action) => action.outcome === "confirmed" || action.outcome === "order_built"), [actions]);
  const spyDayChangePct = useMemo(() => spyDayChangeFromPasses(passes), [passes]);

  return (
    <div className="page-body">
      <div className="container-fluid px-3">
        <PageHeader title="Pluto" subtitle={`Autonomous trading agent · ${state?.agent?.appEnvironment ?? "staging"} paper account${settings ? ` · ${settings.modelId} via OpenRouter` : ""}`} />

        {stateError ? (
          <div className="alert alert-danger mt-3">{stateError}</div>
        ) : state === null ? (
          <div className="py-4"><Spinner label="Loading Pluto" /></div>
        ) : (
          <>
            <PlutoControlCard state={state} onStateChanged={(core) => { setState((previous) => (previous ? { ...previous, ...core } : previous)); void loadState(); void loadEvents(); }} />
            <PlutoTiles state={state} workingActions={workingActions} spyDayChangePct={spyDayChangePct} spyStressPct={settings?.spyStressBreakerPct ?? 3} onStateChanged={(core) => { setState((previous) => (previous ? { ...previous, ...core } : previous)); void loadState(); void loadEvents(); }} />
          </>
        )}

        {passes[0] && (
          <CollapsibleCard
            title="Last pass checks"
            subtitle={
              <span className="text-muted fw-normal" style={{ fontSize: "0.78rem" }}>
                {describePlutoTrigger(passes[0])} · {formatFeedTime(passes[0].startedAt)} · {passes[0].modelCalled ? "model called" : `skipped, ${Object.values(passes[0].systemChecks ?? {}).filter((check) => !check.ok).length} check(s) failed`}
              </span>
            }
            storageKey="pluto-last-pass-checks"
            defaultOpen={false}
            className="mb-3"
          >
            <PlutoChecksBoard checks={passes[0].systemChecks} />
          </CollapsibleCard>
        )}

        <PlutoScoreboardCard scoreboard={scoreboard} error={scoreboardError} />

        <div className="row g-3 mb-3">
          <div className="col-12 col-xl-7"><PlutoTimeline events={events} loading={eventsLoading} error={eventsError} /></div>
          <div className="col-12 col-xl-5"><PlutoDecisions passes={passes} loading={passesLoading} error={passesError} /></div>
        </div>

        <div className="mb-3">
          <PlutoActionsTable actions={actions} loading={actionsLoading} error={actionsError} onOpenTickerDetail={setTickerDetailSymbol} />
        </div>

        <PlutoTickersCard
          tickers={tickers}
          max={tickersMax}
          loading={tickersLoading}
          error={tickersError}
          onChanged={(entryId, enabled) => {
            setTickers((previous) => previous.map((ticker) => (ticker.entryId === entryId ? { ...ticker, botEnabled: enabled } : ticker)));
            void loadTickers();
            void loadState();
          }}
          onOpenTickerDetail={setTickerDetailSymbol}
        />

        <PlutoParametersCard settings={settings} lastChange={lastChange} loading={settingsLoading} error={settingsError} onSaved={(saved) => { setSettings(saved); void loadSettings(); void loadState(); }} />

        <div className="text-muted mb-3" style={{ fontSize: "0.78rem" }}>
          Every control writes to the timeline with who did it. Pause is one click; Pause and cancel, Resume, Mode and Save changes confirm first.
        </div>

        {tickerDetailSymbol && <TickerDetailModal symbol={tickerDetailSymbol} onClose={() => setTickerDetailSymbol(null)} />}
      </div>
    </div>
  );
}
