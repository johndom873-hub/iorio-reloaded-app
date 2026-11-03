import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { fetchTickerValuationInputs, type TickerValuationInputs } from "../../api/tickerTrading";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { buildLeapsPnlCurves, type LeapsPosition } from "../../lib/leapsValuation";
import { daysToExpiry, formatCurrency, formatDayMonth, formatDayMonthYear, formatOptionContractLabel, formatPercentage, formatSignedPercentage, formatSignedPercentageValue, formatSignedPnl, pluralize, pnlTextClass, todayInEasternIso } from "../../lib/formatters";
import { ApexChart } from "../charts/ApexChart";
import { Spinner } from "../Spinner";

// "P&L over time" for a LEAPS (approved by Marcelo 2026-10-27): the Call's P&L against the stock price on today,
// +3, +6 and +12 months and the expiry, valued with Black-Scholes at the contract's own IV as of opening (leapsValuation.ts), with an
// IV-change control, % of the premium or $, and the breakeven on each date. Shown on the Ticker modal, under the chain, as
// soon as a Call is picked in Buy LEAPS mode, for the Order Setup's limit price and contracts (then the order under review).

const leapsContractMultiplier = 100;

interface LeapsPnlOverTimeChartProps {
  symbol: string;
  strike: number;
  expiryIso: string;
  /** Paid per share: the Order Setup's limit price, null while it has none. */
  premium: number | null;
  contracts: number;
  /** The contract's IV and the stock price, live from the Ticker modal's streams; the first pair with both is held. */
  liveImpliedVolatility: number | null;
  liveSpotPrice: number | null;
}

const impliedVolatilityChanges = [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];

// Today lightest to expiry gold (dark), darkest to amber (light): each line reaches 3:1 on its theme's card.
const lineColorsByTheme = {
  dark: ["#e0f2fe", "#7dd3fc", "#38bdf8", "#0ea5e9", "#ffd43b"],
  light: ["#082f49", "#075985", "#0369a1", "#0284c7", "#b45309"],
} as const;
const lineDashes = [2, 8, 5, 12, 0];
const lineWidths = [2, 2, 2.5, 2.5, 3];
// The "now" line and its label: violet on light (amber there is the Expiry line's colour, and #f59f00 reached 2.1:1 on white).
const spotLineStyleByTheme = {
  dark: { line: "#f59f00", labelText: "#1d2733", labelBackground: "#ffd43b" },
  light: { line: "#7c3aed", labelText: "#ffffff", labelBackground: "#7c3aed" },
} as const;

/** "27 Jan" this year, "17 Dec 2027" in another. */
function describeHorizonDate(dateIso: string, todayIso: string): string {
  return dateIso.slice(0, 4) === todayIso.slice(0, 4) ? formatDayMonth(dateIso) : formatDayMonthYear(dateIso);
}

export function LeapsPnlOverTimeChart({ symbol, strike, expiryIso, premium, contracts, liveImpliedVolatility, liveSpotPrice }: LeapsPnlOverTimeChartProps) {
  const { theme } = useTheme();
  const isPhoneLayout = useMediaQuery("(max-width: 991.98px)");
  const [valuationInputs, setValuationInputs] = useState<TickerValuationInputs | null>(null);
  const [valuationInputsError, setValuationInputsError] = useState<string | null>(null);
  const [heldMarketInputs, setHeldMarketInputs] = useState<{ impliedVolatility: number; spotPrice: number } | null>(null);
  const [impliedVolatilityChange, setImpliedVolatilityChange] = useState(0);
  const [showDollars, setShowDollars] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTickerValuationInputs(symbol)
      .then((result) => !cancelled && setValuationInputs(result))
      .catch(() => !cancelled && setValuationInputsError("Could not load the rate and dividends for this chart."));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // The chart is drawn from the first live quote that has both the contract's IV and the stock price, then held: redrawing
  // on every frame wiped the chart's hover tooltip and legend highlight about once a second. Callers key it by contract.
  if (heldMarketInputs === null && liveImpliedVolatility !== null && liveImpliedVolatility > 0 && liveSpotPrice !== null && liveSpotPrice > 0) {
    setHeldMarketInputs({ impliedVolatility: liveImpliedVolatility, spotPrice: liveSpotPrice });
  }
  const impliedVolatility = heldMarketInputs?.impliedVolatility ?? liveImpliedVolatility;
  const spotPrice = heldMarketInputs?.spotPrice ?? liveSpotPrice;
  const riskFreeRate = valuationInputs?.riskFreeRate ?? null;
  const dividendYield = valuationInputs?.nextTwelveMonthsDividends != null && spotPrice !== null && spotPrice > 0 ? valuationInputs.nextTwelveMonthsDividends / spotPrice : null;
  const todayIso = todayInEasternIso();

  // Keyed on the position's values, so a re-render with the same limit price and contracts doesn't rebuild the series and redraw the chart.
  const position = useMemo<LeapsPosition | null>(() => (premium === null ? null : { strike, expiryIso, premium, contracts, multiplier: leapsContractMultiplier }), [strike, expiryIso, premium, contracts]);
  const curves = useMemo(
    () =>
      position !== null && impliedVolatility !== null && impliedVolatility > 0 && spotPrice !== null && spotPrice > 0 && riskFreeRate !== null
        ? buildLeapsPnlCurves(position, { spotPrice, impliedVolatility, riskFreeRate, dividendYield: dividendYield ?? 0 }, impliedVolatilityChange, todayIso)
        : null,
    [position, spotPrice, impliedVolatility, riskFreeRate, dividendYield, impliedVolatilityChange, todayIso],
  );

  const premiumPaid = premium === null ? null : premium * contracts * leapsContractMultiplier;
  const lineColors = lineColorsByTheme[theme];

  const chartOptions = useMemo<ApexOptions>(
    () => ({
      chart: { animations: { enabled: false }, zoom: { enabled: false } },
      colors: [...lineColors].slice(5 - (curves?.length ?? 5)),
      stroke: { curve: "straight", width: lineWidths.slice(5 - (curves?.length ?? 5)), dashArray: lineDashes.slice(5 - (curves?.length ?? 5)) },
      legend: { position: "top", horizontalAlign: "left", fontSize: "12px" },
      xaxis: { type: "numeric", tickAmount: isPhoneLayout ? 4 : 8, labels: { formatter: (value: string) => formatCurrency(Number(value), 0) } },
      yaxis: { labels: { formatter: (value: number) => (showDollars ? formatSignedPnl(Math.round(value), 0) : formatSignedPercentageValue(value, 0)) } },
      tooltip: {
        shared: true,
        x: { formatter: (value: number) => `${symbol} ${formatCurrency(value)}` },
        y: { formatter: (value: number) => (showDollars ? formatSignedPnl(value, 0) : formatSignedPercentageValue(value, 0)) },
      },
      annotations: {
        yaxis: [{ y: 0, borderColor: theme === "dark" ? "#9ca3af" : "#6b7280", strokeDashArray: 0 }],
        xaxis:
          spotPrice === null
            ? []
            : [
                {
                  x: spotPrice,
                  borderColor: spotLineStyleByTheme[theme].line,
                  label: { text: `now ${formatCurrency(spotPrice)}`, orientation: "horizontal", borderColor: spotLineStyleByTheme[theme].labelBackground, style: { fontSize: "0.7rem", color: spotLineStyleByTheme[theme].labelText, background: spotLineStyleByTheme[theme].labelBackground } },
                },
              ],
      },
    }),
    [lineColors, curves?.length, showDollars, symbol, spotPrice, theme, isPhoneLayout],
  );
  const series = useMemo(
    () =>
      (curves ?? []).map((curve) => ({
        name: `${curve.label} · ${describeHorizonDate(curve.dateIso, todayIso)}`,
        data: curve.points.map((point) => ({ x: point.price, y: showDollars ? point.pnlDollars : point.pnlFraction * 100 })),
      })),
    [curves, showDollars, todayIso],
  );

  const contractLabel = formatOptionContractLabel({ symbol, strike, right: "C", expiry: expiryIso, dte: daysToExpiry(expiryIso, todayIso) });
  const missingInput =
    impliedVolatility === null
      ? "No live IV for this contract yet, so it cannot be valued before expiry. It needs a live quote: try again while the market is open."
      : spotPrice === null
        ? `No price for ${symbol} yet.`
        : premium === null
          ? "Enter a limit price in the Order Setup to draw the chart."
          : null;

  return (
    <div className="card mt-3 leaps-pnl-chart">
      <div className="card-header py-2 d-flex flex-wrap align-items-center gap-2">
        <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
          P&amp;L over time
        </span>
        <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
          {contractLabel}
          {premium !== null && premiumPaid !== null && ` · ${pluralize(contracts, "contract")} at ${formatCurrency(premium)} · max risk ${formatCurrency(premiumPaid, 0)}`}
        </span>
      </div>
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-end gap-3 mb-3">
          <div>
            <label htmlFor="leaps-iv-change" className="form-label text-secondary text-uppercase mb-1" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }}>
              IV change
            </label>
            <select id="leaps-iv-change" className="form-select font-mono" style={{ width: "7rem" }} value={impliedVolatilityChange} onChange={(event) => setImpliedVolatilityChange(Number(event.target.value))}>
              {impliedVolatilityChanges.map((change) => (
                <option key={change} value={change}>
                  {change === 0 ? "0%" : formatSignedPercentage(change, 0)}
                </option>
              ))}
            </select>
          </div>
          <div className="btn-group" role="group" aria-label="Show P&L as">
            <button type="button" className={`btn ${showDollars ? "btn-outline-secondary" : "btn-primary"}`} aria-pressed={!showDollars} onClick={() => setShowDollars(false)}>
              % of max risk
            </button>
            <button type="button" className={`btn ${showDollars ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={showDollars} onClick={() => setShowDollars(true)}>
              $
            </button>
          </div>
          <span className="text-secondary ms-lg-auto" style={{ fontSize: "0.8rem" }}>
            IV {formatPercentage(impliedVolatility === null ? null : impliedVolatility * (1 + impliedVolatilityChange), 1)} ·{" "}
            {valuationInputs === null ? "dividends …" : dividendYield === null ? "dividends not included (IBKR sent none)" : `dividends ${formatPercentage(dividendYield, 2)} a year (IBKR)`} · rate {formatPercentage(riskFreeRate, 1)}
          </span>
        </div>

        {valuationInputsError && <div className="alert alert-danger">{valuationInputsError}</div>}
        {missingInput && <div className="alert alert-info">{missingInput}</div>}
        {!missingInput && !valuationInputsError && !curves && (
          <div className="d-flex justify-content-center py-5">
            <Spinner label="Loading the rate and dividends" />
          </div>
        )}

        {curves && (
          <>
            <ApexChart type="line" height={360} series={series} options={chartOptions} />

            <div className="text-secondary text-uppercase fw-bold mt-3 mb-2" style={{ fontSize: "0.7rem", letterSpacing: "0.06em" }}>
              Breakeven on each date · and the P&amp;L if {symbol} stays at {formatCurrency(spotPrice)}
            </div>
            <div className="leaps-breakeven-strip">
              {curves.map((curve) => (
                <div key={curve.label} className="border rounded px-3 py-2">
                  <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
                    {curve.label} · {describeHorizonDate(curve.dateIso, todayIso)}
                  </div>
                  <div className="font-mono fw-semibold">
                    {formatCurrency(curve.breakevenPrice)} <span className="text-secondary fw-normal">({formatSignedPercentage(curve.breakevenPrice / spotPrice! - 1, 1)})</span>
                  </div>
                  <div className={`font-mono ${pnlTextClass(Math.round(curve.pnlIfUnchanged.pnlFraction * 100))}`} style={{ fontSize: "0.8rem" }}>
                    stays: {showDollars ? formatSignedPnl(curve.pnlIfUnchanged.pnlDollars, 0) : formatSignedPercentage(curve.pnlIfUnchanged.pnlFraction, 0)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-secondary mt-3 mb-0" style={{ fontSize: "0.8rem" }}>
          Estimates from Black-Scholes at the contract's own IV, adjusted by IV change; the Call is valued as exercisable only at expiry. Hover the chart for the P&amp;L at any price on each date.
        </p>
      </div>
    </div>
  );
}
