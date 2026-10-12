import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { deleteBacktestSession, fetchBacktestSession, fetchBacktestSettingsTemplate, type BacktestSessionDetail, type BacktestSettingRow } from "../../api/backtest";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestAccuracyTable } from "../../components/backtest/BacktestAccuracyTable";
import { BacktestBackLink, BacktestCard, BacktestJobProgress, BacktestJobStatusBadge } from "../../components/backtest/backtestBits";
import { BacktestSessionCharts } from "../../components/backtest/BacktestCharts";
import { BacktestKpiTiles } from "../../components/backtest/BacktestKpiTiles";
import { BacktestMonthlyReturnsCard } from "../../components/backtest/BacktestMonthlyReturnsCard";
import { BacktestTradesTable } from "../../components/backtest/BacktestTradesTable";
import { BacktestDailyDecisionsTable } from "../../components/backtest/BacktestDailyDecisionsTable";
import { usePolledBacktestResource } from "../../components/backtest/useBacktestPolling";
import { useTickingNow } from "../../hooks/useTickingNow";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatDuration } from "../../lib/formatters";
import { describeOverrideChanges, describeSessionSplits, isBacktestJobActive, sessionSplitsNotePrefix, tablesModeLabel } from "../../lib/backtestPresentation";

// Session results (mockup approved 2026-10-12): ten headline figures, the account value against buy and hold, its drawdown,
// monthly returns, model accuracy by margin band and every trade. Polls every 2 s while the run is going.
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
  const runMoment = `${formatBrowserDayMonth(session.createdAt)} ${formatBrowserClockTime(session.createdAt)}`;
  const subtitle = [
    `${session.startDate} → ${session.endDate}`,
    `${formatCurrency(session.startingValue, 0)} start`,
    tablesModeLabel[session.tablesMode],
    session.finishedAt ? `ran ${runMoment}, ${formatDuration(session.createdAt, session.finishedAt)}` : `started ${runMoment}`,
  ].join(" · ");

  return (
    <>
      <BacktestBackLink />
      <PageHeader
        title={`${session.name} · ${session.symbol}`}
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
      {session.status === "failed" && <div className="alert alert-danger">The run failed{session.error ? `: ${session.error}` : "."}</div>}
      {session.status === "cancelled" && <div className="alert alert-secondary">The run was cancelled; the figures below are only as far as it got.</div>}
      {!finished && job && (
        <BacktestCard title="Run" description={<BacktestJobStatusBadge status={displayStatus} />} className="mb-3">
          <div className="card-body">
            <BacktestJobProgress job={job} now={now} />
          </div>
        </BacktestCard>
      )}

      <BacktestKpiTiles metrics={session.metrics} baselineMetrics={session.baselineMetrics} days={detail.days} trades={detail.trades} monthlyReturns={detail.monthlyReturns} />

      <BacktestCard title="Account value" description="Marked to market every trading day at 10:00 ET, against buying the shares on day one and holding them." className="mb-3">
        <div className="card-body pt-2">
          {detail.days.length < 2 ? (
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
              {finished ? "The session has fewer than two days." : "The chart fills in as the run goes."}
            </div>
          ) : (
            <BacktestSessionCharts days={detail.days} symbol={session.symbol} />
          )}
        </div>
      </BacktestCard>

      <div className="backtest-results-pair mb-3">
        <BacktestMonthlyReturnsCard monthlyReturns={detail.monthlyReturns} />
        <BacktestAccuracyTable bands={detail.accuracyByMarginBand} />
      </div>

      <BacktestTradesTable symbol={session.symbol} sessionName={session.name} trades={detail.trades} />
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
