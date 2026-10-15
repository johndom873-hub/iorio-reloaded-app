import { useEffect } from "react";
import { IconCheck } from "@tabler/icons-react";
import { analysisFixedRulesText, describeAllAnalysisValues, type AnalysisPanelKey, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonthYear, formatNumber } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";

// "Backtest these values?" (mockup approved 2026-10-15): a confirmation stacked over the Analyse window, so it closes
// only through Cancel or the X (never ESC or the backdrop), and its backdrop sits at 1100.

interface AnalysisBacktestConfirmProps {
  symbol: string;
  values: AnalysisPanelValues;
  changed: readonly AnalysisPanelKey[];
  ruleShock: number;
  name: string;
  firstDate: string;
  lastDate: string;
  tradingDays: number;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
}

export function AnalysisBacktestConfirm({ symbol, values, changed, ruleShock, name, firstDate, lastDate, tradingDays, starting, error, onStart, onCancel }: AnalysisBacktestConfirmProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const parts = describeAllAnalysisValues(values, changed, ruleShock);
  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1100, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div className="modal show d-block" style={{ zIndex: 1100 }} role="dialog" aria-modal="true" aria-labelledby="analysis-backtest-confirm-title">
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="analysis-eyebrow">New backtest</div>
                <h5 className="modal-title" id="analysis-backtest-confirm-title">
                  Backtest these values?
                </h5>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onCancel} disabled={starting} />
            </div>
            <div className="modal-body d-flex flex-column gap-3">
              <dl className="analysis-kv">
                <dt>Ticker</dt>
                <dd>
                  <span className="analysis-sans">{symbol} alone</span>
                </dd>
                <dt>Days</dt>
                <dd>
                  <span className="analysis-sans">
                    All stored: {formatDayMonthYear(firstDate)} → {formatDayMonthYear(lastDate)}
                  </span>
                  <span className="analysis-sub">{formatNumber(tradingDays)} trading days</span>
                </dd>
                <dt>Starting capital</dt>
                <dd>
                  {formatCurrency(values.potDollars, 0)}
                  <span className="analysis-sub">the pot</span>
                </dd>
                <dt>Name</dt>
                <dd>
                  <span className="analysis-sans">{name}</span>
                </dd>
              </dl>
              <div>
                <h4 className="subheader mb-1">Settings</h4>
                <p className="mb-0" style={{ fontSize: "0.8125rem" }}>
                  {parts.map((part, index) => (
                    <span key={part.text}>
                      {index > 0 && " · "}
                      {part.changed ? <b>{part.text}</b> : part.text}
                    </span>
                  ))}
                  .{changed.length > 0 ? ` Changed from ${symbol}'s settings in bold.` : ""}
                </p>
                <p className="text-secondary mb-0 mt-1" style={{ fontSize: "0.75rem" }}>
                  Fixed rules: {analysisFixedRulesText}.
                </p>
              </div>
              <p className="text-secondary mb-0" style={{ fontSize: "0.75rem" }}>
                It runs as a background job like other backtests and changes no settings.
              </p>
              {error && <div className="alert alert-danger mb-0">{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={starting}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={onStart} disabled={starting}>
                {starting ? <Spinner size="sm" /> : <IconCheck size={16} aria-hidden="true" />}
                Start
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
