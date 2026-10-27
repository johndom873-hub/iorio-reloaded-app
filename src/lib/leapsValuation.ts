import { computeProbabilityOfProfit, standardNormalCdf } from "./probabilityOfProfit";

// LEAPS valuation (formulas approved by Marcelo 2026-10-27): the "P&L over time" chart values the Call before expiry
// with Black-Scholes, dividend yield q included:
//   d1 = (ln(S ÷ K) + (r − q + σ² ÷ 2) × τ) ÷ (σ × √τ),  d2 = d1 − σ × √τ
//   value = S × e^(−qτ) × N(d1) − K × e^(−rτ) × N(d2),  τ = days left ÷ 365; at expiry the value is max(S − K, 0)
// σ is the contract's own IV × (1 + IV change), r the FRED rate, q IBKR's next-12-months dividends ÷ the stock price.
// P&L = (value − premium) × shares, also as a share of the premium paid (the maximum loss).
// Example: AAPL at $343.91, $300 Call, 416 days, σ 27.8%, r 4.0%, q 0.30%: value ≈ $71.7 (the $71.69 paid).

export interface CallValuationInput {
  spotPrice: number;
  strike: number;
  yearsToExpiry: number;
  impliedVolatility: number;
  riskFreeRate: number;
  dividendYield: number;
}

export function blackScholesCallValue({ spotPrice, strike, yearsToExpiry, impliedVolatility, riskFreeRate, dividendYield }: CallValuationInput): number {
  if (yearsToExpiry <= 0 || impliedVolatility <= 0 || spotPrice <= 0) return Math.max(spotPrice - strike, 0);
  const volatilityTimesRootTime = impliedVolatility * Math.sqrt(yearsToExpiry);
  const d1 = (Math.log(spotPrice / strike) + (riskFreeRate - dividendYield + (impliedVolatility * impliedVolatility) / 2) * yearsToExpiry) / volatilityTimesRootTime;
  const d2 = d1 - volatilityTimesRootTime;
  return spotPrice * Math.exp(-dividendYield * yearsToExpiry) * standardNormalCdf(d1) - strike * Math.exp(-riskFreeRate * yearsToExpiry) * standardNormalCdf(d2);
}

/** The stock price at which the Call is worth `premium` (its value rises with the price, so a bisection finds it). */
export function findCallBreakevenPrice(input: Omit<CallValuationInput, "spotPrice">, premium: number): number {
  if (input.yearsToExpiry <= 0) return input.strike + premium;
  let low = 0;
  // value ≥ S × e^(−qτ) − K × e^(−rτ), so at this price the Call is worth at least the premium.
  let high = (input.strike + premium) * Math.exp(input.dividendYield * input.yearsToExpiry) + 1;
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = (low + high) / 2;
    if (blackScholesCallValue({ ...input, spotPrice: middle }) < premium) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Probability the stock ends above the breakeven at expiry, N(d2) at strike + premium: one minus the short Call's POP. */
export function computeLongCallProbabilityOfProfit(input: { spotPrice: number; strike: number; premium: number; impliedVolatility: number; daysToExpiry: number; riskFreeRate: number | null }): number | null {
  const shortCallProbability = computeProbabilityOfProfit({ ...input, right: "call" });
  return shortCallProbability === null ? null : 1 - shortCallProbability;
}

/** "2026-10-27" + 3 → "2027-01-27"; a day past the month's end falls back to its last day (31 Oct + 4 → 28 Feb). */
function addCalendarMonths(dateIso: string, months: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export interface LeapsHorizon {
  label: string;
  dateIso: string;
  yearsToExpiry: number;
  isExpiry: boolean;
}

/** Today, +3, +6 and +12 months while before the expiry, then the expiry. */
export function buildLeapsHorizons(todayIso: string, expiryIso: string): LeapsHorizon[] {
  const beforeExpiry = [
    { label: "Today", dateIso: todayIso },
    { label: "+3 months", dateIso: addCalendarMonths(todayIso, 3) },
    { label: "+6 months", dateIso: addCalendarMonths(todayIso, 6) },
    { label: "+12 months", dateIso: addCalendarMonths(todayIso, 12) },
  ].filter((horizon) => horizon.dateIso < expiryIso);
  return [
    ...beforeExpiry.map((horizon) => ({ ...horizon, yearsToExpiry: calendarDaysBetween(horizon.dateIso, expiryIso) / 365, isExpiry: false })),
    { label: "Expiry", dateIso: expiryIso, yearsToExpiry: 0, isExpiry: true },
  ];
}

export interface LeapsPosition {
  strike: number;
  expiryIso: string;
  /** Paid per share. */
  premium: number;
  contracts: number;
  multiplier: number;
}

export interface LeapsMarket {
  spotPrice: number;
  /** The contract's own IV (0.278 = 27.8%). */
  impliedVolatility: number;
  riskFreeRate: number;
  dividendYield: number;
}

export interface LeapsPnlPoint {
  price: number;
  pnlDollars: number;
  /** P&L ÷ the premium paid (−1 = the whole premium lost). */
  pnlFraction: number;
}

export interface LeapsHorizonCurve extends LeapsHorizon {
  points: LeapsPnlPoint[];
  breakevenPrice: number;
  /** P&L if the stock is still at today's price on this date. */
  pnlIfUnchanged: LeapsPnlPoint;
}

const pnlCurvePointCount = 61;

/** The chart's price axis: 20% either side of the price, stretched to 10% past the expiry breakeven. */
export function leapsChartPriceRange(spotPrice: number, expiryBreakevenPrice: number): { low: number; high: number } {
  return { low: spotPrice * 0.8, high: Math.max(spotPrice * 1.2, expiryBreakevenPrice * 1.1) };
}

export function buildLeapsPnlCurves(position: LeapsPosition, market: LeapsMarket, impliedVolatilityChange: number, todayIso: string): LeapsHorizonCurve[] {
  const shares = position.contracts * position.multiplier;
  const premiumPaid = position.premium * shares;
  const impliedVolatility = market.impliedVolatility * (1 + impliedVolatilityChange);
  const range = leapsChartPriceRange(market.spotPrice, position.strike + position.premium);
  const pointAt = (horizon: LeapsHorizon, price: number): LeapsPnlPoint => {
    const value = blackScholesCallValue({ spotPrice: price, strike: position.strike, yearsToExpiry: horizon.yearsToExpiry, impliedVolatility, riskFreeRate: market.riskFreeRate, dividendYield: market.dividendYield });
    const pnlDollars = (value - position.premium) * shares;
    return { price, pnlDollars, pnlFraction: premiumPaid > 0 ? pnlDollars / premiumPaid : 0 };
  };
  const step = (range.high - range.low) / (pnlCurvePointCount - 1);
  return buildLeapsHorizons(todayIso, position.expiryIso).map((horizon) => ({
    ...horizon,
    points: Array.from({ length: pnlCurvePointCount }, (_, index) => pointAt(horizon, range.low + step * index)),
    breakevenPrice: findCallBreakevenPrice({ strike: position.strike, yearsToExpiry: horizon.yearsToExpiry, impliedVolatility, riskFreeRate: market.riskFreeRate, dividendYield: market.dividendYield }, position.premium),
    pnlIfUnchanged: pointAt(horizon, market.spotPrice),
  }));
}
