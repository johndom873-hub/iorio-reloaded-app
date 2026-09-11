import { useMemo, useState } from "react";
import { Spinner } from "./Spinner";
import { ApexChart } from "./charts/ApexChart";
import { ClosePositionModal } from "./ClosePositionModal";
import { RollPositionModal } from "./RollPositionModal";
import { RecoveryPathModal } from "./RecoveryPathModal";
import { ApiError } from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import { fetchRollCandidate, type Greeks, type Position, type RollCandidate, type UnrealizedPnlResult } from "../api/positions";
import type { RollStructure, TradeAlert } from "../api/tradeAlerts";
import { computePayoff } from "../lib/payoff";
import {
  daysAgo,
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
  formatDateTime,
  formatDaysAgo,
  formatExpiryWithDte,
  formatNumber,
  formatPercentageValue,
  formatSignedPnl,
  pnlBadgeClass,
  pnlTextClass,
  todayInEasternIso,
} from "../lib/formatters";
import {
  positionHasOptionLeg,
  positionHasStockLeg,
  positionPnlAsOfDate,
  positionPremiumPnl,
  positionStockPnl,
  positionTotalPnl,
  positionTotalPnlPercent,
  strategyBadgeClass,
  strategyLabel,
} from "../lib/positionPnl";

interface PositionCardProps {
  position: Position;
  greeksByLegId: Record<string, Greeks>;
  greeksFetchFailed: boolean;
  unrealizedPnlByPositionId: Record<string, UnrealizedPnlResult>;
  unrealizedPnlFetchFailed: boolean;
  /** Last-known total account value, for EXP% — see PositionsPage's own prop of the same name. */
  totalAccountValue: number | null;
  currentPrice: number | null;
  /** This position's pending roll alert, if any — drives the roll-alert banner and the enhanced Roll button on its leg. */
  rollAlert?: TradeAlert & { suggestedStructure: RollStructure };
  onChanged: () => void;
  /**
   * Scrolls to this ticker's option chain so the user can pick a strike to
   * sell against held shares. When called with a prefill (e.g. from Recovery
   * Path's "Sell This"), the parent also preselects that strike/expiry/
   * quantity in the chain's order panel instead of leaving it blank.
   */
  onSellCall: (prefill?: { strike: number; expiry: string; quantity: number; premium: number }) => void;
}

const annotationColorsByTheme = {
  light: { breakeven: "#f59f00", current: "#4263eb", zero: "#adb5bd" },
  dark: { breakeven: "#f59f00", current: "#748ffc", zero: "#adb5bd" },
} as const;

// One open position's full detail + actions, as a card inside the
// consolidated ticker/position modal (2026-08-31 modal-wiring-audit merge).
// A symbol can have more than one concurrently open position here (e.g. an
// open CSP and an open covered call at once), so the parent renders one of
// these per open position rather than assuming exactly one. Extracted from
// the old standalone PositionDetailModal — same legs table/payoff
// chart/editable fields/Close flow, now reusable per-card. Roll is new here:
// PositionDetailModal never had it (Roll was only reachable from a live
// Trade Alert's roll row).
export function PositionCard({
  position,
  greeksByLegId,
  greeksFetchFailed,
  unrealizedPnlByPositionId,
  unrealizedPnlFetchFailed,
  totalAccountValue,
  currentPrice,
  rollAlert,
  onChanged,
  onSellCall,
}: PositionCardProps) {
  const { theme } = useTheme();
  const annotationColors = annotationColorsByTheme[theme];

  const [showClose, setShowClose] = useState(false);
  const [showRecoveryPath, setShowRecoveryPath] = useState(false);

  // Mirrors PositionsPage's action-column eligibility: an unstructured
  // position (bare stock leftover from an expired covered call or an
  // assigned CSP — not a strategy anyone chose) with an open stock leg can
  // sell a call against it or check a recovery-path projection, regardless
  // of whether it also happens to carry another open leg.
  const isUnstructured = position.strategyKey === "unstructured";
  const hasOpenStockLeg = position.legs.some((leg) => leg.legType === "stock" && !leg.exitAt);

  const [rollingLegId, setRollingLegId] = useState<string | null>(null);
  const [rollError, setRollError] = useState<string | null>(null);
  const [rollCandidate, setRollCandidate] = useState<RollCandidate | null>(null);
  // Set when the user opens the roll flow off a real pending roll alert
  // (banner or the leg's alert-aware Roll button) rather than the on-demand
  // fetchRollCandidate path — keeps its id so the roll gets submitted as
  // sourceAlertId instead of a bare on-demand roll.
  const [selectedRollAlert, setSelectedRollAlert] = useState<(TradeAlert & { suggestedStructure: RollStructure }) | null>(null);

  const payoff = useMemo(
    () => (position.strategyKey !== "unstructured" ? computePayoff(position.strategyKey, position.legs) : null),
    [position],
  );

  async function handleRollClick(legId: string) {
    setRollingLegId(legId);
    setRollError(null);
    try {
      const candidate = await fetchRollCandidate(position.id, legId);
      setRollCandidate(candidate);
    } catch (err) {
      setRollError(err instanceof ApiError ? err.message : "Failed to compute a roll candidate.");
    } finally {
      setRollingLegId(null);
    }
  }

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <span className={`badge ${strategyBadgeClass(position.strategyKey)}`}>{strategyLabel(position.strategyKey)}</span>
        {(() => {
          const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
          if (pnl === "loading") {
            if (unrealizedPnlFetchFailed) {
              return (
                <span className="badge bg-secondary-lt" title="Failed to load live P&L data">
                  P&L —
                </span>
              );
            }
            return <Spinner size="sm" label="Loading P&L" />;
          }
          if (pnl === null)
            return (
              <span className="badge bg-secondary-lt" title="No live price or recent snapshot available for this position">
                P&L —
              </span>
            );
          const pct = positionTotalPnlPercent(position, pnl);
          const asOfDate = positionPnlAsOfDate(position, unrealizedPnlByPositionId);
          const asOfTitle = asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined;
          return (
            <>
              <span className={`badge ${pnlBadgeClass(pnl)}`} title={asOfTitle}>
                {formatSignedPnl(pnl)}
              </span>
              {pct !== null && (
                <span className={`badge ${pnlBadgeClass(pct)}`} title={asOfTitle}>
                  {pct > 0 ? "+" : ""}
                  {formatPercentageValue(pct, 2)}
                </span>
              )}
            </>
          );
        })()}
        {positionHasOptionLeg(position) &&
          (() => {
            const premiumPnl = positionPremiumPnl(position, unrealizedPnlByPositionId);
            return (
              <span className="small" title="Premium collected vs. current buy-back cost of the option contract(s)">
                <span className="text-muted">Premium P&L:</span>{" "}
                {premiumPnl === "loading" || premiumPnl === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={pnlTextClass(premiumPnl)}>{formatSignedPnl(premiumPnl)}</span>
                )}
              </span>
            );
          })()}
        {positionHasStockLeg(position) &&
          (() => {
            const stockPnl = positionStockPnl(position, unrealizedPnlByPositionId);
            return (
              <span className="small" title="Stock price movement vs. entry price">
                <span className="text-muted">Stock P&L:</span>{" "}
                {stockPnl === "loading" || stockPnl === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={pnlTextClass(stockPnl)}>{formatSignedPnl(stockPnl)}</span>
                )}
              </span>
            );
          })()}
        {position.capitalAtRisk !== null && (
          <span className="small" title="Capital committed to this position — stock cost for covered calls, strike collateral for cash-secured puts">
            <span className="text-muted">EXP $:</span> {formatCurrency(Number(position.capitalAtRisk), 0)}
          </span>
        )}
        {position.capitalAtRisk !== null && totalAccountValue !== null && (
          <span className="small" title="This position's capital as a share of total account value (positions + cash)">
            <span className="text-muted">EXP %:</span> {formatPercentageValue((Number(position.capitalAtRisk) / totalAccountValue) * 100, 1)}
          </span>
        )}
        {position.capitalAtRisk !== null &&
          (() => {
            const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
            if (pnl === "loading" || pnl === null) return null;
            return (
              <span className="small" title="Market value — capital committed to this position plus its unrealized P&L">
                <span className="text-muted">MV:</span> {formatCurrency(Number(position.capitalAtRisk) + pnl, 0)}
              </span>
            );
          })()}
        <span className="small" title={formatDateTime(position.openedAt)}>
          <span className="text-muted">Opened:</span> {formatDaysAgo(daysAgo(position.openedAt))}
        </span>
      </div>
      {rollAlert && (
        <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <strong>Roll alert:</strong> {rollAlert.rationale ?? "This position is ready to roll."}
          </div>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setSelectedRollAlert(rollAlert)}>
            Review Roll
          </button>
        </div>
      )}
      <div>
        <div className="table-responsive mb-3">
          <table className="table table-sm table-vcenter card-table mb-0">
            <thead className="table-light">
              <tr>
                <th>Leg</th>
                <th>Side</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Strike</th>
                <th>Expiry</th>
                <th className="text-end">Entry</th>
                <th className="text-end">Delta</th>
                <th className="text-end" title="Rate of change of delta per $1 move in the underlying — higher gamma means delta (and assignment risk) can shift faster">
                  Gamma
                </th>
                <th className="text-end">Exit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {position.legs.map((leg) => {
                const rollEligible = position.status === "open" && leg.legType === "option" && leg.side === "short" && !leg.exitAt;
                const legRollAlert = rollAlert && rollAlert.suggestedStructure.closeLeg.legId === leg.id ? rollAlert : undefined;
                return (
                  <tr key={leg.id}>
                    <td>{leg.legType === "stock" ? "Stock" : leg.optionType === "call" ? "Call" : "Put"}</td>
                    <td>{leg.side}</td>
                    <td className="text-end">{leg.quantity}</td>
                    <td className="text-end">{leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—"}</td>
                    <td>{formatExpiryWithDte(leg.expiryDate, position.status === "closed" ? position.openedAt : todayInEasternIso())}</td>
                    <td className="text-end">{formatCurrency(Number(leg.entryPrice))}</td>
                    <td className="text-end">
                      {leg.legType === "option" ? (
                        leg.id in greeksByLegId ? (
                          formatNumber(greeksByLegId[leg.id].delta, 2)
                        ) : greeksFetchFailed ? (
                          <span className="text-muted" title="Failed to load delta">
                            —
                          </span>
                        ) : (
                          "—"
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-end">
                      {leg.legType === "option" ? (
                        leg.id in greeksByLegId ? (
                          formatNumber(greeksByLegId[leg.id].gamma, 3)
                        ) : greeksFetchFailed ? (
                          <span className="text-muted" title="Failed to load gamma">
                            —
                          </span>
                        ) : (
                          "—"
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-end">{leg.exitAt ? formatCurrency(Number(leg.exitPrice)) : "—"}</td>
                    <td className="text-end">
                      {rollEligible && legRollAlert && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-warning"
                          title={legRollAlert.rationale ?? "Roll alert pending"}
                          onClick={() => setSelectedRollAlert(legRollAlert)}
                        >
                          Roll Alert
                        </button>
                      )}
                      {rollEligible && !legRollAlert && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                          disabled={rollingLegId === leg.id}
                          onClick={() => handleRollClick(leg.id)}
                        >
                          {rollingLegId === leg.id && <Spinner size="sm" />}
                          Roll
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rollError && <div className="alert alert-danger">{rollError}</div>}

        {payoff && (
          <div className="mb-3">
            <h4 className="mb-2" style={{ fontSize: "0.9rem" }}>
              Payoff at Expiration
            </h4>
            <div className="row mb-2">
              <div className="col-4">
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                  Max Gain
                </div>
                <div className="fw-bold text-success">{formatSignedPnl(payoff.maxGain, 0)}</div>
              </div>
              <div className="col-4">
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                  Max Loss
                </div>
                <div className="fw-bold text-danger">{formatSignedPnl(-payoff.maxLoss, 0)}</div>
              </div>
              <div className="col-4">
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                  Breakeven
                </div>
                <div className="fw-bold">{formatCurrency(payoff.breakeven)}</div>
              </div>
            </div>
            <ApexChart
              type="area"
              height={220}
              series={[{ name: "P&L at Expiration", data: payoff.points.map((p) => ({ x: p.price, y: p.pnl })) }]}
              options={{
                xaxis: { type: "numeric", labels: { formatter: (value: string) => formatCurrency(Number(value)) } },
                yaxis: { labels: { formatter: (value: number) => formatCurrency(value) } },
                grid: { padding: { top: 24 } },
                tooltip: {
                  x: { formatter: (value: number) => formatCurrency(value) },
                  y: { formatter: (value: number) => formatSignedPnl(value) },
                },
                annotations: {
                  xaxis: [
                    {
                      x: payoff.breakeven,
                      borderColor: annotationColors.breakeven,
                      label: {
                        text: "Breakeven",
                        style: { fontSize: "0.7rem", color: "#fff", background: annotationColors.breakeven },
                        offsetY: 4,
                      },
                    },
                    ...(currentPrice !== null
                      ? [
                          {
                            x: currentPrice,
                            borderColor: annotationColors.current,
                            label: {
                              text: "Current",
                              style: { fontSize: "0.7rem", color: "#fff", background: annotationColors.current },
                              offsetY: 65,
                            },
                          },
                        ]
                      : []),
                  ],
                  yaxis: [{ y: 0, borderColor: annotationColors.zero, strokeDashArray: 4 }],
                },
                dataLabels: { enabled: false },
                stroke: { curve: "straight", width: 2 },
              }}
            />
          </div>
        )}

        {position.status === "open" && (
          <div className="border-top pt-3 d-flex flex-wrap gap-2">
            {isUnstructured && hasOpenStockLeg && (
              <>
                <button type="button" className="btn btn-outline-warning" onClick={() => onSellCall()}>
                  Sell Call
                </button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowRecoveryPath(true)}>
                  Recovery Path
                </button>
              </>
            )}
            <button type="button" className="btn btn-outline-danger" onClick={() => setShowClose(true)}>
              Close Position
            </button>
          </div>
        )}
      </div>

      {showClose && (
        <ClosePositionModal
          position={position}
          onClose={() => setShowClose(false)}
          onClosed={() => {
            setShowClose(false);
            onChanged();
          }}
        />
      )}

      {showRecoveryPath && (
        <RecoveryPathModal
          positionId={position.id}
          symbol={position.symbol}
          onClose={() => setShowRecoveryPath(false)}
          onSellCandidate={(prefill) => {
            setShowRecoveryPath(false);
            onSellCall(prefill);
          }}
        />
      )}

      {(rollCandidate || selectedRollAlert) && (
        <RollPositionModal
          alert={
            selectedRollAlert
              ? {
                  id: selectedRollAlert.id,
                  symbol: selectedRollAlert.symbol,
                  relatedPositionId: selectedRollAlert.relatedPositionId,
                  suggestedStructure: selectedRollAlert.suggestedStructure,
                }
              : {
                  symbol: rollCandidate!.symbol,
                  relatedPositionId: rollCandidate!.relatedPositionId,
                  suggestedStructure: rollCandidate!.suggestedStructure,
                }
          }
          onClose={() => {
            setRollCandidate(null);
            setSelectedRollAlert(null);
          }}
          onRolled={() => {
            setRollCandidate(null);
            setSelectedRollAlert(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
