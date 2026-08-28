import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { RollPositionModal } from "../components/RollPositionModal";
import { ApiError } from "../api/client";
import { useBackgroundJobs, useJobEvents } from "../contexts/BackgroundJobsContext";
import {
  fetchTradeAlerts,
  isRollAlert,
  refreshTickerAlerts,
  refreshTradeAlert,
  type NewTradeCandidate,
  type RollStructure,
  type TradeAlert,
  type TradeAlertStatus,
} from "../api/tradeAlerts";
import type { StrategyKey } from "../api/screener";
import {
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercentage,
} from "../lib/formatters";

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
  pending: "bg-azure-lt",
  approved: "bg-success-lt",
  rejected: "bg-danger-lt",
  modified: "bg-success-lt",
  expired: "bg-secondary-lt",
};

const statusLabel: Record<TradeAlertStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  modified: "Modified",
  expired: "Expired",
};

function StrategyBadge({ strategyKey }: { strategyKey: StrategyKey }) {
  return <span className="badge bg-azure-lt">{strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}</span>;
}

// A non-pending alert (viewed via the status filter) is a past decision, not
// something actionable — shown as a read-only status badge instead of the
// row's normal action button(s).
function StatusCell({ alert }: { alert: TradeAlert }) {
  return (
    <div>
      <span className={`badge ${statusBadgeClass[alert.status]}`}>{statusLabel[alert.status]}</span>
      {alert.reviewedAt && (
        <div className="text-secondary" style={{ fontSize: "0.7rem" }}>
          {alert.reviewedByDisplayName ? `${alert.reviewedByDisplayName} — ` : ""}
          {formatDateTime(alert.reviewedAt)}
        </div>
      )}
    </div>
  );
}

type NewTradeAlert = TradeAlert & { suggestedStructure: NewTradeCandidate };
type RollAlert = TradeAlert & { suggestedStructure: RollStructure };

export function TradeAlertsPage() {
  const [strategy, setStrategy] = useState<StrategyKey | "all">("all");
  const [status, setStatus] = useState<TradeAlertStatus>("pending");
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [tickerRefreshingSymbol, setTickerRefreshingSymbol] = useState<string | null>(null);
  const [tickerRefreshError, setTickerRefreshError] = useState<string | null>(null);
  // A per-ticker refresh that finds zero remaining new_trade candidates
  // shouldn't make the ticker's whole card vanish (approved 2026-08-27) —
  // that reads as if the click did nothing. Cards for tickers refreshed down
  // to empty stay pinned here (id -> display info) until a real reload
  // (status/strategy filter change, or the global "Run Alerts Now") clears
  // the slate, at which point a ticker with genuinely zero alerts correctly
  // stops appearing at all, matching this page's normal behavior.
  const [keptEmptyTickers, setKeptEmptyTickers] = useState<Map<string, { symbol: string; companyName: string | null }>>(new Map());
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [detailAlertId, setDetailAlertId] = useState<string | undefined>(undefined);
  const [rollAlert, setRollAlert] = useState<RollAlert | null>(null);
  const { jobs, startTradeAlertScan } = useBackgroundJobs();
  const scanJob = jobs.find((job) => job.id === "trade-alert-scan");
  const running = scanJob?.status === "running";

  const loadAlerts = useCallback(async (): Promise<TradeAlert[] | null> => {
    try {
      setError(null);
      const result = await fetchTradeAlerts({ status, strategyKey: strategy === "all" ? undefined : strategy });
      setAlerts(result);
      return result;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trade alerts.");
      return null;
    }
  }, [strategy, status]);

  useEffect(() => {
    setLoading(true);
    setKeptEmptyTickers(new Map());
    loadAlerts().finally(() => setLoading(false));
  }, [loadAlerts]);

  // While this page is open, pull in each ticker/roll result as soon as it's
  // persisted (see runTradeAlertGeneration.ts — the DB row lands before the
  // event fires) instead of waiting for the whole scan to finish. The scan
  // itself and its toast live in BackgroundJobsContext, so this keeps
  // running (and the toast keeps updating) even if the user navigates away
  // and back.
  useJobEvents("trade-alert-scan", (event) => {
    if (event.type === "tickerAlertsReady" || event.type === "done" || (event.type === "rollCandidate" && event.triggered)) {
      loadAlerts();
    }
  });

  async function handleRefresh(id: string) {
    setRefreshingId(id);
    setRefreshError(null);
    try {
      const updated = await refreshTradeAlert(id);
      setAlerts((prev) => prev.map((alert) => (alert.id === id ? updated : alert)));
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : "Failed to refresh alert.");
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleTickerRefresh(tickerId: string, symbol: string, companyName: string | null) {
    setTickerRefreshingSymbol(symbol);
    setTickerRefreshError(null);
    try {
      await refreshTickerAlerts(symbol);
      const result = await loadAlerts();
      const stillHasAlerts = result?.some((a) => a.tickerId === tickerId) ?? true;
      setKeptEmptyTickers((prev) => {
        const next = new Map(prev);
        if (stillHasAlerts) next.delete(tickerId);
        else next.set(tickerId, { symbol, companyName });
        return next;
      });
    } catch (err) {
      setTickerRefreshError(err instanceof ApiError ? err.message : "Failed to refresh alerts for this ticker.");
    } finally {
      setTickerRefreshingSymbol(null);
    }
  }

  function handleReview(alert: NewTradeAlert) {
    setDetailSymbol(alert.symbol);
    setDetailAlertId(alert.id);
  }

  interface TickerGroup {
    tickerId: string;
    symbol: string;
    companyName: string | null;
    alerts: TradeAlert[];
  }

  const groupedByTicker = new Map<string, TickerGroup>();
  for (const alert of alerts) {
    const existing = groupedByTicker.get(alert.tickerId);
    if (existing) existing.alerts.push(alert);
    else groupedByTicker.set(alert.tickerId, { tickerId: alert.tickerId, symbol: alert.symbol, companyName: alert.companyName, alerts: [alert] });
  }
  for (const [tickerId, { symbol, companyName }] of keptEmptyTickers) {
    if (!groupedByTicker.has(tickerId)) groupedByTicker.set(tickerId, { tickerId, symbol, companyName, alerts: [] });
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
            onClick={startTradeAlertScan}
          >
            {running && <Spinner size="sm" />}
            Run Alerts Now
          </button>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {refreshError && <div className="alert alert-danger">{refreshError}</div>}
      {tickerRefreshError && <div className="alert alert-danger">{tickerRefreshError}</div>}

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <ul className="nav nav-tabs mb-0">
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
        Array.from(groupedByTicker.values()).map((group) => {
          const { tickerId, symbol, companyName, alerts: tickerAlerts } = group;
          const newTradeAlerts = tickerAlerts.filter((a): a is NewTradeAlert => !isRollAlert(a));
          const rollAlerts = tickerAlerts.filter((a): a is RollAlert => isRollAlert(a));
          const isTickerRefreshing = tickerRefreshingSymbol === symbol;

          return (
            <div className="card mb-3" key={tickerId}>
              <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none fw-bold fs-5"
                    onClick={() => {
                      setDetailSymbol(symbol);
                      setDetailAlertId(undefined);
                    }}
                  >
                    {symbol}
                  </button>
                  <span className="text-secondary ms-2">{companyName ?? "—"}</span>
                </div>
                {status === "pending" && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                    disabled={isTickerRefreshing}
                    onClick={() => handleTickerRefresh(tickerId, symbol, companyName)}
                    title="Rescan this ticker's new trade alerts (both strategies) against live IBKR data"
                  >
                    {isTickerRefreshing && <Spinner size="sm" />}
                    Refresh
                  </button>
                )}
              </div>
              <div className="card-body d-flex flex-column gap-4">
                <div>
                  <h6 className="text-secondary text-uppercase mb-2" style={{ fontSize: "0.72rem" }}>
                    New Trade Alerts
                  </h6>
                  {newTradeAlerts.length === 0 ? (
                    <p className="text-secondary mb-0">No active trade alerts.</p>
                  ) : (
                    <>
                      {/* Desktop/tablet: full table */}
                      <div className="table-responsive border rounded d-none d-md-block">
                        <table className="table table-sm table-vcenter card-table table-hover mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Strategy</th>
                              <th>Expiry</th>
                              <th className="text-end">Strike</th>
                              <th className="text-end">Delta</th>
                              <th className="text-end">Premium</th>
                              <th className="text-end">Ann. Yield</th>
                              <th style={{ width: 110 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {newTradeAlerts.map((alert) => {
                              const s = alert.suggestedStructure;
                              return (
                                <tr key={alert.id} title={alert.rationale ?? undefined}>
                                  <td>
                                    <StrategyBadge strategyKey={alert.strategyKey} />
                                  </td>
                                  <td>
                                    {formatDate(s.expiry)} <span className="text-secondary">({s.dte} DTE)</span>
                                  </td>
                                  <td className="text-end font-mono">
                                    {formatCurrencyTrimmed(s.strike)}
                                    {s.right === "call" ? "C" : "P"}
                                  </td>
                                  <td className="text-end font-mono">{formatNumber(s.delta, 2)}</td>
                                  <td className="text-end font-mono">{formatCurrency(s.premium)}</td>
                                  <td className="text-end font-mono">
                                    <span className="badge badge-change-pos">{formatPercentage(s.annualizedYield)}</span>
                                  </td>
                                  <td className="text-end">
                                    {alert.status === "pending" ? (
                                      <button type="button" className="btn btn-sm btn-primary" onClick={() => handleReview(alert)}>
                                        Review
                                      </button>
                                    ) : (
                                      <StatusCell alert={alert} />
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile: compact cards instead of a squeezed table */}
                      <div className="d-md-none d-flex flex-column gap-2">
                        {newTradeAlerts.map((alert) => {
                          const s = alert.suggestedStructure;
                          return (
                            <div key={alert.id} className="border rounded p-2" title={alert.rationale ?? undefined}>
                              <div className="d-flex align-items-start justify-content-between gap-2">
                                <div>
                                  <StrategyBadge strategyKey={alert.strategyKey} />
                                  <div className="fw-bold mt-1 font-mono">
                                    {formatCurrencyTrimmed(s.strike)}
                                    {s.right === "call" ? "C" : "P"} · {formatDate(s.expiry)}
                                  </div>
                                  <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
                                    Δ {formatNumber(s.delta, 2)} · Prem {formatCurrency(s.premium)} · {s.dte} DTE
                                  </div>
                                </div>
                                <span className="badge badge-change-pos font-mono text-nowrap">{formatPercentage(s.annualizedYield)}</span>
                              </div>
                              <div className="mt-2">
                                {alert.status === "pending" ? (
                                  <button type="button" className="btn btn-sm btn-primary w-100" onClick={() => handleReview(alert)}>
                                    Review
                                  </button>
                                ) : (
                                  <StatusCell alert={alert} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {rollAlerts.length > 0 && (
                  <div>
                    <h6 className="text-secondary text-uppercase mb-2" style={{ fontSize: "0.72rem" }}>
                      Roll Alerts
                    </h6>
                    {/* Desktop/tablet: full table */}
                    <div className="table-responsive border rounded d-none d-md-block">
                      <table className="table table-sm table-vcenter card-table table-hover mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Position</th>
                            <th>Trigger</th>
                            <th className="text-end">Current / Credit</th>
                            <th>Replacement</th>
                            <th className="text-end">New Premium</th>
                            <th className="text-end">New Yield</th>
                            <th style={{ width: 170 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rollAlerts.map((alert) => {
                            const { closeLeg, replacement, trigger, dte, stillTriggered } = alert.suggestedStructure;
                            const rightLabel = closeLeg.right === "call" ? "C" : "P";
                            const triggerLabel = trigger === "decay" ? "Decayed ≤50%" : `≤21 DTE (${dte}d)`;
                            return (
                              <tr key={alert.id} title={alert.rationale ?? undefined}>
                                <td>
                                  {formatCurrencyTrimmed(closeLeg.strike)}
                                  {rightLabel} exp {formatDate(closeLeg.expiry)}
                                </td>
                                <td>
                                  {stillTriggered === false ? (
                                    <span className="badge bg-secondary-lt text-nowrap">No longer triggered</span>
                                  ) : (
                                    <span className="badge bg-yellow-lt text-nowrap">{triggerLabel}</span>
                                  )}
                                </td>
                                <td className="text-end font-mono">
                                  {formatCurrency(closeLeg.currentPrice)}
                                  <span className="text-secondary"> / </span>
                                  <span className="text-success">{formatCurrency(closeLeg.entryPrice)}</span>
                                </td>
                                <td>
                                  {formatCurrencyTrimmed(replacement.strike)}
                                  {rightLabel} exp {formatDate(replacement.expiry)}{" "}
                                  <span className="text-secondary">
                                    ({replacement.dte} DTE, Δ{formatNumber(replacement.delta, 2)})
                                  </span>
                                </td>
                                <td className="text-end font-mono text-success">{formatCurrency(replacement.premium)}</td>
                                <td className="text-end font-mono">
                                  <span className="badge badge-change-pos">{formatPercentage(replacement.annualizedYield)}</span>
                                </td>
                                <td className="text-end">
                                  {alert.status === "pending" ? (
                                    <div className="d-flex gap-2 justify-content-end">
                                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setRollAlert(alert)}>
                                        Roll
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                                        disabled={refreshingId === alert.id}
                                        onClick={() => handleRefresh(alert.id)}
                                        title="Re-quote this alert's contracts against live IBKR data"
                                      >
                                        {refreshingId === alert.id && <Spinner size="sm" />}
                                        Refresh
                                      </button>
                                    </div>
                                  ) : (
                                    <StatusCell alert={alert} />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: compact cards */}
                    <div className="d-md-none d-flex flex-column gap-2">
                      {rollAlerts.map((alert) => {
                        const { closeLeg, replacement, trigger, dte, stillTriggered } = alert.suggestedStructure;
                        const rightLabel = closeLeg.right === "call" ? "C" : "P";
                        const triggerLabel = trigger === "decay" ? "Decayed ≤50%" : `≤21 DTE (${dte}d)`;
                        return (
                          <div key={alert.id} className="border rounded p-2" title={alert.rationale ?? undefined}>
                            <div className="d-flex align-items-start justify-content-between gap-2">
                              <div>
                                <div className="fw-bold font-mono">
                                  {formatCurrencyTrimmed(closeLeg.strike)}
                                  {rightLabel} → {formatCurrencyTrimmed(replacement.strike)}
                                  {rightLabel}
                                </div>
                                <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
                                  exp {formatDate(closeLeg.expiry)} → {formatDate(replacement.expiry)} ({replacement.dte} DTE, Δ
                                  {formatNumber(replacement.delta, 2)})
                                </div>
                              </div>
                              {stillTriggered === false ? (
                                <span className="badge bg-secondary-lt text-nowrap">No longer triggered</span>
                              ) : (
                                <span className="badge bg-yellow-lt text-nowrap">{triggerLabel}</span>
                              )}
                            </div>
                            <div className="row g-2 mt-1" style={{ fontSize: "0.8rem" }}>
                              <div className="col-6">
                                <div className="text-secondary">Current / Credit</div>
                                <div className="font-mono">
                                  {formatCurrency(closeLeg.currentPrice)}
                                  <span className="text-secondary"> / </span>
                                  <span className="text-success">{formatCurrency(closeLeg.entryPrice)}</span>
                                </div>
                              </div>
                              <div className="col-6">
                                <div className="text-secondary">New Premium / Yield</div>
                                <div className="font-mono">
                                  <span className="text-success">{formatCurrency(replacement.premium)}</span>{" "}
                                  <span className="badge badge-change-pos">{formatPercentage(replacement.annualizedYield)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-2">
                              {alert.status === "pending" ? (
                                <div className="d-flex gap-2">
                                  <button type="button" className="btn btn-sm btn-primary flex-fill" onClick={() => setRollAlert(alert)}>
                                    Roll
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary flex-fill d-inline-flex align-items-center justify-content-center gap-1"
                                    disabled={refreshingId === alert.id}
                                    onClick={() => handleRefresh(alert.id)}
                                  >
                                    {refreshingId === alert.id && <Spinner size="sm" />}
                                    Refresh
                                  </button>
                                </div>
                              ) : (
                                <StatusCell alert={alert} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

      {detailSymbol && (
        <TickerDetailModal
          symbol={detailSymbol}
          initialAlertId={detailAlertId}
          onClose={() => {
            setDetailSymbol(null);
            setDetailAlertId(undefined);
          }}
        />
      )}
      {rollAlert && (
        <RollPositionModal
          alert={rollAlert}
          onClose={() => setRollAlert(null)}
          onRolled={() => setAlerts((prev) => prev.filter((a) => a.id !== rollAlert.id))}
        />
      )}
    </>
  );
}
