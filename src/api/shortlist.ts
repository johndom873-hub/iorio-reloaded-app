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
  /** True when there is under ~5 years of daily history and no preparation run has completed the history step. */
  historyIncomplete?: boolean;
  /** ISO date of the earliest stored daily bar, if any. */
  historyStartDate?: string | null;
  /** True when the latest full-pipeline run ended 'partial' (some step failed) -- offers a full retry, not just Backfill Price History. */
  backfillNeedsRetry?: boolean;

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

export interface BackfillEarningsResult {
  written: number;
  skippedEtf: boolean;
  error: string | null;
}

/** Actions menu's "Backfill Earnings" — same historical-earnings capture (API Ninjas) the new-ticker pipeline runs automatically, re-triggered for an already-shortlisted ticker. */
export function backfillTickerEarnings(tickerId: string): Promise<BackfillEarningsResult> {
  return apiRequest<BackfillEarningsResult>(`/shortlist/${tickerId}/backfill-earnings`, { method: "POST" });
}

export interface BackfillPriceHistoryResult {
  barCount: number;
  ivPointCount: number;
  firstTradingDate: string | null;
  lastTradingDate: string | null;
  suspectedSplitDates: string[];
  invalidBarDates: string[];
}

/** Actions menu's "Backfill Price History" — scoped to just the 5Y history step, not the full new-ticker pipeline (which also re-fetches the calendar and warms option-chain strikes; see routes/shortlist.ts). */
export function backfillTickerPriceHistory(tickerId: string): Promise<BackfillPriceHistoryResult> {
  return apiStreamedRequest<BackfillPriceHistoryResult>(`/shortlist/${tickerId}/backfill-price-history`, { method: "POST" });
}

export interface RefreshOptionChainResult {
  optionChainExpiries: OptionChainExpiryStrikeCount[];
}

/** Actions menu's "Refresh Option Chain" — re-runs refreshStoredOptionChain for just this ticker (expiries + per-expiry strikes), same fetch the nightly capture does. */
export function refreshTickerOptionChain(tickerId: string): Promise<RefreshOptionChainResult> {
  return apiStreamedRequest<RefreshOptionChainResult>(`/shortlist/${tickerId}/refresh-option-chain`, { method: "POST" });
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
