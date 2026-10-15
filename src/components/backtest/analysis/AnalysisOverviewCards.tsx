import type { ReactNode } from "react";
import { IconAlertTriangle, IconCheck, IconSparkles, IconX } from "@tabler/icons-react";
import type { AnalysisFigures, AnalysisRecommendationKey, AnalysisSessionRow, AnalysisSummary, StoredAnalysis } from "../../../api/backtestAnalysis";
import { analysisSignedClass, firstRungCap, lotPriceCeiling, rungPriceCeiling, shockFor, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatBrowserClockTime, formatCurrency, formatDayMonthYear, formatPercentage, formatSignedPercentage } from "../../../lib/formatters";
import { AnalysisCard, AnalysisNote } from "./analysisBits";

// The Summary and the Recommendation from Claude, and the KPI tiles (mockup approved 2026-10-15).

const recommendationLabels: Record<AnalysisRecommendationKey, string> = {
  potDollars: "Pot",
  ladderSharesPct: "Shares",
  ladderRungs: "Rungs",
  ladderShockPct: "Shock",
  minAbsDelta: "|Delta| from",
  maxAbsDelta: "|Delta| to",
  minDte: "Days to expiry, from",
  maxDte: "Days to expiry, to",
  maxSpreadPctOfMid: "Spread limit",
};

function formatRecommendationValue(key: AnalysisRecommendationKey, value: number | null, ruleShock: number): string {
  if (value === null) return key === "ladderShockPct" ? `the rule's (${Math.round(ruleShock * 100)}%)` : "—";
  switch (key) {
    case "potDollars":
      return formatCurrency(value, 0);
    case "ladderSharesPct":
    case "ladderShockPct":
    case "maxSpreadPctOfMid":
      return `${value}%`;
    case "minAbsDelta":
    case "maxAbsDelta":
      return value.toFixed(2);
    default:
      return String(value);
  }
}

/** The recommendation's values over the values shown (a key Claude left out keeps the shown value). */
export function recommendedPanelValues(summary: AnalysisSummary, shown: AnalysisPanelValues): AnalysisPanelValues {
  const values = { ...shown };
  for (const entry of summary.recommendation.values) {
    if (entry.key === "ladderShockPct") values.ladderShockPct = entry.value;
    else if (entry.value !== null) values[entry.key] = entry.value;
  }
  return values;
}

const verdicts = {
  qualifies: { label: "Qualifies", className: "bg-success text-success-fg", Icon: IconCheck },
  borderline: { label: "Borderline", className: "bg-warning text-warning-fg", Icon: IconAlertTriangle },
  does_not_qualify: { label: "Doesn't qualify", className: "bg-danger text-danger-fg", Icon: IconX },
};

interface AnalysisClaudeCardsProps {
  symbol: string;
  analysis: StoredAnalysis;
  shown: AnalysisPanelValues;
  ruleShock: number;
  stale: boolean;
  onTry: (values: AnalysisPanelValues) => void;
  onBacktest: (values: AnalysisPanelValues) => void;
}

export function AnalysisClaudeCards({ symbol, analysis, shown, ruleShock, stale, onTry, onBacktest }: AnalysisClaudeCardsProps) {
  const summary = analysis.summary;
  const title = (text: string) => (
    <span className="d-inline-flex align-items-center gap-1">
      <IconSparkles size={14} aria-hidden="true" />
      {text}
    </span>
  );
  if (!summary) {
    const message =
      analysis.summaryStatus === "not_configured"
        ? "Claude's summary needs the Claude Code CLI: set BACKTEST_CLAUDE_CLI_PATH in the API's .env and restart the API, then Update Analysis."
        : analysis.summaryStatus === "usage_limit"
          ? "The Claude subscription's usage limit stopped the summary. The figures below are complete; Update Analysis later to write it."
          : analysis.summaryStatus === "pending"
            ? "Claude is writing the summary."
            : `Claude's summary could not be written${analysis.summaryError ? `: ${analysis.summaryError}` : "."} The figures below are complete.`;
    return (
      <AnalysisCard title={title("Summary")} stale={stale}>
        <div className="card-body">
          <AnalysisNote tone={analysis.summaryStatus === "pending" ? "info" : "warn"}>
            <p>{message}</p>
          </AnalysisNote>
        </div>
      </AnalysisCard>
    );
  }
  const verdict = verdicts[summary.recommendation.verdict];
  const recommended = recommendedPanelValues(summary, shown);
  const computedAt = analysis.finishedAt ?? analysis.createdAt;
  return (
    <div className="analysis-two-col">
      <AnalysisCard title={title("Summary")} description="Written by Claude from the figures in this analysis" stale={stale}>
        <div className="card-body">
          <div className="analysis-summary-text">
            <p>
              <b>{summary.headline}</b>
            </p>
            {summary.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {summary.caveats.length > 0 && (
              <ul>
                {summary.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </AnalysisCard>
      <AnalysisCard title={title("Recommendation from Claude")} description={`Claude's judgement from the figures and ${symbol}'s backtests as they stood on ${formatDayMonthYear(computedAt.slice(0, 10))}, ${formatBrowserClockTime(computedAt)}. Not tested.`} stale={stale}>
        <div className="card-body">
          <div className="analysis-verdict">
            <span className={`badge ${verdict.className} d-inline-flex align-items-center gap-1`} style={{ fontSize: "0.72rem" }}>
              <verdict.Icon size={12} aria-hidden="true" />
              {verdict.label}
            </span>
            <p>{summary.recommendation.verdictReason}</p>
          </div>
          <dl className="analysis-rec-list">
            {summary.recommendation.values.map((entry) => {
              const was = entry.key === "ladderShockPct" ? shown.ladderShockPct : shown[entry.key];
              const same = was === entry.value;
              return (
                <div key={entry.key}>
                  <dt>{recommendationLabels[entry.key]}</dt>
                  <span className="analysis-rec-value">
                    {formatRecommendationValue(entry.key, entry.value, ruleShock)}
                    <span className="analysis-was">{same ? `same as ${symbol}'s` : `${symbol}'s: ${formatRecommendationValue(entry.key, was, ruleShock)}`}</span>
                  </span>
                  <dd>{entry.reason}</dd>
                </div>
              );
            })}
          </dl>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
            <button type="button" className="btn btn-outline-primary" onClick={() => onTry(recommended)}>
              Try these values
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={() => onBacktest(recommended)}>
              Backtest these values
            </button>
            <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
              Try copies them into the settings above (nothing is saved); Backtest asks first.
            </span>
          </div>
        </div>
      </AnalysisCard>
    </div>
  );
}

interface AnalysisKpiTilesProps {
  symbol: string;
  figures: AnalysisFigures;
  shown: AnalysisPanelValues;
  showingTrial: boolean;
  bestLadder: AnalysisSessionRow | null;
}

export function AnalysisKpiTiles({ symbol, figures, shown, showingTrial, bestLadder }: AnalysisKpiTilesProps) {
  const lastBar = figures.bars.at(-1);
  const yearAgo = figures.bars.length > 252 ? figures.bars[figures.bars.length - 253] : null;
  const oneYear = lastBar && yearAgo ? lastBar[4] / yearAgo[4] - 1 : null;
  const drawdown = figures.maxDrawdown.All;
  const lastDay = figures.chains.lastDay;
  const price = lastDay?.spot ?? null;
  const shock = shockFor(shown, figures.shock.shock);
  const cap = price === null ? null : firstRungCap(price, shock, shown.ladderRungs);
  const lots = price === null ? 0 : Math.floor((shown.potDollars * shown.ladderSharesPct) / 100 / (price * 100));
  const rung = (shown.potDollars * (1 - shown.ladderSharesPct / 100)) / shown.ladderRungs;
  const fits = price !== null && price <= lotPriceCeiling(shown) && price <= rungPriceCeiling(shown, shock);
  // The rule keeps the Max drawdown within its floor and ceiling: say which bound it hit, if any.
  const rawDrawdown = figures.shock.maxDrawdown;
  const ruleText =
    figures.shock.closes < 250 || rawDrawdown === null
      ? "Under 250 closes: the new-listing value"
      : rawDrawdown > figures.shock.shock + 1e-9
        ? `Max drawdown ${formatPercentage(rawDrawdown)} kept at the ${formatPercentage(figures.shock.shock, 0)} ceiling`
        : rawDrawdown < figures.shock.shock - 1e-9
          ? `Max drawdown ${formatPercentage(rawDrawdown)} raised to the ${formatPercentage(figures.shock.shock, 0)} floor`
          : "the stock's Max drawdown over the lookback";
  const tiles: { label: string; value: ReactNode; sub: ReactNode }[] = [
    {
      label: "Last close",
      value: lastBar ? formatCurrency(lastBar[4]) : "—",
      sub: lastBar ? (
        <>
          {formatDayMonthYear(lastBar[0])} · 1 year <span className={analysisSignedClass(oneYear)}>{formatSignedPercentage(oneYear)}</span>
        </>
      ) : (
        "No daily bars"
      ),
    },
    { label: "Max drawdown", value: drawdown ? formatPercentage(-drawdown.depth) : "—", sub: drawdown ? `${formatDayMonthYear(drawdown.peakDate)} → ${formatDayMonthYear(drawdown.troughDate)}` : "No daily bars" },
    {
      label: shown.ladderShockPct === null ? "Recommended shock" : "Shock entered",
      value: formatPercentage(shock, 0),
      sub: shown.ladderShockPct !== null ? `The rule gives ${formatPercentage(figures.shock.shock, 0)}` : ruleText,
    },
    { label: "Volatility, 21-day", value: formatPercentage(figures.volatility.yangZhang21Now), sub: `Yang-Zhang · implied ${formatPercentage(figures.volatility.impliedNow)} (IBKR)` },
    {
      label: showingTrial ? "Fit at your values" : `Fit at ${symbol}'s settings`,
      value:
        price === null ? (
          "—"
        ) : (
          <span className={`badge ${fits ? "bg-success text-success-fg" : "bg-danger text-danger-fg"} d-inline-flex align-items-center gap-1`} style={{ fontSize: "0.72rem" }}>
            {fits ? <IconCheck size={12} aria-hidden="true" /> : <IconX size={12} aria-hidden="true" />}
            {fits ? "Fits" : "Doesn't fit"}
          </span>
        ),
      sub: price === null || cap === null ? "No 10:00 price" : `${lots} lot${lots === 1 ? "" : "s"} · a Put at the ${formatCurrency(cap)} cap needs ${formatCurrency(cap * 100, 0)} of a ${formatCurrency(rung, 0)} rung`,
    },
    {
      label: "Best CC + Put Ladder backtest",
      value: bestLadder?.excessCalmar === null || bestLadder === null ? "—" : bestLadder.excessCalmar.toFixed(2),
      sub: bestLadder ? `Excess Calmar · CAGR ${formatPercentage(bestLadder.cagr)}, Max drawdown ${formatPercentage(bestLadder.maxDrawdown)}` : "No ladder backtest of 2 years or more",
    },
  ];
  return (
    <div className="analysis-kpi-grid">
      {tiles.map((tile) => (
        <div key={tile.label} className="card analysis-kpi">
          <span className="subheader">{tile.label}</span>
          <span className="analysis-kpi-value">{tile.value}</span>
          <span className="analysis-kpi-sub">{tile.sub}</span>
        </div>
      ))}
    </div>
  );
}
