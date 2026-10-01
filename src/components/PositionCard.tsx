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
  positionPnlAsOfDate,
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
const payoffAxisMaximumGainMargin = 1.05;
const payoffAxisMaximumStepsBelowZero = 4;

// Zero-anchored y axis for the payoff chart: from -k·top to top, where top = max gain + 5% and k covers the lowest plotted
// P&L, capped so a lopsided position (a put's small premium against a huge max loss) keeps its gain side readable; the
// steeper part of the loss then runs off the bottom (Max Loss is shown above the chart).
function buildPayoffYAxis(payoff: ReturnType<typeof computePayoff>): { min?: number; max?: number; tickAmount?: number } {
  if (!payoff || !(payoff.maxGain > 0)) return {};
  const top = payoff.maxGain * payoffAxisMaximumGainMargin;
  const lowestPnl = Math.min(0, ...payoff.points.map((point) => point.pnl));
  const stepsBelowZero = Math.min(payoffAxisMaximumStepsBelowZero, Math.max(1, Math.ceil(-lowestPnl / top - 1e-9)));
  return { min: -stepsBelowZero * top, max: top, tickAmount: stepsBelowZero + 1 };
}

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

  // Roll acts on one leg: the open short option leg expiring soonest (the only one for a single-leg position).
  const rollableLeg = useMemo(() => {
    if (position.status !== "open") return null;
    const rollableLegs = displayedLegs.filter((leg) => leg.legType === "option" && leg.side === "short");
    return rollableLegs.sort((legA, legB) => (legA.expiryDate ?? "").localeCompare(legB.expiryDate ?? ""))[0] ?? null;
  }, [position.status, displayedLegs]);

  const payoff = useMemo(
    () => (position.strategyKey !== "unstructured" ? computePayoff(position.strategyKey, displayedLegs, currentPrice) : null),
    [position, displayedLegs, currentPrice],
  );

  const payoffYAxis = useMemo(() => buildPayoffYAxis(payoff), [payoff]);

  // P&L is tracked per leg type (option premium / stock), not per leg: each leg's cell shows its type's figure, and "—" when a
  // second leg of the same type makes the split ambiguous.
  const optionLegCount = displayedLegs.filter((leg) => leg.legType === "option").length;
  const stockLegCount = displayedLegs.filter((leg) => leg.legType === "stock").length;
  const renderLegPnl = (leg: (typeof displayedLegs)[number]) => {
    const isOption = leg.legType === "option";
    if ((isOption ? optionLegCount : stockLegCount) > 1) {
      return (
        <TooltipSpan className="text-muted" text="P&L is tracked per leg type, not per leg">
          —
        </TooltipSpan>
      );
    }
    const pnl = isOption ? positionPremiumPnl(position, unrealizedPnlByPositionId) : positionStockPnl(position, unrealizedPnlByPositionId);
    const meaning = isOption ? "Premium collected vs. current buy-back cost of the option contract" : "Stock P&L: price movement of the shares held vs. entry, plus any shares already sold (realized, net of closing commissions)";
    if (pnl === "loading" || pnl === null) {
      return (
        <TooltipSpan className="text-muted" text={pnl === null ? "No live price or recent snapshot available" : "Loading"}>
          —
        </TooltipSpan>
      );
    }
    return (
      <TooltipSpan className={pnlTextClass(pnl)} text={meaning}>
        {formatSignedPnl(pnl)}
      </TooltipSpan>
    );
  };

  return (
    <div>
      <div className={`mb-3${payoff ? " position-payoff-layout" : ""}`}>
      <div className="d-flex flex-wrap align-items-center gap-2">
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
        {position.capitalAtRisk !== null && (
          <TooltipSpan className="small position-stat" text="Capital committed to this position — stock cost for covered calls, strike collateral for cash-secured puts — and, in brackets, its share of total account value (positions + cash)">
            <span className="position-stat-label">EXP $:</span> {formatCurrency(Number(position.capitalAtRisk), 0)}
            {totalAccountValue !== null && <> ({formatPercentageValue((Number(position.capitalAtRisk) / totalAccountValue) * 100, 1)})</>}
          </TooltipSpan>
        )}
        <TooltipSpan className="small position-stat" text={formatDateTime(position.openedAt)}>
          <span className="position-stat-label">Opened:</span> {formatDaysAgo(daysAgo(position.openedAt))}
        </TooltipSpan>
      </div>
      {payoff && (
        <div className="d-flex flex-wrap align-items-center justify-content-lg-center gap-2">
          <span className="small fw-semibold">Payout at Expiration</span>
        <TooltipSpan className="small position-stat" text="Best case at expiration: the premium kept (plus any stock gain up to the strike)">
          <span className="position-stat-label">Max Gain:</span> <span className="text-success">{formatSignedPnl(payoff.maxGain, 0)}</span>
        </TooltipSpan>
        <TooltipSpan className="small position-stat" text="Worst case at expiration: the stock (or the assigned shares) going to zero">
          <span className="position-stat-label">Max Loss:</span> <span className="text-danger">{formatSignedPnl(-payoff.maxLoss, 0)}</span>
        </TooltipSpan>
        <TooltipSpan className="small position-stat" text="Stock price at expiration where the position neither gains nor loses">
          <span className="position-stat-label">Breakeven:</span> {formatCurrency(payoff.breakeven)}
        </TooltipSpan>
        </div>
      )}
      </div>
      <div>
        <div className={payoff ? "position-payoff-layout" : undefined}>
          <div className="position-legs-table">
          <div className="table-responsive">
          <table className="table table-sm table-vcenter card-table mb-0 text-nowrap">
            <thead className="table-light">
              <tr>
                <th>Leg</th>
                <th>Side</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Strike</th>
                <th>Expiry</th>
                <th className="text-end">Entry</th>
                <th className="text-end">P&L</th>
                <th className="text-end">Delta</th>
                <TooltipSpan as="th" className="text-end" text="Rate of change of delta per $1 move in the underlying — higher gamma means delta (and assignment risk) can shift faster">
                  Gamma
                </TooltipSpan>
              </tr>
            </thead>
            <tbody>
              {displayedLegs.map((leg) => {
                return (
                  <tr key={leg.id}>
                    <td>{leg.legType === "stock" ? "Stock" : leg.optionType === "call" ? "Call" : "Put"}</td>
                    <td>{leg.side}</td>
                    <td className="text-end">{leg.quantity}</td>
                    <td className="text-end">{leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—"}</td>
                    <td>{formatExpiryWithDte(leg.expiryDate, position.status === "closed" ? position.openedAt : todayInEasternIso())}</td>
                    <td className="text-end">{formatCurrency(Number(leg.entryPrice))}</td>
                    <td className="text-end">{renderLegPnl(leg)}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {position.status === "open" && (
            <div className="d-flex flex-wrap gap-2 mt-3">
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
              {rollableLeg && (
                <button type="button" className="btn btn-outline-primary" onClick={() => onRollLeg(rollableLeg.id)}>
                  Roll Option
                </button>
              )}
              <button type="button" className="btn btn-outline-danger" onClick={() => setShowClose(true)}>
                Close Position
              </button>
            </div>
          )}
          </div>
          {payoff && (
            <div className="position-payoff-chart">
              <ApexChart
                type="area"
                height={196}
                series={[{ name: "P&L at Expiration", data: payoff.points.map((p) => ({ x: p.price, y: p.pnl })) }]}
                options={{
                  xaxis: { type: "numeric", labels: { formatter: (value: string) => formatCurrency(Number(value)) } },
                  // Top of the axis is the max gain + 5% (Marcelo, 2026-09-30). Ticks are anchored on $0 and step in multiples of that top, so
                  // the top and $0 are always ticks (a bare `max` leaves Apex's ticks on odd values).
                  yaxis: { ...payoffYAxis, labels: { formatter: (value: number) => formatCurrency(Math.round(value) + 0, 0) } },
                  // Apex leaves ~30px above the plot: pull the chart up so its top gridline lines up with the top of the legs table beside it.
                chart: { offsetY: -30, parentHeightOffset: 0 },
                grid: { padding: { top: 0 } },
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
                          offsetY: -6,
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
                                offsetY: 62,
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
        </div>
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
