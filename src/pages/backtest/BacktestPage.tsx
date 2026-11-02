import { useState } from "react";
import { IconRefresh, IconSettings } from "@tabler/icons-react";
import { errorMessage } from "../../api/client";
import { refreshBacktestMarketIndices } from "../../api/backtest";
import { PageHeader } from "../../components/layout/PageHeader";
import { TooltipSpan } from "../../components/TooltipSpan";
import { Spinner } from "../../components/Spinner";
import { BacktestDataFilesTable } from "../../components/backtest/BacktestDataFilesTable";
import { BacktestJobsCard } from "../../components/backtest/BacktestJobsCard";
import { BacktestLabSettingsModal } from "../../components/backtest/BacktestLabSettingsModal";
import { BacktestSessionsTable } from "../../components/backtest/BacktestSessionsTable";
import { useBacktestOverview } from "../../components/backtest/useBacktestPolling";
import { formatDateTime, formatFileSize, pluralizeCount } from "../../lib/formatters";

const pageTitle = "Backtesting";
const pageSubtitle = "Replay the valuation model and Pluto's rules on ThetaData option prices from 2020. Runs on this Mac only.";

// Backtesting home (mockup approved 2026-10-12): background jobs, the downloaded data files and the sessions; the lab settings
// open from the header (mockup approved 2026-10-19), and Refresh VIX beside them fetches the VIX and VIX3M files again.
export function BacktestPage() {
  const { data: overview, loadError, refreshFailing, reload } = useBacktestOverview();
  const [labSettingsOpen, setLabSettingsOpen] = useState(false);
  // Bumped when the lab settings close: a save may have put stored analyses out of date, so Data files reads them again.
  const [labSettingsClosings, setLabSettingsClosings] = useState(0);
  const [vixRefreshRunning, setVixRefreshRunning] = useState(false);
  const [vixRefreshError, setVixRefreshError] = useState<string | null>(null);

  async function refreshVix() {
    setVixRefreshRunning(true);
    setVixRefreshError(null);
    try {
      await refreshBacktestMarketIndices();
      reload();
    } catch (error) {
      setVixRefreshError(errorMessage(error, "The VIX refresh failed. Try again in a minute."));
    } finally {
      setVixRefreshRunning(false);
    }
  }

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
            <button
              type="button"
              className="btn btn-outline-secondary d-inline-flex align-items-center gap-1"
              disabled={vixRefreshRunning}
              title="Fetch the VIX and VIX3M daily bars from IBKR (about 15 s)"
              onClick={() => void refreshVix()}
            >
              {vixRefreshRunning ? <Spinner size="sm" /> : <IconRefresh size={18} aria-hidden="true" />}
              {vixRefreshRunning ? "Refreshing VIX…" : "Refresh VIX"}
            </button>
          <span className="backtest-source-chip">
            <span className="subheader">Local only</span>
            <span className="font-mono text-break">{overview.dataDirectory}</span>
            <span className="text-secondary">
              · {pluralizeCount(overview.files.length, "file")} · {formatFileSize(totalBytes)} ·{" "}
              {overview.marketIndexFiles ? (
                <TooltipSpan
                  text={`VIX and VIX3M daily closes\n${overview.marketIndexFiles.firstDateIso} to ${overview.marketIndexFiles.lastDateIso}\nFetched ${formatDateTime(overview.marketIndexFiles.fetchedAtIso)}`}
                  multiline
                  className="dotted-underline-label"
                >
                  VIX to {overview.marketIndexFiles.lastDateIso}
                </TooltipSpan>
              ) : (
                <span className="iorio-note-amber">no VIX file</span>
              )}
            </span>
          </span>
          </span>
        }
      />
      {vixRefreshError && <div className="alert alert-danger mb-2">{vixRefreshError}</div>}
      {refreshFailing && (
        <div className="iorio-note-amber mb-2" role="status" style={{ fontSize: "0.8rem" }}>
          Cannot reach the API right now; showing the last update and retrying.
        </div>
      )}
      <BacktestJobsCard jobs={overview.jobs} onJobsChanged={reload} />
      <BacktestDataFilesTable files={overview.files} jobs={overview.jobs} suitabilityBySymbol={overview.suitabilityBySymbol} onFilesChanged={reload} analysesReloadKey={labSettingsClosings} />
      <BacktestSessionsTable />
      {labSettingsOpen && (
        <BacktestLabSettingsModal
          onClose={() => {
            setLabSettingsOpen(false);
            setLabSettingsClosings((count) => count + 1);
          }}
        />
      )}
    </>
  );
}
