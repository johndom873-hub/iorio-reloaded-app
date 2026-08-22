import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { RollPositionModal } from "../components/RollPositionModal";
import { ApiError } from "../api/client";
import {
  fetchTradeAlerts,
  isRollAlert,
  openTradeAlertRunStream,
  rejectTradeAlert,
  type NewTradeCandidate,
  type TradeAlert,
  type TradeAlertStatus,
} from "../api/tradeAlerts";
import type { StrategyKey } from "../api/screener";
import type { PositionLeg } from "../api/positions";
import { computePayoff } from "../lib/payoff";
import { formatCurrency, formatDate, formatDateTime, formatPercentage, formatSignedPnl } from "../lib/formatters";

const strategyTabs: { key: StrategyKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

const statusOptions: { key: TradeAlertStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "modified", label: "Modified" },
  { key: "expired", label: "Expired" },
];

const statusBadgeClass: Record<TradeAlertStatus, string> = {
  pending: "bg-azure-lt text-dark",
  approved: "bg-success-lt text-dark",
  rejected: "bg-danger-lt text-dark",
  modified: "bg-success-lt text-dark",
  expired: "bg-secondary-lt text-dark",
};

const statusLabel: Record<TradeAlertStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  modified: "Modified",
  expired: "Expired",
};

// Pending alerts get action buttons (Trade/Roll/Reject); every other status
// is a past decision, shown read-only with when it was reviewed.
function ReviewedFooter({ alert }: { alert: TradeAlert }) {
  return (
    <div className="d-flex justify-content-between align-items-center mt-auto pt-2">
      <span className={`badge ${statusBadgeClass[alert.status]}`}>{statusLabel[alert.status]}</span>
      {alert.reviewedAt && <span className="text-secondary" style={{ fontSize: "0.75rem" }}>{formatDateTime(alert.reviewedAt)}</span>}
    </div>
  );
}

// Synthesizes the legs a payoff calculation needs from a suggestion, since
// nothing has been entered into position_legs yet — this alert may never
// become a real position. A covered call's implicit stock leg assumes
// buying at the spot price captured when the alert was generated (the
// same assumption the ranking formula's capitalAtRisk already makes) and
// a standard 100-share lot; both are scan-time estimates for comparison
// purposes only; make no claim about what an actual fill would be.
function candidateToLegs(alert: TradeAlert & { suggestedStructure: NewTradeCandidate }): PositionLeg[] {
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
  const [status, setStatus] = useState<TradeAlertStatus>("pending");
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [rollAlert, setRollAlert] = useState<TradeAlert | null>(null);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchTradeAlerts({ status, strategyKey: strategy === "all" ? undefined : strategy });
      setAlerts(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trade alerts.");
    }
  }, [strategy, status]);

  useEffect(() => {
    setLoading(true);
    loadAlerts().finally(() => setLoading(false));
  }, [loadAlerts]);

  const closeRunStreamRef = useRef<(() => void) | null>(null);
  useEffect(() => () => closeRunStreamRef.current?.(), []);

  function handleRunAlerts() {
    setRunning(true);
    setRunError(null);
    setRunProgress("Starting scan...");

    closeRunStreamRef.current = openTradeAlertRunStream((event) => {
      if (event.type === "strategyStart") {
        const label = event.strategyKey === "covered_call" ? "Covered Calls" : "Cash-Secured Puts";
        setRunProgress(`Scanning ${event.tickerCount} shortlisted ticker(s) for ${label}...`);
      } else if (event.type === "ticker") {
        setRunProgress(`${event.symbol}: ${event.candidateCount} candidate(s) found.`);
      } else if (event.type === "tickerError") {
        setRunProgress(`${event.symbol}: scan failed — ${event.message}`);
      } else if (event.type === "streamError") {
        setRunError(event.message);
        setRunning(false);
        setRunProgress(null);
      } else if (event.type === "done") {
        setRunning(false);
        setRunProgress(null);
        loadAlerts();
      }
    });
  }

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

  function handleTradeNewAlert(alert: TradeAlert & { suggestedStructure: NewTradeCandidate }) {
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
      <PageHeader
        title="Trade Alerts"
        subtitle="Suggested trades awaiting your review"
        actions={
          <button
            type="button"
            className="btn btn-outline-primary d-inline-flex align-items-center gap-1"
            disabled={running}
            onClick={handleRunAlerts}
          >
            {running && <Spinner size="sm" />}
            Run Alerts Now
          </button>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {runError && <div className="alert alert-danger">{runError}</div>}
      {running && runProgress && <div className="alert alert-info">{runProgress}</div>}

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <ul className="nav nav-pills mb-0">
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
        <select
          className="form-select w-auto"
          value={status}
          onChange={(event) => setStatus(event.target.value as TradeAlertStatus)}
          aria-label="Filter by status"
        >
          {statusOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="d-flex justify-content-center py-4">
          <Spinner label="Loading trade alerts" />
        </div>
      )}

      {!loading && groupedByTicker.size === 0 && (
        <div className="alert alert-info">
          {status === "pending"
            ? 'No pending trade alerts. Click "Run Alerts Now" above to scan the shortlist.'
            : `No ${status} trade alerts.`}
        </div>
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
                    if (isRollAlert(alert)) {
                      const { closeLeg, replacement, trigger, dte } = alert.suggestedStructure;
                      const rightLabel = closeLeg.right === "call" ? "C" : "P";
                      const triggerLabel = trigger === "decay" ? "Decayed ≤50%" : `≤21 DTE (${dte}d)`;
                      return (
                        <div className="col-12 col-md-6 col-lg-4" key={alert.id}>
                          <div className="card h-100">
                            <div className="card-body d-flex flex-column gap-2">
                              <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
                                <div>
                                  <div className="fw-bold">
                                    Roll ${closeLeg.strike.toFixed(2)}
                                    {rightLabel}
                                  </div>
                                  <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                                    exp {formatDate(closeLeg.expiry)} → ${replacement.strike.toFixed(2)} exp{" "}
                                    {formatDate(replacement.expiry)}
                                  </div>
                                </div>
                                <span className="badge bg-yellow-lt text-dark text-nowrap">{triggerLabel}</span>
                              </div>

                              <div className="row g-2" style={{ fontSize: "0.85rem" }}>
                                <div className="col-6">
                                  <div className="text-secondary">Current price</div>
                                  <div>{formatCurrency(closeLeg.currentPrice)}</div>
                                </div>
                                <div className="col-6">
                                  <div className="text-secondary">Credit collected</div>
                                  <div>{formatCurrency(closeLeg.entryPrice)}</div>
                                </div>
                              </div>

                              <div className="row g-2" style={{ fontSize: "0.85rem" }}>
                                <div className="col-6">
                                  <div className="text-secondary">New premium</div>
                                  <div>{formatCurrency(replacement.premium)}</div>
                                </div>
                                <div className="col-6">
                                  <div className="text-secondary">New yield</div>
                                  <div>{formatPercentage(replacement.annualizedYield)}</div>
                                </div>
                              </div>

                              <p className="text-secondary mb-0" style={{ fontSize: "0.8rem" }}>
                                {alert.rationale}
                              </p>

                              {alert.status === "pending" ? (
                                <div className="d-flex gap-2 mt-auto pt-2">
                                  <button type="button" className="btn btn-sm btn-primary flex-fill" onClick={() => setRollAlert(alert)}>
                                    Roll
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-danger flex-fill d-inline-flex align-items-center justify-content-center gap-1"
                                    disabled={rejectingId === alert.id}
                                    onClick={() => handleReject(alert.id)}
                                  >
                                    {rejectingId === alert.id && <Spinner size="sm" />}
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <ReviewedFooter alert={alert} />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const newTradeAlert = alert as TradeAlert & { suggestedStructure: NewTradeCandidate };
                    const payoff = computePayoff(newTradeAlert.strategyKey, candidateToLegs(newTradeAlert));
                    return (
                      <div className="col-12 col-md-6 col-lg-4" key={alert.id}>
                        <div className="card h-100">
                          <div className="card-body d-flex flex-column gap-2">
                            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
                              <div>
                                <div className="fw-bold">
                                  ${newTradeAlert.suggestedStructure.strike.toFixed(2)}
                                  {newTradeAlert.suggestedStructure.right === "call" ? "C" : "P"}
                                </div>
                                <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                                  exp {formatDate(newTradeAlert.suggestedStructure.expiry)} ({newTradeAlert.suggestedStructure.dte} DTE)
                                </div>
                              </div>
                              <span className="badge badge-change-pos text-nowrap">
                                {formatPercentage(newTradeAlert.suggestedStructure.annualizedYield)} yield
                              </span>
                            </div>

                            <div className="row g-2" style={{ fontSize: "0.85rem" }}>
                              <div className="col-6">
                                <div className="text-secondary">Delta</div>
                                <div>{newTradeAlert.suggestedStructure.delta.toFixed(2)}</div>
                              </div>
                              <div className="col-6">
                                <div className="text-secondary">Premium</div>
                                <div>{formatCurrency(newTradeAlert.suggestedStructure.premium)}</div>
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
                                  <div>{formatSignedPnl(-payoff.maxLoss)}</div>
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

                            {alert.status === "pending" ? (
                              <div className="d-flex gap-2 mt-auto pt-2">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary flex-fill"
                                  onClick={() => handleTradeNewAlert(newTradeAlert)}
                                >
                                  Trade
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger flex-fill d-inline-flex align-items-center justify-content-center gap-1"
                                  disabled={rejectingId === alert.id}
                                  onClick={() => handleReject(alert.id)}
                                >
                                  {rejectingId === alert.id && <Spinner size="sm" />}
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <ReviewedFooter alert={alert} />
                            )}
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
      {rollAlert && isRollAlert(rollAlert) && (
        <RollPositionModal
          alert={rollAlert}
          onClose={() => setRollAlert(null)}
          onRolled={() => setAlerts((prev) => prev.filter((a) => a.id !== rollAlert.id))}
        />
      )}
    </>
  );
}
