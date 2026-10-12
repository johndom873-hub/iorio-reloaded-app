import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchPlutoSizingCaps, type PlutoSizingCaps } from "../../api/pluto";
import type { CandidateModelScore, HeldLegScore, RollSignalCandidate, SignalCandidate, TickerSignals } from "../../api/signals";
import { FLASH_DURATION_MS, flashClassName, useFlashOnChange } from "../../hooks/useFlashOnChange";
import { useTooltip } from "../../hooks/useTooltip";
import { formatCurrency, formatPercentage, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass } from "../../lib/formatters";
import { candidateContractKey, dollarsPerTenThousandOfExposure, gradeBadgeClass, gradeExplanation, gradeLabel, modelColumnExplanation } from "../../lib/signalsPresentation";
import { TooltipSpan } from "../TooltipSpan";

// The order panel's valuation box (mockup approved 2026-10-10; EXP $ net of the premium and yields on calendar days,
// 2026-10-12): the valuation model's figures for the selected contract, what Pluto acts on, with Pluto's own Kelly and
// stress caps for it and the old 63-day Edge underneath until it is retired.

function Row({ label, value, tone, strong, title }: { label: string; value: ReactNode; tone?: string; strong?: boolean; title?: string }) {
  return (
    <div className={`d-flex justify-content-between gap-3 py-1 ${strong ? "border-top mt-1 pt-2 fw-semibold" : ""}`} style={{ fontSize: "0.85rem" }}>
      <TooltipSpan className={strong ? undefined : "text-secondary"} text={title}>
        {label}
      </TooltipSpan>
      <span className={`font-mono text-end ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

/** Pluto's caps for the contract, fetched once per contract (not per tick) with the figures it had then. */
function usePlutoSizingCaps(candidate: SignalCandidate, signals: TickerSignals, spotPrice: number | null): { caps: PlutoSizingCaps | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; caps: PlutoSizingCaps | null; failed: boolean }>({ key: "", caps: null, failed: false });
  const latest = useRef({ candidate, signals, spotPrice });
  latest.current = { candidate, signals, spotPrice };
  const contractKey = candidateContractKey(candidate);
  useEffect(() => {
    const { candidate: current, signals: ticker, spotPrice: spot } = latest.current;
    const model = current.model;
    if (!model) return;
    let cancelled = false;
    fetchPlutoSizingCaps({
      strategyKey: current.strategyKey,
      strike: current.strike,
      bid: current.bid,
      ask: current.ask,
      spotPrice: spot ?? ticker.spotPrice,
      model: { calibratedExpectedPnlDollars: model.calibratedExpectedPnlDollars, pnlVarianceDollars: model.pnlVarianceDollars, coveredPositionPnlVarianceDollars: model.coveredPositionPnlVarianceDollars, varianceSessions: model.varianceSessions },
      ticker: { forecastVolatility: ticker.modelForecast?.annualizedVolatility ?? null, elevatedVolatility: ticker.elevatedVolatility?.elevated === true, dayChangePercent: ticker.dayChangePercent },
    })
      .then((caps) => {
        if (!cancelled) setState({ key: contractKey, caps, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ key: contractKey, caps: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [contractKey]);
  return state.key === contractKey ? { caps: state.caps, failed: state.failed } : { caps: null, failed: false };
}

function describeCaps(caps: PlutoSizingCaps | null, failed: boolean): { value: string; title: string | undefined } {
  if (failed) return { value: "—", title: "Pluto's caps could not be computed right now." };
  if (!caps) return { value: "…", title: undefined };
  const stress = caps.stress.contracts === null ? "no limit" : String(caps.stress.contracts);
  return {
    value: `${caps.kelly.contracts} · ${stress} contracts`,
    title: `What Pluto's sizing gate would allow at most, at the ${formatCurrency(caps.netLiquidationValue, 0)} account value of ${caps.accountValueDateIso}. ${caps.kelly.detail}. ${caps.stress.detail}. Other limits (order size, budget, ticker and cash room, volume) can bind first.`,
  };
}

export function ModelValuationCard({ candidate, model, signals, spotPrice }: { candidate: SignalCandidate; model: CandidateModelScore; signals: TickerSignals; spotPrice: number | null }) {
  const isCall = candidate.strategyKey === "covered_call";
  const mid = (candidate.bid + candidate.ask) / 2;
  const costsDollars = mid * 100 - model.premiumAfterCostsDollars;
  const per10k = dollarsPerTenThousandOfExposure(model.expectedPnlDollars, model.capitalAtRiskDollars);
  const calendarDays = Math.max(1, Math.round(model.calendarYears * 365));
  const edgeFlash = useFlashOnChange(Math.round(model.expectedPnlDollars), FLASH_DURATION_MS, 0);
  const gradeRef = useTooltip<HTMLSpanElement>(modelColumnExplanation.grade);
  const { caps, failed } = usePlutoSizingCaps(candidate, signals, spotPrice);
  const capsShown = describeCaps(caps, failed);
  return (
    <div className="border rounded p-3 signals-valuation-box">
      <div className="d-flex align-items-start justify-content-between gap-2">
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Valuation
        </div>
        <span ref={gradeRef} className={`badge ${gradeBadgeClass[model.grade]}`} style={{ fontSize: "0.72rem" }} tabIndex={0}>
          {gradeLabel[model.grade]}
        </span>
      </div>
      <div className="d-flex flex-wrap align-items-baseline gap-2">
        <span className={`h2 mb-0 font-mono ${pnlTextClass(model.expectedPnlDollars)} ${flashClassName(edgeFlash)}`}>{formatSignedPnl(model.expectedPnlDollars, 0)}</span>
        <span style={{ fontSize: "0.8rem" }}>
          expected per contract · <span className="font-mono">{formatSignedPnl(per10k, 0)}</span> per $10k
        </span>
      </div>
      <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
        Edge Yield <span className={`font-mono ${pnlTextClass(model.expectedAnnualizedReturn)}`}>{formatSignedPercentageValue(model.expectedAnnualizedReturn * 100, 0)}</span> · Hist Yield{" "}
        <span className={`font-mono ${pnlTextClass(model.calibratedAnnualizedReturn)}`}>{formatSignedPercentageValue(model.calibratedAnnualizedReturn * 100, 0)}</span> (history says{" "}
        <span className={`font-mono ${pnlTextClass(model.calibratedExpectedPnlDollars)}`}>{formatSignedPnl(model.calibratedExpectedPnlDollars, 0)}</span> per contract)
      </div>
      <div className="mt-2">
        <Row label="Mid / fair value" value={`${mid.toFixed(3)} / ${model.fairPrice.toFixed(3)}`} />
        <Row label="Edge margin (1 − fair ÷ mid)" value={formatPercentage(model.edgeMargin, 0)} title={modelColumnExplanation.margin} />
        <Row label={`Costs (${formatPercentage(signals.spreadShareCharged, 0)} of half-spread + commission)`} value={formatCurrency(costsDollars)} />
        <Row label="Edge $, held to expiry" value={formatSignedPnl(model.expectedPnlDollars, 0)} tone={pnlTextClass(model.expectedPnlDollars)} strong />
        <Row label={`Edge Yield (on EXP $ ${formatCurrency(model.capitalAtRiskDollars, 0)}, ${calendarDays} calendar day${calendarDays === 1 ? "" : "s"})`} value={formatPercentage(model.expectedAnnualizedReturn, 0)} title={modelColumnExplanation.edgeYield} />
        <Row label="Hist Yield" value={formatPercentage(model.calibratedAnnualizedReturn, 0)} title={modelColumnExplanation.histYield} />
        <Row label={`Chance of profit${isCall ? " (shares + call)" : ""}`} value={formatPercentage(model.probabilityOfProfit, 0)} title={modelColumnExplanation.pop} />
        <Row
          label="Average win / average loss"
          value={
            <>
              <span className="text-success">{formatSignedPnl(model.averageWinDollars, 0)}</span> / <span className={pnlTextClass(model.averageLossDollars)}>{formatSignedPnl(model.averageLossDollars, 0)}</span>
            </>
          }
        />
        <Row label="Worst 5% of outcomes (average)" value={formatSignedPnl(model.expectedShortfallDollars, 0)} tone={pnlTextClass(model.expectedShortfallDollars)} title={modelColumnExplanation.worstPer10k} />
        <Row label="Stock down 2σ by expiry" value={formatSignedPnl(model.stressPnlDollars, 0)} tone={pnlTextClass(model.stressPnlDollars)} />
        <Row label="Premium after costs / premium yield" value={`${formatCurrency(model.premiumAfterCostsDollars, 0)} · ${formatPercentage(model.premiumYield, 0)}`} title={modelColumnExplanation.premiumYield} />
        <Row label="Time left (day basis)" value={`${model.varianceSessions.toFixed(2)} trading days`} strong />
        <Row
          label="Contract IV vs forecast (day basis)"
          value={
            <>
              <span className={model.impliedVolatility === null ? "" : pnlTextClass(model.impliedVolatility - model.forecastVolatility)}>{formatPercentage(model.impliedVolatility, 1)}</span> vs {formatPercentage(model.forecastVolatility, 1)}
            </>
          }
        />
        <Row label="Pluto's caps: Kelly · stress" value={capsShown.value} title={capsShown.title} />
        <div className="d-flex justify-content-between gap-3 pt-2 mt-1 text-secondary" style={{ fontSize: "0.85rem", borderTop: "1px dashed var(--tblr-border-color)" }}>
          <TooltipSpan text={gradeExplanation}>Old Edge (63-day)</TooltipSpan>
          <span className="font-mono text-end">
            {gradeLabel[candidate.grade]} · {formatVolatilityPoints(candidate.netEdge)} · {formatSignedPnl(candidate.edgeDollars, 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The roll's valuation box: the model's net roll $ (what Pluto acts on), per contract
 *   new leg's Edge $ − what holding the current leg is still worth − the cost to buy it back,
 * and the roll's edge margin, graded like an open (API rollSignalCandidates.ts, approved 2026-10-10).
 */
export function RollValuationCard({ roll, held, replacement, quantity }: { roll: RollSignalCandidate; held: HeldLegScore; replacement: SignalCandidate; quantity: number }) {
  const model = roll.model;
  const gradeRef = useTooltip<HTMLSpanElement>("The roll's grade, from its edge margin: the new leg's margin after what holding the current leg is still worth. Strong 30% or more, Good 20%, Weak 10%.");
  if (!model) return null;
  const newLeg = replacement.model;
  return (
    <div className="border rounded p-3 signals-valuation-box">
      <div className="d-flex align-items-start justify-content-between gap-2">
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Roll valuation
        </div>
        <span ref={gradeRef} className={`badge ${gradeBadgeClass[model.grade]}`} style={{ fontSize: "0.72rem" }} tabIndex={0}>
          {gradeLabel[model.grade]}
        </span>
      </div>
      <div className="d-flex flex-wrap align-items-baseline gap-2">
        <span className={`h2 mb-0 font-mono ${pnlTextClass(model.netExpectedPnl)}`}>{formatSignedPnl(model.netExpectedPnl, 0)}</span>
        <span style={{ fontSize: "0.8rem" }}>
          net roll across {quantity} contract{quantity === 1 ? "" : "s"} · <span className="font-mono">{formatSignedPnl(model.netExpectedPnlPerContract, 0)}</span> per contract
        </span>
      </div>
      <div className="mt-2">
        <Row label="New leg's Edge $ (per contract, after costs)" value={newLeg ? formatSignedPnl(newLeg.expectedPnlDollars, 0) : "—"} tone={newLeg ? pnlTextClass(newLeg.expectedPnlDollars) : undefined} />
        <Row label="Holding the current leg is still worth" value={held.model ? formatSignedPnl(-held.model.holdValueDollars, 0) : "—"} tone={held.model ? pnlTextClass(-held.model.holdValueDollars) : undefined} />
        <Row label="Cost to buy the current leg back" value={held.model ? formatSignedPnl(-held.model.closeCostDollars, 0) : "—"} tone="text-danger" />
        <Row label="Net roll $ per contract" value={formatSignedPnl(model.netExpectedPnlPerContract, 0)} tone={pnlTextClass(model.netExpectedPnlPerContract)} strong />
        <Row label="Roll edge margin" value={formatPercentage(model.edgeMargin, 0)} />
        {newLeg && (
          <Row
            label="New leg: Edge Yield · Hist Yield"
            value={
              <>
                <span className={pnlTextClass(newLeg.expectedAnnualizedReturn)}>{formatSignedPercentageValue(newLeg.expectedAnnualizedReturn * 100, 0)}</span> · <span className={pnlTextClass(newLeg.calibratedAnnualizedReturn)}>{formatSignedPercentageValue(newLeg.calibratedAnnualizedReturn * 100, 0)}</span>
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
