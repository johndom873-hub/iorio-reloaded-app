import { useState } from "react";
import type { AnalysisBacktestFigures, AnalysisFigures, AnalysisLabValues } from "../../../api/backtestAnalysis";
import { parseDollarAmountText } from "../../../lib/backtestPresentation";
import { formatCurrency, formatDayMonthBesideYear, formatDayMonthYear, formatDelta, formatNumber, formatOptionContractLabel, formatPercentage, formatPotDollars } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";
import { AnalysisCard } from "./analysisBits";

// Can v4 trade it, Size and If v4 started today (Vol Farmer v4, mockup approved 2026-11-01): F1, F5 and the option
// activity; F2, F3, F4 and the band today with the trial (another starting value only); F10's replay of the last 10:00 look.

type Effective = AnalysisLabValues["effective"];

const roundToThousand = (dollars: number | null) => (dollars === null ? null : Math.round(dollars / 1000) * 1000);
const lotsLabel = (lots: number) => `${formatNumber(lots)} ${lots === 1 ? "lot" : "lots"}`;

export function AnalysisCanTradeCard({ symbol, figures, backtest, effective }: { symbol: string; figures: AnalysisFigures; backtest: AnalysisBacktestFigures | null; effective: Effective }) {
  const weeks = figures.expiryWeeks;
  const years = Object.entries(weeks.byYear);
  const everyYearFull = years.length > 0 && years.every(([, year]) => year.wholeWeeks === 0 || year.weeksWithExpiryDay === year.wholeWeeks);
  const fullYears = years.filter(([, year]) => year.wholeWeeks > 0 && year.weeksWithExpiryDay === year.wholeWeeks).length;
  const perWeek = weeks.wholeWeeks === 0 ? null : weeks.expiryDays / weeks.wholeWeeks;
  const lastYear = years.at(-1);
  const lastYearPerWeek = lastYear && lastYear[1].wholeWeeks > 0 ? lastYear[1].expiryDays / lastYear[1].wholeWeeks : null;
  const activity = figures.optionActivity?.volume ?? null;
  const v4 = effective.v4;
  return (
    <AnalysisCard title="Can v4 trade it" description="The option data at the 10:00 quote">
      <div className="card-body">
        <dl className="analysis-stat-list analysis-stat-grid-2">
          <div>
            <dt>Weeks with an expiry day</dt>
            <dd>
              {formatNumber(weeks.weeksWithExpiryDay)} of {formatNumber(weeks.wholeWeeks)}{" "}
              <span className="analysis-plain">· whole weeks, {everyYearFull && years.length > 0 ? `every year ${years[0]![0]}–${lastYear![0]}` : `every week in ${fullYears} of ${years.length} years`}</span>
            </dd>
          </div>
          <div>
            <dt>Expiry days</dt>
            <dd>
              {formatNumber(weeks.expiryDays)}{" "}
              {perWeek !== null && (
                <span className="analysis-plain">
                  · about {formatNumber(perWeek, 1)} a week{lastYear && lastYearPerWeek !== null && Math.abs(lastYearPerWeek - perWeek) >= 0.2 ? `, ${formatNumber(lastYearPerWeek, 1)} a week in ${lastYear[0]}` : ""}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Expiry days with a Call v4 could sell</dt>
            <dd>
              {formatNumber(figures.sameDayCalls.daysWithCall)} of {formatNumber(figures.sameDayCalls.expiryDays)}{" "}
              <span className="analysis-plain">
                · same-day, above the price, |delta| {formatDelta(v4.callMinAbsDelta)}–{formatDelta(v4.callMaxAbsDelta)}, spread at most {formatNumber(v4.maxSpreadPctOfMid)}% of the mid
              </span>
            </dd>
          </div>
          <div>
            <dt>Options traded a day</dt>
            <dd>
              {activity ? formatNumber(activity.yearAveragePerDay) : "—"}{" "}
              {activity && (
                <span className="analysis-plain">
                  · the last {formatNumber(activity.yearSessions)} sessions; {formatNumber(activity.averagePerDay)} over the last {formatNumber(activity.sessions)}
                  {activity.callShare !== null ? ` · Calls ${formatPercentage(activity.callShare, 0)}` : ""}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Days with every 10:00 quote at zero</dt>
            <dd>{formatNumber(figures.dataQuality.daysWithEveryQuoteAtZero)}</dd>
          </div>
          <div>
            <dt>LEAPS</dt>
            <dd>
              {!backtest || backtest.leapsBought === 0 ? (
                <>
                  None bought <span className="analysis-plain">· v4 buys one only after a Put is assigned</span>
                </>
              ) : (
                <>
                  {formatNumber(backtest.leapsBought)} bought <span className="analysis-plain">· {formatCurrency(backtest.sources?.leaps?.pnlDollars, 0)} after costs, on {symbol}</span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </AnalysisCard>
  );
}

/** The band today in words: where the lots v4 can buy stand against the floor and the top. */
function describeBandToday(today: AnalysisFigures["today"]): string | null {
  const band = today.band;
  if (!band) return null;
  const shares = formatCurrency(today.sharesDollars, 0);
  const next = `${lotsLabel(today.lots + 1)}, ${formatCurrency(band.oneMoreLotDollars, 0)}`;
  if (today.sharesDollars < band.floorDollars) return `${shares}, under the ${formatCurrency(band.floorDollars, 0)} floor; ${next}, would ${band.oneMoreLotDollars > band.topDollars ? `pass the ${formatCurrency(band.topDollars, 0)} top` : "be inside it"}`;
  return `${shares}, inside the ${formatCurrency(band.floorDollars, 0)}–${formatCurrency(band.topDollars, 0)} band`;
}

interface AnalysisSizeCardProps {
  figures: AnalysisFigures;
  effective: Effective;
  /** Starts a trial at another starting account; null when the viewer can't run one. */
  onRunTrial: ((accountDollars: number) => void) | null;
  trialRunning: boolean;
  busy: boolean;
}

export function AnalysisSizeCard({ figures, effective, onRunTrial, trialRunning, busy }: AnalysisSizeCardProps) {
  const [text, setText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const size = figures.size;
  const account = formatCurrency(size.accountDollars, 0);
  const typed = parseDollarAmountText(text);
  const valid = typed > 0;
  const largest = size.largestPotByCallVolume;
  const band = describeBandToday(figures.today);
  return (
    <AnalysisCard title="Size" description="What pot fits, last 12 months">
      <div className="card-body d-flex flex-column gap-3">
        <dl className="analysis-stat-list analysis-stat-grid-2">
          <div>
            <dt>Smallest pot</dt>
            <dd>
              {formatCurrency(size.smallestPotDollars, 0)}{" "}
              {size.highestPriceAsTraded !== null && (
                <span className="analysis-plain">
                  · one lot at the year's highest 10:00 price, {formatCurrency(size.highestPriceAsTraded)}, ÷ {formatPercentage(effective.firstPositionShare, 0)}; with one ticker an account of {formatCurrency(size.smallestAccountDollars, 0)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Largest pot by Call volume</dt>
            <dd>
              {largest.potDollars === null ? "—" : largest.potDollars > 0 ? `about ${formatPotDollars(largest.potDollars)}` : "$0"}{" "}
              <span className="analysis-plain">
                · the lots the Calls' volume limit allows on 80% of the {formatNumber(largest.expiryDays)} expiry days
                {figures.sameDayCalls.lastTwelveMonths.daysWithCall < largest.expiryDays ? `; a Call v4 could sell on ${formatNumber(figures.sameDayCalls.lastTwelveMonths.daysWithCall)} of them` : ""}
              </span>
            </dd>
          </div>
          <div>
            <dt>Target reached at {account}</dt>
            <dd>
              {formatPercentage(size.targetReached.medianShareOfTarget, 0)}{" "}
              {size.targetReached.sharesDollarsLow !== null && (
                <span className="analysis-plain">
                  · median; whole lots of {formatCurrency(roundToThousand(size.targetReached.sharesDollarsLow), 0)} to {formatCurrency(roundToThousand(size.targetReached.sharesDollarsHigh), 0)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>The band at {account} today</dt>
            <dd>
              {lotsLabel(figures.today.lots)} {band && <span className="analysis-plain">· {band}</span>}
            </dd>
          </div>
        </dl>
        {onRunTrial && (
          <form
            className="d-flex flex-wrap align-items-end gap-2 border-top pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              setAttempted(true);
              if (valid) onRunTrial(typed);
            }}
          >
            <div>
              <label className="form-label" htmlFor="analysis-trial-account" style={{ fontSize: "0.8125rem" }}>
                Try another starting value
              </label>
              <input id="analysis-trial-account" className={`form-control font-monospace${attempted && !valid ? " is-invalid" : ""}`} type="text" inputMode="decimal" placeholder="$500,000" value={text} onChange={(event) => setText(event.target.value)} onBlur={() => valid && setText(formatCurrency(typed, 0))} style={{ width: "10rem" }} />
            </div>
            <button type="submit" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={busy || trialRunning}>
              {trialRunning && <Spinner size="sm" />}
              {trialRunning ? "Trial running" : "Run a trial"}
            </button>
            {attempted && !valid && <span className="text-danger w-100" style={{ fontSize: "0.75rem" }}>Type a dollar amount above zero.</span>}
            <span className="text-secondary w-100" style={{ fontSize: "0.75rem" }}>
              Runs the same backtest with this starting value only; the analysis stays as it is.
            </span>
          </form>
        )}
      </div>
    </AnalysisCard>
  );
}

export function AnalysisTodayCard({ symbol, figures }: { symbol: string; figures: AnalysisFigures }) {
  const today = figures.today;
  const call = today.call;
  const band = today.band;
  return (
    <AnalysisCard
      title="If v4 started today"
      description={`${formatDayMonthYear(today.date)}, ${today.isExpiryDay ? "an expiry day" : "not an expiry day"} · ${symbol} ${formatCurrency(today.priceAsTraded)} at 10:00 · a ${formatCurrency(today.accountDollars, 0)} account, so a ${formatCurrency(today.potDollars, 0)} pot`}
    >
      <div className="card-body">
        <dl className="analysis-stat-list analysis-stat-grid-3">
          <div>
            <dt>First position</dt>
            <dd>
              {today.lots === 0 ? (
                <>
                  None <span className="analysis-plain">· one lot costs more than the {formatCurrency(today.targetDollars, 0)} target</span>
                </>
              ) : (
                <>
                  {lotsLabel(today.lots)}: {formatNumber(today.lots * 100)} shares for {formatCurrency(today.sharesDollars)} <span className="analysis-plain">· {formatPercentage(today.shareOfTarget, 0)} of the {formatCurrency(today.targetDollars, 0)} target</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>The Call it sells</dt>
            <dd>
              {call ? (
                <>
                  {formatOptionContractLabel({ symbol, strike: call.strike, right: "C", expiry: today.date, dte: 0 })} at {formatCurrency(call.fillPrice)}{" "}
                  <span className="analysis-plain">
                    · |delta| {formatDelta(Math.abs(call.delta))} · IV {formatPercentage(call.impliedVolatility)} · {formatPercentage(call.premiumYield)} a year over 1 session
                  </span>
                </>
              ) : (
                <>
                  None <span className="analysis-plain">· {today.isExpiryDay ? "no Call expiring today passes v4's rules" : "no expiry today"}</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>First break-even (B-E1)</dt>
            <dd>{formatCurrency(today.firstBreakEven)}</dd>
          </div>
          <div>
            <dt>The band</dt>
            <dd>
              {band ? (
                <>
                  Shares {formatCurrency(band.floorDollars, 0)} to {formatCurrency(band.topDollars, 0)} <span className="analysis-plain">· {describeBandToday(today)}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Puts</dt>
            <dd>
              {today.putsNow ? "Now" : "Not now"} <span className="analysis-plain">· they start when the best Call pays under {formatNumber(today.putsStartCallYieldPct, 1)}% a year</span>
            </dd>
          </div>
          <div>
            <dt>Then a Put at or below</dt>
            <dd>
              {formatCurrency(today.putStrikeCap)} {today.step && <span className="analysis-plain">· B-E1 less a Step of {formatNumber(today.step.stepPct, 1)}%: IV {formatPercentage(today.step.impliedVolatility)} on {formatDayMonthBesideYear(today.step.ivDate, today.date)}</span>}
            </dd>
          </div>
        </dl>
      </div>
    </AnalysisCard>
  );
}
