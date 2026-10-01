import { apiRequest, apiBaseUrl, apiStreamedRequest } from "./client";

export interface ShortlistRow {
  id: string;
  addedAt: string;
  notes: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  /** 'preparing' while the new-ticker backfill is running, else null. */
  backfillStatus?: "preparing" | null;
  backfillProgressPercent?: number | null;
  /** ISO date of the earliest stored daily bar, if any. */
  historyStartDate: string | null;
  /** ISO date of the newest stored daily bar, if any. */
  latestDailyBarDate: string | null;
  /** The newest session a completed bar can exist for; a newest bar older than this is stale. */
  lastCompletedSessionDate: string;
  /** What Populate Daily Bars would do: the full five years, only the missing sessions, or nothing. Decided by the server. */
  dailyBarsPlan: DailyBarsPlan;
  /** True when the latest full-pipeline run ended 'partial' (some step failed) -- offers a full retry, not just Populate Daily Bars. */
  backfillNeedsRetry?: boolean;
  /** Open positions on this ticker. Remove is disabled (and the API refuses with 409) while above zero. */
  openPositionCount: number;

  // Data-readiness columns (redesigned 2026-09-23) -- exactly what the Signals pipeline reads before it
  // can score a candidate; see loadShortlistDataReadiness.ts in the API repo.
  dailyBarCount: number;
  suspectedSplitDateIso: string | null;
  earningsCount: number;
  nextEarningsDateIso: string | null;
  isEtf: boolean;
  dividendHistoryCount: number;
  dividendCadenceUnknown: boolean;
  chainSnapshotCount: number;
  latestFittedSliceCount: number | null;
  latestTotalSliceCount: number | null;
  /** One entry per expiry stored in option_chain_expiry_strikes, each with its strike count. */
  optionChainExpiries: OptionChainExpiryStrikeCount[];
}

export type DailyBarsPlan = "full" | "topUp" | "none";

export interface OptionChainExpiryStrikeCount {
  expiry: string;
  strikeCount: number;
}

export function fetchShortlist(): Promise<ShortlistRow[]> {
  return apiRequest<ShortlistRow[]>("/shortlist");
}

export function addToShortlist(symbol: string, notes?: string): Promise<AddToShortlistResult> {
  return apiRequest<AddToShortlistResult>("/shortlist", {
    method: "POST",
    body: JSON.stringify({ symbol, notes }),
  });
}

export function removeFromShortlist(entryId: string): Promise<void> {
  return apiRequest<void>(`/shortlist/${entryId}`, { method: "DELETE" });
}

export function updateShortlistNotes(entryId: string, notes: string): Promise<{ notes: string | null }> {
  return apiRequest<{ notes: string | null }>(`/shortlist/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: notes.trim() || null }),
  });
}

export interface TickerSearchResult {
  symbol: string;
  companyName: string | null;
}

export function searchTickers(query: string): Promise<TickerSearchResult[]> {
  return apiRequest<TickerSearchResult[]>(`/shortlist/search?q=${encodeURIComponent(query)}`);
}

export type BackfillStepKey = "history" | "calendar" | "chain_warmup" | "first_snapshot";
export type BackfillStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface BackfillStep {
  key: BackfillStepKey;
  label: string;
  status: BackfillStepStatus;
  message: string | null;
}

export interface TickerBackfillRun {
  id: string;
  tickerId: string;
  status: "running" | "complete" | "partial";
  steps: BackfillStep[];
  progressPercent: number;
  startedAt: string;
  finishedAt: string | null;
}

/** POST /shortlist also returns the run it started for the new ticker. */
export interface AddToShortlistResult extends ShortlistRow {
  backfillRun: TickerBackfillRun;
}

/** Starts a new preparation run for the ticker (the modal's Retry). A run already in progress is returned as-is. */
export function retryTickerBackfill(tickerId: string): Promise<TickerBackfillRun> {
  return apiRequest<TickerBackfillRun>(`/shortlist/${tickerId}/backfill`, { method: "POST" });
}

export interface PopulateEarningsResult {
  written: number;
  skippedEtf: boolean;
  error: string | null;
}

/** Actions menu's "Populate Earnings" — same historical-earnings capture (API Ninjas) the new-ticker pipeline runs automatically, re-triggered for an already-shortlisted ticker. */
export function populateTickerEarnings(tickerId: string): Promise<PopulateEarningsResult> {
  return apiRequest<PopulateEarningsResult>(`/shortlist/${tickerId}/populate-earnings`, { method: "POST" });
}

export interface PopulateDailyBarsResult {
  /** What the server decided to do; "none" means the stored bars were already complete and current. */
  plan: DailyBarsPlan;
  barCount?: number;
  firstTradingDate?: string | null;
  lastTradingDate?: string | null;
}

/** Actions menu's "Populate Daily Bars" — the server inspects the stored bars and fetches the full 5Y history or only the missing sessions; scoped to daily bars, not the full new-ticker pipeline (see routes/shortlist.ts in the API repo). */
export function populateTickerDailyBars(tickerId: string): Promise<PopulateDailyBarsResult> {
  return apiStreamedRequest<PopulateDailyBarsResult>(`/shortlist/${tickerId}/populate-daily-bars`, { method: "POST" });
}

export interface PopulateOptionChainResult {
  optionChainExpiries: OptionChainExpiryStrikeCount[];
}

/** Actions menu's "Populate Option Chain" — re-runs refreshStoredOptionChain for just this ticker (expiries + per-expiry strikes), same fetch the nightly capture does. */
export function populateTickerOptionChain(tickerId: string): Promise<PopulateOptionChainResult> {
  return apiStreamedRequest<PopulateOptionChainResult>(`/shortlist/${tickerId}/populate-option-chain`, { method: "POST" });
}

const backfillStreamReconnectDelayMs = 2_000;

/**
 * Streams a ticker's latest backfill run. The server closes the stream when the
 * run finishes, so this closes itself on a finished run instead of letting
 * EventSource auto-reconnect; while the run is still going, a dropped
 * connection (e.g. a dyno restart, which EventSource treats as fatal) is
 * reopened after a short delay. Returns a function that stops everything.
 */
export function openTickerBackfillStream(tickerId: string, onRun: (run: TickerBackfillRun | null) => void): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let stopped = false;

  function open() {
    source = new EventSource(`${apiBaseUrl}/shortlist/${tickerId}/backfill/stream`, { withCredentials: true });
    source.onmessage = (message) => {
      let run: TickerBackfillRun | null;
      try {
        run = JSON.parse(message.data);
      } catch {
        return;
      }
      onRun(run);
      if (!run || run.status !== "running") {
        stopped = true;
        source?.close();
      }
    };
    source.onerror = () => {
      source?.close();
      if (!stopped) reconnectTimer = window.setTimeout(open, backfillStreamReconnectDelayMs);
    };
  }

  open();
  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    source?.close();
  };
}
