import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestDataFilesTable } from "../../components/backtest/BacktestDataFilesTable";
import { BacktestJobsCard } from "../../components/backtest/BacktestJobsCard";
import { BacktestLabSettingsCard } from "../../components/backtest/BacktestLabSettingsCard";
import { BacktestSessionsTable } from "../../components/backtest/BacktestSessionsTable";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { formatFileSize, pluralizeCount } from "../../lib/formatters";

const pageTitle = "Backtesting";
const pageSubtitle = "Replay the valuation model and Pluto's rules on ThetaData option prices from 2020. Runs on this Mac only.";

// Backtesting home (mockup approved 2026-10-12): background jobs, the downloaded data files, the lab settings, and the sessions.
export function BacktestPage() {
  const { data: overview, loadError, refreshFailing, reload } = useBacktestOverview();

  if (loadError) {
    return (
      <>
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <div className="alert alert-danger mt-3">{loadError} Retrying in the background.</div>
      </>
    );
  }

  if (!overview) {
    return (
      <>
        <PageHeader title={pageTitle} subtitle={pageSubtitle} />
        <div className="d-flex justify-content-center py-5">
          <Spinner label="Loading backtesting" />
        </div>
      </>
    );
  }

  const totalBytes = overview.files.reduce((sum, file) => sum + file.sizeBytes, 0);

  return (
    <>
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          <span className="backtest-source-chip">
            <span className="subheader">Local only</span>
            <span className="font-mono text-break">{overview.dataDirectory}</span>
            <span className="text-secondary">
              · {pluralizeCount(overview.files.length, "file")} · {formatFileSize(totalBytes)}
            </span>
          </span>
        }
      />
      {refreshFailing && (
        <div className="iorio-note-amber mb-2" role="status" style={{ fontSize: "0.8rem" }}>
          Cannot reach the API right now; showing the last update and retrying.
        </div>
      )}
      <BacktestJobsCard jobs={overview.jobs} onJobsChanged={reload} />
      <BacktestDataFilesTable files={overview.files} jobs={overview.jobs} onFilesChanged={reload} />
      <BacktestLabSettingsCard />
      <BacktestSessionsTable />
    </>
  );
}
