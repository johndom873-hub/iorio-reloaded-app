import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { deleteBacktestSession, fetchBacktestSession, fetchBacktestSettingsTemplate, type BacktestSessionDetail, type BacktestSettingRow } from "../../api/backtest";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { TooltipSpan } from "../../components/TooltipSpan";
import { BacktestAccuracyTable } from "../../components/backtest/BacktestAccuracyTable";
import { BacktestBackLink, BacktestCard, BacktestJobProgress, BacktestJobStatusBadge, BacktestValueScaleSwitch } from "../../components/backtest/backtestBits";
import { useBacktestValueScale } from "../../components/backtest/useBacktestValueScale";
import { BacktestSessionCharts } from "../../components/backtest/BacktestCharts";
import { BacktestKpiTiles } from "../../components/backtest/BacktestKpiTiles";
import { BacktestMonthlyReturnsCard } from "../../components/backtest/BacktestMonthlyReturnsCard";
import { BacktestTradesTable } from "../../components/backtest/BacktestTradesTable";
import { BacktestDailyDecisionsTable } from "../../components/backtest/BacktestDailyDecisionsTable";
import { BacktestActionsLog } from "../../components/backtest/BacktestActionsLog";
import { BacktestBaselineComparisonTable } from "../../components/backtest/BacktestBaselineComparisonTable";
import { BacktestCyclesTable } from "../../components/backtest/BacktestCyclesTable";
import { BacktestFillsTable } from "../../components/backtest/BacktestFillsTable";
import { BacktestPositionsTable } from "../../components/backtest/BacktestPositionsTable";
import { BacktestRunNotesCard } from "../../components/backtest/BacktestRunNotesCard";
import { BacktestSessionPriceCard } from "../../components/backtest/BacktestSessionPriceCard";
import { BacktestTickerStatisticsTable } from "../../components/backtest/BacktestTickerStatisticsTable";
import { usePolledBacktestResource } from "../../components/backtest/useBacktestPolling";
import { useTickingNow } from "../../hooks/useTickingNow";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatDuration } from "../../lib/formatters";
import {
  backtestSessionTitle,
  decisionMakerLabel,
  describeLlmCalls,
  describeOverrideChanges,
  describeSessionTickerValues,
  describeSessionTickerValueSources,
  describeSessionSplits,
  isBacktestJobActive,
  sessionDecisionMaker,
  decidedByPhrase,
  sessionSplitsNotePrefix,
  summarizeCycleTotals,
  tablesModeLabel,
} from "../../lib/backtestPresentation";

// Session results (mockup approved 2026-10-12; the wheel sections built in the same style without a mockup, Marcelo
// 2026-10-12): the headline figures led by the wheel cycle P&L, the account value against both buy-and-hold lines (comparison
// only), the run's notes, per-symbol statistics, the wheel cycles, monthly returns, model accuracy, every option sold, the
// simulated positions, the actions log and fills (read page by page), and each day's decisions. Polls every 2 s while the run
// is going.
export function BacktestSessionPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [settingRows, setSettingRows] = useState<BacktestSettingRow[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchDetail = useCallback(() => fetchBacktestSession(sessionId), [sessionId]);
  const isActive = useCallback((detail: BacktestSessionDetail) => {
    const running = detail.session.status === "queued" || detail.session.status === "running";
    return running || (detail.job !== null && isBacktestJobActive(detail.job, new Date())) ? true : null;
  }, []);
  const { data: detail, loadError, refreshFailing } = usePolledBacktestResource(fetchDetail, isActive, "Could not load the session.");
  const [valueScale, setValueScale] = useBacktestValueScale();
  const now = useTickingNow(detail?.job?.heartbeatAt ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchBacktestSettingsTemplate()
      .then((template) => !cancelled && setSettingRows(template.rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBacktestSession(sessionId);
      navigate("/backtest");
    } catch (err) {
      setDeleteError(errorMessage(err, "Could not delete the session."));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  if (loadError) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title="Backtest session" />
        <div className="alert alert-danger mt-3">{loadError}</div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title="Backtest session" />
        <div className="d-flex justify-content-center py-5">
          <Spinner label="Loading the session" />
        </div>
      </>
    );
  }

  const { session, job } = detail;
  const displayStatus = job?.displayStatus ?? session.status;
  const finished = session.status === "succeeded";
  const changes = describeOverrideChanges(session.overrides, session.settingsSnapshot, settingRows);
  const sessionSplits = describeSessionSplits(session.symbol, session.detectedSplits);
  const symbols = session.symbols.length > 0 ? session.symbols : [session.symbol];
  const cycleTotals = summarizeCycleTotals(detail.cycles);
  const runMoment = `${formatBrowserDayMonth(session.createdAt)} ${formatBrowserClockTime(session.createdAt)}`;
  const decisionMaker = sessionDecisionMaker(session);
  const llmCalls = session.runStatistics?.llmCalls ?? null;
  const subtitle = [
    `${session.startDate} → ${session.endDate}`,
    `${formatCurrency(session.startingValue, 0)} start`,
    tablesModeLabel[session.tablesMode],
    `decided by ${decidedByPhrase[decisionMaker]}`,
    session.finishedAt ? `ran ${runMoment}, ${formatDuration(session.createdAt, session.finishedAt)}` : `started ${runMoment}`,
  ].join(" · ");

  return (
    <>
      <BacktestBackLink batch={session.batch} />
      <PageHeader
        title={backtestSessionTitle(session.name, symbols, session.symbol)}
        subtitle={subtitle}
        actions={
          <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
            {changes.map((change) => (
              <span key={change} className="backtest-override-chip">
                {change}
              </span>
            ))}
            {changes.length === 0 && <span className="text-secondary" style={{ fontSize: "0.8rem" }}>Pluto's settings, unchanged</span>}
            <Link to={`/backtest/new?from=${session.id}`} className="btn btn-outline-secondary">
              Run again with changes
            </Link>
            <button type="button" className="btn btn-outline-danger" disabled={displayStatus === "running" || displayStatus === "queued"} onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          </div>
        }
      />
      {decisionMaker === "llm" && (
        <div className="mb-2" style={{ fontSize: "0.8rem" }}>
          <span className="badge bg-indigo text-indigo-fg me-2">{decisionMakerLabel.llm}</span>
          <span className="text-secondary">{llmCalls ? `${describeLlmCalls(llmCalls)}.` : "Claude through the subscription; the calls show once the run has looked at a day."} The model's reasons are each action's "Chosen because" in the Actions log.</span>
        </div>
      )}
      {session.symbolSettings && (
        <div className="text-secondary mb-2" style={{ fontSize: "0.8rem" }}>
          {symbols.flatMap((symbol) => {
            const settings = session.symbolSettings?.[symbol];
            return settings
              ? [
                  <div key={symbol}>
                    <TooltipSpan text={describeSessionTickerValueSources(settings)} multiline className="dotted-underline-label">
                      {describeSessionTickerValues(symbol, settings)}
                    </TooltipSpan>
                  </div>,
                ]
              : [];
          })}
        </div>
      )}
      {sessionSplits && (
        <div className="text-secondary mb-2" style={{ fontSize: "0.8rem" }}>
          {sessionSplitsNotePrefix}{" "}
          {sessionSplits.map((split, index) => (
            <span key={split} className="text-nowrap">
              {split}
              {index < sessionSplits.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
      {refreshFailing && (
        <div className="iorio-note-amber mb-2" role="status" style={{ fontSize: "0.8rem" }}>
          Cannot reach the API right now; showing the last update and retrying.
        </div>
      )}
      {deleteError && <div className="alert alert-danger">{deleteError}</div>}
      {session.status === "failed" && <div className="alert alert-danger text-break">The run failed{session.error ? `: ${session.error}` : "."}</div>}
      {session.status === "cancelled" && <div className="alert alert-secondary">The run was cancelled; the figures below are only as far as it got.</div>}
      {!finished && job && (
        <BacktestCard title="Run" description={<BacktestJobStatusBadge status={displayStatus} />} className="mb-3">
          <div className="card-body">
            <BacktestJobProgress job={job} now={now} />
          </div>
        </BacktestCard>
      )}

      <BacktestKpiTiles
        pnlBasis={session.pnlBasis}
        metrics={session.metrics}
        days={detail.days}
        monthlyReturns={detail.monthlyReturns}
        cycles={detail.cycles}
        allSymbolsStatistics={detail.allSymbolsStatistics}
        pnlSources={detail.pnlSources ?? null}
        excessCalmar={detail.excessCalmar ?? null}
        daysWithNoOptions={detail.daysWithNoOptions ?? null}
      />

      <BacktestCard
        title="Account value"
        description={
          detail.days.some((day) => day.spyBaselineValue !== null)
            ? "Marked to market every trading day at 10:00 ET. Buy and hold of the session's symbols (white in the dark theme, near-black in the light) and of SPY (grey) are for comparison only."
            : "Marked to market every trading day at 10:00 ET. Buy and hold of the session's symbols (white in the dark theme, near-black in the light) is for comparison only (this session has no SPY line)."
        }
        actions={detail.days.length < 2 ? undefined : <BacktestValueScaleSwitch scale={valueScale} onChange={setValueScale} />}
        className="mb-3"
      >
        <div className="card-body pt-2">
          {detail.days.length < 2 ? (
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
              {finished ? "The session has fewer than two days." : "The chart fills in as the run goes."}
            </div>
          ) : (
            <BacktestSessionCharts days={detail.days} scale={valueScale} baselineLabel={session.baselineLabel} spyBaselineLabel={session.spyBaselineLabel} />
          )}
        </div>
      </BacktestCard>

      <BacktestSessionPriceCard sessionId={session.id} symbols={symbols} status={session.status} />

      <div className="mb-3">
        <BacktestBaselineComparisonTable
          metrics={session.metrics}
          baselineMetrics={session.baselineMetrics}
          baselineLabel={session.baselineLabel}
          spyBaselineMetrics={session.spyBaselineMetrics}
          spyBaselineLabel={session.spyBaselineLabel}
        />
      </div>

      <BacktestRunNotesCard notes={session.notes} runStatistics={session.runStatistics} />
      <BacktestTickerStatisticsTable tickerStatistics={detail.tickerStatistics} allSymbolsStatistics={detail.allSymbolsStatistics} />
      {(detail.cycles.length > 0 || detail.positions.length > 0) && <BacktestCyclesTable sessionId={session.id} status={session.status} cycles={detail.cycles} cycleGaps={detail.cycleGaps ?? []} symbols={symbols} sessionDays={detail.days} />}

      <div className="backtest-results-pair mb-3">
        <BacktestMonthlyReturnsCard monthlyReturns={detail.monthlyReturns} baselineLabel={session.baselineLabel} spyBaselineLabel={session.spyBaselineLabel} />
        <BacktestAccuracyTable bands={detail.accuracyByMarginBand} pnlBasis={session.pnlBasis} openCycleCount={cycleTotals.openCount} openCycleDollars={cycleTotals.openDollars} />
      </div>

      <BacktestTradesTable symbol={session.symbol} sessionName={session.name} pnlBasis={session.pnlBasis} trades={detail.trades} />
      <BacktestPositionsTable positions={detail.positions} symbols={symbols} />
      <BacktestActionsLog
        sessionId={session.id}
        symbols={symbols}
        startDate={session.startDate}
        endDate={session.endDate}
        filledCount={detail.bookCounts.filledActions}
        blockedCount={detail.bookCounts.blockedActions}
      />
      <BacktestFillsTable sessionId={session.id} symbols={symbols} startDate={session.startDate} endDate={session.endDate} fillCount={detail.bookCounts.fills} positions={detail.positions} />
      <BacktestDailyDecisionsTable days={detail.days} />

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this session?"
          message={`${session.name} (${session.symbol}): its settings, every day's result and every trade are removed. The data files stay.`}
          confirmLabel="Delete"
          confirming={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
