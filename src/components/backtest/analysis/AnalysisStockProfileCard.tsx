import type { BacktestDetectedSplit, BacktestTickerProfile } from "../../../api/backtest";
import type { AnalysisBacktestFigures, AnalysisFileFigures } from "../../../api/backtestAnalysis";
import { tickerCategoryLabels } from "../../../lib/analysisPresentation";
import { describeSplitRatio } from "../../../lib/backtestPresentation";
import { formatCurrency, formatDayMonthBesideYear, formatDayMonthYear, formatNumber, formatOrdinal, formatPercentage, formatRatio, formatSignedNumber } from "../../../lib/formatters";
import { AnalysisCard } from "./analysisBits";

// The stock profile (F7, F9, F12–F16 and the 10-15 sheet's price CAGR and variance ratio; mockup approved 2026-11-01): what
// the stock does, from every daily bar in the file, in eight short sections.

/** The variance ratio's reading, from the API's label (1 ± 2 standard errors). */
const varianceRatioReadings = {
  trending: "variance ratio, above 1 by more than 2 standard errors: moves tend to run on",
  "range-bound": "variance ratio, below 1 by more than 2 standard errors: moves tend to reverse",
  neither: "variance ratio, within 2 standard errors of 1: no tilt either way",
} as const;

/** Weekly skew read as even within ±0.5, else which tail is longer. */
function describeSkew(skew: number | null): string {
  if (skew === null) return "";
  if (Math.abs(skew) < 0.5) return "about even";
  return skew < 0 ? "the falls run larger than the rises" : "the rises run larger than the falls";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="analysis-eyebrow mb-2">{title}</h4>
      <dl className="analysis-stat-list">{children}</dl>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value} {note && <span className="analysis-plain">· {note}</span>}
      </dd>
    </div>
  );
}

interface AnalysisStockProfileCardProps {
  figures: AnalysisFileFigures;
  backtest: AnalysisBacktestFigures | null;
  profile: BacktestTickerProfile | null;
  splits: readonly BacktestDetectedSplit[] | null;
}

export function AnalysisStockProfileCard({ figures, backtest, profile, splits }: AnalysisStockProfileCardProps) {
  const stock = figures.stockProfile;
  const firstBar = figures.bars[0]?.[0] ?? null;
  const lastBar = figures.bars.at(-1)?.[0] ?? null;
  const sinceBars = firstBar ? `since ${firstBar.slice(0, 4)}` : "";
  const ivFirst = stock.ivRange.firstDate;
  const premium = figures.volatility.impliedVersusRealised.all;
  const trendDays = stock.trend.days;
  const share = (count: number) => (trendDays === 0 ? "—" : formatPercentage(count / trendDays, 0));
  const all = figures.profile.all;
  const backtestYear = figures.expiryWeeks.backtestStartDate.slice(0, 4);
  const activity = figures.optionActivity?.volume ?? null;
  const weeks = figures.expiryWeeks;
  const optionYear = figures.optionFirstDate.slice(0, 4);
  const splitsInOptions = (splits ?? []).filter((split) => split.firstDayAfter >= figures.optionFirstDate);
  const earnings = figures.earnings;
  return (
    <AnalysisCard title="Stock profile" description={`From every daily bar in the file, ${firstBar ? `since ${formatDayMonthYear(firstBar)}` : ""}${ivFirst ? `; implied volatility from ${formatDayMonthYear(ivFirst)}` : ""}`}>
      <div className="card-body analysis-profile-grid">
        <Section title="Volatility">
          <Stat
            label="Implied volatility now"
            value={formatPercentage(stock.ivNow?.impliedVolatility)}
            note={stock.ivNow && lastBar ? `${formatDayMonthBesideYear(stock.ivNow.date, lastBar)}${stock.ivNow.percentile !== null ? ` · ${formatOrdinal(Math.round(stock.ivNow.percentile * 100))} percentile of the last year` : ""}` : undefined}
          />
          <Stat label={`Implied, median${ivFirst ? ` since ${ivFirst.slice(0, 4)}` : ""}`} value={formatPercentage(stock.ivRange.median)} note={`10th ${formatPercentage(stock.ivRange.tenth)} · 90th ${formatPercentage(stock.ivRange.ninetieth)}`} />
          <Stat label="Implied minus the next month's realised" value={premium.medianPremium === null ? "—" : `${formatSignedNumber(premium.medianPremium * 100, 1)} vol points`} note={premium.shareAbove === null ? undefined : `above on ${formatPercentage(premium.shareAbove, 0)} of days`} />
        </Section>
        <Section title="Step">
          <Stat label="Now" value={formatPercentage(stock.steps.now?.step)} note={stock.steps.now && lastBar ? (stock.steps.now.source === "implied" ? `from ${formatDayMonthBesideYear(stock.steps.now.date, lastBar)}'s IV` : `from the 63-day realised volatility on ${formatDayMonthBesideYear(stock.steps.now.date, lastBar)}`) : undefined} />
          <Stat label={`Median ${sinceBars}`} value={formatPercentage(stock.steps.median)} note={`10th ${formatPercentage(stock.steps.tenth)} · 90th ${formatPercentage(stock.steps.ninetieth)}`} />
          <Stat label="Puts sold" value={!backtest ? "—" : backtest.putsSold === 0 ? "None" : formatNumber(backtest.putsSold)} note={backtest && backtest.putsSold > 0 ? "in the analysis backtest" : undefined} />
        </Section>
        <Section title="Swings">
          <Stat label="Falls of a Step" value={formatNumber(stock.falls.count)} note={stock.falls.perYear === null ? undefined : `${formatNumber(stock.falls.perYear, 1)} a year`} />
          <Stat label="Went on to 2 Steps" value={`${formatNumber(stock.falls.reachedTwoSteps)} of ${formatNumber(stock.falls.count)}`} />
          <Stat label="Back within a year" value={`${formatNumber(stock.falls.backWithinAYear)} of ${formatNumber(stock.falls.count)}`} />
        </Section>
        <Section title="Trend">
          <Stat label={`Price CAGR ${sinceBars}`} value={formatPercentage(all?.cagr)} />
          <Stat label="Days in an uptrend · downtrend · neither" value={`${share(stock.trend.uptrend)} · ${share(stock.trend.downtrend)} · ${share(stock.trend.neither)}`} />
          <Stat label="Month-long moves" value={formatRatio(all?.varianceRatio)} note={all?.label ? varianceRatioReadings[all.label] : undefined} />
        </Section>
        <Section title="Market">
          <Stat label="Beta to SPY" value={formatRatio(stock.market?.all.beta)} note={stock.market?.sinceBacktest ? `since ${backtestYear}: ${formatRatio(stock.market.sinceBacktest.beta)}` : undefined} />
          <Stat label="Correlation with SPY" value={formatRatio(stock.market?.all.correlation)} note={stock.market?.sinceBacktest ? `since ${backtestYear}: ${formatRatio(stock.market.sinceBacktest.correlation)}` : undefined} />
          <Stat label="Beta on SPY's down days" value={formatRatio(stock.market?.spyDownDays.beta)} />
        </Section>
        <Section title="Jumps">
          <Stat label="Opening gaps beyond 2 daily standard deviations" value={stock.gaps.perYear === null ? "—" : `${formatNumber(stock.gaps.perYear, 1)} a year`} />
          <Stat label="Weekly returns' skew" value={stock.weeklySkew.skew === null ? "—" : formatSignedNumber(stock.weeklySkew.skew, 2)} note={describeSkew(stock.weeklySkew.skew) || undefined} />
          <Stat label="Earnings moves" value={earnings.medianAbsMove === null ? "—" : `${formatPercentage(earnings.medianAbsMove)} median`} note={earnings.withImplied > 0 ? `${formatNumber(earnings.beyondImplied)} of ${formatNumber(earnings.withImplied)} beyond the implied move` : undefined} />
        </Section>
        <Section title={`Options, ${optionYear} on`}>
          <Stat label="Weeks with an expiry day" value={weeks.wholeWeeks > 0 && weeks.weeksWithExpiryDay === weeks.wholeWeeks ? "Every week" : `${formatNumber(weeks.weeksWithExpiryDay)} of ${formatNumber(weeks.wholeWeeks)}`} />
          <Stat label="Options traded a day" value={activity ? formatNumber(activity.yearAveragePerDay) : "—"} note={activity ? `the last ${formatNumber(activity.yearSessions)} sessions` : undefined} />
          <Stat label="LEAPS bought" value={!backtest ? "—" : backtest.leapsBought === 0 ? "None" : formatNumber(backtest.leapsBought)} note={backtest && backtest.leapsBought > 0 ? `${formatCurrency(backtest.sources?.leaps?.pnlDollars, 0)} after costs` : undefined} />
        </Section>
        <Section title="Identity">
          <Stat label="Kind" value={profile ? tickerCategoryLabels(profile).slice(0, 2).join(" · ") || "—" : "—"} />
          <Stat label="History" value={`Prices from ${firstBar ? formatDayMonthYear(firstBar) : "—"}${ivFirst ? ` · IV from ${formatDayMonthYear(ivFirst)}` : ""}`} />
          <Stat label={`Splits since ${optionYear}`} value={splits === null ? "Not analysed" : splitsInOptions.length === 0 ? "None" : splitsInOptions.map((split) => `${describeSplitRatio(split.ratio)} split, ${formatDayMonthYear(split.firstDayAfter)}`).join("; ")} />
        </Section>
      </div>
    </AnalysisCard>
  );
}
