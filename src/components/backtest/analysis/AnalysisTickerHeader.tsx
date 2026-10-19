import type { ReactNode } from "react";
import type { BacktestTickerProfile, BacktestTickerSuitability } from "../../../api/backtest";
import type { AnalysisCappedPut, AnalysisFigures } from "../../../api/backtestAnalysis";
import { fiftyTwoWeekRange, impliedVolatilityPercentile, lastCloseWithChange, tickerCategoryLabels } from "../../../lib/analysisPresentation";
import { daysToExpiry, formatCurrency, formatDayMonth, formatOptionContractLabel, formatOrdinal, formatPercentage, formatSignedPercentage, pnlTextClass, todayInEasternIso } from "../../../lib/formatters";
import { TickerSuitabilityBadge } from "../TickerSuitabilityBadge";

// The Analyse window's header (Marcelo 2026-10-19): who the ticker is, and the facts to read without scrolling, all from
// the stored analysis (its "option data to" date) except the name, classification and suitability.

interface AnalysisTickerIdentityProps {
  symbol: string;
  profile: BacktestTickerProfile | null;
  suitability: BacktestTickerSuitability | null;
  /** Null for a trader. */
  onOpenSuitability: (() => void) | null;
}

/** Under the symbol: the full name, kind, sector, industry and exchange, and the Suitability badge. */
export function AnalysisTickerIdentity({ symbol, profile, suitability, onOpenSuitability }: AnalysisTickerIdentityProps) {
  const details = profile ? [...tickerCategoryLabels(profile), profile.exchange].filter((label): label is string => !!label) : [];
  return (
    <div className="analysis-header-identity">
      {profile?.companyName && <span className="analysis-header-name">{profile.companyName}</span>}
      {details.length > 0 && <span className="text-secondary">{details.join(" · ")}</span>}
      <TickerSuitabilityBadge symbol={symbol} suitability={suitability} onOpen={onOpenSuitability} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="analysis-header-fact">
      <span className="text-secondary">{label}</span> {children}
    </span>
  );
}

function contractFact(symbol: string, contract: AnalysisCappedPut, right: "C" | "P") {
  return (
    <>
      <strong>{formatOptionContractLabel({ symbol, strike: contract.strike, right, expiry: contract.expiry, dte: contract.dte })}</strong> {formatPercentage(contract.premiumYield)}
    </>
  );
}

/** The facts strip: last close, 52-week range, IV and its percentile, the best Put and Call, next earnings. */
export function AnalysisTickerFacts({ symbol, figures }: { symbol: string; figures: AnalysisFigures }) {
  const close = lastCloseWithChange(figures.bars);
  const range = fiftyTwoWeekRange(figures.bars);
  const iv = impliedVolatilityPercentile(figures.bars);
  const lastDay = figures.chains.lastDay;
  const next = figures.earnings.next;
  const daysToEarnings = next ? daysToExpiry(next.date, todayInEasternIso()) : null;
  return (
    <div className="analysis-header-facts">
      <Fact label={close ? `Close ${formatDayMonth(close.date)}` : "Close"}>
        {close ? (
          <>
            <strong>{formatCurrency(close.close)}</strong> {close.change !== null && <span className={pnlTextClass(close.change)}>({formatSignedPercentage(close.change)})</span>}
          </>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label="52-week">
        {range ? (
          <>
            <strong>
              {formatCurrency(range.low)}–{formatCurrency(range.high)}
            </strong>
            {range.position !== null && ` (at ${formatPercentage(range.position, 0)})`}
          </>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label="IV">
        {iv ? (
          <>
            <strong>{formatPercentage(iv.impliedVolatility)}</strong> ({formatOrdinal(Math.round(iv.percentile * 100))} percentile, {iv.sessions} sessions)
          </>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label="Best Put">{lastDay?.bestCappedPut ? contractFact(symbol, lastDay.bestCappedPut, "P") : "none passed"}</Fact>
      <Fact label="Best Call">{lastDay?.bestEntryCall ? contractFact(symbol, lastDay.bestEntryCall, "C") : lastDay?.bestEntryCall === null ? "none passed" : "Update Analysis to see it"}</Fact>
      <Fact label="Next earnings">
        {next ? (
          <>
            <strong>{formatDayMonth(next.date)}</strong> ({daysToEarnings} day{daysToEarnings === 1 ? "" : "s"}
            {next.afterClose === true ? ", after the close" : next.afterClose === false ? ", before the open" : ""})
          </>
        ) : (
          "none scheduled"
        )}
      </Fact>
    </div>
  );
}
