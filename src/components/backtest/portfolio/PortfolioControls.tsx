import { useEffect, useState } from "react";
import type { PortfolioHorizonYears, PortfolioProjection } from "../../../api/backtestPortfolio";
import { formatDateTime, formatDayMonthYear, formatNumber } from "../../../lib/formatters";
import { projectionPathChoices } from "../../../lib/portfolioSimulatorPresentation";
import { BacktestSegmentedSwitch } from "../backtestBits";
import { Spinner } from "../../Spinner";

export interface ProjectionRunState {
  running: boolean;
  /** What is running: the book, the compared portfolio or the suggestions. */
  label: string | null;
  done: number;
  total: number;
  error: string | null;
}

interface PortfolioControlsProps {
  accountDollars: number;
  horizonYears: PortfolioHorizonYears;
  pathCount: number;
  excessAllowancePct: number | null;
  hasTickers: boolean;
  run: ProjectionRunState;
  projection: PortfolioProjection | null;
  onAccountDollars: (dollars: number) => void;
  onHorizonYears: (years: PortfolioHorizonYears) => void;
  onPathCount: (count: number) => void;
  onRun: () => void;
  onStop: () => void;
}

/** The account (typed with thousands separators, applied on leaving the box or Enter), the view settings and the projection's run. */
export function PortfolioControls({ accountDollars, horizonYears, pathCount, excessAllowancePct, hasTickers, run, projection, onAccountDollars, onHorizonYears, onPathCount, onRun, onStop }: PortfolioControlsProps) {
  const [accountText, setAccountText] = useState(formatNumber(accountDollars));
  useEffect(() => setAccountText(formatNumber(accountDollars)), [accountDollars]);
  const typedAccount = Number(accountText.replace(/[,\s$]/g, ""));
  const accountInvalid = !Number.isFinite(typedAccount) || typedAccount <= 0;
  const applyAccount = () => {
    if (!accountInvalid && typedAccount !== accountDollars) onAccountDollars(typedAccount);
    else setAccountText(formatNumber(accountDollars));
  };
  const percent = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;

  return (
    <div className="card">
      <div className="card-body">
        <div className="portfolio-controls">
          <div className="portfolio-bar-control">
            <label htmlFor="portfolio-account" className="portfolio-bar-label">
              Account
            </label>
            <div className="input-group portfolio-account-input">
              <span className="input-group-text">$</span>
              <input
                id="portfolio-account"
                className={`form-control text-end ${accountInvalid ? "is-invalid" : ""}`}
                inputMode="numeric"
                value={accountText}
                onChange={(event) => setAccountText(event.target.value)}
                onBlur={applyAccount}
                onKeyDown={(event) => event.key === "Enter" && applyAccount()}
              />
            </div>
          </div>
          <div className="portfolio-bar-control">
            <span className="portfolio-bar-label">Horizon</span>
            <BacktestSegmentedSwitch<"3" | "5">
              ariaLabel="Horizon"
              options={[
                { value: "3", label: "3 years" },
                { value: "5", label: "5 years" },
              ]}
              value={String(horizonYears) as "3" | "5"}
              onChange={(value) => onHorizonYears(Number(value) as PortfolioHorizonYears)}
            />
          </div>
          <div className="portfolio-bar-control">
            <label htmlFor="portfolio-paths" className="portfolio-bar-label">
              Paths
            </label>
            <select id="portfolio-paths" className="form-select" value={pathCount} onChange={(event) => onPathCount(Number(event.target.value))}>
              {projectionPathChoices.map((count) => (
                <option key={count} value={count}>
                  {formatNumber(count)}
                </option>
              ))}
            </select>
          </div>
          {excessAllowancePct !== null && (
            <div className="portfolio-bar-control">
              <span className="portfolio-bar-label">Allowance</span>
              <span>
                {excessAllowancePct}% <span className="text-secondary">(lab settings)</span>
              </span>
            </div>
          )}
          <span className="portfolio-bar-spacer" />
          {run.running ? (
            <button type="button" className="btn btn-outline-secondary" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!hasTickers || accountInvalid} onClick={onRun}>
              Run projection
            </button>
          )}
        </div>
        <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
          Runs both drifts on the same {formatNumber(pathCount)} paths: Neutral (each stock earns the T-bill + β × the market's long-run excess return) and As it happened (each stock's own past moves).
        </div>
        {run.running && (
          <div className="d-flex flex-column gap-1 mt-3">
            <div className="progress" role="progressbar" aria-label="Projection progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
              <Spinner size="sm" />
              {run.label}
              {run.total > 0 ? ` · ${formatNumber(run.done)} of ${formatNumber(run.total)}` : ""}
            </div>
          </div>
        )}
        {run.error && <div className="alert alert-danger mt-3 mb-0">{run.error}</div>}
        {projection && (
          <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
            {formatNumber(projection.summary.pathCount)} paths of 250-day blocks · history {formatDayMonthYear(projection.history.from)} – {formatDayMonthYear(projection.history.to)} · T-bill now {projection.riskFree.nowPct.toFixed(2)}% · data to{" "}
            {formatDayMonthYear(projection.asOf)}
            {projection.savedAt ? ` · saved ${formatDateTime(projection.savedAt)}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
