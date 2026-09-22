import { apiRequest, apiBaseUrl } from "./client";

export interface ShortlistRow {
  id: string;
  addedAt: string;
  notes: string | null;
  tickerId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  snapshotDate: string | null;
  impliedVolatility: string | null;
  avgOptionVolume: string | null;
  capturedAt: string | null;
  ivRank: number | null;
  ivPercentile: number | null;
  ivWindowDays: number;
  /** 'preparing' while the new-ticker backfill is running, else null. */
  backfillStatus?: "preparing" | null;
  backfillProgressPercent?: number | null;
  /** True when there is under ~5 years of daily history and no preparation run has completed the history step. */
  historyIncomplete?: boolean;
  /** ISO date of the earliest stored daily bar, if any. */
  historyStartDate?: string | null;
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
