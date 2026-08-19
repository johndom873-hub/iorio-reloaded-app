import type { PositionLeg } from "../api/positions";
import type { StrategyKey } from "../api/screener";

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export interface PayoffResult {
  maxGain: number;
  maxLoss: number;
  breakeven: number;
  points: PayoffPoint[];
}

const chartPointCount = 60;
const chartRangeFraction = 0.25;

// Expiration-only "hockey stick" math, approved 2026-08-19 — see PROGRESS.md
// and the Positions screen plan. Uses each leg's actual multiplier rather
// than assuming 100, since the schema explicitly supports non-standard
// multipliers (post-split/special-dividend adjusted contracts).
function buildChartPoints(centerPrice: number, payoffAt: (price: number) => number): PayoffPoint[] {
  const low = centerPrice * (1 - chartRangeFraction);
  const high = centerPrice * (1 + chartRangeFraction);
  const step = (high - low) / (chartPointCount - 1);
  return Array.from({ length: chartPointCount }, (_, i) => {
    const price = low + step * i;
    return { price, pnl: payoffAt(price) };
  });
}

export function computeCoveredCallPayoff(legs: PositionLeg[]): PayoffResult | null {
  const stockLeg = legs.find((leg) => leg.legType === "stock");
  const callLeg = legs.find((leg) => leg.legType === "option" && leg.optionType === "call");
  if (!stockLeg || !callLeg || callLeg.strikePrice === null) return null;

  const stockEntryPrice = Number(stockLeg.entryPrice);
  const callPremium = Number(callLeg.entryPrice);
  const strike = Number(callLeg.strikePrice);
  // Share count comes from the stock leg's quantity, not its `multiplier`
  // (that field means "shares per option contract" and is meaningless for a
  // stock leg — assumes a standard 1:1 covered write, call contracts fully
  // covering the shares held).
  const shareCount = stockLeg.quantity;

  const payoffAt = (price: number) => {
    const cappedPrice = Math.min(price, strike);
    return (cappedPrice - stockEntryPrice + callPremium) * shareCount;
  };

  return {
    maxGain: (strike - stockEntryPrice + callPremium) * shareCount,
    maxLoss: (stockEntryPrice - callPremium) * shareCount,
    breakeven: stockEntryPrice - callPremium,
    points: buildChartPoints(stockEntryPrice, payoffAt),
  };
}

export function computeCashSecuredPutPayoff(legs: PositionLeg[]): PayoffResult | null {
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
    points: buildChartPoints(strike, payoffAt),
  };
}

export function computePayoff(strategyKey: StrategyKey, legs: PositionLeg[]): PayoffResult | null {
  if (strategyKey === "covered_call") return computeCoveredCallPayoff(legs);
  return computeCashSecuredPutPayoff(legs);
}
