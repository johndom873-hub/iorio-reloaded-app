import { useEffect, useMemo, useState } from "react";
import { Spinner } from "./Spinner";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { ApiError } from "../api/client";
import { fetchTickerDetail, type OptionQuote, type TickerDetail } from "../api/tickerDetail";
import { formatCurrency, formatNumber, formatPercentage } from "../lib/formatters";

interface TickerDetailModalProps {
  symbol: string;
  onClose: () => void;
}

interface StrikeRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

interface ExpiryGroup {
  expiry: string;
  daysToExpiry: number;
  strikes: StrikeRow[];
}

function parseIbkrExpiry(expiry: string): Date {
  return new Date(`${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}T00:00:00Z`);
}

function formatExpiry(expiry: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
    parseIbkrExpiry(expiry),
  );
}

function groupOptionChain(quotes: OptionQuote[]): ExpiryGroup[] {
  const byExpiry = new Map<string, Map<number, StrikeRow>>();

  for (const quote of quotes) {
    if (!byExpiry.has(quote.expiry)) byExpiry.set(quote.expiry, new Map());
    const strikes = byExpiry.get(quote.expiry)!;
    if (!strikes.has(quote.strike)) strikes.set(quote.strike, { strike: quote.strike, call: null, put: null });
    const row = strikes.get(quote.strike)!;
    if (quote.right === "C") row.call = quote;
    else row.put = quote;
  }

  const today = new Date();
  return Array.from(byExpiry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiry, strikes]) => ({
      expiry,
      daysToExpiry: Math.round((parseIbkrExpiry(expiry).getTime() - today.getTime()) / 86_400_000),
      strikes: Array.from(strikes.values()).sort((a, b) => a.strike - b.strike),
    }));
}

function OptionSideCells({ quote }: { quote: OptionQuote | null }) {
  return (
    <>
      <td className="text-end">{formatCurrency(quote?.bid ?? null)}</td>
      <td className="text-end">{formatCurrency(quote?.ask ?? null)}</td>
      <td className="text-end">{formatPercentage(quote?.impliedVolatility ?? null)}</td>
      <td className="text-end">{formatNumber(quote?.delta ?? null, 2)}</td>
    </>
  );
}

export function TickerDetailModal({ symbol, onClose }: TickerDetailModalProps) {
  const [detail, setDetail] = useState<TickerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTickerDetail(symbol)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load ticker detail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Informational modal, no action required — closable via ESC or backdrop click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const expiryGroups = useMemo(() => groupOptionChain(detail?.optionChain ?? []), [detail]);

  const pricing = detail?.pricing;
  const change = pricing?.last != null && pricing?.previousClose != null ? pricing.last - pricing.previousClose : null;
  const changePercent = change != null && pricing?.previousClose ? change / pricing.previousClose : null;

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div
        className="modal show d-block"
        style={{ zIndex: 1050 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal-dialog modal-dialog-scrollable modal-fullscreen-sm-down modal-xl">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {symbol}
                {detail?.companyName && <span className="text-muted fw-normal"> — {detail.companyName}</span>}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {loading && (
                <div className="d-flex justify-content-center py-5">
                  <Spinner label="Loading ticker detail" />
                </div>
              )}
              {error && <div className="alert alert-danger">{error}</div>}

              {detail && !loading && (
                <>
                  <div className="d-flex flex-wrap align-items-baseline gap-3 mb-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span className="h2 mb-0">{formatCurrency(pricing?.last ?? null)}</span>
                    {change != null && (
                      <strong className={change >= 0 ? "text-success" : "text-danger"}>
                        {change >= 0 ? "+" : ""}
                        {formatCurrency(change)} ({change >= 0 ? "+" : ""}
                        {formatPercentage(changePercent, 2)})
                      </strong>
                    )}
                    <span className="text-muted small">
                      Bid {formatCurrency(pricing?.bid ?? null)} &middot; Ask {formatCurrency(pricing?.ask ?? null)}
                    </span>
                    <span className="text-muted small">
                      Day range {formatCurrency(pricing?.low ?? null)} – {formatCurrency(pricing?.high ?? null)}
                    </span>
                    <span className="text-muted small">Volume {formatNumber(pricing?.volume ?? null)}</span>
                    {detail.sector && <span className="badge bg-secondary-lt text-dark">{detail.sector}</span>}
                  </div>

                  <div className="mb-4">
                    <TickerPriceChart symbol={symbol} />
                  </div>

                  <h4 className="mb-2">Option Chain</h4>
                  <p className="text-muted small mb-3">
                    Near-the-money strikes for the next {expiryGroups.length || "few"} expiries in the 15-60 day
                    range typically used for covered calls and cash-secured puts.
                  </p>

                  {expiryGroups.length === 0 && <p className="text-muted">No option chain data available.</p>}

                  {expiryGroups.map((group) => (
                    <div key={group.expiry} className="mb-4">
                      <h5 className="mb-2">
                        {formatExpiry(group.expiry)}{" "}
                        <span className="text-muted fw-normal small">({group.daysToExpiry} DTE)</span>
                      </h5>
                      <div className="table-responsive">
                        <table className="table table-sm table-vcenter card-table">
                          <thead className="table-light">
                            <tr>
                              <th colSpan={4} className="text-center">
                                Calls
                              </th>
                              <th className="text-center">Strike</th>
                              <th colSpan={4} className="text-center">
                                Puts
                              </th>
                            </tr>
                            <tr>
                              <th className="text-end">Bid</th>
                              <th className="text-end">Ask</th>
                              <th className="text-end">IV</th>
                              <th className="text-end">Delta</th>
                              <th className="text-center">·</th>
                              <th className="text-end">Bid</th>
                              <th className="text-end">Ask</th>
                              <th className="text-end">IV</th>
                              <th className="text-end">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.strikes.map((row) => (
                              <tr key={row.strike}>
                                <OptionSideCells quote={row.call} />
                                <td className="text-center fw-bold">{formatCurrency(row.strike)}</td>
                                <OptionSideCells quote={row.put} />
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
