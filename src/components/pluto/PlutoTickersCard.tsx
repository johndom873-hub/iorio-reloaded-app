import { useState } from "react";
import type { PlutoTicker } from "../../api/pluto";
import { formatRelativeDate } from "../../lib/formatters";
import { Spinner } from "../Spinner";
import { PlutoBotToggle } from "./PlutoBotToggle";

interface PlutoTickersCardProps {
  tickers: PlutoTicker[];
  max: number;
  loading: boolean;
  error: string | null;
  onChanged: (entryId: string, enabled: boolean) => void;
  onOpenTickerDetail: (symbol: string) => void;
}

export function PlutoTickersCard({ tickers, max, loading, error, onChanged, onOpenTickerDetail }: PlutoTickersCardProps) {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const enabledCount = tickers.filter((ticker) => ticker.botEnabled).length;
  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h3 className="card-title m-0">Allowed tickers</h3>
        <span className={`badge ${enabledCount >= max ? "bg-warning text-white" : "bg-secondary-lt"}`} style={{ fontSize: "0.72rem" }}>{enabledCount} of {max}</span>
      </div>
      <div className="card-body">
        {(error || toggleError) && <div className="alert alert-danger">{error ?? toggleError}</div>}
        {loading ? (
          <Spinner size="sm" label="Loading tickers" />
        ) : tickers.length === 0 ? (
          <div className="text-muted" style={{ fontSize: "0.85rem" }}>The shortlist is empty.</div>
        ) : (
          <div className="row g-2">
            {tickers.map((ticker) => (
              <div key={ticker.entryId} className="col-12 col-sm-6 col-md-4 col-xl-3">
                <div className="d-flex align-items-center justify-content-between gap-2 py-1 border-bottom">
                  <span style={{ minWidth: 0 }}>
                    <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => onOpenTickerDetail(ticker.symbol)}>{ticker.symbol}</button>
                    <span className="text-muted ms-2" style={{ fontSize: "0.75rem" }}>
                      {ticker.botEnabled ? `${ticker.botEnabledChangedBy ?? "enabled"}${ticker.botEnabledChangedAt ? ` · ${formatRelativeDate(ticker.botEnabledChangedAt)}` : ""}` : "off"}
                    </span>
                  </span>
                  <PlutoBotToggle entryId={ticker.entryId} symbol={ticker.symbol} enabled={ticker.botEnabled} onChanged={(enabled) => { setToggleError(null); onChanged(ticker.entryId, enabled); }} onError={setToggleError} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-muted mt-3" style={{ fontSize: "0.78rem" }}>Each enabled ticker holds one IBKR market-data line on Pluto's connection. The same toggle is on the Shortlist tab.</div>
      </div>
    </div>
  );
}
