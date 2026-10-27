import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { buildOpenOrder, type AdaptivePriority, type OrderRequest } from "../../api/positions";
import { checkOrderLimits, type CommissionPreviewLeg, type OrderLimitsResult } from "../../api/orderChecks";
import { toIbkrExpiry, useOrderCommissionPreview } from "../../hooks/useOrderCommissionPreview";
import { useTooltip } from "../../hooks/useTooltip";
import { computeLongCallPayoff } from "../../lib/payoff";
import { formatCurrency, formatNumber, formatOptionContractLabel, formatPercentage, formatQuotePrice, formatSignedPercentage, formatSignedPnl } from "../../lib/formatters";
import { FillPriorityPicker } from "../FillPriorityPicker";
import { LeapsPnlOverTimeModal } from "../LeapsPnlOverTimeModal";
import { Spinner } from "../Spinner";

// Order setup for a LEAPS, a Call bought on the Ticker modal's chain in Buy LEAPS mode (approved by Marcelo
// 2026-10-27): the cost is the most it can lose, the gain has no cap, the breakeven at expiry is strike + premium, and
// the "P&L over time" modal shows what the Call is worth before then. The premium counts toward the Risk & Limits
// rules and the traders' capital (checkOrderLimits with strategyKey "leaps"). Builds through POST /positions/orders.

const orderLimitsDebounceMs = 400;

export interface PickedLeapsContract {
  expiry: string;
  strike: number;
  dte: number;
  /** Live, from the `optionQuotes` stream; null until the first quote arrives. */
  bid: number | null;
  ask: number | null;
  delta: number | null;
  impliedVolatility: number | null;
}

interface LeapsOrderSetupFormProps {
  symbol: string;
  contract: PickedLeapsContract;
  spotPrice: number | null;
  /** Shown above the quote (e.g. the earnings date falling before expiry). */
  notice: ReactNode;
  /** Why this viewer may not open on the ticker (a trader, where Pluto trades it), or null. */
  accessLevelRefusal: string | null;
  onCancel: () => void;
  onSubmitted: (order: OrderRequest, adaptivePriority: AdaptivePriority) => void;
}

function Row({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="d-flex justify-content-between align-items-center gap-3 py-1" style={{ fontSize: "0.85rem" }}>
      <span className="text-secondary">{label}</span>
      <span className={`font-mono text-end ${tone ?? ""}`}>{value}</span>
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

export function LeapsOrderSetupForm({ symbol, contract, spotPrice, notice, accessLevelRefusal, onCancel, onSubmitted }: LeapsOrderSetupFormProps) {
  const hasTwoSidedQuote = contract.bid !== null && contract.ask !== null;
  const mid = hasTwoSidedQuote ? (contract.bid! + contract.ask!) / 2 : null;
  const [contractQty, setContractQty] = useState("1");
  const [limitPriceInput, setLimitPriceInput] = useState(mid === null ? "" : mid.toFixed(2));
  // The first live quote fills an empty limit price; a typed price is never overwritten.
  useEffect(() => {
    if (mid !== null) setLimitPriceInput((current) => (current === "" ? mid.toFixed(2) : current));
  }, [mid]);
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showPnlOverTime, setShowPnlOverTime] = useState(false);

  const quantity = Math.max(1, Math.floor(Number(contractQty) || 0));
  const limitPrice = Number(limitPriceInput);
  const limitPriceValid = limitPriceInput.trim() !== "" && Number.isFinite(limitPrice) && limitPrice > 0;
  const limitPriceInCents = limitPriceValid ? Number(limitPrice.toFixed(2)) : null;
  const payoff = limitPriceInCents === null ? null : computeLongCallPayoff([{ legType: "option", optionType: "call", entryPrice: String(limitPriceInCents), strikePrice: String(contract.strike), quantity, multiplier: 100 }]);
  const cost = payoff?.maxLoss ?? null;
  const shares = quantity * 100;

  const commissionPreviewLegs: CommissionPreviewLeg[] | null = limitPriceInCents === null ? null : [{ role: "option", action: "BUY", symbol, quantity, unitPrice: limitPriceInCents, strike: contract.strike, expiry: toIbkrExpiry(contract.expiry), right: "C" }];
  const commissionPreview = useOrderCommissionPreview(commissionPreviewLegs);

  // Debounced limits check (cosmetic: confirm re-checks server-side). Its figures also give the share of the account.
  const [orderLimitsResult, setOrderLimitsResult] = useState<OrderLimitsResult | null>(null);
  const limitsDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    if (limitPriceInCents === null) {
      setOrderLimitsResult(null);
      return;
    }
    limitsDebounceRef.current = window.setTimeout(() => {
      checkOrderLimits({ symbol, strategyKey: "leaps", quantity, strike: contract.strike, premium: limitPriceInCents })
        .then(setOrderLimitsResult)
        .catch(() => setOrderLimitsResult(null));
    }, orderLimitsDebounceMs);
    return () => {
      if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    };
  }, [symbol, contract.strike, quantity, limitPriceInCents]);
  const accountValue = orderLimitsResult?.details?.totalPortfolioValue ?? null;
  const shareOfAccount = cost !== null && accountValue !== null && accountValue > 0 ? cost / accountValue : null;

  const blockingReasons = [...(accessLevelRefusal ? [accessLevelRefusal] : []), ...(orderLimitsResult?.blocked ? orderLimitsResult.reasons : [])];
  const reviewBlockedMessage = !hasTwoSidedQuote
    ? "No live bid and ask for this contract right now (market closed, or no quote yet). An order needs a live quote — try again while the market is open."
    : !limitPriceValid
      ? "Enter a limit price above zero."
      : null;

  async function handleReviewOrder() {
    if (limitPriceInCents === null) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const order = await buildOpenOrder({ symbol, strategyKey: "leaps", option: { quantity, limitPrice: limitPriceInCents, strikePrice: contract.strike, expiryDate: contract.expiry } });
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
        <h4 className="mb-0 d-flex align-items-center gap-2" style={{ fontSize: "1.05rem" }}>
          Buy LEAPS · {symbol}
          <span className="badge bg-leaps" style={{ fontSize: "0.72rem" }}>
            LEAPS
          </span>
        </h4>
        <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
          {formatOptionContractLabel({ strike: contract.strike, right: "C", expiry: contract.expiry, dte: contract.dte })}
        </div>
      </div>

      {notice}

      {blockingReasons.length > 0 && (
        <div className="alert alert-warning mb-0 py-2" style={{ fontSize: "0.85rem" }}>
          <strong>Cannot place now:</strong> {blockingReasons.join(" ")}
        </div>
      )}

      <div className="border rounded p-3">
        <Row label="Bid / Ask" value={`${formatQuotePrice(contract.bid)} / ${formatQuotePrice(contract.ask)}`} />
        <Row label="Delta" value={contract.delta === null ? "—" : `${contract.delta > 0 ? "+" : ""}${contract.delta.toFixed(2)}`} />
        <Row label="IV" value={formatPercentage(contract.impliedVolatility, 1)} />
      </div>

      <div className="border rounded p-3">
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <label className="form-label mb-0 text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }} htmlFor="leaps-order-qty">
            Contracts
          </label>
          <input id="leaps-order-qty" type="number" min={1} step={1} className="form-control form-control-sm font-mono" style={{ width: "6rem" }} value={contractQty} onChange={(event) => setContractQty(event.target.value)} />
        </div>
        <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
          <label className="form-label mb-0 text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }} htmlFor="leaps-order-limit">
            Limit price
          </label>
          <input
            id="leaps-order-limit"
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
        <Row label="Cost (total)" value={cost === null ? "—" : formatSignedPnl(-cost, 0)} tone="text-danger" />
        <Row
          label={
            <>
              Commission <span className="text-secondary">· worst case</span>
            </>
          }
          value={commissionPreview.preview ? formatCurrency(commissionPreview.preview.commissionDollars, 2) : commissionPreview.loading ? <Spinner size="sm" /> : commissionPreview.failed ? "unavailable" : "—"}
        />
        <Row label="Max gain" value="Unlimited" tone="text-success" />
        <Row label="Max loss (the premium)" value={cost === null ? "—" : formatSignedPnl(-cost, 0)} tone="text-danger" />
        <Row
          label={
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              Breakeven at expiry
              <button type="button" className="btn btn-outline-primary btn-sm py-0 leaps-pnl-button" disabled={limitPriceInCents === null} onClick={() => setShowPnlOverTime(true)}>
                P&amp;L over time
              </button>
            </span>
          }
          value={
            payoff ? (
              <span className="text-nowrap">
                {formatCurrency(payoff.breakeven)} <span className="text-secondary">({spotPrice !== null && spotPrice > 0 ? formatSignedPercentage(payoff.breakeven / spotPrice - 1, 1) : "—"})</span>
              </span>
            ) : (
              "—"
            )
          }
        />
        <Row label="Share of the account" value={formatPercentage(shareOfAccount, 1)} />
      </div>

      <p className="text-secondary mb-0" style={{ fontSize: "0.8rem" }}>
        Held as a LEAPS position. The premium counts toward the Risk &amp; Limits rules and the traders' capital. At expiry IBKR exercises it if it is in the money: {formatNumber(shares)} shares at {formatCurrency(contract.strike)} ({formatCurrency(shares * contract.strike, 0)}).
      </p>

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

      {showPnlOverTime && limitPriceInCents !== null && (
        <LeapsPnlOverTimeModal
          symbol={symbol}
          position={{ strike: contract.strike, expiryIso: contract.expiry, premium: limitPriceInCents, contracts: quantity, multiplier: 100 }}
          initialImpliedVolatility={contract.impliedVolatility}
          initialSpotPrice={spotPrice}
          onClose={() => setShowPnlOverTime(false)}
        />
      )}
    </div>
  );
}
