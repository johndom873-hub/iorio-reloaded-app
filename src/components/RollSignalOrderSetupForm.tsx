import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { buildRollOrder, type AdaptivePriority, type OrderRequest } from "../api/positions";
import type { HeldLegScore, RollSignalCandidate, SignalGrade, TickerSignals, UnscoredSignalContract } from "../api/signals";
import { checkOrderLimits } from "../api/orderChecks";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatPercentage, formatPercentageValue, formatQuotePrice, formatSignedPnl } from "../lib/formatters";
import { computeExposurePerShare } from "../lib/payoff";
import { RollValuationCard } from "./signals/ModelValuationCard";
import { describeHeldLeg, describeNonLiveQuoteBlock, describeRollSignalFlag, describeRollSignalWarning, describeSignalFlag, gradeLabel, heldLegUnscoredReasonLabel, rollFlagLetter, signalFlagLetter } from "../lib/signalsPresentation";
import { Spinner } from "./Spinner";
import { OrderCommissionRows } from "./OrderCommissionRows";
import { toIbkrExpiry, useOrderCommissionPreview } from "../hooks/useOrderCommissionPreview";
import type { CommissionPreviewLeg, OrderLimitsResult } from "../api/orderChecks";
import { useTooltip } from "../hooks/useTooltip";

// Roll Signals order setup (mockup rev 4 approved 2026-09-24). Same split as
// SignalOrderSetupForm: the form half only -- it builds the roll through the
// existing POST /positions/:id/roll (one two-leg IBKR combo at a net credit
// limit) with the roll snapshot attached, and hands the OrderRequest up; the
// caller renders the shared OrderReviewPanel. The cards mirror the Signal
// form: the roll's valuation (the model's net roll $ and Edge margin, and how
// far the margin has moved since the roll was selected), the two legs, and the
// order (quantity fixed to the held leg -- no partial rolls -- fill priority,
// net credit, the realised P&L locked in on the held leg).

/** How far the roll's Edge margin may move from its value at selection (a fraction: 2 points) before the notice warns. */
export const rollEdgeMarginMoveWarning = 0.02;
const orderLimitsDebounceMs = 400;
const adaptivePriorities: AdaptivePriority[] = ["Patient", "Normal", "Urgent"];

interface RollSignalOrderSetupFormProps {
  symbol: string;
  signals: TickerSignals;
  /** The selected roll as scored NOW (it re-renders with every live frame); null when the picked chain contract has no Signals score. */
  roll: RollSignalCandidate | null;
  /** The picked chain contract's quote when it could not be scored (then `roll` is null): no net roll Edge, the order still builds. */
  unscoredReplacement?: UnscoredSignalContract | null;
  /** The held leg the roll closes, as scored now. */
  held: HeldLegScore;
  spotPrice: number | null;
  /** The roll's Edge margin and grade when it was selected (null for a chain pick): the change notice's reference. */
  rollEdgeMarginAtSelection: number | null;
  rollGradeAtSelection: SignalGrade | null;
  selectedAtIso: string;
  /** Why the picked chain contract is not a Signals candidate / has no score, shown above the roll signal. */
  notice?: ReactNode;
  /** Why this viewer may not open or roll on the ticker (a trader, where Pluto trades it), or null: a blocking reason, checked before anything is built. */
  accessLevelRefusal: string | null;
  onCancel: () => void;
  onSubmitted: (order: OrderRequest, adaptivePriority: AdaptivePriority) => void;
}

function Row({ label, value, tone, strong }: { label: ReactNode; value: ReactNode; tone?: string; strong?: boolean }) {
  return (
    <div className={`d-flex justify-content-between gap-3 py-1 ${strong ? "border-top mt-1 pt-2" : ""}`} style={{ fontSize: "0.85rem" }}>
      <span className={strong ? "fw-semibold" : "text-secondary"}>{label}</span>
      <span className={`font-mono text-end text-nowrap ${strong ? "fw-semibold" : ""} ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function ReviewOrderButton({ disabled, blockedTooltip, building, onClick }: { disabled: boolean; blockedTooltip: string | undefined; building: boolean; onClick: () => void }) {
  const ref = useTooltip<HTMLSpanElement>(blockedTooltip);
  return (
    <span ref={ref} tabIndex={blockedTooltip ? 0 : undefined} style={{ display: "inline-block", flex: 1 }}>
      <button type="button" className="btn btn-primary w-100 d-inline-flex align-items-center justify-content-center gap-1" disabled={disabled} onClick={onClick}>
        {building && <Spinner size="sm" />}
        Review Order
      </button>
    </span>
  );
}

export function RollSignalOrderSetupForm({ symbol, signals, roll, unscoredReplacement = null, held, spotPrice, rollEdgeMarginAtSelection, rollGradeAtSelection, selectedAtIso, notice = null, accessLevelRefusal, onCancel, onSubmitted }: RollSignalOrderSetupFormProps) {
  const replacement = roll?.replacement ?? null;
  const target = replacement ?? unscoredReplacement!;
  const quantity = held.quantity;
  const isCall = held.strategyKey === "covered_call";
  const right = isCall ? "Call" : "Put";
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const heldMid = held.mid ?? 0;
  const heldAsk = held.ask ?? heldMid;
  const replacementTwoSided = target.bid !== null && target.ask !== null;
  const replacementMid = replacementTwoSided ? (target.bid! + target.ask!) / 2 : 0;
  const netCreditAtMid = roll ? roll.netCreditPerShare : replacementMid - heldMid;
  const netCreditWorst = (target.bid ?? 0) - heldAsk;
  const isDebit = netCreditAtMid < 0;
  const netWord = isDebit ? "debit" : "credit";
  const netMoney = (perShare: number, decimals?: number) => formatCurrency(isDebit ? -perShare : perShare, decimals);
  // EXP $ per contract of the new leg (the Signals score's, else computed the same way): strike (put) or spot (call), less its premium.
  const replacementExposurePerShare = computeExposurePerShare(held.strategyKey, { strike: target.strike, spotPrice: spotPrice ?? 0, premium: replacementMid });
  const replacementDollarRisk = replacement ? replacement.dollarRisk : replacementExposurePerShare === null ? null : replacementExposurePerShare * 100;
  // Both legs go out at their mids; the expected fill gives up the Risk & Limits share of both half-spreads (the
  // way from the mid credit to the worst case), the same assumption the model's roll is valued with.
  const netCreditExpected = netCreditAtMid - (netCreditAtMid - netCreditWorst) * signals.spreadShareCharged;
  const edgeMarginMoved =
    roll !== null && rollEdgeMarginAtSelection !== null && (Math.abs(roll.model.edgeMargin - rollEdgeMarginAtSelection) >= rollEdgeMarginMoveWarning || roll.model.grade !== rollGradeAtSelection);
  const realisedOnHeldLeg = (held.entryPrice - heldMid) * 100 * quantity;
  const capitalAtRiskAfter = replacementDollarRisk === null ? null : replacementDollarRisk * quantity; // net of the new leg's premium, as Positions counts it

  // One IBKR what-if for the whole two-leg combo (re-asked only when the legs change, never on a price tick); the
  // expected premium is the expected net credit, so a roll whose credit barely covers the commission warns.
  const heldLimitForPreview = Number(heldMid.toFixed(2));
  const replacementLimitForPreview = Number(replacementMid.toFixed(2));
  const rollRight = isCall ? ("C" as const) : ("P" as const);
  const commissionPreviewLegs: CommissionPreviewLeg[] | null =
    heldLimitForPreview > 0 && replacementLimitForPreview > 0
      ? [
          { role: "option", action: "BUY", symbol, quantity, unitPrice: heldLimitForPreview, strike: held.strike, expiry: toIbkrExpiry(held.expiry), right: rollRight },
          { role: "option", action: "SELL", symbol, quantity, unitPrice: replacementLimitForPreview, strike: target.strike, expiry: toIbkrExpiry(target.expiry), right: rollRight },
        ]
      : null;
  const commissionPreview = useOrderCommissionPreview(commissionPreviewLegs);
  // The limit check reads both legs' prices when it runs, without re-running on every price tick.
  const rollPricesForLimitsRef = useRef({ premium: replacementLimitForPreview, buyback: heldLimitForPreview });
  rollPricesForLimitsRef.current = { premium: replacementLimitForPreview, buyback: heldLimitForPreview };

  // The blocking order limits, re-checked against the backend with the roll rule (only the
  // strike difference less the net credit adds notional). Cosmetic: POST /orders/:id/confirm is the real gate.
  const [orderLimitsResult, setOrderLimitsResult] = useState<OrderLimitsResult | null>(null);
  const limitsDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    limitsDebounceRef.current = window.setTimeout(() => {
      // No spot price: a roll's notional never uses it (only the strike difference counts), and passing it re-ran the check on every price tick.
      const prices = rollPricesForLimitsRef.current;
      checkOrderLimits({ symbol, strategyKey: held.strategyKey, quantity, strike: target.strike, premium: prices.premium, rollFrom: { strike: held.strike, premium: prices.buyback } })
        .then(setOrderLimitsResult)
        .catch(() => setOrderLimitsResult(null));
    }, orderLimitsDebounceMs);
    return () => {
      if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    };
  }, [symbol, held.strategyKey, target.strike, quantity, held.strike]);

  const quotesAreLive = held.quoteSource === "live" && target.quoteSource === "live";
  const blockingReasons = [
    ...(accessLevelRefusal ? [accessLevelRefusal] : []),
    ...(held.mid === null ? ["The held leg has no live two-sided quote right now."] : []),
    ...(replacementTwoSided ? [] : ["The new contract has no two-sided quote right now."]),
    ...[describeNonLiveQuoteBlock("The leg you hold", held.quoteSource), describeNonLiveQuoteBlock("The new contract", target.quoteSource)].filter((reason): reason is string => reason !== null),
    ...(orderLimitsResult?.blocked ? orderLimitsResult.reasons : []),
  ];

  async function handleReviewOrder() {
    setBuilding(true);
    setBuildError(null);
    try {
      const builtAtIso = new Date().toISOString();
      const order = await buildRollOrder(held.positionId, {
        closeLegId: held.legId,
        closeLimitPrice: Number(heldMid.toFixed(2)),
        newLeg: { strikePrice: target.strike, expiryDate: target.expiry, quantity, limitPrice: Number(replacementMid.toFixed(2)) },
        signalSnapshot: {
          version: 1,
          kind: "roll",
          closeLeg: held,
          replacement: replacement ?? { scored: false, ...unscoredReplacement },
          roll: roll
            ? {
                netExpectedPnlPerContract: roll.model.netExpectedPnlPerContract,
                netExpectedPnl: roll.model.netExpectedPnl,
                edgeMargin: roll.model.edgeMargin,
                netCreditPerShare: roll.netCreditPerShare,
                netCreditWorstPerShare: netCreditWorst,
                deltaChange: roll.deltaChange,
                dollarRiskChange: roll.dollarRiskChange,
                flags: roll.flags,
                warnings: roll.warnings,
                grade: roll.model.grade,
              }
            : null,
          ticker: {
            spotPrice,
            priceSource: signals.priceSource,
            snapshotDateIso: signals.snapshotDateIso,
            atmImpliedVolatility: signals.atmImpliedVolatility,
            modelForecast: signals.modelForecast,
            momentum: signals.momentum,
            skew: signals.skew,
            elevatedVolatility: signals.elevatedVolatility,
            nextEarningsDateIso: signals.nextEarningsDateIso,
          },
          order: { quantity, adaptivePriority, closeLimitPrice: Number(heldMid.toFixed(2)), newLegLimitPrice: Number(replacementMid.toFixed(2)), netCreditExpected, realisedOnHeldLeg },
          timing: { selectedAtIso, builtAtIso, rollEdgeMarginAtSelection, rollEdgeMarginAtBuild: roll?.model.edgeMargin ?? null },
        },
      });
      onSubmitted(order, adaptivePriority);
    } catch (err) {
      setBuildError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to build the roll order.");
    } finally {
      setBuilding(false);
    }
  }

  const legRow = (label: string, side: "buy" | "sell", contract: string, bid: number | null, ask: number | null, delta: number | null, midIv: number | null, surfaceIv: number | null) => (
    <tr>
      <td>
        <span className={`badge ${side === "buy" ? "bg-warning-lt" : "bg-azure-lt"}`} style={{ fontSize: "0.7rem" }}>
          {label}
        </span>
      </td>
      <td className="text-nowrap">{contract}</td>
      <td className="text-end font-mono">{formatQuotePrice(bid)}</td>
      <td className="text-end font-mono">{formatQuotePrice(ask)}</td>
      <td className="text-end font-mono">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}</td>
      <td className="text-end font-mono text-nowrap">
        {formatPercentage(midIv, 1)} / {formatPercentage(surfaceIv, 1)}
      </td>
    </tr>
  );

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Order Setup
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          Roll {right} · {symbol}{" "}
          <span className="text-secondary fw-normal">
            {formatCurrencyTrimmed(held.strike)}{held.dte === null ? "" : ` · ${held.dte} DTE`} → {formatCurrencyTrimmed(target.strike)} · {target.dte} DTE
          </span>
        </h4>
      </div>
      {blockingReasons.length > 0 && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Cannot place now:</strong> {blockingReasons.join(" ")} The score is still shown.
        </div>
      )}
      {roll && roll.warnings.length > 0 && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Not one of the listed rolls.</strong> {roll.warnings.map((warning) => describeRollSignalWarning(warning)).join(" ")}
        </div>
      )}
      {notice}
      <div className="alert alert-info mb-0 py-2" style={{ fontSize: "0.85rem" }}>
        Rolls the whole leg: {quantity} contract{quantity === 1 ? "" : "s"} close, {quantity} open, as one IBKR combo at a net {netWord} limit.
      </div>

      {roll && replacement && <RollValuationCard roll={roll} held={held} replacement={replacement} quantity={quantity} />}
      {roll && replacement ? (
        <div className={`d-flex align-items-center gap-2 rounded px-2 py-1 ${edgeMarginMoved ? "bg-warning-lt" : "bg-secondary-lt"}`} style={{ fontSize: "0.78rem" }}>
          {rollEdgeMarginAtSelection === null
            ? `Roll Edge margin ${formatPercentageValue(roll.model.edgeMargin * 100)}.`
            : edgeMarginMoved
              ? `Roll Edge margin was ${formatPercentageValue(rollEdgeMarginAtSelection * 100)}, now ${formatPercentageValue(roll.model.edgeMargin * 100)}${rollGradeAtSelection !== null && roll.model.grade !== rollGradeAtSelection ? ` (${gradeLabel[rollGradeAtSelection]} → ${gradeLabel[roll.model.grade]})` : ""} since you selected this roll at ${formatDate(selectedAtIso)}.`
              : `Roll Edge margin is steady since you selected this roll (${formatPercentageValue(rollEdgeMarginAtSelection * 100)}).`}
          <span className="ms-auto d-inline-flex align-items-center gap-1 text-secondary">
            <span className="iorio-pulse-dot" />
            {quotesAreLive ? "live" : "waiting for live quotes"}
          </span>
        </div>
      ) : (
        <div className="border rounded p-3 text-secondary" style={{ fontSize: "0.85rem" }}>
          <div className="text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
            Roll signal
          </div>
          {held.unscoredReason
            ? `No Signals score for the leg you hold: ${heldLegUnscoredReasonLabel[held.unscoredReason]}. So the roll has no valuation.`
            : "The valuation model could not value this roll, so it has no Signals score."}{" "}
          The order can still be placed at the quotes below.
        </div>
      )}

      <div className="border rounded p-3">
        <div className="text-secondary text-uppercase mb-1" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Legs
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-vcenter card-table mb-1" style={{ fontSize: "0.8rem" }}>
            <thead className="table-light">
              <tr>
                <th></th>
                <th>Contract</th>
                <th className="text-end">Bid</th>
                <th className="text-end">Ask</th>
                <th className="text-end">Δ</th>
                <th className="text-end">IV mid / surf.</th>
              </tr>
            </thead>
            <tbody>
              {legRow("Buy to close", "buy", describeHeldLeg(held), held.bid, held.ask, held.delta, held.midImpliedVolatility, held.surfaceImpliedVolatility)}
              {legRow("Sell to open", "sell", describeHeldLeg({ right: isCall ? "C" : "P", strike: target.strike, dte: target.dte }), target.bid, target.ask, target.delta, replacement?.midImpliedVolatility ?? null, replacement?.surfaceImpliedVolatility ?? null)}
            </tbody>
          </table>
        </div>
        <Row label={`Net ${netWord} at mid · worst case (buy ask, sell bid)`} value={`${netMoney(netCreditAtMid)} · ${netMoney(netCreditWorst)} /sh`} tone={isDebit ? "text-danger" : undefined} />
        <Row label="Delta" value={`${held.delta === null ? "—" : held.delta.toFixed(2)} → ${target.delta === null ? "—" : target.delta.toFixed(2)}`} />
        <Row label="Capital at risk per contract" value={`${formatCurrency(held.dollarRisk, 0)} → ${formatCurrency(replacementDollarRisk, 0)}`} />
        <Row label="Delta drift risk (new leg)" value={!replacement ? "—" : replacement.uncompensatedSharePercent === null ? "…" : `${replacement.uncompensatedSharePercent.toFixed(0)}% of P&L variance`} />
        {(roll?.flags.length ?? held.flags.length) === 0 && (replacement?.flags.length ?? 0) === 0 ? (
          <Row label="Flags" value={<span className="text-secondary">none</span>} />
        ) : (
          <>
            {(roll?.flags ?? held.flags).map((flag) => (
              <div key={flag} className="d-flex align-items-start gap-2 py-1" style={{ fontSize: "0.8rem" }}>
                <span className="badge bg-warning-lt" style={{ fontSize: "0.72rem", flex: "none" }}>
                  {rollFlagLetter[flag]}
                </span>
                <span>{describeRollSignalFlag(flag, held)}</span>
              </div>
            ))}
            {(replacement ? replacement.flags : []).map((flag) => (
              <div key={flag} className="d-flex align-items-start gap-2 py-1" style={{ fontSize: "0.8rem" }}>
                <span className="badge bg-warning-lt" style={{ fontSize: "0.72rem", flex: "none" }}>
                  {signalFlagLetter[flag]}
                </span>
                <span>New leg: {describeSignalFlag(flag, replacement!, signals.macroEvents)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <span className="text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }}>
            Contracts
          </span>
          <span className="font-mono fw-semibold">{quantity}</span>
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
        <Row label={`Net ${netWord} limit (mid)`} value={`${netMoney(netCreditAtMid)} /sh · ${netMoney(netCreditAtMid * 100 * quantity, 0)} total`} />
        <Row label={`Expected net ${netWord} (${formatPercentage(signals.spreadShareCharged, 0)} of the half-spreads)`} value={`${netMoney(netCreditExpected)} /sh · ${netMoney(netCreditExpected * 100 * quantity, 0)} total`} />
        <Row label={`Held leg: sold at ${formatCurrency(held.entryPrice)}, closing near ${formatCurrency(heldMid)}`} value={`${formatSignedPnl(realisedOnHeldLeg, 0)} realised`} tone={realisedOnHeldLeg >= 0 ? "text-success" : "text-danger"} />
        <Row label="New leg credit (mid)" value={formatSignedPnl(replacementMid * 100 * quantity, 0)} tone="text-success" />
        <Row label="Capital at risk after roll" value={formatCurrency(capitalAtRiskAfter, 0)} />
        <Row label="Annualised yield, new leg" value={replacement ? formatPercentage(replacement.annualizedYield, 0) : "—"} />
        <OrderCommissionRows {...commissionPreview} expectedPremiumDollars={netCreditExpected * 100 * quantity} />
        <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
          Quantity follows the held leg. Partial rolls are not offered here.
        </div>
      </div>
      {buildError && <div className="alert alert-danger mb-0">{buildError}</div>}
      <div className="d-flex gap-2">
        <ReviewOrderButton disabled={building || blockingReasons.length > 0} blockedTooltip={blockingReasons.length > 0 ? "You cannot place this now" : undefined} building={building} onClick={handleReviewOrder} />
        <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
