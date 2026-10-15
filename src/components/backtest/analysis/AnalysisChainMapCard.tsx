import { useState } from "react";
import type { AnalysisChainMapContract, AnalysisFigures } from "../../../api/backtestAnalysis";
import { firstRungCap, type AnalysisPanelValues } from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonthYear, formatPercentage } from "../../../lib/formatters";
import { TooltipSpan } from "../../TooltipSpan";
import { AnalysisCard } from "./analysisBits";
import { AnalysisPutsSwitch } from "./AnalysisLiquidityCards";

// The chain yield map (mockup approved 2026-10-15): the stored analysis's last day, 1–45 days to expiry, per |delta|
// band a track along premium yield at the mid, darker where more contracts sit (scaled within each band). Bands outside
// the strategy's |delta| range (the values the analysis was computed with) are dashed.

const bands: [number, number, string][] = [
  [0.05, 0.1, "0.05–0.10"],
  [0.1, 0.2, "0.10–0.20"],
  [0.2, 0.3, "0.20–0.30"],
  [0.3, 0.4, "0.30–0.40"],
  [0.4, 1.01, "above 0.40"],
];
const binEdges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0, Infinity];
const binCount = binEdges.length - 1;
const binLabel = (bin: number) => (binEdges[bin + 1] === Infinity ? "200%+" : `${Math.round(binEdges[bin]! * 100)}–${Math.round(binEdges[bin + 1]! * 100)}%`);
const binOf = (premiumYield: number) => {
  for (let bin = 0; bin < binCount; bin++) if (premiumYield < binEdges[bin + 1]!) return bin;
  return binCount - 1;
};
const axisTicks: [number, string][] = [
  [0, "0%"],
  [5, "50%"],
  [10, "100%"],
  [12, "150%"],
  [15, "200%+"],
];
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length === 0 ? null : sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Every filter but |delta|: the bid ($0.05), the spread limit, and a volume limit of at least one contract (20% of the previous session). */
const passesOtherFilters = (contract: AnalysisChainMapContract, values: AnalysisPanelValues) => {
  const mid = (contract.bid + contract.ask) / 2;
  return contract.bid >= 0.05 && mid > 0 && (contract.ask - contract.bid) / mid <= values.maxSpreadPctOfMid / 100 && Math.floor(contract.previousVolume * 0.2) >= 1;
};

interface AnalysisChainMapCardProps {
  figures: AnalysisFigures;
  computedWith: AnalysisPanelValues;
  putsCapped: boolean;
  onPutsCappedChange: (capped: boolean) => void;
  stale: boolean;
}

export function AnalysisChainMapCard({ figures, computedWith, putsCapped, onPutsCappedChange, stale }: AnalysisChainMapCardProps) {
  const [showAll, setShowAll] = useState(false);
  const lastDay = figures.chains.lastDay;
  const chain = figures.chains.chainMap;
  if (!lastDay) return null;
  const cap = lastDay.spot === null ? null : firstRungCap(lastDay.spot, lastDay.shock, computedWith.ladderRungs);

  const panel = (side: "C" | "P") => {
    const capped = side === "P" && putsCapped && cap !== null;
    const inBand = (contract: AnalysisChainMapContract, low: number, high: number) =>
      contract.right === side && contract.delta !== null && contract.yieldAtMid !== null && Math.abs(contract.delta) >= low && Math.abs(contract.delta) < high && contract.dte >= computedWith.minDte && contract.dte <= computedWith.maxDte && (!capped || contract.strike <= cap! + 1e-9);
    const passing = chain.filter((contract) => inBand(contract, computedWith.minAbsDelta, computedWith.maxAbsDelta + 1e-9) && passesOtherFilters(contract, computedWith)).length;
    let shownTotal = 0;
    const title = side === "C" ? "Calls" : capped ? `Puts under the ${formatCurrency(cap)} cap` : "Puts";
    const rows = bands.map(([low, high, label]) => {
      const contracts = chain.filter((contract) => inBand(contract, low, high) && (showAll || passesOtherFilters(contract, computedWith)));
      shownTotal += contracts.length;
      const outside = low >= computedWith.maxAbsDelta - 1e-9 || high <= computedWith.minAbsDelta + 1e-9;
      const partly = !outside && ((computedWith.maxAbsDelta > low && computedWith.maxAbsDelta < high) || (computedWith.minAbsDelta > low && computedWith.minAbsDelta < high));
      const bandLabel = (
        <div className="analysis-ymap-band">
          {label}
          {outside ? <small>outside the {computedWith.minAbsDelta.toFixed(2)}–{computedWith.maxAbsDelta.toFixed(2)} range</small> : partly ? <small>partly outside</small> : null}
        </div>
      );
      if (contracts.length === 0) {
        return [
          <div key={`${label}-label`}>{bandLabel}</div>,
          <div key={`${label}-track`} className="analysis-ymap-track is-empty">
            {capped ? "None under the cap" : "No contracts"}
          </div>,
          <div key={`${label}-stat`} className="analysis-ymap-stat text-secondary">
            —
          </div>,
        ];
      }
      const counts = new Array<number>(binCount).fill(0);
      for (const contract of contracts) counts[binOf(contract.yieldAtMid!)]!++;
      const fullest = Math.max(...counts);
      return [
        <div key={`${label}-label`}>{bandLabel}</div>,
        <div key={`${label}-track`} className={`analysis-ymap-track${outside ? " is-out" : ""}`}>
          {counts.map((count, bin) =>
            count === 0 ? null : (
              <TooltipSpan
                key={bin}
                className="analysis-ymap-cell"
                style={{ left: `${(bin / binCount) * 100}%`, width: `${100 / binCount}%`, ["--a" as string]: (0.2 + 0.8 * (count / fullest)).toFixed(3) }}
                text={`${title}, |delta| ${label} · yield ${binLabel(bin)}: ${count} contract${count === 1 ? "" : "s"}`}
              />
            ),
          )}
        </div>,
        <div key={`${label}-stat`} className="analysis-ymap-stat">
          <b>{contracts.length}</b> <span className="text-secondary">· {formatPercentage(median(contracts.map((contract) => contract.yieldAtMid!)), 0)}</span>
        </div>,
      ];
    });
    return (
      <div className="analysis-ymap">
        <div className="analysis-ymap-side">
          <h4>{title}</h4>
          <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
            {passing} passing every filter · {shownTotal} shown
          </span>
        </div>
        <div className="analysis-ymap-hdr">|Delta|</div>
        <div />
        <div className="analysis-ymap-hdr text-end">Count · median</div>
        {rows.flat()}
        <div className="analysis-ymap-axis">
          {axisTicks.map(([position, text]) => (
            <span key={text} style={{ left: `${(position / binCount) * 100}%` }}>
              {text}
            </span>
          ))}
        </div>
        <div className="analysis-ymap-axis-title">Premium yield at the mid, % a year</div>
      </div>
    );
  };

  const underRange = chain.filter((contract) => contract.delta !== null && contract.yieldAtMid !== null && Math.abs(contract.delta) < 0.05).length;
  const withoutVolatility = chain.filter((contract) => contract.delta === null).length;
  const withoutYield = chain.filter((contract) => contract.delta !== null && contract.yieldAtMid === null).length;
  const actions = (
    <>
      <label className="form-check form-switch mb-0 d-inline-flex align-items-center gap-2" style={{ fontSize: "0.8rem" }}>
        <input className="form-check-input m-0" type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
        Add the contracts the filters leave out
      </label>
      <AnalysisPutsSwitch capped={putsCapped} onChange={onPutsCappedChange} />
    </>
  );
  return (
    <AnalysisCard
      title={`Chain yield map · ${formatDayMonthYear(lastDay.date)}`}
      description={`Where yield sits in the last stored chain at the 10:00 quote, ${computedWith.minDte}–${computedWith.maxDte} days to expiry. Stronger colour means more contracts, scaled within each band.`}
      actions={actions}
      stale={stale}
      footer={
        <p className="mb-0">
          Shown by default: contracts passing every filter except |delta| (the band is the delta). The toggle adds those the bid, spread or volume filters leave out. The axis steps by 10 points to 100%, then by 25 to 200%. Not placed: {underRange} contracts under 0.05 delta, {withoutVolatility} with no implied volatility, {withoutYield} with no positive premium.
        </p>
      }
    >
      <div className="card-body">
        <div className="analysis-ymap-panels">
          {panel("C")}
          {panel("P")}
        </div>
        <div className="analysis-legend mt-3">
          <span className="analysis-legend-item">
            <span className="analysis-density-scale">
              {[0.2, 0.4, 0.6, 0.8, 1].map((alpha) => (
                <i key={alpha} style={{ ["--a" as string]: alpha }} />
              ))}
            </span>
            Fewer to more contracts in the band
          </span>
          <span className="analysis-legend-item">
            <span className="analysis-density-scale is-out">
              {[0.2, 0.6, 1].map((alpha) => (
                <i key={alpha} style={{ ["--a" as string]: alpha }} />
              ))}
            </span>
            Outside the strategy's |delta| range (dashed track)
          </span>
        </div>
      </div>
    </AnalysisCard>
  );
}
