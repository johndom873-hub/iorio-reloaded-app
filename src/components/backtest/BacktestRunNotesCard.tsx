import type { BacktestRunStatistics } from "../../api/backtest";
import { formatNumber } from "../../lib/formatters";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { describeLlmCalls } from "../../lib/backtestPresentation";
import { BacktestCard, BacktestCollapseToggle } from "./backtestBits";

/** Facts from the run's statistics that its notes do not already say: days with looks after 10:00, breaker trips, days the
 *  market-stress check could not run. */
function describeRunStatistics(statistics: BacktestRunStatistics): string[] {
  const days = (count: number) => `${formatNumber(count)} ${count === 1 ? "day" : "days"}`;
  const facts = [
    `Days with looks after 10:00: ${formatNumber(statistics.daysWithIntradayLooks)}.`,
    statistics.dailyLossBreakerTripDates.length === 0
      ? "The daily-loss breaker never tripped."
      : `The daily-loss breaker tripped on ${days(statistics.dailyLossBreakerTripDates.length)}: ${statistics.dailyLossBreakerTripDates.join(", ")}.`,
  ];
  if (statistics.daysWithoutMarketStressBars > 0) facts.push(`${days(statistics.daysWithoutMarketStressBars)} without SPY 30-minute bars: the market-stress check could not run on them.`);
  if (statistics.llmCalls) facts.push(`The AI model: ${describeLlmCalls(statistics.llmCalls)}.`);
  return facts;
}

/** What the run says about the session as a whole: its looks, symbols without intraday quotes, checks that could not run,
 *  breaker trips, and how both buy-and-hold lines were built. Collapsible, remembered in this browser. */
export function BacktestRunNotesCard({ notes, runStatistics }: { notes: string[]; runStatistics: BacktestRunStatistics | null }) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-run-notes", true);
  if (notes.length === 0 && runStatistics === null) return null;
  const facts = runStatistics ? describeRunStatistics(runStatistics) : [];
  return (
    <BacktestCard
      title="Run notes"
      description={runStatistics ? `${formatNumber(runStatistics.looksRun)} looks · what the figures rest on` : "what the figures rest on"}
      actions={<BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />}
      className="mb-3"
    >
      {isOpen && (
        <div className="card-body py-2" style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
          <ul className="mb-0 ps-3">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            {facts.map((fact) => (
              <li key={fact} className="text-secondary">
                {fact}
              </li>
            ))}
          </ul>
        </div>
      )}
    </BacktestCard>
  );
}
