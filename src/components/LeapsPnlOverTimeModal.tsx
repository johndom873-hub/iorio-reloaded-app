import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ApexOptions } from "apexcharts";
import { fetchTickerValuationInputs, openOptionQuotesStream, optionContractKey, type TickerValuationInputs } from "../api/tickerTrading";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { buildLeapsPnlCurves, type LeapsPosition } from "../lib/leapsValuation";
import { daysToExpiry, formatCurrency, formatDayMonth, formatDayMonthYear, formatOptionContractLabel, formatPercentage, formatSignedPercentage, formatSignedPercentageValue, formatSignedPnl, pluralize, pnlTextClass, todayInEasternIso } from "../lib/formatters";
import { ApexChart } from "./charts/ApexChart";
import { Spinner } from "./Spinner";

// "P&L over time" for a LEAPS (approved by Marcelo 2026-10-27): the Call's P&L against the stock price on today,
// +3, +6 and +12 months and the expiry, valued with Black-Scholes at the contract's own IV as of opening (leapsValuation.ts), with an
// IV-change control, % of the premium or $, and the breakeven on each date. Opened from the order setup, Order Review
// and the LEAPS position card. Informational: ESC and a backdrop click close it, and only it (it sits over the Ticker
// modal, whose own ESC handler must not see the key).

interface LeapsPnlOverTimeModalProps {
  symbol: string;
  position: LeapsPosition;
  /** The contract's IV and the stock price already on screen, until its own live quote arrives. */
  initialImpliedVolatility: number | null;
  initialSpotPrice: number | null;
  onClose: () => void;
}

const impliedVolatilityChanges = [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];

// Today lightest to expiry gold (dark), darkest to amber (light): each line reaches 3:1 on its theme's card.
const lineColorsByTheme = {
  dark: ["#e0f2fe", "#7dd3fc", "#38bdf8", "#0ea5e9", "#ffd43b"],
  light: ["#082f49", "#075985", "#0369a1", "#0284c7", "#b45309"],
} as const;
const lineDashes = [2, 8, 5, 12, 0];
const lineWidths = [2, 2, 2.5, 2.5, 3];
const spotLineColor = "#f59f00";

/** "27 Jan" this year, "17 Dec 2027" in another. */
function describeHorizonDate(dateIso: string, todayIso: string): string {
  return dateIso.slice(0, 4) === todayIso.slice(0, 4) ? formatDayMonth(dateIso) : formatDayMonthYear(dateIso);
}

export function LeapsPnlOverTimeModal({ symbol, position, initialImpliedVolatility, initialSpotPrice, onClose }: LeapsPnlOverTimeModalProps) {
  const { theme } = useTheme();
  const isPhoneLayout = useMediaQuery("(max-width: 991.98px)");
  const [valuationInputs, setValuationInputs] = useState<TickerValuationInputs | null>(null);
  const [valuationInputsError, setValuationInputsError] = useState<string | null>(null);
  const [liveImpliedVolatility, setLiveImpliedVolatility] = useState<number | null>(null);
  const [liveSpotPrice, setLiveSpotPrice] = useState<number | null>(null);
  const [impliedVolatilityChange, setImpliedVolatilityChange] = useState(0);
  const [showDollars, setShowDollars] = useState(false);

  useEffect(() => {
    // Capture on window, ahead of the Ticker modal's document listener, so ESC closes this modal only.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

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
  // on every frame wiped the chart's hover tooltip and legend highlight about once a second.
  const contractKey = optionContractKey({ expiry: position.expiryIso, strike: position.strike, right: "C" });
  useEffect(() => {
    let closeStream = () => {};
    closeStream = openOptionQuotesStream(
      symbol,
      [contractKey],
      (frame) => {
        const impliedVolatility = frame.quotes[contractKey]?.impliedVolatility ?? null;
        if (impliedVolatility === null || !(impliedVolatility > 0) || frame.spotPrice === null || !(frame.spotPrice > 0)) return;
        setLiveImpliedVolatility(impliedVolatility);
        setLiveSpotPrice(frame.spotPrice);
        closeStream();
      },
      () => {},
    );
    return () => closeStream();
  }, [symbol, contractKey]);

  const impliedVolatility = liveImpliedVolatility ?? initialImpliedVolatility;
  const spotPrice = liveSpotPrice ?? initialSpotPrice;
  const riskFreeRate = valuationInputs?.riskFreeRate ?? null;
  const dividendYield = valuationInputs?.nextTwelveMonthsDividends != null && spotPrice !== null && spotPrice > 0 ? valuationInputs.nextTwelveMonthsDividends / spotPrice : null;
  const todayIso = todayInEasternIso();

  // Callers pass a new position object on every render (the order form re-renders on each live quote): keyed on its values,
  // so an unchanged position doesn't rebuild the series and redraw the chart.
  const { strike, expiryIso, premium, contracts, multiplier } = position;
  const stablePosition = useMemo<LeapsPosition>(() => ({ strike, expiryIso, premium, contracts, multiplier }), [strike, expiryIso, premium, contracts, multiplier]);
  const curves = useMemo(
    () => (impliedVolatility !== null && impliedVolatility > 0 && spotPrice !== null && spotPrice > 0 && riskFreeRate !== null ? buildLeapsPnlCurves(stablePosition, { spotPrice, impliedVolatility, riskFreeRate, dividendYield: dividendYield ?? 0 }, impliedVolatilityChange, todayIso) : null),
    [stablePosition, spotPrice, impliedVolatility, riskFreeRate, dividendYield, impliedVolatilityChange, todayIso],
  );

  const shares = position.contracts * position.multiplier;
  const premiumPaid = position.premium * shares;
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
            : [{ x: spotPrice, borderColor: spotLineColor, label: { text: `now ${formatCurrency(spotPrice)}`, orientation: "horizontal", style: { fontSize: "0.7rem", color: "#1d2733", background: "#ffd43b" } } }],
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

  const contractLabel = formatOptionContractLabel({ symbol, strike: position.strike, right: "C", expiry: position.expiryIso, dte: daysToExpiry(position.expiryIso, todayIso) });
  const missingInput = impliedVolatility === null ? "No live IV for this contract yet, so it cannot be valued before expiry. It needs a live quote: try again while the market is open." : spotPrice === null ? `No price for ${symbol} yet.` : null;

  return createPortal(
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1100, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div
        className="modal show d-block leaps-pnl-modal"
        style={{ zIndex: 1100 }}
        role="dialog"
        aria-modal="true"
        aria-label="P&L over time"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <div style={{ minWidth: 0 }}>
                <h5 className="modal-title">P&amp;L over time</h5>
                <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                  {contractLabel} · {pluralize(position.contracts, "contract")} at {formatCurrency(position.premium)} · max risk {formatCurrency(premiumPaid, 0)}
                </div>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
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
        </div>
      </div>
    </>,
    document.body,
  );
}
