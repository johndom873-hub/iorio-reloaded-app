import { useCallback, useEffect, useState, type FormEvent } from "react";
import { IconPlayerPlay, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { backtestMaxSymbolsPerSession, deleteBacktestDataFile, resumeBacktestJob, startBacktestDownload, type BacktestDataFileSummary, type BacktestJobView, type BacktestTickerSuitability } from "../../api/backtest";
import { fetchAnalysesForTable, rerunOutOfDateAnalyses, type AnalysesForTable, type AnalysisTableRow, type SuitabilityVerdict } from "../../api/backtestAnalysis";
import { useIsAdmin } from "../../hooks/useAuth";
import { formatBrowserClockTime, formatCurrency, formatDayMonth, formatFileSize, formatNumber, formatPercentage, formatRatio } from "../../lib/formatters";
import { describeDataFileIssues, describeDetectedSplits, splitsNotAnalysedExplanation, suggestedSuitabilityLabel } from "../../lib/backtestPresentation";
import { describeTickerValuesDifferingFromLab, mergeTickerOwnValues } from "../../lib/analysisPresentation";
import { ConfirmModal } from "../ConfirmModal";
import { DataTable, type DataTableColumn } from "../DataTable/DataTable";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { BacktestCardTitle } from "./backtestBits";
import { TickerAnalysisModal } from "./analysis/TickerAnalysisModal";
import { TickerSuitabilityBadge } from "./TickerSuitabilityBadge";
import { TickerSuitabilityModal } from "./TickerSuitabilityModal";

interface BacktestDataFilesTableProps {
  files: BacktestDataFileSummary[];
  jobs: BacktestJobView[];
  /** The tickers marked Suitable or Unsuitable; the rest are Pending. */
  suitabilityBySymbol: Record<string, BacktestTickerSuitability>;
  onFilesChanged: () => Promise<void>;
  /** Changes when the analyses may have changed elsewhere (the lab settings closed): the table reads them again. */
  analysesReloadKey: number;
}

/** The From and Days columns' headings (and Expiries'): the file's option days, and the IBKR daily spot (stock) prices in the local DB. */
const optionsGroup = { label: "Options", className: "text-center", title: "Days with option prices stored in the file (ThetaData)" };
const spotGroup = { label: "Spot", className: "text-center", title: "IBKR daily spot prices of the stock, in the local database: the forecast and the settlement prices come from them" };

/** The columns of each ticker's latest Vol Farmer v4 analysis (mockup approved 2026-11-01). */
const analysisGroup = { label: "VF", className: "text-center", title: "Each ticker's latest analysis for Vol Farmer v4 at the lab's values; open it from the symbol" };
/** While an analysis runs, the table's analyses are read again this often. */
const analysesPollMilliseconds = 15_000;

const analysisRunning = (row: AnalysisTableRow | undefined) => row?.status === "queued" || row?.status === "running";
const analysedAt = (iso: string) => `${formatDayMonth(iso.slice(0, 10))}, ${formatBrowserClockTime(iso)}`;
/** The latest analysis's rule verdict; null when the ticker has none. */
function ruleVerdictOf(row: AnalysisTableRow | undefined): SuitabilityVerdict | null {
  const figures = row?.tableFigures ?? null;
  return figures ? { suits: figures.verdict === "suits", failedChecks: figures.failedChecks, uncoveredWindows: figures.uncoveredWindows } : null;
}

/** The ThetaData history starts in 2020; a new symbol downloads from here unless another date is chosen. */
const defaultDownloadStartDate = "2020-01-01";
const symbolPattern = /^[A-Z][A-Z.]{0,9}$/;

function latestDownloadJob(jobs: BacktestJobView[], symbol: string): BacktestJobView | null {
  return jobs.filter((job) => job.kind === "download" && job.symbol === symbol).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Data files: one SQLite file per symbol with every contract's 10:00 ET quote; Update downloads only the missing days. */
export function BacktestDataFilesTable({ files, jobs, suitabilityBySymbol, onFilesChanged, analysesReloadKey }: BacktestDataFilesTableProps) {
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
  const [suitabilitySymbol, setSuitabilitySymbol] = useState<string | null>(null);
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const downloadRequestRunning = pendingSymbol !== null || bulkUpdateRunning;
  const [analyses, setAnalyses] = useState<AnalysesForTable | null>(null);
  const [rerunRunning, setRerunRunning] = useState(false);

  const loadAnalyses = useCallback(async () => {
    try {
      setAnalyses(await fetchAnalysesForTable());
    } catch (err) {
      setRowError(errorMessage(err, "Could not load the analyses."));
    }
  }, []);
  useEffect(() => {
    void loadAnalyses();
  }, [loadAnalyses, analysesReloadKey]);
  const anyAnalysisRunning = analyses ? Object.values(analyses.bySymbol).some(analysisRunning) : false;
  useEffect(() => {
    if (!anyAnalysisRunning) return;
    const timer = window.setInterval(() => void loadAnalyses(), analysesPollMilliseconds);
    return () => window.clearInterval(timer);
  }, [anyAnalysisRunning, loadAnalyses]);

  /** Re-run out of date: a saved analysis of every ticker whose stored one read lab values that have changed since. */
  const rerunOutOfDate = async () => {
    setRerunRunning(true);
    setRowError(null);
    try {
      const outcome = await rerunOutOfDateAnalyses();
      if (outcome.skipped.length > 0) setRowError(`Not re-run: ${outcome.skipped.map((entry) => `${entry.symbol} (${entry.reason})`).join(", ")}.`);
      await loadAnalyses();
    } catch (err) {
      setRowError(errorMessage(err, "Could not re-run the analyses."));
    } finally {
      setRerunRunning(false);
    }
  };

  const selectedFiles = files.filter((file) => selectedSymbols.has(file.symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const allFilesSelected = files.length > 0 && selectedFiles.length === files.length;
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
      // Select all: ticked when every file is selected, half-ticked when some are; a click selects all, or clears all when all are.
      headerContent: (
        <label className="backtest-checkbox-hit">
          <input
            type="checkbox"
            className="form-check-input m-0"
            aria-label="Select all data files"
            checked={allFilesSelected}
            ref={(input) => {
              if (input) input.indeterminate = !allFilesSelected && selectedFiles.length > 0;
            }}
            onChange={() => setSelectedSymbols(allFilesSelected ? new Set() : new Set(files.map((file) => file.symbol)))}
          />
        </label>
      ),
      render: (file) => (
        <label className="backtest-checkbox-hit">
          <input type="checkbox" className="form-check-input m-0" aria-label={`Select ${file.symbol}`} checked={selectedSymbols.has(file.symbol)} onChange={() => toggleSelected(file.symbol)} />
        </label>
      ),
    },
    {
      key: "symbol",
      header: "Symbol",
      // The symbol opens the Analyse window (not the ticker modal): plain text until the file has a complete day. A ticker
      // with Vol Farmer v4 values of its own carries an Own values tag naming them.
      render: (file) => {
        const ownValuesText = analyses ? describeTickerValuesDifferingFromLab(mergeTickerOwnValues(analyses.labTickerFieldValues, analyses.tickerValuesBySymbol[file.symbol]?.values), analyses.labTickerFieldValues) : "";
        const symbolCell = file.firstDate ? (
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold iorio-symbol-link" title={`Analyse ${file.symbol} for Vol Farmer v4`} onClick={() => setAnalysedSymbol(file.symbol)}>
            {file.symbol}
          </button>
        ) : (
          <strong title="No complete days yet">{file.symbol}</strong>
        );
        if (!ownValuesText) return symbolCell;
        return (
          <span className="d-inline-flex align-items-center gap-2">
            {symbolCell}
            <TooltipSpan text={`${file.symbol}'s own values: ${ownValuesText}`} className="analysis-src-tag is-override text-nowrap">
              Own values
            </TooltipSpan>
          </span>
        );
      },
    },
    {
      key: "suitability",
      header: "Suitability",
      headerTitle: isAdmin
        ? "Whether the ticker suits Vol Farmer v4, as you mark it. While Pending, the latest analysis's rule suggests a flag beside it. Click a badge to mark it or edit its note."
        : "Whether the ticker suits Vol Farmer v4, as an admin marks it. While Pending, the latest analysis's rule suggests a flag beside it. Point at a badge for its note.",
      cellClassName: "text-nowrap",
      // The flag; while Pending, the rule's suggested flag beside it, and a spinner while an analysis runs.
      render: (file) => {
        const suitability = suitabilityBySymbol[file.symbol] ?? null;
        const row = analyses?.bySymbol[file.symbol];
        const verdict = ruleVerdictOf(row);
        return (
          <span className="d-inline-flex align-items-center gap-2">
            <TickerSuitabilityBadge symbol={file.symbol} suitability={suitability} onOpen={isAdmin ? () => setSuitabilitySymbol(file.symbol) : null} />
            {(suitability?.status ?? "pending") === "pending" && verdict && (
              <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
                suggests {suggestedSuitabilityLabel(verdict.suits)}
              </span>
            )}
            {analysisRunning(row) && <Spinner size="sm" label={`Analysing ${file.symbol}`} />}
          </span>
        );
      },
    },
    {
      key: "latestImpliedVolatility",
      header: "IV",
      headerTitle: "IBKR's latest daily implied volatility of the stock (30 days), from the local database; point at a value for its day",
      align: "right",
      cellClassName: "text-nowrap",
      render: (file) =>
        file.latestImpliedVolatility === null ? (
          "—"
        ) : (
          <TooltipSpan text={`IBKR's implied volatility on ${file.latestImpliedVolatilityDate ?? "an unknown day"}`} className="dotted-underline-label">
            {formatPercentage(file.latestImpliedVolatility)}
          </TooltipSpan>
        ),
    },
    {
      key: "optionsIncome",
      header: "Options",
      headerTitle: "The Calls' and Puts' P&L a year over the last 12 months ÷ the account at their start (the rule's first check)",
      group: analysisGroup,
      align: "right",
      render: (file) => {
        const figures = analyses?.bySymbol[file.symbol]?.tableFigures ?? null;
        return figures ? formatPercentage(figures.optionsIncomeTwelveMonths) : "—";
      },
    },
    { key: "v4Cagr", header: "VF CAGR", group: analysisGroup, align: "right", render: (file) => formatPercentage(analyses?.bySymbol[file.symbol]?.tableFigures?.v4Cagr) },
    { key: "holdCagr", header: "B&H CAGR", group: analysisGroup, align: "right", render: (file) => formatPercentage(analyses?.bySymbol[file.symbol]?.tableFigures?.holdCagr) },
    {
      key: "excessCalmar",
      header: "Excess Calmar",
      headerTitle: "VF v4's over the analysis backtest: (CAGR − the period's T-bill CAGR) ÷ |Max drawdown|",
      group: analysisGroup,
      align: "right",
      render: (file) => formatRatio(analyses?.bySymbol[file.symbol]?.tableFigures?.v4ExcessCalmar),
    },
    {
      key: "smallestPot",
      header: "Smallest pot",
      headerTitle: "One lot at the last 12 months' highest 10:00 price ÷ 80%",
      group: analysisGroup,
      align: "right",
      render: (file) => formatCurrency(analyses?.bySymbol[file.symbol]?.tableFigures?.smallestPotDollars, 0),
    },
    { key: "from", header: "From", group: optionsGroup, cellClassName: "font-mono text-nowrap", render: (file) => file.firstDate ?? "—" },
    {
      key: "days",
      header: "Days",
      headerTitle: "Days with option prices",
      group: optionsGroup,
      align: "right",
      render: (file) => (file.lastDate ? <TooltipSpan text={`Last day: ${file.lastDate}`}>{formatNumber(file.completeDays)}</TooltipSpan> : formatNumber(file.completeDays)),
    },
    {
      key: "expiriesPerWeek",
      header: "Expiries",
      headerTitle: "Expirations a week with a Call quoted at 10:00: the median of the file's last 4 full Monday-to-Friday weeks (5 = a new expiration every weekday, 1 = weekly only)",
      group: optionsGroup,
      align: "right",
      render: (file) => formatNumber(file.expiriesPerWeek, 1),
    },
    // No IBKR bars: an amber "none" under From, since a backtest needs them.
    { key: "spotFrom", header: "From", group: spotGroup, headerClassName: "data-table-column-gap", cellClassName: "font-mono text-nowrap data-table-column-gap", render: (file) => file.barsFirstDate ?? <span className="iorio-note-amber">none</span> },
    {
      key: "spotDays",
      header: "Days",
      headerTitle: "Days with spot prices",
      group: spotGroup,
      align: "right",
      render: (file) => (file.barsLastDate ? <TooltipSpan text={`Last day: ${file.barsLastDate}`}>{formatNumber(file.barsCount)}</TooltipSpan> : formatNumber(file.barsCount)),
    },
    {
      key: "issues",
      header: "Issues",
      headerTitle: "Days with a gap in the option data that can change a backtest: nothing stored yet, stored with a part or an expiration within 45 days missing, or not retrievable. Expirations further out are listed but not counted. Point at the count for the list.",
      align: "right",
      render: (file) =>
        file.issueDays > 0 ? (
          <TooltipSpan text={describeDataFileIssues(file)} multiline className="iorio-note-amber dotted-underline-label">
            {formatNumber(file.issueDays)}
          </TooltipSpan>
        ) : file.issues.farExpiries.length > 0 ? (
          <TooltipSpan text={describeDataFileIssues(file)} multiline className="text-secondary dotted-underline-label">
            0
          </TooltipSpan>
        ) : (
          <span className="text-secondary">0</span>
        ),
    },
    {
      key: "splits",
      header: "Splits",
      headerClassName: "data-table-column-gap",
      headerTitle: "Stock splits found in the file's period; point at the count for each one (new shares per old share, from the first day on the new scale). IBKR's bars are split-adjusted and the option prices are as traded, so a session puts each day's prices on that day's traded scale.",
      align: "right",
      cellClassName: "text-nowrap data-table-column-gap",
      render: (file) =>
        !file.detectedSplits ? (
          <TooltipSpan text={splitsNotAnalysedExplanation} className="text-secondary">
            {describeDetectedSplits(null)}
          </TooltipSpan>
        ) : file.detectedSplits.length === 0 ? (
          <span className="text-secondary">0</span>
        ) : (
          <TooltipSpan text={describeDetectedSplits(file.detectedSplits)} multiline className="dotted-underline-label">
            {formatNumber(file.detectedSplits.length)}
          </TooltipSpan>
        ),
    },
    { key: "size", header: "Size", align: "right", headerClassName: "data-table-column-gap", cellClassName: "text-nowrap data-table-column-gap", render: (file) => formatFileSize(file.sizeBytes) },
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
              className={`btn btn-icon ${status === "stopped" ? "btn-outline-primary" : "btn-outline-secondary"} backtest-icon-button`}
              disabled={downloadRequestRunning}
              title={status === "stopped" ? `Resume ${file.symbol}'s download` : `Update ${file.symbol}: download the missing days`}
              aria-label={status === "stopped" ? `Resume ${file.symbol}'s download` : `Update ${file.symbol}`}
              onClick={() => {
                setRowError(null);
                if (status === "stopped" && job) void resumeDownload(job);
                else void requestDownload(file.symbol, file.firstDate ?? undefined, "row");
              }}
            >
              {busy ? <Spinner size="sm" /> : status === "stopped" ? <IconPlayerPlay size={16} aria-hidden="true" /> : <IconRefresh size={16} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="btn btn-icon btn-outline-danger backtest-icon-button"
              disabled={downloadRequestRunning || deleteRunning}
              title={`Delete ${file.symbol}'s data file`}
              aria-label={`Delete ${file.symbol}'s data file`}
              onClick={() => setFileToDelete(file)}
            >
              <IconTrash size={16} aria-hidden="true" />
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

  const outOfDate = analyses?.outOfDate ?? [];
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
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <BacktestCardTitle title="Data files" />
        {analyses === null ? (
          <span className="d-inline-flex align-items-center gap-1 text-secondary" style={{ fontSize: "0.8125rem" }}>
            <Spinner size="sm" />
            Loading the analyses
          </span>
        ) : (
          outOfDate.length > 0 && (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className="text-secondary" style={{ fontSize: "0.8125rem" }}>
                {outOfDate.length === 1 ? "1 analysis is" : `${formatNumber(outOfDate.length)} analyses are`} out of date after the lab save of {analysedAt(analyses.labSavedAt)}
              </span>
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={rerunRunning} title={outOfDate.join(", ")} onClick={() => void rerunOutOfDate()}>
                {rerunRunning && <Spinner size="sm" />}
                Re-run out of date ({formatNumber(outOfDate.length)})
              </button>
            </div>
          )
        )}
      </div>
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
      {suitabilitySymbol && (
        <TickerSuitabilityModal
          symbol={suitabilitySymbol}
          suitability={suitabilityBySymbol[suitabilitySymbol] ?? null}
          ruleVerdict={ruleVerdictOf(analyses?.bySymbol[suitabilitySymbol])}
          onSaved={onFilesChanged}
          onClose={() => setSuitabilitySymbol(null)}
        />
      )}
      {analysedSymbol && (
        <TickerAnalysisModal
          symbol={analysedSymbol}
          onClose={() => {
            setAnalysedSymbol(null);
            void loadAnalyses();
          }}
          onSuitabilitySaved={onFilesChanged}
        />
      )}
    </div>
  );
}
