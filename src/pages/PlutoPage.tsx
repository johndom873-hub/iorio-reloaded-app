import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import { openNotificationStream } from "../api/notifications";
import {
  fetchPlutoActions,
  fetchPlutoEventsExcludingTypes,
  fetchPlutoEventsOfTypes,
  fetchPlutoLatestModelPass,
  fetchPlutoPasses,
  fetchPlutoScoreboard,
  fetchPlutoSettings,
  fetchPlutoSettingsAudit,
  fetchPlutoState,
  type PlutoAction,
  type PlutoEvent,
  type PlutoPass,
  type PlutoScoreboard,
  type PlutoSettings,
  type PlutoSettingsAuditRow,
  type PlutoState,
} from "../api/pluto";
import { fetchShortlist, type ShortlistRow } from "../api/shortlist";
import { PlutoHistoryTab, type PlutoHistoryView } from "../components/pluto/PlutoHistoryTab";
import { PlutoLiveTab, activityFeedLength } from "../components/pluto/PlutoLiveTab";
import { PlutoSettingsTab } from "../components/pluto/PlutoSettingsTab";
import { PlutoStatusCard } from "../components/pluto/PlutoStatusCard";
import { PlutoTickersTab } from "../components/pluto/PlutoTickersTab";
import { Spinner } from "../components/Spinner";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";
import { useTickingNow } from "../hooks/useTickingNow";
import { activityFeedHiddenEventTypes, crashLoopRestartsFromEvents, derivePlutoStatus } from "../lib/plutoPresentation";
import "../components/pluto/PlutoPage.css";

// The Pluto screen (redesign approved 2026-10-06): one status card that is always visible, then Live / History /
// Tickers / Settings tabs. The tab and the History view live in the URL so the cards can link to each other.

type PlutoTab = "live" | "history" | "tickers" | "settings";

const tabs: { key: PlutoTab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "history", label: "History" },
  { key: "tickers", label: "Tickers" },
  { key: "settings", label: "Settings" },
];

const stateRefreshIntervalMs = 30_000;
const notificationRefreshDebounceMs = 400;
const actionsPageSize = 100;
const passesPageSize = 30;

function tabFromParam(value: string | null): PlutoTab {
  return value === "history" || value === "tickers" || value === "settings" ? value : "live";
}

function historyViewFromParam(value: string | null): PlutoHistoryView {
  return value === "decisions" || value === "events" ? value : "orders";
}

export function PlutoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParam(searchParams.get("tab"));
  const historyView = historyViewFromParam(searchParams.get("view"));
  const isPhone = useMediaQuery("(max-width: 767px)");
  const { open: openTickerModal } = useSignalsTickerModal();

  const [state, setState] = useState<PlutoState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  // Bumped on every new event so an open Event log reloads its first page; the log owns its own page and filters.
  const [eventLogRefreshToken, setEventLogRefreshToken] = useState(0);
  const [passes, setPasses] = useState<PlutoPass[]>([]);
  const [passesLimit, setPassesLimit] = useState(passesPageSize);
  const [passesLoading, setPassesLoading] = useState(true);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [latestModelPass, setLatestModelPass] = useState<PlutoPass | null>(null);
  const [latestModelPassLoading, setLatestModelPassLoading] = useState(true);
  const [latestModelPassError, setLatestModelPassError] = useState<string | null>(null);
  const [feedEvents, setFeedEvents] = useState<PlutoEvent[]>([]);
  const [feedEventsLoading, setFeedEventsLoading] = useState(true);
  const [feedEventsError, setFeedEventsError] = useState<string | null>(null);
  const [actions, setActions] = useState<PlutoAction[]>([]);
  const [actionsLimit, setActionsLimit] = useState(actionsPageSize);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [shortlist, setShortlist] = useState<ShortlistRow[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(true);
  const [shortlistError, setShortlistError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlutoSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [audit, setAudit] = useState<PlutoSettingsAuditRow[]>([]);
  const [scoreboard, setScoreboard] = useState<PlutoScoreboard | null>(null);
  const [scoreboardError, setScoreboardError] = useState<string | null>(null);

  const now = useTickingNow(state?.lastPassAt ?? state?.updatedAt ?? null, [state?.session.windowStartAt, state?.session.windowEndAt]);

  const loadState = useCallback(async () => {
    try {
      setState(await fetchPlutoState());
      setStateError(null);
    } catch (err) {
      setStateError(errorMessage(err, "Could not load Pluto's state."));
    }
  }, []);
  const refreshEventLog = useCallback(() => setEventLogRefreshToken((token) => token + 1), []);
  const loadPasses = useCallback(
    async (limit = passesLimit) => {
      try {
        setPasses(await fetchPlutoPasses(limit));
        setPassesError(null);
      } catch (err) {
        setPassesError(errorMessage(err, "Could not load the decisions."));
      } finally {
        setPassesLoading(false);
      }
    },
    [passesLimit],
  );
  const loadLatestModelPass = useCallback(async () => {
    try {
      setLatestModelPass((await fetchPlutoLatestModelPass())[0] ?? null);
      setLatestModelPassError(null);
    } catch (err) {
      setLatestModelPassError(errorMessage(err, "Could not load the latest decision."));
    } finally {
      setLatestModelPassLoading(false);
    }
  }, []);
  const loadFeedEvents = useCallback(async () => {
    try {
      setFeedEvents(await fetchPlutoEventsExcludingTypes(activityFeedHiddenEventTypes, activityFeedLength));
      setFeedEventsError(null);
    } catch (err) {
      setFeedEventsError(errorMessage(err, "Could not load the activity."));
    } finally {
      setFeedEventsLoading(false);
    }
  }, []);
  const loadActions = useCallback(
    async (limit = actionsLimit) => {
      try {
        setActions(await fetchPlutoActions(limit));
        setActionsError(null);
      } catch (err) {
        setActionsError(errorMessage(err, "Could not load the orders."));
      } finally {
        setActionsLoading(false);
      }
    },
    [actionsLimit],
  );
  const loadScoreboard = useCallback(async () => {
    try {
      setScoreboard(await fetchPlutoScoreboard());
      setScoreboardError(null);
    } catch (err) {
      setScoreboardError(errorMessage(err, "Could not load the track record."));
    }
  }, []);
  const loadShortlist = useCallback(async () => {
    try {
      setShortlist(await fetchShortlist());
      setShortlistError(null);
    } catch (err) {
      setShortlistError(errorMessage(err, "Could not load the tickers."));
    } finally {
      setShortlistLoading(false);
    }
  }, []);
  const loadSettings = useCallback(async () => {
    try {
      const [loaded, auditRows] = await Promise.all([fetchPlutoSettings(), fetchPlutoSettingsAudit(20)]);
      setSettings(loaded);
      setAudit(auditRows);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(errorMessage(err, "Could not load the settings."));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadState(), loadPasses(), loadLatestModelPass(), loadFeedEvents(), loadActions(), loadShortlist(), loadSettings(), loadScoreboard()]);
    const timer = setInterval(() => void loadState(), stateRefreshIntervalMs);
    return () => clearInterval(timer);
    // Initial load only; the per-list loaders re-run on their own limit changes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (actionsLimit > actionsPageSize) void loadActions(actionsLimit).finally(() => setLoadingMore(false));
  }, [actionsLimit, loadActions]);
  useEffect(() => {
    if (passesLimit > passesPageSize) void loadPasses(passesLimit).finally(() => setLoadingMore(false));
  }, [passesLimit, loadPasses]);

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
        refreshEventLog();
        void loadFeedEvents();
        if ([...kinds].some((kind) => kind.startsWith("pass_") || kind.startsWith("model_") || kind === "no_trade" || kind.startsWith("action_") || kind.startsWith("order_") || kind.startsWith("breaker_"))) {
          void loadPasses();
          void loadLatestModelPass();
          void loadActions();
          void loadScoreboard();
        }
        if (kinds.has("ticker_enabled") || kinds.has("ticker_disabled")) void loadShortlist();
        if (kinds.has("settings_changed")) void loadSettings();
      }, notificationRefreshDebounceMs);
    });
  }, [loadState, refreshEventLog, loadFeedEvents, loadPasses, loadLatestModelPass, loadActions, loadShortlist, loadSettings, loadScoreboard]);

  // The paused headline's restart count lives in the pause event, which a busy log can push far past the loaded events.
  const [pauseEvents, setPauseEvents] = useState<PlutoEvent[]>([]);
  const crashLoopPausedAt = state?.pauseReason === "crash_loop" ? state.pausedAt : null;
  useEffect(() => {
    if (!crashLoopPausedAt) return;
    fetchPlutoEventsOfTypes(["paused"], 5).then(setPauseEvents).catch(() => setPauseEvents([]));
  }, [crashLoopPausedAt]);
  const status = useMemo(() => (state ? derivePlutoStatus(state, now, crashLoopRestartsFromEvents(pauseEvents)) : null), [state, now, pauseEvents]);
  const enabledCount = state?.enabledTickers.count ?? shortlist.filter((row) => row.botEnabled).length;
  const maxEnabled = state?.enabledTickers.max ?? settings?.maxEnabledTickers ?? 0;

  function selectTab(next: PlutoTab) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "live") params.delete("tab");
        else params.set("tab", next);
        if (next !== "history") params.delete("view");
        return params;
      },
      { replace: true },
    );
  }
  function selectHistoryView(view: PlutoHistoryView) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set("tab", "history");
        if (view === "orders") params.delete("view");
        else params.set("view", view);
        return params;
      },
      { replace: true },
    );
  }
  function loadMore(view: "orders" | "decisions") {
    setLoadingMore(true);
    if (view === "orders") setActionsLimit((limit) => limit + actionsPageSize);
    else setPassesLimit((limit) => limit + passesPageSize);
  }

  return (
    <div className="page-body">
      <div className="container-fluid px-3 pm">
        <div className="pm-pagehead">
          <div>
            <h1 className="pm-title">Pluto</h1>
            <div className="pm-subtitle">Autonomous trading agent</div>
          </div>
        </div>

        {stateError ? (
          <div className="alert alert-danger">{stateError}</div>
        ) : state === null || status === null ? (
          <div className="py-4"><Spinner label="Loading Pluto" /></div>
        ) : (
          <PlutoStatusCard
            state={state}
            status={status}
            settings={settings}
            now={now}
            isPhone={isPhone}
            showKpis={!isPhone || tab === "live"}
            onStateChanged={(core) => {
              setState((previous) => (previous ? { ...previous, ...core } : previous));
              void loadState();
              refreshEventLog();
              void loadFeedEvents();
            }}
            onOrdersChanged={() => {
              void loadState();
              void loadActions();
              refreshEventLog();
              void loadFeedEvents();
            }}
          />
        )}

        <nav className="pm-tabs" aria-label="Pluto sections">
          {tabs.map((entry) => (
            <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} className={`pm-tab${tab === entry.key ? " active" : ""}`} onClick={() => selectTab(entry.key)}>
              {entry.label}
              {entry.key === "tickers" && <span className="count">{enabledCount}{isPhone ? "/" : " / "}{maxEnabled}</span>}
            </button>
          ))}
        </nav>

        {tab === "live" && (
          <PlutoLiveTab state={state} actions={actions} actionsLoading={actionsLoading} actionsError={actionsError} latestModelPass={latestModelPass} latestModelPassLoading={latestModelPassLoading} latestModelPassError={latestModelPassError} feedEvents={feedEvents} feedEventsLoading={feedEventsLoading} feedEventsError={feedEventsError} now={now} isPhone={isPhone} onOpenTicker={openTickerModal} />
        )}
        {tab === "history" && (
          <PlutoHistoryTab
            view={historyView}
            onViewChange={selectHistoryView}
            scoreboard={scoreboard}
            scoreboardError={scoreboardError}
            actions={actions}
            actionsLoading={actionsLoading}
            actionsError={actionsError}
            passes={passes}
            passesLoading={passesLoading}
            passesError={passesError}
            eventLogRefreshToken={eventLogRefreshToken}
            state={state}
            now={now}
            isPhone={isPhone}
            onOpenTicker={openTickerModal}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
          />
        )}
        {tab === "tickers" && (
          <PlutoTickersTab
            rows={shortlist}
            loading={shortlistLoading}
            error={shortlistError}
            state={state}
            maxEnabled={maxEnabled}
            isPhone={isPhone}
            onOpenTicker={openTickerModal}
            onToggled={(entryId, enabled) => {
              setShortlist((previous) => previous.map((row) => (row.id === entryId ? { ...row, botEnabled: enabled } : row)));
              void loadShortlist();
              void loadState();
            }}
            onPrepRunChange={() => void loadShortlist()}
          />
        )}
        {tab === "settings" && (
          <PlutoSettingsTab
            settings={settings}
            audit={audit}
            loading={settingsLoading}
            error={settingsError}
            state={state}
            isPhone={isPhone}
            onSaved={(saved) => {
              setSettings(saved);
              void loadSettings();
              void loadState();
            }}
          />
        )}
      </div>
    </div>
  );
}
