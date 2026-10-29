import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { checkOrderLimits, type CommissionPreviewLeg, type OrderLimitsResult } from "../../api/orderChecks";
import { buildRollOrder, type AdaptivePriority, type OrderRequest } from "../../api/positions";
import type { LiveContractQuote, OpenShortLeg } from "../../api/tickerTrading";
import { toIbkrExpiry, useOrderCommissionPreview } from "../../hooks/useOrderCommissionPreview";
import { useTooltip } from "../../hooks/useTooltip";
import { useTradingSessions } from "../../hooks/useTradingSessions";
import { daysToExpiry, formatCurrency, formatOptionContractLabel, formatPercentage, formatQuotePrice, formatSignedPnl } from "../../lib/formatters";
import { computeAnnualizedYield, computeExposurePerShare, computeFrictionDollarsPerContract } from "../../lib/payoff";
import { sessionsHeldToExpiry } from "../../lib/tradingSessions";
import { FillPriorityPicker } from "../FillPriorityPicker";
import { OrderCommissionRows } from "../OrderCommissionRows";
import { Spinner } from "../Spinner";

// Roll order setup for the Ticker modal (2026-10-27, replacing the Roll Signals form): the held short leg and the
// contract picked on the chain, both at their live quotes. Builds the roll through POST /positions/:id/roll (one
// two-leg IBKR combo, both legs at their mids) and hands the OrderRequest up to the shared OrderReviewPanel.

const orderLimitsDebounceMs = 400;

interface RollOrderSetupFormProps {
  symbol: string;
  held: OpenShortLeg;
  heldQuote: LiveContractQuote | null;
  target: { expiry: string; strike: number; dte: number };
  targetQuote: LiveContractQuote | null;
  spotPrice: number | null;
  /** λ (0..1), the Risk & Limits spread cost share. */
  spreadShareCharged: number | null;
  notice?: ReactNode;
  /** Why this viewer may not open or roll on the ticker, or null: a blocking reason, checked before anything is built. */
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

// A disabled button fires no hover/focus events, so its tooltip lives on a wrapping span.
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

function midOf(quote: LiveContractQuote | null): number | null {
  return quote?.bid != null && quote.ask != null ? (quote.bid + quote.ask) / 2 : null;
}

function formatDelta(delta: number | null | undefined): string {
  return delta === null || delta === undefined ? "—" : delta.toFixed(2);
}

export function RollOrderSetupForm({ symbol, held, heldQuote, target, targetQuote, spotPrice, spreadShareCharged, notice = null, accessLevelRefusal, onCancel, onSubmitted }: RollOrderSetupFormProps) {
  const quantity = held.quantity;
  const isCall = held.strategyKey === "covered_call";
  const right = isCall ? ("C" as const) : ("P" as const);
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const heldMid = midOf(heldQuote);
  const replacementMid = midOf(targetQuote);
  const heldAsk = heldQuote?.ask ?? heldMid ?? 0;
  const netCreditAtMid = heldMid !== null && replacementMid !== null ? replacementMid - heldMid : null;
  const netCreditWorst = (targetQuote?.bid ?? 0) - heldAsk;
  const isDebit = (netCreditAtMid ?? 0) < 0;
  const tradingSessions = useTradingSessions();
  const netWord = isDebit ? "debit" : "credit";
  const netMoney = (perShare: number | null, decimals?: number) => (perShare === null ? "—" : formatCurrency(isDebit ? -perShare : perShare, decimals));
  // Both legs go out at their mids; the expected fill gives up the Risk & Limits share of both half-spreads (the way from the mid credit to the worst case).
  const netCreditExpected = netCreditAtMid === null || spreadShareCharged === null ? null : netCreditAtMid - (netCreditAtMid - netCreditWorst) * spreadShareCharged;
  // EXP $ per contract: strike (put) or spot (call), less the leg's premium, as Positions counts it.
  const heldExposurePerShare = heldMid === null ? null : computeExposurePerShare(held.strategyKey, { strike: held.strike, spotPrice: spotPrice ?? 0, premium: heldMid });
  const replacementExposurePerShare = replacementMid === null ? null : computeExposurePerShare(held.strategyKey, { strike: target.strike, spotPrice: spotPrice ?? 0, premium: replacementMid });
  const realisedOnHeldLeg = heldMid === null ? null : (held.entryPrice - heldMid) * 100 * quantity;
  const replacementYield =
    targetQuote?.bid != null && targetQuote.ask != null && replacementMid !== null && spreadShareCharged !== null && tradingSessions !== null
      ? computeAnnualizedYield(held.strategyKey, { premium: replacementMid, sessionsHeld: sessionsHeldToExpiry(tradingSessions, target.expiry), strike: target.strike, spotPrice: spotPrice ?? 0, frictionDollarsPerContract: computeFrictionDollarsPerContract({ bid: targetQuote.bid, ask: targetQuote.ask, spreadShareCharged }) })
      : null;

  // One IBKR what-if for the whole two-leg combo (re-asked only when the legs change, never on a price tick).
  const heldLimitForPreview = heldMid === null ? 0 : Number(heldMid.toFixed(2));
  const replacementLimitForPreview = replacementMid === null ? 0 : Number(replacementMid.toFixed(2));
  const commissionPreviewLegs: CommissionPreviewLeg[] | null =
    heldLimitForPreview > 0 && replacementLimitForPreview > 0
      ? [
          { role: "option", action: "BUY", symbol, quantity, unitPrice: heldLimitForPreview, strike: held.strike, expiry: toIbkrExpiry(held.expiry), right },
          { role: "option", action: "SELL", symbol, quantity, unitPrice: replacementLimitForPreview, strike: target.strike, expiry: toIbkrExpiry(target.expiry), right },
        ]
      : null;
  const commissionPreview = useOrderCommissionPreview(commissionPreviewLegs);
  // The limit check reads both legs' prices when it runs, without re-running on every price tick.
  const rollPricesForLimitsRef = useRef({ premium: replacementLimitForPreview, buyback: heldLimitForPreview });
  rollPricesForLimitsRef.current = { premium: replacementLimitForPreview, buyback: heldLimitForPreview };
  const [orderLimitsResult, setOrderLimitsResult] = useState<OrderLimitsResult | null>(null);
  const limitsDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    limitsDebounceRef.current = window.setTimeout(() => {
      const prices = rollPricesForLimitsRef.current;
      checkOrderLimits({ symbol, strategyKey: held.strategyKey, quantity, strike: target.strike, premium: prices.premium, rollFrom: { strike: held.strike, premium: prices.buyback } })
        .then(setOrderLimitsResult)
        .catch(() => setOrderLimitsResult(null));
    }, orderLimitsDebounceMs);
    return () => {
      if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    };
  }, [symbol, held.strategyKey, target.strike, quantity, held.strike]);

  const blockingReasons = [
    ...(accessLevelRefusal ? [accessLevelRefusal] : []),
    ...(heldMid === null ? ["The leg you hold has no live two-sided quote right now."] : []),
    ...(replacementMid === null ? ["The new contract has no live two-sided quote right now."] : []),
    ...(orderLimitsResult?.blocked ? orderLimitsResult.reasons : []),
  ];

  async function handleReviewOrder() {
    if (heldMid === null || replacementMid === null) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const order = await buildRollOrder(held.positionId, {
        closeLegId: held.legId,
        closeLimitPrice: Number(heldMid.toFixed(2)),
        newLeg: { strikePrice: target.strike, expiryDate: target.expiry, quantity, limitPrice: Number(replacementMid.toFixed(2)) },
      });
      onSubmitted(order, adaptivePriority);
    } catch (err) {
      setBuildError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to build the roll order.");
    } finally {
      setBuilding(false);
    }
  }

  const legRow = (label: string, side: "buy" | "sell", contract: string, quote: LiveContractQuote | null) => (
    <tr>
      <td className={side === "buy" ? "text-danger" : "text-success"}>{label}</td>
      <td className="text-nowrap">{contract}</td>
      <td className="text-end font-mono">{formatQuotePrice(quote?.bid ?? null)}</td>
      <td className="text-end font-mono">{formatQuotePrice(quote?.ask ?? null)}</td>
      <td className="text-end font-mono">{formatDelta(quote?.delta)}</td>
      <td className="text-end font-mono">{formatPercentage(quote?.impliedVolatility ?? null, 1)}</td>
    </tr>
  );

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Roll
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          {isCall ? "Covered Call" : "Cash-Secured Put"} · {symbol}
        </h4>
      </div>

      {notice}

      {blockingReasons.length > 0 && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Cannot place now:</strong> {blockingReasons.join(" ")}
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
                <th className="text-end">IV</th>
              </tr>
            </thead>
            <tbody>
              {legRow("Buy to close", "buy", formatOptionContractLabel({ strike: held.strike, right, expiry: held.expiry, dte: daysToExpiry(held.expiry) }), heldQuote)}
              {legRow("Sell to open", "sell", formatOptionContractLabel({ strike: target.strike, right, expiry: target.expiry, dte: target.dte }), targetQuote)}
            </tbody>
          </table>
        </div>
        <Row label={`Net ${netWord} at mid · worst case (buy ask, sell bid)`} value={`${netMoney(netCreditAtMid)} · ${netMoney(netCreditWorst)} /sh`} tone={isDebit ? "text-danger" : undefined} />
        <Row label="Delta" value={`${formatDelta(heldQuote?.delta)} → ${formatDelta(targetQuote?.delta)}`} />
        <Row label="Capital at risk per contract" value={`${formatCurrency(heldExposurePerShare === null ? null : heldExposurePerShare * 100, 0)} → ${formatCurrency(replacementExposurePerShare === null ? null : replacementExposurePerShare * 100, 0)}`} />
      </div>

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <span className="text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }}>
            Contracts
          </span>
          <span className="font-mono fw-semibold">{quantity}</span>
        </div>
        <div className="mb-2">
          <FillPriorityPicker value={adaptivePriority} onChange={setAdaptivePriority} />
        </div>
        <Row label={`Net ${netWord} limit (mid)`} value={`${netMoney(netCreditAtMid)} /sh · ${netMoney(netCreditAtMid === null ? null : netCreditAtMid * 100 * quantity, 0)} total`} />
        <Row label={`Expected net ${netWord} (${formatPercentage(spreadShareCharged, 0)} of the half-spreads)`} value={`${netMoney(netCreditExpected)} /sh · ${netMoney(netCreditExpected === null ? null : netCreditExpected * 100 * quantity, 0)} total`} />
        <Row label={`Held leg: sold at ${formatCurrency(held.entryPrice)}${heldMid === null ? "" : `, closing near ${formatCurrency(heldMid)}`}`} value={realisedOnHeldLeg === null ? "—" : `${formatSignedPnl(realisedOnHeldLeg, 0)} realised`} tone={realisedOnHeldLeg === null ? undefined : realisedOnHeldLeg >= 0 ? "text-success" : "text-danger"} />
        <Row label="Capital at risk after roll" value={formatCurrency(replacementExposurePerShare === null ? null : replacementExposurePerShare * 100 * quantity, 0)} />
        <Row label="Annualised yield after costs, new leg" value={formatPercentage(replacementYield, 0)} />
        <OrderCommissionRows {...commissionPreview} expectedPremiumDollars={(netCreditExpected ?? 0) * 100 * quantity} />
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
