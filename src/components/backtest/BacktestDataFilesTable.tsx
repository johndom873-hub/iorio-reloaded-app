import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { backtestMaxSymbolsPerSession, deleteBacktestDataFile, resumeBacktestJob, startBacktestDownload, type BacktestDataFileSummary, type BacktestJobView } from "../../api/backtest";
import { formatFileSize, formatNumber } from "../../lib/formatters";
import { describeDataFileIssues, describeDetectedSplits, splitsNotAnalysedExplanation } from "../../lib/backtestPresentation";
import { ConfirmModal } from "../ConfirmModal";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { BacktestCardTitle } from "./backtestBits";
import { TickerAnalysisModal } from "./analysis/TickerAnalysisModal";

interface BacktestDataFilesTableProps {
  files: BacktestDataFileSummary[];
  jobs: BacktestJobView[];
  onFilesChanged: () => Promise<void>;
}

/** The From, To and Days columns' headings: the file's option days, and the IBKR daily spot (stock) prices in the local DB. */
const optionsGroup = { label: "Options", className: "text-center", title: "Days with option prices stored in the file (ThetaData)" };
const spotGroup = { label: "Spot", className: "text-center", title: "IBKR daily spot prices of the stock, in the local database: the forecast and the settlement prices come from them" };

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
  const [analysedSymbol, setAnalysedSymbol] = useState<string | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [bulkUpdateRunning, setBulkUpdateRunning] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<BacktestDataFileSummary | null>(null);
  const [deleteRunning, setDeleteRunning] = useState(false);
  const navigate = useNavigate();
  const downloadRequestRunning = pendingSymbol !== null || bulkUpdateRunning;

  const selectedFiles = files.filter((file) => selectedSymbols.has(file.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const filesWithoutCompleteDays = selectedFiles.filter((file) => !file.firstDate || !file.lastDate);
  const backtestBlockedReason =
    filesWithoutCompleteDays.length > 0
      ? `${filesWithoutCompleteDays.map((file) => file.symbol).join(", ")} ${filesWithoutCompleteDays.length === 1 ? "has" : "have"} no complete days yet`
      : selectedFiles.length > backtestMaxSymbolsPerSession
        ? `A session takes at most ${backtestMaxSymbolsPerSession} symbols`
        : null;

  const toggleSelected = (symbol: string) => {
    setSelectedSymbols((previous) => {
      const next = new Set(previous);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  /**
   * Update (N): the ticked tickers one after another, A to Z, so the queue keeps that order. Each does what its row's button
   * does (a stopped download resumes); one already queued or downloading is skipped. The ones that failed stay ticked.
   */
  const updateSelected = async () => {
    setRowError(null);
    setBulkUpdateRunning(true);
    const failures: { symbol: string; message: string }[] = [];
    try {
      for (const file of selectedFiles) {
        const job = latestDownloadJob(jobs, file.symbol);
        const status = job?.displayStatus;
        if (status === "queued" || status === "running") continue;
        try {
          if (status === "stopped" && job) await resumeBacktestJob(job.id);
          else await startBacktestDownload({ symbol: file.symbol, ...(file.firstDate ? { startDate: file.firstDate } : {}) });
        } catch (err) {
          failures.push({ symbol: file.symbol, message: errorMessage(err, `Could not start the ${file.symbol} download.`) });
        }
      }
      await onFilesChanged();
    } finally {
      setSelectedSymbols(new Set(failures.map((failure) => failure.symbol)));
      if (failures.length > 0) setRowError(failures.map((failure) => `${failure.symbol}: ${failure.message}`).join(" "));
      setBulkUpdateRunning(false);
    }
  };

  /** Deletes the file and its downloads; the server refuses while a download, backtest or analysis using it runs. */
  const confirmDeleteFile = async (file: BacktestDataFileSummary) => {
    setDeleteRunning(true);
    setRowError(null);
    try {
      await deleteBacktestDataFile(file.symbol);
      setSelectedSymbols((previous) => {
        const next = new Set(previous);
        next.delete(file.symbol);
        return next;
      });
      await onFilesChanged();
    } catch (err) {
      setRowError(errorMessage(err, `Could not delete the ${file.symbol} data file.`));
    } finally {
      setDeleteRunning(false);
      setFileToDelete(null);
    }
  };

  const backtestSelected = () => navigate(`/backtest/new?symbols=${selectedFiles.map((file) => encodeURIComponent(file.symbol)).join(",")}`);

  /**
   * Update sends the file's own first day, so it fills the gaps and adds the days since, never extending the file back in
   * time. Every download joins the end of the queue; the Jobs card's Move to top reorders it.
   */
  const requestDownload = async (symbol: string, startDate: string | undefined, source: "form" | "row") => {
    setPendingSymbol(symbol);
    try {
      await startBacktestDownload({ symbol, ...(startDate ? { startDate } : {}) });
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

  /** The form's symbol and start date, checked; null after showing what is wrong. */
  const readAddSymbolForm = (): string | null => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbolPattern.test(symbol)) {
      setFormError("Type a ticker symbol, e.g. HOOD.");
      return null;
    }
    if (!newStartDate) {
      setFormError("Choose the first day to download.");
      return null;
    }
    setFormError(null);
    return symbol;
  };

  const handleAddSymbol = async (event: FormEvent) => {
    event.preventDefault();
    const symbol = readAddSymbolForm();
    if (symbol && (await requestDownload(symbol, newStartDate, "form"))) setNewSymbol("");
  };

  const columns: DataTableColumn<BacktestDataFileSummary>[] = [
    {
      key: "select",
      header: "",
      render: (file) => (
        <label className="backtest-checkbox-hit">
          <input type="checkbox" className="form-check-input m-0" aria-label={`Select ${file.symbol}`} checked={selectedSymbols.has(file.symbol)} onChange={() => toggleSelected(file.symbol)} />
        </label>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      // The symbol opens the Analyse window (not the ticker modal): plain text until the file has a complete day.
      render: (file) =>
        file.firstDate ? (
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold iorio-symbol-link" title={`Analyse ${file.symbol} for the CC + Put Ladder`} onClick={() => setAnalysedSymbol(file.symbol)}>
            {file.symbol}
          </button>
        ) : (
          <strong title="No complete days yet">{file.symbol}</strong>
        ),
    },
    { key: "from", header: "From", group: optionsGroup, cellClassName: "font-mono text-nowrap", render: (file) => file.firstDate ?? "—" },
    { key: "to", header: "To", group: optionsGroup, cellClassName: "font-mono text-nowrap", render: (file) => file.lastDate ?? "—" },
    { key: "days", header: "Days", headerTitle: "Days with option prices", group: optionsGroup, align: "right", render: (file) => formatNumber(file.completeDays) },
    // No IBKR bars: an amber "none" under From, since a backtest needs them.
    { key: "spotFrom", header: "From", group: spotGroup, headerClassName: "data-table-column-gap", cellClassName: "font-mono text-nowrap data-table-column-gap", render: (file) => file.barsFirstDate ?? <span className="iorio-note-amber">none</span> },
    { key: "spotTo", header: "To", group: spotGroup, cellClassName: "font-mono text-nowrap", render: (file) => file.barsLastDate ?? "—" },
    { key: "spotDays", header: "Days", headerTitle: "Days with spot prices", group: spotGroup, align: "right", render: (file) => formatNumber(file.barsCount) },
    {
      key: "issues",
      header: "Issues",
      headerTitle: "Days with a problem in the option data: nothing stored yet, stored with parts missing, or not retrievable. Point at the count for the list.",
      align: "right",
      render: (file) =>
        file.issueDays > 0 ? (
          <TooltipSpan text={describeDataFileIssues(file)} multiline className="iorio-note-amber dotted-underline-label">
            {formatNumber(file.issueDays)}
          </TooltipSpan>
        ) : (
          <span className="text-secondary">0</span>
        ),
    },
    {
      key: "splits",
      header: "Splits",
      headerClassName: "data-table-column-gap",
      headerTitle: "Stock splits found in the file's period (new shares per old share, from the first day on the new scale). IBKR's bars are split-adjusted and the option prices are as traded, so a session puts each day's prices on that day's traded scale.",
      cellClassName: "font-mono text-nowrap data-table-column-gap",
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
            <div className="d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled>
                <Spinner size="sm" />
                {status === "queued" ? "Queued" : job?.pauseRequested ? "Pausing" : "Downloading"}
              </button>
            </div>
          );
        }
        return (
          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className={`btn ${status === "stopped" ? "btn-outline-primary" : "btn-outline-secondary"} d-inline-flex align-items-center gap-1`}
              disabled={downloadRequestRunning}
              onClick={() => {
                setRowError(null);
                if (status === "stopped" && job) void resumeDownload(job);
                else void requestDownload(file.symbol, file.firstDate ?? undefined, "row");
              }}
            >
              {busy && <Spinner size="sm" />}
              {status === "stopped" ? "Resume" : "Update"}
            </button>
            <button type="button" className="btn btn-outline-danger" disabled={downloadRequestRunning || deleteRunning} onClick={() => setFileToDelete(file)}>
              Delete
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
      <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={downloadRequestRunning}>
        {pendingSymbol !== null && pendingSymbol === newSymbol.trim().toUpperCase() && <Spinner size="sm" />}
        Download
      </button>
    </form>
  );

  const selectionActions = (
    <div className="d-flex flex-column align-items-end gap-1">
      <div className="d-flex align-items-center gap-2">
        <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={selectedFiles.length === 0 || downloadRequestRunning} onClick={() => void updateSelected()}>
          {bulkUpdateRunning && <Spinner size="sm" />}
          Update ({selectedFiles.length})
        </button>
        <button type="button" className="btn btn-outline-primary" disabled={selectedFiles.length === 0 || backtestBlockedReason !== null} title={backtestBlockedReason ?? undefined} onClick={backtestSelected}>
          Backtest ({selectedFiles.length})
        </button>
      </div>
      {backtestBlockedReason && (
        <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
          {backtestBlockedReason}
        </span>
      )}
    </div>
  );

  // The title on its own row; under it the add-a-symbol form on the left and, with files to tick, the selection's actions on the right.
  const header = (
    <div className="d-flex flex-column gap-2 w-100">
      <BacktestCardTitle title="Data files" />
      <div className="d-flex flex-wrap align-items-end justify-content-between gap-2">
        {addSymbolForm}
        {files.length > 0 && selectionActions}
      </div>
    </div>
  );
  const errors = (formError || rowError) && (
    <div className="px-3 pt-2">
      {formError && <div className="alert alert-danger mb-2">{formError}</div>}
      {rowError && <div className="alert alert-danger mb-2">{rowError}</div>}
    </div>
  );

  // No table without rows: a wide table's centred empty message lands off screen on a phone.
  if (files.length === 0) {
    return (
      <div className="card mb-3">
        <div className="card-body py-2 border-bottom">{header}</div>
        {errors}
        <div className="text-secondary px-3 py-3" style={{ fontSize: "0.85rem" }}>
          No data files yet. Add a symbol to download its option history.
        </div>
      </div>
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
        toolbar={header}
        beforeTable={errors}
      />
      {fileToDelete && (
        <ConfirmModal
          title={`Delete ${fileToDelete.symbol}'s data file?`}
          message={
            <>
              <p>
                {fileToDelete.symbol}.sqlite ({formatNumber(fileToDelete.completeDays)} trading days
                {fileToDelete.firstDate && fileToDelete.lastDate ? `, ${fileToDelete.firstDate} to ${fileToDelete.lastDate}` : ""}, {formatFileSize(fileToDelete.sizeBytes)}) and its downloads in Background jobs are deleted.
              </p>
              <p className="mb-0">Past backtests keep their results. Downloading {fileToDelete.symbol} again starts from scratch.</p>
            </>
          }
          confirmLabel="Delete"
          confirming={deleteRunning}
          onConfirm={() => void confirmDeleteFile(fileToDelete)}
          onCancel={() => setFileToDelete(null)}
        />
      )}
      {analysedSymbol && (
        <TickerAnalysisModal
          symbol={analysedSymbol}
          onClose={() => setAnalysedSymbol(null)}
          onEditGlobalSettings={() => {
            setAnalysedSymbol(null);
            document.getElementById("backtest-lab-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}
    </div>
  );
}
