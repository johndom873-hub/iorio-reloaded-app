import type { OrderLeg } from "../api/positions";
import type { OpenOrderStrategyKey, StrategyKey } from "../api/strategy";
import { tradingSessionsPerYear } from "./tradingSessions";

export interface PayoffPoint {
  price: number;
  pnl: number;
}

// Narrowed to just the fields the math below actually reads, so both a real
// PositionLeg and an adapted not-yet-confirmed OrderLeg (see
// orderLegsToPayoffInput below) satisfy it structurally.
export interface PayoffLegInput {
  legType: "stock" | "option";
  optionType: "call" | "put" | null;
  entryPrice: string;
  strikePrice: string | null;
  quantity: number;
  multiplier: number;
}

export interface PayoffResult {
  maxGain: number;
  maxLoss: number;
  breakeven: number;
  /** P&L at expiration if the stock closes at `price`. */
  payoffAt: (price: number) => number;
}

export interface ChartPriceRange {
  low: number;
  high: number;
}

const chartPointCount = 60;
// The chart shows the break-even ±15% (Marcelo, 2026-09-30). A current price within 2% of an edge widens that edge to 5% past the price
// (Marcelo, 2026-10-19), and a held range never narrows again: the axis stays still between widenings instead of moving with every tick.
const chartRangeFraction = 0.15;
const currentPriceEdgeMarginFraction = 0.02;
const currentPriceWidenedMarginFraction = 0.05;

// Expiration-only "hockey stick" math, approved 2026-08-19 — see PROGRESS.md
// and the Positions screen plan. Uses each leg's actual multiplier rather
// than assuming 100, since the schema explicitly supports non-standard
// multipliers (post-split/special-dividend adjusted contracts).

// The chart's price range, widened from heldRange (the range already shown) or the break-even ±15% when there is none.
// Returns heldRange itself when the price needs no widening, so an unchanged range keeps its identity.
// Example: break-even $111.69 → $94.94–$128.44; a price of $94.95 is within 2% of $94.94, so the low edge becomes $94.95 × 0.95 = $90.20,
// and it moves again only when the price falls below $92.04 ($90.20 ÷ 0.98).
export function computeChartPriceRange(breakeven: number, currentPrice: number | null, heldRange: ChartPriceRange | null = null): ChartPriceRange {
  const range = heldRange ?? { low: breakeven * (1 - chartRangeFraction), high: breakeven * (1 + chartRangeFraction) };
  if (currentPrice === null || !(currentPrice > 0)) return range;
  const widensLow = currentPrice * (1 - currentPriceEdgeMarginFraction) < range.low;
  const widensHigh = currentPrice * (1 + currentPriceEdgeMarginFraction) > range.high;
  if (!widensLow && !widensHigh) return range;
  return {
    low: widensLow ? currentPrice * (1 - currentPriceWidenedMarginFraction) : range.low,
    high: widensHigh ? currentPrice * (1 + currentPriceWidenedMarginFraction) : range.high,
  };
}

export function computePayoffChartPoints(payoff: PayoffResult, range: ChartPriceRange): PayoffPoint[] {
  const step = (range.high - range.low) / (chartPointCount - 1);
  return Array.from({ length: chartPointCount }, (_, i) => {
    const price = range.low + step * i;
    return { price, pnl: payoff.payoffAt(price) };
  });
}

// A covered call's net cost per share is the position's own break-even when known (its shares' cost less the premium earned on
// them, earlier calls and the put that delivered them included; approved 2026-10-16), else the stock entry less this call's premium.
// Max gain is negative when the shares cost more than the strike plus that premium: assignment then sells them at a loss.
export function computeCoveredCallPayoff(legs: PayoffLegInput[], positionBreakEven: number | null = null): PayoffResult | null {
  const stockLeg = legs.find((leg) => leg.legType === "stock");
  const callLeg = legs.find((leg) => leg.legType === "option" && leg.optionType === "call");
  if (!stockLeg || !callLeg || callLeg.strikePrice === null) return null;

  const netCostPerShare = positionBreakEven ?? Number(stockLeg.entryPrice) - Number(callLeg.entryPrice);
  const strike = Number(callLeg.strikePrice);
  // Share count comes from the stock leg's quantity, not its `multiplier`
  // (that field means "shares per option contract" and is meaningless for a
  // stock leg — assumes a standard 1:1 covered write, call contracts fully
  // covering the shares held).
  const shareCount = stockLeg.quantity;

  const payoffAt = (price: number) => {
    const cappedPrice = Math.min(price, strike);
    return (cappedPrice - netCostPerShare) * shareCount;
  };

  return {
    maxGain: (strike - netCostPerShare) * shareCount,
    maxLoss: netCostPerShare * shareCount,
    breakeven: netCostPerShare,
    payoffAt,
  };
}

export function computeCashSecuredPutPayoff(legs: PayoffLegInput[]): PayoffResult | null {
  const putLeg = legs.find((leg) => leg.legType === "option" && leg.optionType === "put");
  if (!putLeg || putLeg.strikePrice === null) return null;

  const putPremium = Number(putLeg.entryPrice);
  const strike = Number(putLeg.strikePrice);
  // Total share-equivalent exposure = contracts held × shares per contract.
  const shareCount = putLeg.quantity * putLeg.multiplier;

  const payoffAt = (price: number) => {
    const flooredPrice = Math.max(price, 0);
    return flooredPrice >= strike ? putPremium * shareCount : (flooredPrice - strike + putPremium) * shareCount;
  };

  return {
    maxGain: putPremium * shareCount,
    maxLoss: (strike - putPremium) * shareCount,
    breakeven: strike - putPremium,
    payoffAt,
  };
}

// A LEAPS (a long Call): the premium paid is the most it can lose, the gain has no cap (maxGain is Infinity), and it
// breaks even at expiry at strike + premium (approved by Marcelo 2026-10-27).
export function computeLongCallPayoff(legs: PayoffLegInput[]): PayoffResult | null {
  const callLeg = legs.find((leg) => leg.legType === "option" && leg.optionType === "call");
  if (!callLeg || callLeg.strikePrice === null) return null;

  const premium = Number(callLeg.entryPrice);
  const strike = Number(callLeg.strikePrice);
  const shareCount = callLeg.quantity * callLeg.multiplier;

  return {
    maxGain: Infinity,
    maxLoss: premium * shareCount,
    breakeven: strike + premium,
    payoffAt: (price: number) => (Math.max(price - strike, 0) - premium) * shareCount,
  };
}

export function computePayoff(strategyKey: OpenOrderStrategyKey, legs: PayoffLegInput[], positionBreakEven: number | null = null): PayoffResult | null {
  if (strategyKey === "covered_call") return computeCoveredCallPayoff(legs, positionBreakEven);
  if (strategyKey === "leaps") return computeLongCallPayoff(legs);
  return computeCashSecuredPutPayoff(legs);
}

// Adapts an unconfirmed OrderRequest's legs (role/action/unitPrice/strike,
// see OrderLeg) into the same shape computePayoff already reads from a real
// PositionLeg -- no live data needed, this is pure math on the order's own
// proposed entry price/strike. A stock leg's multiplier is fixed at 1
// (shares, not contracts) matching how a real synced stock leg always ends
// up (see project_position_leg_multiplier_vs_quantity); an option leg's
// multiplier is assumed 100 -- the standard equity-option contract size,
// same assumption already made throughout this order-building flow.
export function orderLegsToPayoffInput(legs: OrderLeg[]): PayoffLegInput[] {
  return legs.map((leg) => ({
    legType: leg.role,
    optionType: leg.right === "C" ? "call" : leg.right === "P" ? "put" : null,
    entryPrice: String(leg.unitPrice),
    strikePrice: leg.strike !== undefined ? String(leg.strike) : null,
    quantity: leg.quantity,
    multiplier: leg.role === "stock" ? 1 : 100,
  }));
}

// A contract's exposure (EXP $) per share, net of the premium received (Marcelo 2026-10-12), the same as the
// server's: the strike for a cash-secured put (the cash it reserves) or the spot for a covered call (the shares it
// holds), less the premium the sale brings in. Null when the inputs can't support a real number.
export function computeExposurePerShare(strategyKey: StrategyKey, input: { strike: number; spotPrice: number; premium: number }): number | null {
  const base = strategyKey === "covered_call" ? input.spotPrice : input.strike;
  if (!(base > 0) || !(input.premium >= 0) || input.premium >= base) return null;
  return base - input.premium;
}

// The server's flat commission per option contract (optionFriction.ts), the fallback its estimate starts from.
export const flatCommissionPerContractDollars = 0.68;

// The friction a sale is charged, in dollars per contract, as the server charges it: λ × half-spread × 100 + commission
// (λ = the Risk & Limits spread cost share). The screen's yields use the flat commission (Marcelo, 2026-10-12).
export function computeFrictionDollarsPerContract(input: { bid: number; ask: number; spreadShareCharged: number }): number {
  return input.spreadShareCharged * ((input.ask - input.bid) / 2) * 100 + flatCommissionPerContractDollars;
}

// Annualized yield, same as the server's: premium ÷ the exposure net of the premium × 252 ÷ the trading sessions held
// (lib/tradingSessions.ts, Marcelo 2026-10-29). With frictionDollarsPerContract (the chain and its order form, Marcelo
// 2026-10-12) the premium on top is after costs: (premium − friction ÷ 100) ÷ exposure × 252 ÷ sessions; the exposure
// stays net of the full premium, as EXP $ is.
// Example: $40 put, bid 0.45 / ask 0.55, sold on a Monday for Friday (5 sessions), λ 50%: friction $3.18,
// (0.50 − 0.0318) ÷ 39.50 × 252 ÷ 5 = 59.7%.
// Returns null when the inputs can't support a real number (no premium, or sessions/exposure <= 0).
export function computeAnnualizedYield(
  strategyKey: StrategyKey,
  input: { premium: number | null; sessionsHeld: number; strike: number; spotPrice: number; frictionDollarsPerContract?: number },
): number | null {
  const { premium, sessionsHeld, strike, spotPrice } = input;
  if (premium === null || premium <= 0 || sessionsHeld <= 0) return null;
  const exposurePerShare = computeExposurePerShare(strategyKey, { strike, spotPrice, premium });
  if (exposurePerShare === null) return null;
  const premiumAfterCosts = premium - (input.frictionDollarsPerContract ?? 0) / 100;
  return (premiumAfterCosts / exposurePerShare) * (tradingSessionsPerYear / sessionsHeld);
}

// Same definition as Positions' capitalAtRisk (EXP $): the shares bought less the call's premium on them for a
// covered call, the strike collateral less the premium for a CSP -- computed here from the order's own proposed
// legs (limit prices) since an unconfirmed order has no stored capitalAtRisk field the way a real Position does.
// A covered call written on shares already held buys nothing: null.
export function computeCapitalAtRiskFromOrderLegs(strategyKey: StrategyKey, legs: OrderLeg[]): number | null {
  const optionLeg = legs.find((leg) => leg.role === "option");
  if (strategyKey === "covered_call") {
    const stockLeg = legs.find((leg) => leg.role === "stock");
    return stockLeg ? stockLeg.quantity * (stockLeg.unitPrice - (optionLeg?.unitPrice ?? 0)) : null;
  }
  return optionLeg && optionLeg.strike !== undefined ? (optionLeg.strike - optionLeg.unitPrice) * optionLeg.quantity * 100 : null;
}
