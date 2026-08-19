import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import { fetchTradeAlerts, rejectTradeAlert, type TradeAlert } from "../api/tradeAlerts";
import type { StrategyKey } from "../api/screener";
import type { PositionLeg } from "../api/positions";
import { computePayoff } from "../lib/payoff";
import { formatCurrency, formatDate, formatPercentage, formatSignedPnl } from "../lib/formatters";

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

// Synthesizes the legs a payoff calculation needs from a suggestion, since
// nothing has been entered into position_legs yet — this alert may never
// become a real position. A covered call's implicit stock leg assumes
// buying at the spot price captured when the alert was generated (the
// same assumption the ranking formula's capitalAtRisk already makes) and
// a standard 100-share lot; both are scan-time estimates for comparison
// purposes only; make no claim about what an actual fill would be.
function candidateToLegs(alert: TradeAlert): PositionLeg[] {
  const s = alert.suggestedStructure;
  const optionLeg: PositionLeg = {
    id: `alert-${alert.id}-option`,
    legType: "option",
    side: "short",
    quantity: 1,
    optionType: s.right,
    strikePrice: String(s.strike),
    expiryDate: s.expiry,
    multiplier: 100,
    ibkrContractId: null,
    entryPrice: String(s.premium),
    entryAt: alert.createdAt,
    exitPrice: null,
    exitAt: null,
  };
  if (alert.strategyKey === "cash_secured_put") return [optionLeg];

  const stockLeg: PositionLeg = {
    id: `alert-${alert.id}-stock`,
    legType: "stock",
    side: "long",
    quantity: 100,
    optionType: null,
    strikePrice: null,
    expiryDate: null,
    multiplier: 1,
    ibkrContractId: null,
    entryPrice: String(s.spotPrice),
    entryAt: alert.createdAt,
    exitPrice: null,
    exitAt: null,
  };
  return [optionLeg, stockLeg];
}

export function TradeAlertsPage() {
  const navigate = useNavigate();
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchTradeAlerts({ status: "pending", strategyKey: strategy === "all" ? undefined : strategy });
      setAlerts(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trade alerts.");
    }
  }, [strategy]);

  useEffect(() => {
    setLoading(true);
    loadAlerts().finally(() => setLoading(false));
  }, [loadAlerts]);

  async function handleReject(id: string) {
    setRejectingId(id);
    try {
      setError(null);
      await rejectTradeAlert(id);
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reject alert.");
    } finally {
      setRejectingId(null);
    }
  }

  function handleTrade(alert: TradeAlert) {
    const params = new URLSearchParams({
      symbol: alert.symbol,
      strategy: alert.strategyKey,
      strike: String(alert.suggestedStructure.strike),
      expiry: alert.suggestedStructure.expiry,
      premium: String(alert.suggestedStructure.premium),
      alertId: alert.id,
      new: "1",
    });
    navigate(`/positions?${params.toString()}`);
  }

  const groupedByTicker = new Map<string, TradeAlert[]>();
  for (const alert of alerts) {
    const existing = groupedByTicker.get(alert.tickerId) ?? [];
    existing.push(alert);
    groupedByTicker.set(alert.tickerId, existing);
  }

  return (
    <>
      <PageHeader title="Trade Alerts" subtitle="Suggested trades awaiting your review" />

      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="nav nav-pills mb-3">
        {strategyTabs.map((tab) => (
          <li className="nav-item" key={tab.key}>
            <button
              type="button"
              className={`nav-link ${strategy === tab.key ? "active" : ""}`}
              onClick={() => setStrategy(tab.key)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>

      {loading && (
        <div className="d-flex justify-content-center py-4">
          <Spinner label="Loading trade alerts" />
        </div>
      )}

      {!loading && groupedByTicker.size === 0 && (
        <div className="alert alert-info">No pending trade alerts. Run the daily trade-alert generation job to scan the shortlist.</div>
      )}

      {!loading &&
        Array.from(groupedByTicker.entries()).map(([tickerId, tickerAlerts]) => {
          const first = tickerAlerts[0];
          return (
            <div className="card mb-3" key={tickerId}>
              <div className="card-header d-flex align-items-center justify-content-between">
                <div>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none fw-bold fs-5"
                    onClick={() => setDetailSymbol(first.symbol)}
                  >
                    {first.symbol}
                  </button>
                  <span className="text-secondary ms-2">{first.companyName ?? "—"}</span>
                </div>
                <span className="badge bg-azure-lt text-dark" style={{ fontSize: "0.72rem" }}>
                  {first.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
                </span>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  {tickerAlerts.map((alert) => {
                    const payoff = computePayoff(alert.strategyKey, candidateToLegs(alert));
                    return (
                      <div className="col-12 col-md-6 col-lg-4" key={alert.id}>
                        <div className="card h-100">
                          <div className="card-body d-flex flex-column gap-2">
                            <div className="d-flex justify-content-between align-items-start">
                              <div>
                                <div className="fw-bold">
                                  ${alert.suggestedStructure.strike.toFixed(2)}
                                  {alert.suggestedStructure.right === "call" ? "C" : "P"}
                                </div>
                                <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                                  exp {formatDate(alert.suggestedStructure.expiry)} ({alert.suggestedStructure.dte} DTE)
                                </div>
                              </div>
                              <span className="badge badge-change-pos">
                                {formatPercentage(alert.suggestedStructure.annualizedYield)} yield
                              </span>
                            </div>

                            <div className="row g-2" style={{ fontSize: "0.85rem" }}>
                              <div className="col-6">
                                <div className="text-secondary">Delta</div>
                                <div>{alert.suggestedStructure.delta.toFixed(2)}</div>
                              </div>
                              <div className="col-6">
                                <div className="text-secondary">Premium</div>
                                <div>{formatCurrency(alert.suggestedStructure.premium)}</div>
                              </div>
                            </div>

                            {payoff && (
                              <div className="row g-2" style={{ fontSize: "0.85rem" }}>
                                <div className="col-4">
                                  <div className="text-secondary">Max Gain</div>
                                  <div>{formatSignedPnl(payoff.maxGain)}</div>
                                </div>
                                <div className="col-4">
                                  <div className="text-secondary">Max Loss</div>
                                  <div>{formatSignedPnl(payoff.maxLoss)}</div>
                                </div>
                                <div className="col-4">
                                  <div className="text-secondary">Breakeven</div>
                                  <div>{formatCurrency(payoff.breakeven)}</div>
                                </div>
                              </div>
                            )}

                            <p className="text-secondary mb-0" style={{ fontSize: "0.8rem" }}>
                              {alert.rationale}
                            </p>

                            <div className="d-flex gap-2 mt-auto pt-2">
                              <button type="button" className="btn btn-primary flex-fill" onClick={() => handleTrade(alert)}>
                                Trade
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-danger d-inline-flex align-items-center justify-content-center gap-1"
                                disabled={rejectingId === alert.id}
                                onClick={() => handleReject(alert.id)}
                              >
                                {rejectingId === alert.id && <Spinner size="sm" />}
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
