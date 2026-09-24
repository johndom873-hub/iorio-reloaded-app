import { useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { buildOpenOrder, type AdaptivePriority, type OrderRequest } from "../api/positions";
import type { SignalCandidate, TickerSignals } from "../api/signals";
import { flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";
import { formatCurrency, formatDate, formatPercentage, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints } from "../lib/formatters";
import { describeCandidate, gradeBadgeClass, gradeLabel, signalFlagExplanation, signalFlagLetter } from "../lib/signalsPresentation";
import { Spinner } from "./Spinner";
import { useTooltip } from "../hooks/useTooltip";

// Signals order setup (stage 5, approved 2026-09-22). Same split as
// RollOrderSetupForm: this is only the "form" half -- it builds the order
// through the existing POST /positions/orders and hands the OrderRequest up;
// the caller renders the shared OrderReviewPanel, which confirms and places
// it exactly as every other order in the app. What is new: the Signal card
// (net Edge at the mid and at the bid -- an Adaptive order fills somewhere
// between), a decay meter against the score at selection, and the signal
// snapshot saved with the order for Phase 2.

export const decayWarningVolatilityPoints = 1;
const adaptivePriorities: AdaptivePriority[] = ["Patient", "Normal", "Urgent"];
// Where an Adaptive order is expected to fill, as a share of the way from the mid to the bid.
const expectedSpreadConcession: Record<AdaptivePriority, number> = { Patient: 0, Normal: 0.5, Urgent: 1 };

interface SignalOrderSetupFormProps {
  symbol: string;
  signals: TickerSignals;
  /** The selected candidate as scored NOW (it re-renders with every live frame). */
  candidate: SignalCandidate;
  spotPrice: number | null;
  /** The list's net Edge (bid case) when the row was selected -- the decay meter's reference. */
  netEdgeAtSelection: number;
  selectedAtIso: string;
  onCancel: () => void;
  onSubmitted: (order: OrderRequest, adaptivePriority: AdaptivePriority) => void;
}

function Row({ label, value, tone, strong }: { label: string; value: ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div className={`d-flex justify-content-between gap-3 py-1 ${strong ? "border-top mt-1 pt-2" : ""}`} style={{ fontSize: "0.85rem" }}>
      <span className={strong ? "fw-semibold" : "text-secondary"}>{label}</span>
      <span className={`font-mono text-end ${strong ? "fw-semibold" : ""} ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

// A native `disabled` button never fires hover/focus events, so the tooltip
// has to live on a wrapping span instead (Tabler/Bootstrap Tooltip
// limitation) -- extracted here since the wrapper also needs its own
// useTooltip ref.
function ReviewOrderButton({ disabled, blockedTooltip, building, onClick }: { disabled: boolean; blockedTooltip: string | undefined; building: boolean; onClick: () => void }) {
  const ref = useTooltip<HTMLSpanElement>(blockedTooltip);
  return (
    <span ref={ref} tabIndex={blockedTooltip ? 0 : undefined} style={{ display: "inline-block", flex: 1 }}>
      <button
        type="button"
        className="btn btn-primary w-100 d-inline-flex align-items-center justify-content-center gap-1"
        disabled={disabled}
        onClick={onClick}
      >
        {building && <Spinner size="sm" />}
        Review Order
      </button>
    </span>
  );
}

export function SignalOrderSetupForm({ symbol, signals, candidate, spotPrice, netEdgeAtSelection, selectedAtIso, onCancel, onSubmitted }: SignalOrderSetupFormProps) {
  const isCall = candidate.strategyKey === "covered_call";
  const defaultQuantity = isCall && signals.freeShares >= 100 ? Math.floor(signals.freeShares / 100) : 1;
  const [contractQty, setContractQty] = useState(String(defaultQuantity));
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const quantity = Math.max(1, Math.floor(Number(contractQty) || 0));
  const mid = (candidate.bid + candidate.ask) / 2;
  const frictionAtMid = candidate.edge - candidate.netEdgeAtMid;
  const frictionAtBid = candidate.frictionVolatility;
  const concession = expectedSpreadConcession[adaptivePriority];
  const netEdgeExpected = candidate.netEdgeAtMid - (candidate.netEdgeAtMid - candidate.netEdge) * concession;
  const edgeDollarsExpected = netEdgeExpected * candidate.vega * 100;
  // Same mid-to-bid interpolation as netEdgeExpected, so the expected fill price backing the risk
  // denominator matches the same Adaptive priority assumption as the expected Edge $ numerator.
  const premiumExpected = mid - (mid - candidate.bid) * concession;
  const capitalAtRiskPerContract = isCall ? (spotPrice ?? 0) * 100 : candidate.strike * 100;
  const dollarRiskExpected = capitalAtRiskPerContract - premiumExpected;
  const riskAdjustedRatioExpected = edgeDollarsExpected / dollarRiskExpected;
  const decay = candidate.netEdge - netEdgeAtSelection;
  const decayed = Math.abs(decay) >= decayWarningVolatilityPoints / 100;
  const netEdgeFlash = useFlashOnChange(candidate.netEdge, 1200, 3);

  // A covered call always sends both legs (buy the shares, sell the call) in one order, so having
  // no free shares yet is the normal case, not a blocker -- only a cash-secured put needs the cash upfront.
  const blockingFlag = candidate.flags.find((flag) => flag === "insufficient_cash");
  const capitalAtRisk = isCall ? (spotPrice ?? 0) * 100 * quantity : candidate.strike * 100 * quantity;
  const maxGainAtBid = candidate.bid * 100 * quantity;

  async function handleReviewOrder() {
    setBuilding(true);
    setBuildError(null);
    try {
      const builtAtIso = new Date().toISOString();
      const order = await buildOpenOrder({
        symbol,
        strategyKey: candidate.strategyKey,
        option: { quantity, limitPrice: Number(mid.toFixed(2)), strikePrice: candidate.strike, expiryDate: candidate.expiry },
        signalSnapshot: {
          version: 1,
          candidate,
          ticker: {
            spotPrice,
            priceSource: signals.priceSource,
            snapshotDateIso: signals.snapshotDateIso,
            atmImpliedVolatility: signals.atmImpliedVolatility,
            forecast: signals.forecast,
            momentum: signals.momentum,
            skew: signals.skew,
            elevatedVolatility: signals.elevatedVolatility,
            nextEarningsDateIso: signals.nextEarningsDateIso,
            gradeCounts: signals.gradeCounts,
          },
          order: { quantity, adaptivePriority, referencePremium: Number(mid.toFixed(2)), netEdgeExpected, edgeDollarsExpected, riskAdjustedRatioExpected },
          timing: { selectedAtIso, builtAtIso, netEdgeAtSelection, netEdgeAtBuild: candidate.netEdge },
        },
      });
      onSubmitted(order, adaptivePriority);
    } catch (err) {
      setBuildError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to build order.");
    } finally {
      setBuilding(false);
    }
  }

  const gradeForExpected = netEdgeExpected <= 0 ? "avoid" : candidate.grade;

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Order Setup
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          {isCall ? "Covered Call" : "Cash-Secured Put"} · {symbol}{" "}
          <span className="text-secondary fw-normal">
            {describeCandidate(candidate)} · {candidate.dte}DTE
          </span>
        </h4>
      </div>

      {blockingFlag && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Cannot place now:</strong> not enough free cash to secure this put. The score is still shown.
        </div>
      )}

      {isCall && signals.freeShares > 0 && (
        <div className="alert alert-info mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          {signals.freeShares} share{signals.freeShares === 1 ? "" : "s"} available to cover this call.
        </div>
      )}

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-2">
          <div>
            <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
              Signal
            </div>
            <span className={`h3 mb-0 font-mono ${candidate.netEdge > 0 ? "text-success" : "text-danger"} ${flashClassName(netEdgeFlash)}`}>{formatVolatilityPoints(candidate.netEdge)}</span>{" "}
            <span className="text-secondary" style={{ fontSize: "0.8rem" }}>
              net Edge ({formatSignedPnl(edgeDollarsExpected, 0)})
            </span>
          </div>
          <span className={`badge ${gradeBadgeClass[gradeForExpected]}`} style={{ fontSize: "0.8rem" }}>
            {gradeLabel[gradeForExpected]}
          </span>
        </div>
        <div className="mt-2">
          <Row label="Surface IV at this strike (10:00 snapshot, live spot)" value={formatPercentage(candidate.surfaceImpliedVolatility, 1)} />
          <Row label={`Forecast volatility (${signals.forecast?.windowDays ?? 63}-day Yang-Zhang)`} value={formatPercentage(candidate.forecastVolatility, 1)} />
          <Row label="Friction (mid-bid range)" value={`${formatVolatilityPoints(frictionAtMid).replace("+", "")} – ${formatVolatilityPoints(frictionAtBid).replace("+", "")}`} />
        </div>
        <div className={`d-flex align-items-center gap-2 mt-2 rounded px-2 py-1 ${decayed ? "bg-warning-lt" : "bg-secondary-lt"}`} style={{ fontSize: "0.78rem" }}>
          {decayed ? `Net Edge has moved ${formatVolatilityPoints(decay)} since you selected this contract at ${formatDate(selectedAtIso)}.` : `Net Edge is steady since you selected this contract (${formatVolatilityPoints(netEdgeAtSelection)}).`}
          <span className="ms-auto d-inline-flex align-items-center gap-1 text-secondary">
            <span className="iorio-pulse-dot" />
            live
          </span>
        </div>
      </div>

      <div className="border rounded p-3">
        <Row label="Contract IV: live mid vs surface" value={candidate.midImpliedVolatility === null ? "—" : `${formatPercentage(candidate.midImpliedVolatility, 1)} vs ${formatPercentage(candidate.surfaceImpliedVolatility, 1)} (${formatVolatilityPoints(candidate.midImpliedVolatility - candidate.surfaceImpliedVolatility)})`} />
        <Row label="Delta drift risk" value={candidate.uncompensatedSharePercent === null ? "…" : `${candidate.uncompensatedSharePercent.toFixed(0)}% of P&L variance`} />
        <Row label="Tilt" value={`momentum ${signals.momentum === null ? "n/a" : formatSignedPercentageValue(signals.momentum * 100, 0)} · skew ${signals.skew ? formatVolatilityPoints(signals.skew.skew) : "—"} · vol ${signals.elevatedVolatility ? (signals.elevatedVolatility.elevated ? "elevated" : "normal") : "n/a"}`} />
        {candidate.flags.length === 0 ? (
          <Row label="Flags" value={<span className="text-secondary">none</span>} />
        ) : (
          candidate.flags.map((flag) => (
            <div key={flag} className="d-flex align-items-start gap-2 py-1" style={{ fontSize: "0.8rem" }}>
              <span className="badge bg-warning-lt" style={{ fontSize: "0.72rem", flex: "none" }}>
                {signalFlagLetter[flag]}
              </span>
              <span>{signalFlagExplanation[flag]}</span>
            </div>
          ))
        )}
      </div>

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <label className="form-label mb-0 text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }} htmlFor="signal-order-qty">
            Contracts
          </label>
          <input id="signal-order-qty" type="number" min={1} step={1} className="form-control form-control-sm font-mono" style={{ width: "6rem" }} value={contractQty} onChange={(event) => setContractQty(event.target.value)} />
        </div>
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <span className="text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }}>
            Fill priority (IBKR Adaptive)
          </span>
          <div className="btn-group" role="group">
            {adaptivePriorities.map((priority) => (
              <button key={priority} type="button" className={`btn btn-sm ${priority === adaptivePriority ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setAdaptivePriority(priority)}>
                {priority}
              </button>
            ))}
          </div>
        </div>
        <Row label="Reference premium (bid)" value={formatCurrency(candidate.bid)} />
        <Row label="Max gain (at bid)" value={formatSignedPnl(maxGainAtBid, 0)} tone="text-success" />
        <Row label="Capital at risk" value={formatCurrency(capitalAtRisk, 0)} />
        <Row label="Annualised yield" value={formatPercentage(candidate.annualizedYield, 0)} />
        {isCall && (
          <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
            = {quantity * 100} shares required · you hold {signals.freeShares} free share{signals.freeShares === 1 ? "" : "s"} of {symbol}
          </div>
        )}
      </div>

      {buildError && <div className="alert alert-danger mb-0">{buildError}</div>}

      <div className="d-flex gap-2">
        <ReviewOrderButton
          disabled={building || blockingFlag !== undefined}
          blockedTooltip={blockingFlag ? "You cannot place this now" : undefined}
          building={building}
          onClick={handleReviewOrder}
        />
        <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
