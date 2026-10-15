import { useState, type ReactNode } from "react";
import type { BacktestJobView } from "../../api/backtest";
import { ConfirmModal } from "../ConfirmModal";

interface PendingPutFirst {
  symbol: string;
  running: BacktestJobView;
  run: (pauseRunning: boolean) => Promise<void>;
}

/**
 * Puts a download at the top of the queue. When another download is running, a confirmation asks whether to pause it so
 * this one starts now (the paused one goes back into the queue right after it and continues where it stopped) or to keep
 * it running (this one waits at the top). `run` sends the request; it reports its own errors.
 */
export function usePutDownloadFirst(jobs: BacktestJobView[]): { requestPutFirst: (symbol: string, run: (pauseRunning: boolean) => Promise<void>) => Promise<void>; putFirstModal: ReactNode } {
  const [pending, setPending] = useState<PendingPutFirst | null>(null);
  const [sending, setSending] = useState(false);

  const requestPutFirst = async (symbol: string, run: (pauseRunning: boolean) => Promise<void>) => {
    const running = jobs.find((job) => job.kind === "download" && job.displayStatus === "running" && job.symbol !== symbol && !job.pauseRequested);
    if (running) setPending({ symbol, running, run });
    else await run(false);
  };

  const choose = async (pauseRunning: boolean) => {
    if (!pending) return;
    setSending(true);
    try {
      await pending.run(pauseRunning);
    } finally {
      setSending(false);
      setPending(null);
    }
  };

  const putFirstModal = pending && (
    <ConfirmModal
      title={`Start ${pending.symbol} now?`}
      message={
        <>
          <p>
            {pending.running.symbol} is downloading{pending.running.progressLabel ? ` (${pending.running.progressLabel})` : ""}. Pause it so {pending.symbol} starts now?
          </p>
          <p className="mb-0 text-secondary">
            {pending.running.symbol} goes back in the queue right after {pending.symbol} and continues where it stopped; stopping can take up to a minute. If you keep it running, {pending.symbol} waits at the top of the queue.
          </p>
        </>
      }
      confirmLabel={`Pause ${pending.running.symbol}, start ${pending.symbol}`}
      danger={false}
      confirming={sending}
      secondaryLabel={`Keep ${pending.running.symbol} running`}
      onSecondary={() => void choose(false)}
      onConfirm={() => void choose(true)}
      onCancel={() => setPending(null)}
    />
  );

  return { requestPutFirst, putFirstModal };
}
