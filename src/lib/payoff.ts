import type { OrderLeg } from "../api/positions";
import type { StrategyKey } from "../api/screener";

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

export function computeCoveredCallPayoff(legs: PayoffLegInput[]): PayoffResult | null {
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
    points: buildChartPoints(strike, payoffAt),
  };
}

export function computePayoff(strategyKey: StrategyKey, legs: PayoffLegInput[]): PayoffResult | null {
  if (strategyKey === "covered_call") return computeCoveredCallPayoff(legs);
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

// Same ranking formula already approved and shipped server-side for trade
// alert candidates (generateTradeAlertCandidates.ts, approved 2026-08-20):
//   annualizedYield = (premium / capitalAtRisk) * (365 / dte)
// capitalAtRisk = spot price for a covered call (the stock you'd hold),
// strike price for a cash-secured put (the cash you'd reserve). Reused here
// so the option chain can show yield for every browsable strike, not just
// alert candidates -- same math, no new formula, just applied more broadly.
// Returns null when the inputs can't support a real number (no premium, or
// dte/capitalAtRisk <= 0).
export function computeAnnualizedYield(
  strategyKey: StrategyKey,
  input: { premium: number | null; dte: number; strike: number; spotPrice: number },
): number | null {
  const { premium, dte, strike, spotPrice } = input;
  if (premium === null || premium <= 0 || dte <= 0) return null;
  const capitalAtRisk = strategyKey === "covered_call" ? spotPrice : strike;
  if (!capitalAtRisk || capitalAtRisk <= 0) return null;
  return (premium / capitalAtRisk) * (365 / dte);
}

// Same definition already established for Trade Alerts/Positions'
// capitalAtRisk (stock entry cost for a covered call, strike collateral for
// a CSP) -- computed here from the order's own proposed legs since an
// unconfirmed order has no stored capitalAtRisk field the way a real
// Position does.
export function computeCapitalAtRiskFromOrderLegs(strategyKey: StrategyKey, legs: OrderLeg[]): number | null {
  if (strategyKey === "covered_call") {
    const stockLeg = legs.find((leg) => leg.role === "stock");
    return stockLeg ? stockLeg.unitPrice * stockLeg.quantity : null;
  }
  const putLeg = legs.find((leg) => leg.role === "option");
  return putLeg && putLeg.strike !== undefined ? putLeg.strike * putLeg.quantity * 100 : null;
}
