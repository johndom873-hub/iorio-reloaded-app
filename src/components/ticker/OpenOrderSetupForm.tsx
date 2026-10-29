import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { buildOpenOrder, type AdaptivePriority, type OrderRequest } from "../../api/positions";
import type { OptionStrategyKey } from "../../api/tickerTrading";
import { checkOrderLimits } from "../../api/orderChecks";
import { computeAnnualizedYield, computeExposurePerShare, computeFrictionDollarsPerContract, computePayoff } from "../../lib/payoff";
import { sessionsHeldToExpiry } from "../../lib/tradingSessions";
import { formatCurrency, formatOptionContractLabel, formatPercentage, formatQuotePrice, formatSignedPnl } from "../../lib/formatters";
import { useTooltip } from "../../hooks/useTooltip";
import { useTradingSessions } from "../../hooks/useTradingSessions";
import { FillPriorityPicker } from "../FillPriorityPicker";
import { Spinner } from "../Spinner";
import { OrderCommissionRows } from "../OrderCommissionRows";
import { toIbkrExpiry, useOrderCommissionPreview } from "../../hooks/useOrderCommissionPreview";
import type { CommissionPreviewLeg, OrderLimitsResult } from "../../api/orderChecks";

// Order setup for a contract picked on the Ticker modal's chain (2026-10-27, the former chain-contract form without
// Signals): the live quote and the plain payoff. Builds through POST /positions/orders and hands the OrderRequest
// up to the shared OrderReviewPanel.

const orderLimitsDebounceMs = 400;

export interface PickedContractQuote {
  strategyKey: OptionStrategyKey;
  expiry: string;
  strike: number;
  dte: number;
  /** Live, from the `optionQuotes` stream; null until the first quote arrives (or with the market shut). */
  bid: number | null;
  ask: number | null;
  delta: number | null;
}

interface OpenOrderSetupFormProps {
  symbol: string;
  contract: PickedContractQuote;
  /** Free shares to cover a call; null while unknown. */
  freeShares: number | null;
  spotPrice: number | null;
  /** λ (0..1), the Risk & Limits spread cost: the yield is after the same costs as the chain's (Marcelo, 2026-10-12). */
  spreadShareCharged: number | null;
  /** Shown above the quote (e.g. the earnings date falling before expiry). */
  notice: ReactNode;
  /** Why this viewer may not open or roll on the ticker (a trader, where Pluto trades it), or null: a blocking reason, checked before anything is built. */
  accessLevelRefusal: string | null;
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

export function OpenOrderSetupForm({ symbol, contract, freeShares, spotPrice, spreadShareCharged, notice, accessLevelRefusal, onCancel, onSubmitted }: OpenOrderSetupFormProps) {
  const isCall = contract.strategyKey === "covered_call";
  const hasTwoSidedQuote = contract.bid !== null && contract.ask !== null;
  const mid = hasTwoSidedQuote ? (contract.bid! + contract.ask!) / 2 : null;
  const defaultQuantity = isCall && freeShares !== null && freeShares >= 100 ? Math.floor(freeShares / 100) : 1;
  const [contractQty, setContractQty] = useState(String(defaultQuantity));
  const [limitPriceInput, setLimitPriceInput] = useState(mid === null ? "" : mid.toFixed(2));
  // The first live quote fills an empty limit price (a pick made before its quote arrived); a typed price is never overwritten.
  useEffect(() => {
    if (mid !== null) setLimitPriceInput((current) => (current === "" ? mid.toFixed(2) : current));
  }, [mid]);
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const tradingSessions = useTradingSessions();
  const quantity = Math.max(1, Math.floor(Number(contractQty) || 0));
  const limitPrice = Number(limitPriceInput);
  const limitPriceValid = limitPriceInput.trim() !== "" && Number.isFinite(limitPrice) && limitPrice > 0;
  const premiumTotal = limitPriceValid ? limitPrice * 100 * quantity : null;
  // After costs, as the chain cell shows it: the spread cost share of the contract's half-spread plus the flat commission.
  const frictionDollarsPerContract = contract.bid !== null && contract.ask !== null && spreadShareCharged !== null ? computeFrictionDollarsPerContract({ bid: contract.bid, ask: contract.ask, spreadShareCharged }) : null;
  const annualizedYield = limitPriceValid && spotPrice !== null && frictionDollarsPerContract !== null && tradingSessions !== null ? computeAnnualizedYield(contract.strategyKey, { premium: limitPrice, sessionsHeld: sessionsHeldToExpiry(tradingSessions, contract.expiry), strike: contract.strike, spotPrice, frictionDollarsPerContract }) : null;
  // EXP $ at the limit price, net of the premium: the same as Positions will show once it fills.
  const exposurePerShareAtLimit = limitPriceValid ? computeExposurePerShare(contract.strategyKey, { strike: contract.strike, spotPrice: spotPrice ?? 0, premium: limitPrice }) : null;
  const capitalAtRisk = exposurePerShareAtLimit === null ? null : exposurePerShareAtLimit * 100 * quantity;
  // Expiration payoff at the limit price: a covered call buys the shares at spot in the same order.
  const payoff =
    !limitPriceValid || (isCall && spotPrice === null)
      ? null
      : computePayoff(contract.strategyKey, [
          ...(isCall ? [{ legType: "stock" as const, optionType: null, entryPrice: String(spotPrice), strikePrice: null, quantity: quantity * 100, multiplier: 1 }] : []),
          { legType: "option", optionType: isCall ? "call" : "put", entryPrice: String(limitPrice), strikePrice: String(contract.strike), quantity, multiplier: 100 },
        ]);

  // One what-if per form for the commission preview; a covered call short of shares buys the rest in the same combo.
  const coveredCallEntryShares = isCall && freeShares !== null ? Math.max(0, quantity * 100 - freeShares) : 0;
  const limitPriceForPreview = limitPriceValid ? Number(limitPrice.toFixed(2)) : 0;
  const commissionPreviewLegs: CommissionPreviewLeg[] | null =
    limitPriceForPreview > 0 && (coveredCallEntryShares === 0 || (spotPrice !== null && spotPrice > 0))
      ? [
          ...(coveredCallEntryShares > 0 ? [{ role: "stock" as const, action: "BUY" as const, symbol, quantity: coveredCallEntryShares, unitPrice: spotPrice! }] : []),
          { role: "option" as const, action: "SELL" as const, symbol, quantity, unitPrice: limitPriceForPreview, strike: contract.strike, expiry: toIbkrExpiry(contract.expiry), right: isCall ? ("C" as const) : ("P" as const) },
        ]
      : null;
  const commissionPreview = useOrderCommissionPreview(commissionPreviewLegs);

  // Debounced order-limits check (cosmetic: confirm re-checks server-side, so a failed check fails open).
  // It needs the limit price (the exposure is net of the premium); the price is typed, not live, so it re-checks on edits only.
  const [orderLimitsResult, setOrderLimitsResult] = useState<OrderLimitsResult | null>(null);
  const limitsDebounceRef = useRef<number | null>(null);
  const premiumForLimits = limitPriceValid ? limitPriceForPreview : null;
  useEffect(() => {
    if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    if (premiumForLimits === null) {
      setOrderLimitsResult(null);
      return;
    }
    limitsDebounceRef.current = window.setTimeout(() => {
      checkOrderLimits({ symbol, strategyKey: contract.strategyKey, quantity, strike: contract.strike, premium: premiumForLimits, spotPrice: isCall ? spotPrice : null })
        .then(setOrderLimitsResult)
        .catch(() => setOrderLimitsResult(null));
    }, orderLimitsDebounceMs);
    return () => {
      if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    };
  }, [symbol, contract.strategyKey, contract.strike, quantity, premiumForLimits, spotPrice, isCall]);

  const blockingReasons = [...(accessLevelRefusal ? [accessLevelRefusal] : []), ...(orderLimitsResult?.blocked ? orderLimitsResult.reasons : [])];
  const reviewBlockedMessage = !hasTwoSidedQuote
    ? "No live bid and ask for this contract right now (market closed, or no quote yet). An order needs a live quote — try again while the market is open."
    : !limitPriceValid
      ? "Enter a limit price above zero."
      : null;

  async function handleReviewOrder() {
    if (!limitPriceValid) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const order = await buildOpenOrder({
        symbol,
        strategyKey: contract.strategyKey,
        option: { quantity, limitPrice: Number(limitPrice.toFixed(2)), strikePrice: contract.strike, expiryDate: contract.expiry },
      });
      onSubmitted(order, adaptivePriority);
    } catch (err) {
      setBuildError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to build order.");
    } finally {
      setBuilding(false);
    }
  }

  const reviewDisabled = building || blockingReasons.length > 0 || reviewBlockedMessage !== null;

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Order Setup
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          {isCall ? "Covered Call" : "Cash-Secured Put"} · {symbol}{" "}
          <span className="text-secondary fw-normal">
            {formatOptionContractLabel({ strike: contract.strike, right: isCall ? "C" : "P", expiry: contract.expiry, dte: contract.dte })}
          </span>
        </h4>
      </div>

      {notice}

      {blockingReasons.length > 0 && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Cannot place now:</strong> {blockingReasons.join(" ")}
        </div>
      )}

      {isCall && freeShares !== null && freeShares > 0 && (
        <div className="alert alert-info mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          {freeShares} share{freeShares === 1 ? "" : "s"} available to cover this call.
        </div>
      )}

      <div className="border rounded p-3">
        <Row label="Bid / Ask" value={`${formatQuotePrice(contract.bid)} / ${formatQuotePrice(contract.ask)}`} />
        <Row label="Delta" value={contract.delta === null ? "—" : `${contract.delta > 0 ? "+" : ""}${contract.delta.toFixed(2)}`} />
      </div>

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <label className="form-label mb-0 text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }} htmlFor="chain-contract-order-qty">
            Contracts
          </label>
          <input id="chain-contract-order-qty" type="number" min={1} step={1} className="form-control form-control-sm font-mono" style={{ width: "6rem" }} value={contractQty} onChange={(event) => setContractQty(event.target.value)} />
        </div>
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <label className="form-label mb-0 text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }} htmlFor="chain-contract-order-limit">
            Limit price
          </label>
          <input
            id="chain-contract-order-limit"
            type="number"
            min={0.01}
            step={0.01}
            className="form-control form-control-sm font-mono"
            style={{ width: "6rem" }}
            value={limitPriceInput}
            placeholder={mid === null ? "no quote" : undefined}
            onChange={(event) => setLimitPriceInput(event.target.value)}
          />
        </div>
        <div className="mb-2">
          <FillPriorityPicker value={adaptivePriority} onChange={setAdaptivePriority} />
        </div>
        <Row label="Premium (total)" value={formatCurrency(premiumTotal, 0)} tone="text-success" />
        <Row label="Annualised yield after costs" value={formatPercentage(annualizedYield, 0)} />
        <OrderCommissionRows {...commissionPreview} expectedPremiumDollars={premiumTotal ?? 0} />
        {payoff ? (
          <>
            <Row label="Max gain (at limit)" value={formatSignedPnl(payoff.maxGain, 0)} tone="text-success" />
            <Row label="Max loss (at limit)" value={formatSignedPnl(-payoff.maxLoss, 0)} tone="text-danger" />
            <Row label="Breakeven" value={formatCurrency(payoff.breakeven)} />
          </>
        ) : (
          <Row label="Max gain / loss" value="—" />
        )}
        <Row label="Capital at risk" value={formatCurrency(capitalAtRisk, 0)} />
        {isCall && (
          <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
            = {quantity * 100} shares required{freeShares !== null ? ` · you hold ${freeShares} free share${freeShares === 1 ? "" : "s"} of ${symbol}` : ""}
          </div>
        )}
      </div>

      {reviewBlockedMessage && (
        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
          {reviewBlockedMessage}
        </div>
      )}
      {buildError && <div className="alert alert-danger mb-0">{buildError}</div>}

      <div className="d-flex gap-2">
        <ReviewOrderButton disabled={reviewDisabled} blockedTooltip={reviewDisabled && !building ? (reviewBlockedMessage ?? "You cannot place this now") : undefined} building={building} onClick={handleReviewOrder} />
        <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
