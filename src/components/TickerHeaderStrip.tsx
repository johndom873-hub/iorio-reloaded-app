import { useState } from "react";
import { ApiError } from "../api/client";
import { addToShortlist } from "../api/shortlist";
import type { NextTickerCalendarEvents } from "../api/calendarEvents";
import type { TickerOverview } from "../api/tickerDetail";
import { formatCompactNumber, formatCurrency, formatDate, formatNumber, formatPercentage } from "../lib/formatters";
import { flashClassName, useFlashOnChange } from "../hooks/useFlashOnChange";
import { Spinner } from "./Spinner";

// The price/stats strip under a ticker modal's title — extracted from
// TickerDetailModal (2026-09-22) so the Signals modal shows the identical header.

interface TickerHeaderStripProps {
  symbol: string;
  overview: TickerOverview;
  /** The header price: same frozen-then-live, last-trade-only source as the Positions table. Never a previous close. */
  spotPrice: number | null;
  nextCalendarEvents: NextTickerCalendarEvents | null;
  /** Called after "Add to Shortlist" succeeds so the owner can flip overview.isShortlisted. */
  onShortlisted: () => void;
}

export function TickerHeaderStrip({ symbol, overview, spotPrice, nextCalendarEvents, onShortlisted }: TickerHeaderStripProps) {
  const [isAddingToShortlist, setIsAddingToShortlist] = useState(false);
  const [addToShortlistError, setAddToShortlistError] = useState<string | null>(null);

  const pricing = overview.pricing;
  const change = spotPrice != null && pricing.previousClose != null ? spotPrice - pricing.previousClose : null;
  const changePercent = change != null && pricing.previousClose ? change / pricing.previousClose : null;

  // Pricing keeps ticking for as long as the modal stays open -- same flash convention as the option chain.
  const spotPriceFlash = useFlashOnChange(spotPrice);
  const lowFlash = useFlashOnChange(pricing.low ?? null);
  const highFlash = useFlashOnChange(pricing.high ?? null);
  const volumeFlash = useFlashOnChange(pricing.volume ?? null);

  async function handleAddToShortlist() {
    setIsAddingToShortlist(true);
    setAddToShortlistError(null);
    try {
      await addToShortlist(symbol);
      onShortlisted();
    } catch (err) {
      setAddToShortlistError(err instanceof ApiError ? err.message : "Failed to add ticker to shortlist.");
    } finally {
      setIsAddingToShortlist(false);
    }
  }

  return (
    <>
      <div className="d-flex flex-wrap align-items-baseline gap-3 mb-3 font-mono">
        <span className={`h2 mb-0 ${flashClassName(spotPriceFlash)}`}>{formatCurrency(spotPrice)}</span>
        {change != null && (
          <strong className={change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-secondary"}>
            {change >= 0 ? "+" : ""}
            {formatCurrency(change)} ({change >= 0 ? "+" : ""}
            {formatPercentage(changePercent, 2)})
          </strong>
        )}
        <span className="text-secondary small">
          <strong>Day range</strong> $<span className={flashClassName(lowFlash)}>{formatNumber(pricing.low ?? null, 2)}</span>-
          <span className={flashClassName(highFlash)}>{formatNumber(pricing.high ?? null, 2)}</span>
        </span>
        <span className="text-secondary small">
          <strong>Volume</strong> <span className={flashClassName(volumeFlash)}>{formatCompactNumber(pricing.volume ?? null)}</span>
        </span>
        <span className="text-secondary small">
          <strong>Ex-Div</strong> {formatDate(nextCalendarEvents?.nextExDividendDate ?? null)}
        </span>
        <span className="text-secondary small">
          <strong>Earnings</strong> {formatDate(nextCalendarEvents?.nextEarningsDate ?? null)}
        </span>
        {overview.sector && <span className="badge bg-secondary-lt">{overview.sector}</span>}
        {!overview.isShortlisted && (
          <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={isAddingToShortlist} onClick={handleAddToShortlist}>
            {isAddingToShortlist && <Spinner size="sm" />}
            Add to Shortlist
          </button>
        )}
      </div>
      {addToShortlistError && <div className="alert alert-danger">{addToShortlistError}</div>}
    </>
  );
}
