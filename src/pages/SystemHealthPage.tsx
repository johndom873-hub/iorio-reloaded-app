import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { Spinner } from "../components/Spinner";
import { ApiError } from "../api/client";
import { fetchJobRuns, fetchJobStatuses, triggerIbkrHealthCheck, type JobRun, type JobRunStatus } from "../api/systemHealth";
import { formatDateTime, formatDuration } from "../lib/formatters";

const jobLabels: Record<string, string> = {
  daily_market_data_capture: "Daily Market Data Capture",
  daily_pnl_snapshot: "Daily P&L Snapshot",
  trade_alert_generation: "Trade Alert Generation",
  ibkr_health_check: "IBKR Gateway Health Check",
};

function jobLabel(jobName: string): string {
  return jobLabels[jobName] ?? jobName;
}

function statusBadgeClass(status: JobRunStatus): string {
  if (status === "success") return "bg-success-lt";
  if (status === "failure") return "bg-danger-lt";
  return "bg-azure-lt";
}

function StatusBadge({ status }: { status: JobRunStatus }) {
  return (
    <span className={`badge ${statusBadgeClass(status)} text-dark`} style={{ fontSize: "0.72rem" }}>
      {status}
    </span>
  );
}

export function SystemHealthPage() {
  const [statuses, setStatuses] = useState<JobRun[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [statusesError, setStatusesError] = useState<string | null>(null);

  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [jobRunsLoading, setJobRunsLoading] = useState(true);
  const [jobRunsError, setJobRunsError] = useState<string | null>(null);

  const [checkingIbkr, setCheckingIbkr] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const loadStatuses = useCallback(async () => {
    try {
      setStatusesError(null);
      setStatuses(await fetchJobStatuses());
    } catch (err) {
      setStatusesError(err instanceof ApiError ? err.message : "Failed to load job statuses.");
    }
  }, []);

  const loadJobRuns = useCallback(async () => {
    try {
      setJobRunsError(null);
      setJobRuns(await fetchJobRuns());
    } catch (err) {
      setJobRunsError(err instanceof ApiError ? err.message : "Failed to load job run history.");
    }
  }, []);

  useEffect(() => {
    setStatusesLoading(true);
    loadStatuses().finally(() => setStatusesLoading(false));
  }, [loadStatuses]);

  useEffect(() => {
    setJobRunsLoading(true);
    loadJobRuns().finally(() => setJobRunsLoading(false));
  }, [loadJobRuns]);

  async function handleRunHealthCheck() {
    setCheckingIbkr(true);
    setCheckError(null);
    try {
      await triggerIbkrHealthCheck();
      await Promise.all([loadStatuses(), loadJobRuns()]);
    } catch (err) {
      setCheckError(err instanceof ApiError ? err.message : "Failed to run health check.");
    } finally {
      setCheckingIbkr(false);
    }
  }

  const columns: DataTableColumn<JobRun>[] = [
    { key: "job", header: "Job", render: (row) => jobLabel(row.jobName) },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "startedAt", header: "Started", render: (row) => formatDateTime(row.startedAt) },
    { key: "duration", header: "Duration", render: (row) => formatDuration(row.startedAt, row.finishedAt) },
    {
      key: "details",
      header: "Details",
      render: (row) =>
        row.status === "failure" ? (
          <span className="text-danger" title={row.errorMessage ?? undefined}>
            {row.errorMessage ?? "Failed"}
          </span>
        ) : row.details ? (
          <span className="text-muted small">{JSON.stringify(row.details)}</span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="System Health"
        subtitle="Scheduled job status and modular health checks"
        actions={
          <button
            type="button"
            className="btn btn-outline-primary d-inline-flex align-items-center gap-1"
            disabled={checkingIbkr}
            onClick={handleRunHealthCheck}
          >
            {checkingIbkr && <Spinner size="sm" />}
            Run Health Check Now
          </button>
        }
      />

      {checkError && <div className="alert alert-danger">{checkError}</div>}
      {statusesError && <div className="alert alert-danger">{statusesError}</div>}
      {jobRunsError && <div className="alert alert-danger">{jobRunsError}</div>}

      {statusesLoading ? (
        <div className="d-flex justify-content-center py-3">
          <Spinner label="Loading job statuses" />
        </div>
      ) : (
        <div className="row g-3 mb-3">
          {statuses.length === 0 ? (
            <div className="col-12">
              <div className="text-muted">No job runs recorded yet.</div>
            </div>
          ) : (
            statuses.map((job) => (
              <div className="col-12 col-sm-6 col-md-3" key={job.jobName}>
                <div className="card">
                  <div className="card-body">
                    <div className="text-muted mb-1" style={{ fontSize: "0.75rem" }}>
                      {jobLabel(job.jobName)}
                    </div>
                    <StatusBadge status={job.status} />
                    <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>
                      Last run {formatDateTime(job.startedAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <DataTable
        tableId="system-health-jobs"
        columns={columns}
        rows={jobRuns}
        rowKey={(row) => row.id}
        loading={jobRunsLoading}
        emptyMessage="No job runs recorded yet."
      />
    </>
  );
}
