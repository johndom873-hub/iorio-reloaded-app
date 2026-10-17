import { useCallback, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { deleteBacktestBatch, fetchBacktestBatch, type BacktestBatchDetail } from "../../api/backtest";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBatchCombinedCard } from "../../components/backtest/BacktestBatchCombinedCard";
import { BacktestBatchRunsCard } from "../../components/backtest/BacktestBatchRunsCard";
import { BacktestBatchTickersCard } from "../../components/backtest/BacktestBatchTickersCard";
import { BacktestValueLinesChart, type BacktestValueLine } from "../../components/backtest/BacktestCharts";
import { BacktestBackLink, BacktestCard, BacktestValueScaleSwitch } from "../../components/backtest/backtestBits";
import { usePolledBacktestResource } from "../../components/backtest/useBacktestPolling";
import { useBacktestValueScale } from "../../components/backtest/useBacktestValueScale";
import { useTickingNow } from "../../hooks/useTickingNow";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { pluralizeCount } from "../../lib/formatters";
import { decidedByPhrase, spyBuyAndHoldColorByTheme, tablesModeLabel } from "../../lib/backtestPresentation";
import { batchBuyAndHoldColor, batchRunColor, batchSpyBaseline, buyAndHoldGroups, describeRunDifferences, parseTickedRuns, storedRunValues } from "../../lib/backtestBatchPresentation";

const pageTitle = "Backtest batch";

/** Fast while a run is queued or running, slow while one has stopped (it may be resumed), not at all once every run has ended. */
function batchPollState(detail: BacktestBatchDetail): boolean | null {
  if (detail.runs.some((run) => run.job?.displayStatus === "queued" || run.job?.displayStatus === "running")) return true;
  if (detail.runs.some((run) => run.session.status === "queued" || run.session.status === "running")) return false;
  return null;
}

// A batch (mockup approved 2026-10-17, https://claude.ai/artifact/9rs1PXZGBnkphdMu2wc6yf): its runs beside buy and hold, the
// ticked runs combined into one portfolio (their numbers kept in the address, ?combine=1,3), the account values as % since the
// start, and each ticker's results in each run.
export function BacktestBatchPage() {
  const { batchId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [valueScale, setValueScale] = useBacktestValueScale();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchBatch = useCallback(() => fetchBacktestBatch(batchId), [batchId]);
  const { data: detail, loadError, refreshFailing } = usePolledBacktestResource(fetchBatch, batchPollState, "Could not load the batch.");
  // The newest heartbeat keeps the running runs' times fresh.
  const now = useTickingNow(detail?.runs.map((run) => run.job?.heartbeatAt ?? "").sort().at(-1) || null);

  const ticked = parseTickedRuns(searchParams.get("combine"));
  // Written by hand, not through URLSearchParams, so the address reads ?combine=1,3 rather than ?combine=1%2C3.
  const setTicked = (runNumbers: number[]) => navigate({ search: runNumbers.length === 0 ? "" : `?combine=${[...runNumbers].sort((a, b) => a - b).join(",")}` }, { replace: true });
  const toggleTick = (runNumber: number) => setTicked(ticked.includes(runNumber) ? ticked.filter((number) => number !== runNumber) : [...ticked, runNumber]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBacktestBatch(batchId);
      navigate("/backtest");
    } catch (err) {
      setDeleteError(errorMessage(err, "Could not delete the batch."));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  if (loadError || !detail) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} />
        {loadError ? (
          <div className="alert alert-danger mt-3">{loadError}</div>
        ) : (
          <div className="d-flex justify-content-center py-5">
            <Spinner label="Loading the batch" />
          </div>
        )}
      </>
    );
  }

  const { batch, runs } = detail;
  const descriptions = describeRunDifferences(runs.map(storedRunValues));
  const buyAndHold = buyAndHoldGroups(runs);
  const spy = batchSpyBaseline(runs);
  const finishedRuns = runs.filter((run) => run.session.status === "succeeded" && run.points.length > 0);
  const unfinishedCount = runs.filter((run) => run.session.status === "queued" || run.session.status === "running").length;
  const failedCount = runs.filter((run) => run.session.status === "failed" || run.session.status === "cancelled").length;
  const statusText = [
    `${pluralizeCount(runs.length, "run")}`,
    finishedRuns.length > 0 ? `${finishedRuns.length} finished` : null,
    unfinishedCount > 0 ? `${unfinishedCount} queued or running` : null,
    failedCount > 0 ? `${failedCount} failed or cancelled` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  const subtitle = [`Batch · ${statusText}`, `${batch.startDate} → ${batch.endDate}`, `decided by ${decidedByPhrase[batch.decisionMaker]}`, tablesModeLabel[batch.tablesMode], "each run is its own account"].join(" · ");
  const tickedFinished = finishedRuns.filter((run) => ticked.includes(run.runNumber));
  const tickedWaiting = ticked.filter((runNumber) => runs.some((run) => run.runNumber === runNumber && run.session.status !== "succeeded" && run.session.status !== "failed" && run.session.status !== "cancelled"));

  const headerActions = (
    <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
      <Link to={`/backtest/new?fromBatch=${batch.id}`} className="btn btn-outline-secondary">
        Run again with changes
      </Link>
      <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmingDelete(true)}>
        Delete batch
      </button>
    </div>
  );

  const lines: BacktestValueLine[] = [
    ...finishedRuns.map((run) => ({ name: `Run ${run.runNumber}`, color: batchRunColor(theme, run.runNumber), line: "solid" as const, points: run.points })),
    ...buyAndHold.filter((group) => group.points.length > 0).map((group) => ({ name: `Buy and hold · ${group.symbols.join(", ")}`, color: batchBuyAndHoldColor(theme, group), line: "dashed" as const, points: group.points })),
    ...(spy ? [{ name: "Buy and hold · SPY", color: spyBuyAndHoldColorByTheme[theme], line: "dotted" as const, points: spy.points }] : []),
  ];

  return (
    <>
      <BacktestBackLink />
      {/* On a phone the buttons take their own row under the title, which would otherwise shrink to a word a line. */}
      <PageHeader title={batch.name} subtitle={subtitle} actions={isPhone ? undefined : headerActions} />
      {isPhone && <div className="mb-3">{headerActions}</div>}
      {refreshFailing && (
        <div className="iorio-note-amber mb-2" role="status" style={{ fontSize: "0.8rem" }}>
          Cannot reach the API right now; showing the last update and retrying.
        </div>
      )}
      {deleteError && <div className="alert alert-danger">{deleteError}</div>}

      <BacktestBatchRunsCard runs={runs} descriptions={descriptions} buyAndHold={buyAndHold} spyMetrics={spy?.metrics ?? null} ticked={ticked} onToggleTick={toggleTick} now={now} />

      <BacktestBatchCombinedCard batchId={batch.id} runs={tickedFinished} waitingRunNumbers={tickedWaiting} scale={valueScale} onClearTicks={() => setTicked([])} />

      <BacktestCard
        title="Account value"
        description="% since the start, every trading day at 10:00 ET; the dashed and dotted lines are buy and hold, for comparison only"
        actions={<BacktestValueScaleSwitch scale={valueScale} onChange={setValueScale} />}
        className="mb-3"
      >
        <div className="card-body pt-2">
          {finishedRuns.length > 0 ? (
            <BacktestValueLinesChart scale={valueScale} lines={lines} mode="percent" />
          ) : (
            <div className="text-secondary py-3" style={{ fontSize: "0.85rem" }}>
              The lines show once a run has finished.
            </div>
          )}
        </div>
      </BacktestCard>

      <BacktestBatchTickersCard runs={runs} />

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this batch?"
          message={`Deletes ${batch.name} and its ${pluralizeCount(runs.length, "run")}: every run's session, days and simulated book${unfinishedCount > 0 ? ", the unfinished runs stopped first" : ""}. This cannot be undone.`}
          confirmLabel="Delete batch"
          confirming={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
