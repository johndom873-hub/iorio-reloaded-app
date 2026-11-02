import type { BacktestDetectedSplit } from "../../../api/backtest";
import type { AnalysisBacktestFigures, AnalysisFigures, SuitabilityWindow } from "../../../api/backtestAnalysis";
import { describeFailedChecks, expiryDaysPerWeek, formatCagrPoints, formatSignedCagrPoints, highestLotPriceForPot } from "../../../lib/analysisPresentation";
import { describeSplitRatio } from "../../../lib/backtestPresentation";
import { formatCurrency, formatDayMonth, formatDayMonthBesideYear, formatDayMonthYear, formatNumber, formatPercentage, formatPotDollars, formatRatio, joinWithAnd } from "../../../lib/formatters";
import { AnalysisCard } from "./analysisBits";

// The Analyse window's verdict (Vol Farmer v4, mockup approved 2026-11-01): the band at the top, with the rule's verdict
// in words (Claude's summary comes later, Marcelo 2026-11-01), v4 against buy and hold, and how it earns; and the rule's
// four checks over the analysis backtest's last 12, 6 and 3 months.

const addOneDay = (dateIso: string) => new Date(Date.parse(`${dateIso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function CheckIcon({ passes }: { passes: boolean }) {
  return passes ? (
    <svg width="14" height="14" viewBox="0 0 24 24" className="analysis-check-icon is-pass" role="img" aria-label="Passes">
      <path d="M5 12l5 5l10 -10" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" className="analysis-check-icon is-fail" role="img" aria-label="Fails">
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function VerdictBadge({ suits, children }: { suits: boolean; children: React.ReactNode }) {
  return <span className={`badge analysis-verdict-badge ${suits ? "is-good" : "is-poor"}`}>{children}</span>;
}

/** The years v4's return beat the stock held's. */
function yearsBeatingHold(backtest: AnalysisBacktestFigures): string[] {
  return backtest.years.filter((row) => row.holdReturn !== null && row.v4Return > row.holdReturn).map((row) => row.year);
}

interface AnalysisVerdictBandProps {
  symbol: string;
  figures: AnalysisFigures;
  backtest: AnalysisBacktestFigures;
  /** The pot the analysis starts with and the first position's share of it (the values it ran with). */
  potDollars: number;
  firstPositionShare: number;
  /** Opens the Suitability flag; null when the viewer can't set it. */
  onSetFlag: (() => void) | null;
}

export function AnalysisVerdictBand({ symbol, figures, backtest, potDollars, firstPositionShare, onSetFlag }: AnalysisVerdictBandProps) {
  const { verdict } = backtest.rule;
  const lastTwelveMonths = backtest.rule.windows.find((window) => window.months === 12) ?? null;
  const expiriesAWeek = lastTwelveMonths ? expiryDaysPerWeek(lastTwelveMonths) : null;
  const metrics = backtest.metrics;
  const hold = backtest.buyAndHoldMetrics;
  const spy = backtest.spyMetrics;
  const calls = backtest.sources?.coveredCalls ?? null;
  const all = backtest.allYears;
  const beat = yearsBeatingHold(backtest);
  const largest = figures.size.largestPotByCallVolume.potDollars;
  const smallest = figures.size.smallestPotDollars;
  const failed = describeFailedChecks(verdict);
  // "37.1 of the 49.7 points" when the Calls' part sits inside a positive CAGR; else the part alone, with the shares' beside it.
  const callsPartInside = calls !== null && calls.cagrPart !== null && metrics !== null && metrics.cagr > 0 && calls.cagrPart <= metrics.cagr;
  const sharesPart = backtest.sources?.shares?.cagrPart ?? null;
  const rows: { label: string; className: string; strong: boolean; metrics: typeof metrics; calmar: number | null }[] = [
    { label: "VF v4", className: "is-account", strong: true, metrics, calmar: backtest.excessCalmar.v4 },
    { label: `${symbol}, held`, className: "is-hold", strong: false, metrics: hold, calmar: backtest.excessCalmar.hold },
    { label: "SPY, held", className: "is-spy", strong: false, metrics: spy, calmar: backtest.excessCalmar.spy },
  ];
  return (
    <div className="card">
      <div className="card-body analysis-band-grid">
        <section>
          <div className="analysis-eyebrow mb-2">The verdict</div>
          <div className="analysis-verdict">
            <VerdictBadge suits={verdict.suits}>{verdict.suits ? "Suits v4" : "Doesn't suit v4"}</VerdictBadge>
            <p>
              Suggested flag <b>{verdict.suits ? "Suitable" : "Unsuitable"}</b>
              {verdict.suits && smallest !== null && (
                <>
                  {" "}
                  · pot <b>{formatPotDollars(smallest)}</b> {largest !== null && largest > smallest ? <>to <b>about {formatPotDollars(largest)}</b></> : "or more"}
                </>
              )}
            </p>
            {onSetFlag && (
              <button type="button" className="btn btn-outline-primary" onClick={onSetFlag}>
                Set flag to {verdict.suits ? "Suitable" : "Unsuitable"}
              </button>
            )}
          </div>
          <p className="analysis-verdict-facts">
            {figures.today.priceAsTraded !== null && (
              <>
                {symbol} <b>{formatCurrency(figures.today.priceAsTraded)}</b> at 10:00, {formatDayMonth(figures.today.date)} ·{" "}
              </>
            )}
            smallest pot <b>{formatCurrency(smallest, 0)}</b> · the {formatCurrency(potDollars, 0)} pot holds a lot up to <b>{formatCurrency(highestLotPriceForPot(potDollars, firstPositionShare))}</b> a share
            {lastTwelveMonths && expiriesAWeek !== null && (
              <>
                {" "}
                · <b>{formatNumber(expiriesAWeek, 1, 1)}</b> expiries a week ({formatNumber(lastTwelveMonths.expiryDaysSold.expiryDays)} in the last 12 months)
              </>
            )}
          </p>
          <div className="analysis-summary-text">
            <p>
              Vol Farmer v4 made {formatPercentage(metrics?.cagr)} a year on {symbol} from {formatDayMonthYear(backtest.startDate)} to {formatDayMonthYear(backtest.endDate)}, against {formatPercentage(hold?.cagr)} for holding the shares, with a Max drawdown of {formatPercentage(metrics?.maxDrawdown)} against {formatPercentage(hold?.maxDrawdown)}.
              {calls && calls.cagrPart !== null && metrics && (callsPartInside ? <> The Calls made {formatCagrPoints(calls.cagrPart)} of the {formatCagrPoints(metrics.cagr)} points.</> : <> The Calls made {formatSignedCagrPoints(calls.cagrPart)} points of it, the shares {formatSignedCagrPoints(sharesPart)}.</>)} It sold a Call on {formatNumber(all.expiryDaysSold)} of {formatNumber(all.expiryDays)} expiry days, at a median {formatPercentage(all.callYieldMedian)} a year.
            </p>
            <p>{verdict.suits ? "It passes all four checks over the last 12, 6 and 3 months." : `It fails the rule: ${failed}.`}</p>
          </div>
        </section>
        <section>
          <div className="analysis-eyebrow mb-2">
            Against buy and hold · {formatDayMonthYear(backtest.startDate)} → {formatDayMonthYear(backtest.endDate)}
          </div>
          <table className="table table-sm table-vcenter mb-0 analysis-bordered-table">
            <thead className="table-light">
              <tr>
                <th />
                <th className="text-end">CAGR</th>
                <th className="text-end">Max drawdown</th>
                <th className="text-end">Excess Calmar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className={row.strong ? "fw-semibold" : "fw-normal"}>
                    <svg width="12" height="4" className="me-2" aria-hidden="true">
                      <line x1="0" x2="12" y1="2" y2="2" className={`analysis-svg-line ${row.className}`} />
                    </svg>
                    {row.label}
                  </th>
                  <td className="text-end font-monospace">{formatPercentage(row.metrics?.cagr)}</td>
                  <td className="text-end font-monospace">{formatPercentage(row.metrics?.maxDrawdown)}</td>
                  <td className={`text-end font-monospace${row.strong && row.calmar !== null && backtest.excessCalmar.hold !== null ? (row.calmar >= backtest.excessCalmar.hold ? " analysis-cell-good" : " analysis-cell-poor") : ""}`}>{formatRatio(row.calmar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="analysis-stat-list mt-3">
            <div>
              <dt>{formatCurrency(backtest.startingValue, 0)} became</dt>
              <dd>
                {formatCurrency(metrics?.endValue, 0)} <span className="analysis-plain">· {symbol} held {formatCurrency(hold?.endValue, 0)} · SPY {formatCurrency(spy?.endValue, 0)}</span>
              </dd>
            </div>
            {backtest.maxDrawdownDates && (
              <div>
                <dt>Max drawdown</dt>
                <dd>
                  {formatDayMonthYear(backtest.maxDrawdownDates.peak)} → {formatDayMonthYear(backtest.maxDrawdownDates.trough)} <span className="analysis-plain">· {backtest.maxDrawdownDates.back ? `back on ${formatDayMonthYear(backtest.maxDrawdownDates.back)}` : "not back yet"}</span>
                </dd>
              </div>
            )}
            <div>
              <dt>Beat holding {symbol}</dt>
              <dd>
                {beat.length} of {backtest.years.length} years {beat.length > 0 && <span className="analysis-plain">· {beat.join(", ")}</span>}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <div className="analysis-eyebrow mb-2">How it earns</div>
          <dl className="analysis-stat-list">
            <div>
              <dt>Covered Calls, median yield at sale</dt>
              <dd>
                {formatPercentage(all.callYieldMedian)} a year <span className="analysis-plain">· {formatNumber(all.callsSold)} sold</span>
              </dd>
            </div>
            <div>
              <dt>IV of the Calls sold</dt>
              <dd>
                {formatPercentage(all.callImpliedVolatility)} <span className="analysis-plain">· by contracts; IBKR's 30-day IV a median {formatPercentage(figures.stockProfile.ivRange.median)}</span>
              </dd>
            </div>
            {calls && metrics && (
              <div>
                <dt>Calls' part of the CAGR</dt>
                <dd>
                  {calls.cagrPart === null ? "—" : callsPartInside ? `${formatCagrPoints(calls.cagrPart)} of the ${formatCagrPoints(metrics.cagr)} points` : `${formatCagrPoints(calls.cagrPart)} points`}{" "}
                  <span className="analysis-plain">
                    · shares {formatCagrPoints(sharesPart)} · interest {formatCagrPoints(backtest.interest?.cagrPart)}
                  </span>
                </dd>
              </div>
            )}
            <div>
              <dt>Expiry days with a Call sold</dt>
              <dd>
                {formatNumber(all.expiryDaysSold)} of {formatNumber(all.expiryDays)}{" "}
                <span className="analysis-plain">
                  · an expiry in {formatNumber(all.weeksWithExpiryDay)} of {formatNumber(all.wholeWeeks)} whole weeks
                </span>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

interface RuleCell {
  text: string;
  detail: string;
  passes: boolean;
}

function ruleCellsOf(windows: readonly SuitabilityWindow[], startingPotDollars: number, splits: readonly BacktestDetectedSplit[]): { label: string; how: string; threshold: string; cells: RuleCell[] }[] {
  const notCovered: RuleCell = { text: "not covered", detail: "the backtest starts later", passes: false };
  // A lot's price is as traded, so one from before a split says so.
  const lotDetail = (window: SuitabilityWindow, index: number) => {
    const { lotFits } = window;
    if (lotFits.date === null || lotFits.lotDollars === null || lotFits.priceAsTraded === null) return "no 10:00 price";
    if (index > 0 && windows[index - 1]!.lotFits.date === lotFits.date) return "the same day";
    const splitAfter = splits.find((split) => split.firstDayAfter > lotFits.date! && split.firstDayAfter <= window.endDate);
    return `${formatCurrency(lotFits.lotDollars)} at ${formatCurrency(lotFits.priceAsTraded)}, ${formatDayMonthBesideYear(lotFits.date, window.endDate)}${splitAfter ? `, before the ${describeSplitRatio(splitAfter.ratio)} split` : ""}`;
  };
  return [
    {
      label: "Options' income",
      how: "the Calls' and Puts' P&L a year ÷ the account",
      threshold: "at least 15% a year",
      cells: windows.map((window) => (!window.covered ? notCovered : { text: formatPercentage(window.optionsIncome.yearlyShare), detail: `${formatCurrency(window.optionsIncome.pnlDollars, 0)} on ${formatCurrency(window.optionsIncome.accountAtStartDollars, 0)}`, passes: window.optionsIncome.passes })),
    },
    {
      label: "Expiry days with a Call sold",
      how: "of the days an expiry ends at the close",
      threshold: "at least 70%",
      cells: windows.map((window) => (!window.covered ? notCovered : { text: `${window.expiryDaysSold.daysSold} of ${window.expiryDaysSold.expiryDays}`, detail: formatPercentage(window.expiryDaysSold.share, 0), passes: window.expiryDaysSold.passes })),
    },
    {
      label: "Weeks with an expiry day",
      how: "whole weeks, Monday to Sunday",
      threshold: "at least 90%",
      cells: windows.map((window) => (!window.covered ? notCovered : { text: `${window.weeksWithExpiry.weeksWithExpiryDay} of ${window.weeksWithExpiry.wholeWeeks}`, detail: formatPercentage(window.weeksWithExpiry.share, 0), passes: window.weeksWithExpiry.passes })),
    },
    {
      label: "A lot fits the pot",
      how: `its cost ÷ 80% of the ${formatCurrency(startingPotDollars, 0)} pot`,
      threshold: "at most 100%",
      cells: windows.map((window, index) => (!window.covered ? notCovered : { text: formatPercentage(window.lotFits.shareOfTarget), detail: lotDetail(window, index), passes: window.lotFits.passes })),
    },
  ];
}

export function AnalysisRuleCard({ backtest, splits }: { backtest: AnalysisBacktestFigures; splits: readonly BacktestDetectedSplit[] }) {
  const { windows, verdict } = backtest.rule;
  const rows = ruleCellsOf(windows, backtest.startingPotDollars, splits);
  const passing = rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.passes).length, 0);
  const total = rows.length * windows.length;
  return (
    <AnalysisCard
      title="Does it suit v4"
      description="The analysis backtest's last 12, 6 and 3 months. Suitable when all four checks pass in all three."
      actions={
        <VerdictBadge suits={verdict.suits}>
          {verdict.suits ? "Suitable" : "Doesn't suit"} · {passing} of {total} pass
        </VerdictBadge>
      }
      footer={
        <p className="mb-0">
          Options' income = the Calls' and Puts' P&amp;L in the window, after commissions (one still open at the end at its last mark) ÷ the account at its start × 365 ÷ its days. Expiry days: days whose 10:00 quotes list a Call expiring at that day's close. Whole weeks only, Monday to Sunday. A lot: 100 shares at the window's highest 10:00 price plus $0.50 commission, against 80% of the {formatCurrency(backtest.startingPotDollars, 0)} pot this analysis starts with.
        </p>
      }
    >
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Check</th>
              <th>Passes at</th>
              {windows.map((window) => (
                <th key={window.months} className="text-end">
                  Last {window.months} months <span className="analysis-plain">from {formatDayMonthYear(addOneDay(window.startDate))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="fw-semibold">
                  {row.label}
                  <div className="analysis-plain fw-normal" style={{ fontSize: "0.75rem" }}>
                    {row.how}
                  </div>
                </th>
                <td className="text-secondary">{row.threshold}</td>
                {row.cells.map((cell, index) => (
                  <td key={index} className="text-end font-monospace">
                    <CheckIcon passes={cell.passes} />
                    {cell.text}
                    <div className="analysis-plain" style={{ fontSize: "0.75rem" }}>
                      {cell.detail}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verdict.uncoveredWindows.length > 0 && (
        <div className="card-body pt-2">
          <p className="mb-0 text-secondary" style={{ fontSize: "0.8125rem" }}>
            The backtest doesn't cover the last {joinWithAnd(verdict.uncoveredWindows.map((months) => `${months} months`))} in full, so {verdict.uncoveredWindows.length === 1 ? "that window fails" : "those windows fail"}.
          </p>
        </div>
      )}
    </AnalysisCard>
  );
}
