import { useState } from "react";
import { IconSettings } from "@tabler/icons-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestDataFilesTable } from "../../components/backtest/BacktestDataFilesTable";
import { BacktestJobsCard } from "../../components/backtest/BacktestJobsCard";
import { BacktestLabSettingsModal } from "../../components/backtest/BacktestLabSettingsModal";
import { BacktestSessionsTable } from "../../components/backtest/BacktestSessionsTable";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { formatFileSize, pluralizeCount } from "../../lib/formatters";

const pageTitle = "Backtesting";
const pageSubtitle = "Replay the valuation model and Pluto's rules on ThetaData option prices from 2020. Runs on this Mac only.";

// Backtesting home (mockup approved 2026-10-12): background jobs, the downloaded data files and the sessions; the lab settings
// open from the header (mockup approved 2026-10-19).
export function BacktestPage() {
  const { data: overview, loadError, refreshFailing, reload } = useBacktestOverview();
  const [labSettingsOpen, setLabSettingsOpen] = useState(false);

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
          <span className="d-inline-flex flex-wrap align-items-center gap-2">
            <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setLabSettingsOpen(true)}>
              <IconSettings size={18} aria-hidden="true" />
              Lab settings
            </button>
          <span className="backtest-source-chip">
            <span className="subheader">Local only</span>
            <span className="font-mono text-break">{overview.dataDirectory}</span>
            <span className="text-secondary">
              · {pluralizeCount(overview.files.length, "file")} · {formatFileSize(totalBytes)}
            </span>
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
      <BacktestDataFilesTable files={overview.files} jobs={overview.jobs} suitabilityBySymbol={overview.suitabilityBySymbol} onFilesChanged={reload} onOpenLabSettings={() => setLabSettingsOpen(true)} />
      <BacktestSessionsTable />
      {labSettingsOpen && <BacktestLabSettingsModal onClose={() => setLabSettingsOpen(false)} />}
    </>
  );
}
