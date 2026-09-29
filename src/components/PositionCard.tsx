import { useMemo, useState } from "react";
import { Spinner } from "./Spinner";
import { ApexChart } from "./charts/ApexChart";
import { ClosePositionModal } from "./ClosePositionModal";
import { RecoveryPathModal } from "./RecoveryPathModal";
import { useTheme } from "../contexts/ThemeContext";
import type { Greeks, Position, UnrealizedPnlResult } from "../api/positions";
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
  positionIsStockOnly,
  positionPremiumPnl,
  positionStockPnl,
  positionTotalPnl,
  positionTotalPnlPercent,
} from "../lib/positionPnl";
import { StrategyBadge } from "./StrategyBadge";
import { TooltipSpan } from "./TooltipSpan";

interface PositionCardProps {
  position: Position;
  greeksByLegId: Record<string, Greeks>;
  greeksFetchFailed: boolean;
  unrealizedPnlByPositionId: Record<string, UnrealizedPnlResult>;
  unrealizedPnlFetchFailed: boolean;
  /** Last-known total account value, for EXP% — see PositionsPage's own prop of the same name. */
  totalAccountValue: number | null;
  currentPrice: number | null;
  onChanged: () => void;
  /**
   * Scrolls to this ticker's option chain so the user can pick a strike to
   * sell against held shares. When called with a prefill (e.g. from Recovery
   * Path's "Sell This"), the parent also preselects that strike/expiry/
   * quantity in the chain's order panel instead of leaving it blank.
   */
  onSellCall: (prefill?: { strike: number; expiry: string; quantity: number; premium: number }) => void;
  /** Selects this open short leg's best Signals roll in the Signals modal's order setup (or explains there is none). */
  onRollLeg: (legId: string) => void;
}

const annotationColorsByTheme = {
  light: { breakeven: "#f59f00", current: "#4263eb", zero: "#adb5bd" },
  dark: { breakeven: "#f59f00", current: "#748ffc", zero: "#adb5bd" },
} as const;

// One open position's full detail + actions, as a card inside the Signals
// modal. A symbol can have more than one concurrently open position here (e.g. an
// open CSP and an open covered call at once), so the parent renders one of
// these per open position rather than assuming exactly one. Extracted from
// the old standalone PositionDetailModal — same legs table/payoff
// chart/editable fields/Close flow, now reusable per-card. Roll on a short
// option leg selects that leg's best Signals roll in the Signals modal.
export function PositionCard({
  position,
  greeksByLegId,
  greeksFetchFailed,
  unrealizedPnlByPositionId,
  unrealizedPnlFetchFailed,
  totalAccountValue,
  currentPrice,
  onChanged,
  onSellCall,
  onRollLeg,
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

  // An open position can still carry closed legs (an expired/assigned call whose stock leg remains). Those are
  // history, not part of what's held now — the Wheel cycle card has them — so only live legs are listed and
  // drive the payoff diagram. A closed position shows all its legs.
  const displayedLegs = useMemo(
    () => (position.status === "open" ? position.legs.filter((leg) => !leg.exitAt) : position.legs),
    [position],
  );

  const payoff = useMemo(
    () => (position.strategyKey !== "unstructured" ? computePayoff(position.strategyKey, displayedLegs) : null),
    [position, displayedLegs],
  );

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <StrategyBadge strategyKey={position.strategyKey} />
        {(() => {
          const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
          if (pnl === "loading") {
            if (unrealizedPnlFetchFailed) {
              return (
                <TooltipSpan className="badge bg-secondary-lt" text="Failed to load live P&L data">
                  P&L —
                </TooltipSpan>
              );
            }
            return <Spinner size="sm" label="Loading P&L" />;
          }
          if (pnl === null)
            return (
              <TooltipSpan className="badge bg-secondary-lt" text="No live price or recent snapshot available for this position">
                P&L —
              </TooltipSpan>
            );
          const pct = positionTotalPnlPercent(position, pnl);
          const asOfDate = positionPnlAsOfDate(position, unrealizedPnlByPositionId);
          const asOfTitle = asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined;
          return (
            <>
              <TooltipSpan className={`badge ${pnlBadgeClass(pnl)}`} text={asOfTitle}>
                {formatSignedPnl(pnl)}
              </TooltipSpan>
              {pct !== null && (
                <TooltipSpan className={`badge ${pnlBadgeClass(pct)}`} text={asOfTitle}>
                  {pct > 0 ? "+" : ""}
                  {formatPercentageValue(pct, 2)}
                </TooltipSpan>
              )}
            </>
          );
        })()}
        {positionHasOptionLeg(position) &&
          !positionIsStockOnly(position) &&
          (() => {
            const premiumPnl = positionPremiumPnl(position, unrealizedPnlByPositionId);
            return (
              <TooltipSpan className="small" text="Premium collected vs. current buy-back cost of the option contract(s)">
                <span className="text-muted">Premium P&L:</span>{" "}
                {premiumPnl === "loading" || premiumPnl === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={pnlTextClass(premiumPnl)}>{formatSignedPnl(premiumPnl)}</span>
                )}
              </TooltipSpan>
            );
          })()}
        {positionHasStockLeg(position) &&
          (() => {
            const stockPnl = positionStockPnl(position, unrealizedPnlByPositionId);
            return (
              <TooltipSpan className="small" text="Stock price movement vs. entry price">
                <span className="text-muted">Stock P&L:</span>{" "}
                {stockPnl === "loading" || stockPnl === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={pnlTextClass(stockPnl)}>{formatSignedPnl(stockPnl)}</span>
                )}
              </TooltipSpan>
            );
          })()}
        {position.capitalAtRisk !== null && (
          <TooltipSpan className="small" text="Capital committed to this position — stock cost for covered calls, strike collateral for cash-secured puts">
            <span className="text-muted">EXP $:</span> {formatCurrency(Number(position.capitalAtRisk), 0)}
          </TooltipSpan>
        )}
        {position.capitalAtRisk !== null && totalAccountValue !== null && (
          <TooltipSpan className="small" text="This position's capital as a share of total account value (positions + cash)">
            <span className="text-muted">EXP %:</span> {formatPercentageValue((Number(position.capitalAtRisk) / totalAccountValue) * 100, 1)}
          </TooltipSpan>
        )}
        {position.capitalAtRisk !== null &&
          (() => {
            const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
            if (pnl === "loading" || pnl === null) return null;
            return (
              <TooltipSpan className="small" text="Market value — capital committed to this position plus its unrealized P&L">
                <span className="text-muted">MV:</span> {formatCurrency(Number(position.capitalAtRisk) + pnl, 0)}
              </TooltipSpan>
            );
          })()}
        <TooltipSpan className="small" text={formatDateTime(position.openedAt)}>
          <span className="text-muted">Opened:</span> {formatDaysAgo(daysAgo(position.openedAt))}
        </TooltipSpan>
      </div>
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
                <TooltipSpan as="th" className="text-end" text="Rate of change of delta per $1 move in the underlying — higher gamma means delta (and assignment risk) can shift faster">
                  Gamma
                </TooltipSpan>
                <th className="text-end">Exit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedLegs.map((leg) => {
                const rollEligible = position.status === "open" && leg.legType === "option" && leg.side === "short" && !leg.exitAt;
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
                          <TooltipSpan className="text-muted" text="Failed to load delta">
                            —
                          </TooltipSpan>
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
                          <TooltipSpan className="text-muted" text="Failed to load gamma">
                            —
                          </TooltipSpan>
                        ) : (
                          "—"
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-end">{leg.exitAt ? formatCurrency(Number(leg.exitPrice)) : "—"}</td>
                    <td className="text-end">
                      {rollEligible && (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onRollLeg(leg.id)}>
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
    </div>
  );
}
