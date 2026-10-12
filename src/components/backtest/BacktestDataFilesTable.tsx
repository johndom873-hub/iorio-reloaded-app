import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/client";
import { resumeBacktestJob, startBacktestDownload, type BacktestDataFileSummary, type BacktestJobView } from "../../api/backtest";
import { formatFileSize, formatNumber } from "../../lib/formatters";
import { describeDetectedSplits, splitsNotAnalysedExplanation } from "../../lib/backtestPresentation";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { BacktestCard, BacktestCardTitle } from "./backtestBits";

interface BacktestDataFilesTableProps {
  files: BacktestDataFileSummary[];
  jobs: BacktestJobView[];
  onFilesChanged: () => Promise<void>;
}

/** The ThetaData history starts in 2020; a new symbol downloads from here unless another date is chosen. */
const defaultDownloadStartDate = "2020-01-01";
const symbolPattern = /^[A-Z][A-Z.]{0,9}$/;

function latestDownloadJob(jobs: BacktestJobView[], symbol: string): BacktestJobView | null {
  return jobs.filter((job) => job.kind === "download" && job.symbol === symbol).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Data files: one SQLite file per symbol with every contract's 10:00 ET quote; Update downloads only the missing days. */
export function BacktestDataFilesTable({ files, jobs, onFilesChanged }: BacktestDataFilesTableProps) {
  const [newSymbol, setNewSymbol] = useState("");
  const [newStartDate, setNewStartDate] = useState(defaultDownloadStartDate);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  /** Update sends the file's own first day, so it fills the gaps and adds the days since, never extending the file back in time. */
  const requestDownload = async (symbol: string, startDate: string | undefined, source: "form" | "row") => {
    setPendingSymbol(symbol);
    try {
      await startBacktestDownload(startDate ? { symbol, startDate } : { symbol });
      await onFilesChanged();
      return true;
    } catch (err) {
      const message = errorMessage(err, `Could not start the ${symbol} download.`);
      if (source === "form") setFormError(message);
      else setRowError(message);
      return false;
    } finally {
      setPendingSymbol(null);
    }
  };

  const resumeDownload = async (job: BacktestJobView) => {
    setPendingSymbol(job.symbol);
    setRowError(null);
    try {
      await resumeBacktestJob(job.id);
      await onFilesChanged();
    } catch (err) {
      setRowError(errorMessage(err, `Could not resume the ${job.symbol} download.`));
    } finally {
      setPendingSymbol(null);
    }
  };

  const handleAddSymbol = async (event: FormEvent) => {
    event.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbolPattern.test(symbol)) {
      setFormError("Type a ticker symbol, e.g. HOOD.");
      return;
    }
    if (!newStartDate) {
      setFormError("Choose the first day to download.");
      return;
    }
    setFormError(null);
    if (await requestDownload(symbol, newStartDate, "form")) setNewSymbol("");
  };

  const columns: DataTableColumn<BacktestDataFileSummary>[] = [
    { key: "symbol", header: "Symbol", render: (file) => <strong>{file.symbol}</strong> },
    { key: "from", header: "From", cellClassName: "font-mono text-nowrap", render: (file) => file.firstDate ?? "—" },
    { key: "to", header: "To", cellClassName: "font-mono text-nowrap", render: (file) => file.lastDate ?? "—" },
    { key: "days", header: "Trading days", headerTitle: "Days stored with data", align: "right", render: (file) => formatNumber(file.completeDays) },
    {
      key: "missing",
      header: "Missing",
      headerTitle: "Weekdays between From and To with nothing stored (a gap to fill). Holidays are stored as days without data, so they do not count.",
      align: "right",
      render: (file) => <span className={file.missingWeekdays > 0 ? "iorio-note-amber" : "text-secondary"}>{formatNumber(file.missingWeekdays)}</span>,
    },
    {
      key: "bars",
      header: "Daily bars",
      headerTitle: "IBKR daily bars in the local database for the symbol: the forecast and the settlement prices come from them.",
      cellClassName: "font-mono text-nowrap",
      render: (file) => (file.barsFirstDate && file.barsLastDate ? `${file.barsFirstDate} → ${file.barsLastDate}` : <span className="iorio-note-amber">none</span>),
    },
    {
      key: "splits",
      header: "Splits",
      headerTitle: "Stock splits found in the file's period (new shares per old share, from the first day on the new scale). IBKR's bars are split-adjusted and the option prices are as traded, so a session puts each day's prices on that day's traded scale.",
      cellClassName: "font-mono text-nowrap",
      render: (file) =>
        !file.detectedSplits ? (
          <TooltipSpan text={splitsNotAnalysedExplanation} className="text-secondary">
            {describeDetectedSplits(null)}
          </TooltipSpan>
        ) : (
          <span className={file.detectedSplits.length === 0 ? "text-secondary" : undefined}>{describeDetectedSplits(file.detectedSplits)}</span>
        ),
    },
    { key: "size", header: "Size", align: "right", cellClassName: "text-nowrap", render: (file) => formatFileSize(file.sizeBytes) },
    {
      key: "actions",
      header: "",
      render: (file) => {
        const job = latestDownloadJob(jobs, file.symbol);
        const status = job?.displayStatus;
        const busy = pendingSymbol === file.symbol;
        if (status === "queued" || status === "running") {
          return (
            <div className="text-end">
              <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled>
                <Spinner size="sm" />
                {status === "queued" ? "Queued" : "Downloading"}
              </button>
            </div>
          );
        }
        return (
          <div className="text-end">
            <button
              type="button"
              className={`btn ${status === "stopped" ? "btn-outline-primary" : "btn-outline-secondary"} d-inline-flex align-items-center gap-1`}
              disabled={pendingSymbol !== null}
              onClick={() => {
                setRowError(null);
                if (status === "stopped" && job) void resumeDownload(job);
                else void requestDownload(file.symbol, file.firstDate ?? undefined, "row");
              }}
            >
              {busy && <Spinner size="sm" />}
              {status === "stopped" ? "Resume" : "Update"}
            </button>
          </div>
        );
      },
    },
  ];

  const addSymbolForm = (
    <form className="d-flex flex-wrap align-items-end gap-2" onSubmit={(event) => void handleAddSymbol(event)} noValidate>
      <div>
        <label htmlFor="backtest-new-symbol" className="form-label mb-1 text-secondary" style={{ fontSize: "0.75rem" }}>
          Add a symbol
        </label>
        <input
          id="backtest-new-symbol"
          type="text"
          className="form-control font-mono text-uppercase"
          style={{ width: "7rem" }}
          placeholder="HOOD"
          autoComplete="off"
          spellCheck={false}
          value={newSymbol}
          onChange={(event) => setNewSymbol(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="backtest-new-symbol-start" className="form-label mb-1 text-secondary" style={{ fontSize: "0.75rem" }}>
          From
        </label>
        <input id="backtest-new-symbol-start" type="date" className="form-control font-mono" value={newStartDate} onChange={(event) => setNewStartDate(event.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={pendingSymbol !== null}>
        {pendingSymbol !== null && pendingSymbol === newSymbol.trim().toUpperCase() && <Spinner size="sm" />}
        Download
      </button>
    </form>
  );

  const title = "Data files";
  const description = "One file per symbol: every contract's bid and ask at 10:00 ET, the day's volume and open interest. Downloads add only the missing days.";
  const errors = (formError || rowError) && (
    <div className="px-3 pt-2">
      {formError && <div className="alert alert-danger mb-2">{formError}</div>}
      {rowError && <div className="alert alert-danger mb-2">{rowError}</div>}
    </div>
  );

  // No table without rows: a wide table's centred empty message lands off screen on a phone.
  if (files.length === 0) {
    return (
      <BacktestCard title={title} description={description} actions={addSymbolForm} className="mb-3">
        {errors}
        <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
          No data files yet. Add a symbol to download its option history.
        </div>
      </BacktestCard>
    );
  }

  return (
    <div className="mb-3">
      <DataTable
        tableId="backtest-data-files"
        columns={columns}
        rows={files}
        rowKey={(file) => file.symbol}
        dense
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            {addSymbolForm}
          </>
        }
        beforeTable={errors}
      />
    </div>
  );
}
