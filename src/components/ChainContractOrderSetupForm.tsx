import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { buildOpenOrder, type AdaptivePriority, type OrderRequest } from "../api/positions";
import type { SignalQuoteSource, SignalStrategyKey } from "../api/signals";
import { checkSignalOrderLimits } from "../api/signalSettings";
import { computeAnnualizedYield, computePayoff } from "../lib/payoff";
import { formatCurrency, formatDateTime, formatPercentage, formatQuotePrice, formatSignedPnl } from "../lib/formatters";
import { describeCandidate, quoteSourceLabel } from "../lib/signalsPresentation";
import { useTooltip } from "../hooks/useTooltip";
import { FillPriorityPicker } from "./FillPriorityPicker";
import { Spinner } from "./Spinner";

// Order setup for a chain contract Signals could not score (in the money, spans earnings, no surface for the
// expiry, no two-sided quote, ...): the quote and the plain payoff, no Signals card. Builds through the same
// POST /positions/orders as SignalOrderSetupForm, without a signal snapshot, and hands the OrderRequest up to
// the shared OrderReviewPanel.

const orderLimitsDebounceMs = 400;

export interface ChainContractQuote {
  strategyKey: SignalStrategyKey;
  expiry: string;
  strike: number;
  dte: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  quoteSource: SignalQuoteSource | null;
  quotedAt: string | null;
}

interface ChainContractOrderSetupFormProps {
  symbol: string;
  contract: ChainContractQuote;
  /** Free shares to cover a call; null when unknown (ticker outside the Signals universe). */
  freeShares: number | null;
  spotPrice: number | null;
  /** Why this contract has no Signals score, shown above the quote. */
  notice: ReactNode;
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

// A disabled button fires no hover/focus events, so its tooltip lives on a wrapping span (same as SignalOrderSetupForm).
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

function describeQuoteSource(contract: ChainContractQuote): string {
  if (contract.quoteSource === null) return "No quote";
  const label = quoteSourceLabel[contract.quoteSource];
  return contract.quotedAt && contract.quoteSource !== "snapshot" ? `${label} · ${formatDateTime(contract.quotedAt)}` : label;
}

export function ChainContractOrderSetupForm({ symbol, contract, freeShares, spotPrice, notice, onCancel, onSubmitted }: ChainContractOrderSetupFormProps) {
  const isCall = contract.strategyKey === "covered_call";
  const hasTwoSidedQuote = contract.bid !== null && contract.ask !== null;
  const mid = hasTwoSidedQuote ? (contract.bid! + contract.ask!) / 2 : null;
  const defaultQuantity = isCall && freeShares !== null && freeShares >= 100 ? Math.floor(freeShares / 100) : 1;
  const [contractQty, setContractQty] = useState(String(defaultQuantity));
  const [limitPriceInput, setLimitPriceInput] = useState(mid === null ? "" : mid.toFixed(2));
  const [adaptivePriority, setAdaptivePriority] = useState<AdaptivePriority>("Normal");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const quantity = Math.max(1, Math.floor(Number(contractQty) || 0));
  const limitPrice = Number(limitPriceInput);
  const limitPriceValid = limitPriceInput.trim() !== "" && Number.isFinite(limitPrice) && limitPrice > 0;
  const premiumTotal = limitPriceValid ? limitPrice * 100 * quantity : null;
  const annualizedYield = limitPriceValid && spotPrice !== null ? computeAnnualizedYield(contract.strategyKey, { premium: limitPrice, dte: contract.dte, strike: contract.strike, spotPrice }) : null;
  const capitalAtRisk = isCall ? (spotPrice === null ? null : spotPrice * 100 * quantity) : contract.strike * 100 * quantity;
  // Expiration payoff at the limit price (same computePayoff as SignalOrderSetupForm): a covered call buys the shares at spot in the same order.
  const payoff =
    !limitPriceValid || (isCall && spotPrice === null)
      ? null
      : computePayoff(contract.strategyKey, [
          ...(isCall ? [{ legType: "stock" as const, optionType: null, entryPrice: String(spotPrice), strikePrice: null, quantity: quantity * 100, multiplier: 1 }] : []),
          { legType: "option", optionType: isCall ? "call" : "put", entryPrice: String(limitPrice), strikePrice: String(contract.strike), quantity, multiplier: 100 },
        ]);

  // Same debounced order-limits check as SignalOrderSetupForm (cosmetic: confirm re-checks server-side, so a failed check fails open).
  const [orderLimitsResult, setOrderLimitsResult] = useState<{ blocked: boolean; reasons: string[] } | null>(null);
  const limitsDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    limitsDebounceRef.current = window.setTimeout(() => {
      checkSignalOrderLimits({ symbol, strategyKey: contract.strategyKey, quantity, strike: contract.strike, spotPrice })
        .then(setOrderLimitsResult)
        .catch(() => setOrderLimitsResult(null));
    }, orderLimitsDebounceMs);
    return () => {
      if (limitsDebounceRef.current !== null) window.clearTimeout(limitsDebounceRef.current);
    };
  }, [symbol, contract.strategyKey, contract.strike, quantity, spotPrice]);

  const blockingReasons = orderLimitsResult?.blocked ? orderLimitsResult.reasons : [];
  const reviewBlockedMessage = !hasTwoSidedQuote
    ? "No bid and ask for this contract right now (market closed, or not in today's capture). An order needs a live quote — try again while the market is open."
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
          Order Setup · no Signals score
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          {isCall ? "Covered Call" : "Cash-Secured Put"} · {symbol}{" "}
          <span className="text-secondary fw-normal">
            {describeCandidate(contract)} · {contract.dte}DTE
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
        <Row label="Quote" value={describeQuoteSource(contract)} />
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
        <Row label="Annualised yield" value={formatPercentage(annualizedYield, 0)} />
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
