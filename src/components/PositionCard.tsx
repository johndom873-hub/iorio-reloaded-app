import { useMemo, useState, type ReactNode } from "react";
import type { FrozenTicker } from "../api/environment";
import { describeFrozenTicker } from "../hooks/useFrozenTickers";
import { Spinner } from "./Spinner";
import { ColumnVisibilityPopover } from "./DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "./DataTable/useColumnVisibility";
import { ApexChart } from "./charts/ApexChart";
import { ClosePositionModal } from "./ClosePositionModal";
import { RecoveryPathModal } from "./RecoveryPathModal";
import { useChartPriceRange } from "../hooks/useChartPriceRange";
import { useTheme } from "../hooks/useTheme";
import type { Greeks, Position, UnrealizedPnlResult } from "../api/positions";
import { computePayoff, computePayoffChartPoints, type PayoffPoint } from "../lib/payoff";
import {
  daysAgo,
  formatCurrency,
  formatTransactionPrice,
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
  /** Total account value for EXP% (live, snapshot fallback) — see fetchCurrentAccountValue. */
  totalAccountValue: number | null;
  currentPrice: number | null;
  /** Set while the ticker is frozen after a stock split: the order buttons show disabled, with why. */
  frozen?: FrozenTicker;
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
function buildPayoffYAxis(payoff: ReturnType<typeof computePayoff>, chartPoints: PayoffPoint[]): { min?: number; max?: number; tickAmount?: number } {
  if (!payoff || !(payoff.maxGain > 0)) return {};
  const top = payoff.maxGain * payoffAxisMaximumGainMargin;
  const lowestPnl = Math.min(0, ...chartPoints.map((point) => point.pnl));
  const stepsBelowZero = Math.min(payoffAxisMaximumStepsBelowZero, Math.max(1, Math.ceil(-lowestPnl / top - 1e-9)));
  return { min: -stepsBelowZero * top, max: top, tickAmount: stepsBelowZero + 1 };
}

// One visibility setting shared by every position card's legs table.
const legColumns = [
  { key: "leg", header: "Leg" },
  { key: "side", header: "Side" },
  { key: "quantity", header: "Qty" },
  { key: "strike", header: "Strike" },
  { key: "expiry", header: "Expiry" },
  { key: "fill", header: "Fill" },
  { key: "commission", header: "Comm." },
  { key: "cost", header: "Cost/sh" },
  { key: "exit", header: "Exit" },
  { key: "pnl", header: "P&L" },
  { key: "delta", header: "Delta" },
  { key: "gamma", header: "Gamma" },
];

/** A disabled order button carries the freeze's explanation on its wrapper (a disabled button gets no hover or tap). */
function FrozenActionTooltip({ frozen, children }: { frozen: FrozenTicker | undefined; children: ReactNode }) {
  if (!frozen) return <>{children}</>;
  return (
    <TooltipSpan text={describeFrozenTicker(frozen)} className="frozen-tap-target">
      {children}
    </TooltipSpan>
  );
}

export function PositionCard({
  position,
  greeksByLegId,
  greeksFetchFailed,
  unrealizedPnlByPositionId,
  unrealizedPnlFetchFailed,
  totalAccountValue,
  currentPrice,
  frozen,
  onChanged,
  onSellCall,
  onRollLeg,
}: PositionCardProps) {
  const { theme } = useTheme();
  const annotationColors = annotationColorsByTheme[theme];
  const { isColumnVisible, toggleColumn } = useColumnVisibility(
    "position-legs",
    legColumns.map((column) => column.key),
  );
  const visibleLegColumnKeys = legColumns.filter((column) => isColumnVisible(column.key)).map((column) => column.key);
  // The gear sits in the last visible header; with every column hidden it gets a header cell of its own.
  const lastVisibleLegColumnKey = visibleLegColumnKeys[visibleLegColumnKeys.length - 1];
  const gearPopover = <ColumnVisibilityPopover columns={legColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />;
  const headerLabel = (key: string, label: ReactNode, alignRight = false) =>
    key === lastVisibleLegColumnKey ? (
      <div className={`d-flex align-items-center gap-1 ${alignRight ? "justify-content-end" : ""}`}>
        <span>{label}</span>
        {gearPopover}
      </div>
    ) : (
      label
    );

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
    // Hedges and unstructured positions have no strategy payoff diagram.
    () => (position.strategyKey === "covered_call" || position.strategyKey === "cash_secured_put" ? computePayoff(position.strategyKey, displayedLegs, position.breakEven ?? null) : null),
    [position, displayedLegs],
  );
  const chartPriceRange = useChartPriceRange(payoff?.breakeven ?? null, currentPrice);
  const payoffChartPoints = useMemo(() => (payoff && chartPriceRange ? computePayoffChartPoints(payoff, chartPriceRange) : []), [payoff, chartPriceRange]);

  const payoffYAxis = useMemo(() => buildPayoffYAxis(payoff, payoffChartPoints), [payoff, payoffChartPoints]);

  // What really traded for each leg (approved mockup 2026-10-16): IBKR's fills and commission, beside the cost P&L counts.
  const renderLegFill = (leg: (typeof displayedLegs)[number]) => {
    if (leg.openingFillPrice === null || leg.openingFillPrice === undefined) {
      return (
        <TooltipSpan className="text-secondary" text="No fill recorded for this leg: the cost is shown">
          {formatTransactionPrice(Number(leg.entryPrice), { withDollarSign: true })}
        </TooltipSpan>
      );
    }
    const price = formatTransactionPrice(leg.openingFillPrice, { withDollarSign: true });
    if (!leg.openingFillCarried) return <span className="font-mono">{price}</span>;
    return (
      <TooltipSpan text="Bought by an earlier position (an assigned put or a hand-over): IBKR's execution price of that purchase">
        <span className="font-mono">{price}</span>
        <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
          carried over
        </div>
      </TooltipSpan>
    );
  };
  const renderLegCommission = (leg: (typeof displayedLegs)[number]) => {
    if (leg.openingCommissionMissing) {
      return (
        <TooltipSpan className="text-secondary" text="IBKR has not reported the commission of every opening fill yet">
          —
        </TooltipSpan>
      );
    }
    const opening = leg.openingCommission ?? null;
    const closing = leg.closingCommission ?? null;
    if (opening === null && closing === null) return <span className="text-secondary">—</span>;
    const total = (opening ?? 0) + (closing ?? 0);
    return (
      <TooltipSpan className="font-mono" text={`Opening ${formatCurrency(opening ?? 0)} · closing ${formatCurrency(closing ?? 0)}`}>
        {formatCurrency(total)}
      </TooltipSpan>
    );
  };
  const renderLegExit = (leg: (typeof displayedLegs)[number]) => {
    if (!leg.exitAt) return <span className="text-secondary">—</span>;
    if (leg.closingFillPrice !== null && leg.closingFillPrice !== undefined) return <span className="font-mono">{formatTransactionPrice(leg.closingFillPrice, { withDollarSign: true })}</span>;
    if (leg.exitPrice === null) {
      return (
        <TooltipSpan className="text-secondary" text="Closed without a recorded exit">
          —
        </TooltipSpan>
      );
    }
    const howItEnded =
      leg.legType === "stock" && Number(leg.exitPrice) === Number(leg.entryPrice) ? "moved" : leg.legType === "option" && position.closeReason === "assigned" ? "assigned" : leg.legType === "option" ? "expired" : null;
    return (
      <>
        <span className="font-mono">{formatTransactionPrice(Number(leg.exitPrice), { withDollarSign: true })}</span>
        {howItEnded && (
          <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
            {howItEnded}
          </div>
        )}
      </>
    );
  };

  // P&L is tracked per leg type (option premium / stock), not per leg: each leg's cell shows its type's figure, and "—" when a
  // second leg of the same type makes the split ambiguous.
  const optionLegCount = displayedLegs.filter((leg) => leg.legType === "option").length;
  const stockLegCount = displayedLegs.filter((leg) => leg.legType === "stock").length;
  const renderLegPnl = (leg: (typeof displayedLegs)[number]) => {
    const isOption = leg.legType === "option";
    if ((isOption ? optionLegCount : stockLegCount) > 1) {
      return (
        <TooltipSpan className="text-secondary" text="P&L is tracked per leg type, not per leg">
          —
        </TooltipSpan>
      );
    }
    const pnl = isOption ? positionPremiumPnl(position, unrealizedPnlByPositionId) : positionStockPnl(position, unrealizedPnlByPositionId);
    const meaning = isOption ? "Premium collected vs. current buy-back cost of the option contract" : "Stock P&L: price movement of the shares held vs. entry, plus any shares already sold (realized, net of closing commissions)";
    if (pnl === "loading" || pnl === null) {
      return (
        <TooltipSpan className="text-secondary" text={pnl === null ? "No live price or recent snapshot available" : "Loading"}>
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
          <TooltipSpan className="small position-stat" text="Capital committed to this position — the shares' cost for covered calls, the strike collateral for cash-secured puts, less the premium received — and, in brackets, its share of total account value (positions + cash)">
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
        <TooltipSpan className="small position-stat" text="Best case at expiration: the premium kept plus the stock's move up to the strike. Below zero when the shares cost more than the strike plus the premium earned on them: assignment then sells them at a loss">
          <span className="position-stat-label">Max Gain:</span> <span className={pnlTextClass(payoff.maxGain)}>{formatSignedPnl(payoff.maxGain, 0)}</span>
        </TooltipSpan>
        <TooltipSpan className="small position-stat" text="Worst case at expiration: the stock (or the assigned shares) going to zero">
          <span className="position-stat-label">Max Loss:</span> <span className="text-danger">{formatSignedPnl(-payoff.maxLoss, 0)}</span>
        </TooltipSpan>
        <TooltipSpan
          className="small position-stat"
          text={
            position.strategyKey === "covered_call" && position.breakEven != null
              ? "Stock price at expiration where the position neither gains nor loses: this position's own break-even, its shares' cost less the premium earned on them (earlier calls and the put that delivered them included)"
              : "Stock price at expiration where the position neither gains nor loses"
          }
        >
          <span className="position-stat-label">Breakeven:</span> {formatCurrency(payoff.breakeven)}
        </TooltipSpan>
        {position.strategyKey === "covered_call" && (position.cycleOpenPositionCount ?? 0) > 1 && position.cycleBreakEven != null && (
          <div className="small text-secondary w-100 text-lg-center">
            {position.symbol} has {position.cycleOpenPositionCount} positions: the whole-cycle break-even, {formatCurrency(position.cycleBreakEven, 2)}, is in the Wheel cycle card.
          </div>
        )}
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
                {isColumnVisible("leg") && <th>{headerLabel("leg", "Leg")}</th>}
                {isColumnVisible("side") && <th>{headerLabel("side", "Side")}</th>}
                {isColumnVisible("quantity") && <th className="text-end">{headerLabel("quantity", "Qty", true)}</th>}
                {isColumnVisible("strike") && <th className="text-end">{headerLabel("strike", "Strike", true)}</th>}
                {isColumnVisible("expiry") && <th>{headerLabel("expiry", "Expiry")}</th>}
                {isColumnVisible("fill") && (
                  <TooltipSpan as="th" className="text-end" text="IBKR's execution price (the average of the fills); for shares bought by an earlier position, what they were bought at">
                    {headerLabel("fill", "Fill", true)}
                  </TooltipSpan>
                )}
                {isColumnVisible("commission") && (
                  <TooltipSpan as="th" className="text-end" text="Commission IBKR charged on this leg's opening and closing fills">
                    {headerLabel("commission", "Comm.", true)}
                  </TooltipSpan>
                )}
                {isColumnVisible("cost") && (
                  <TooltipSpan as="th" className="text-end" text="What P&L counts per share: the fill with its commission (a short option: the credit less it)">
                    {headerLabel("cost", "Cost/sh", true)}
                  </TooltipSpan>
                )}
                {isColumnVisible("exit") && (
                  <TooltipSpan as="th" className="text-end" text="The closing fills' average price, or how the leg ended">
                    {headerLabel("exit", "Exit", true)}
                  </TooltipSpan>
                )}
                {isColumnVisible("pnl") && <th className="text-end">{headerLabel("pnl", "P&L", true)}</th>}
                {isColumnVisible("delta") && <th className="text-end">{headerLabel("delta", "Delta", true)}</th>}
                {isColumnVisible("gamma") && (
                  <TooltipSpan as="th" className="text-end" text="Rate of change of delta per $1 move in the underlying — higher gamma means delta (and assignment risk) can shift faster">
                    {headerLabel("gamma", "Gamma", true)}
                  </TooltipSpan>
                )}
                {visibleLegColumnKeys.length === 0 && <th>{gearPopover}</th>}
              </tr>
            </thead>
            <tbody>
              {displayedLegs.map((leg) => {
                return (
                  <tr key={leg.id}>
                    {isColumnVisible("leg") && <td>{leg.legType === "stock" ? "Stock" : leg.optionType === "call" ? "Call" : "Put"}</td>}
                    {isColumnVisible("side") && <td>{leg.side}</td>}
                    {isColumnVisible("quantity") && <td className="text-end">{leg.quantity}</td>}
                    {isColumnVisible("strike") && <td className="text-end">{leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—"}</td>}
                    {isColumnVisible("expiry") && <td>{formatExpiryWithDte(leg.expiryDate, position.status === "closed" ? position.openedAt : todayInEasternIso())}</td>}
                    {isColumnVisible("fill") && <td className="text-end">{renderLegFill(leg)}</td>}
                    {isColumnVisible("commission") && <td className="text-end">{renderLegCommission(leg)}</td>}
                    {isColumnVisible("cost") && <td className="text-end font-mono">{formatCurrency(Number(leg.entryPrice), 4)}</td>}
                    {isColumnVisible("exit") && <td className="text-end">{renderLegExit(leg)}</td>}
                    {isColumnVisible("pnl") && <td className="text-end">{renderLegPnl(leg)}</td>}
                    {isColumnVisible("delta") && (
                      <td className="text-end">
                        {leg.legType === "option" ? (
                          leg.id in greeksByLegId ? (
                            formatNumber(greeksByLegId[leg.id].delta, 2)
                          ) : greeksFetchFailed ? (
                            <TooltipSpan className="text-secondary" text="Failed to load delta">
                              —
                            </TooltipSpan>
                          ) : (
                            "—"
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {isColumnVisible("gamma") && (
                      <td className="text-end">
                        {leg.legType === "option" ? (
                          leg.id in greeksByLegId ? (
                            formatNumber(greeksByLegId[leg.id].gamma, 3)
                          ) : greeksFetchFailed ? (
                            <TooltipSpan className="text-secondary" text="Failed to load gamma">
                              —
                            </TooltipSpan>
                          ) : (
                            "—"
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {visibleLegColumnKeys.length === 0 && <td />}
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
                  <FrozenActionTooltip frozen={frozen}>
                    <button type="button" className="btn btn-outline-warning" disabled={frozen !== undefined} onClick={() => onSellCall()}>
                      Sell Call
                    </button>
                  </FrozenActionTooltip>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowRecoveryPath(true)}>
                    Recovery Path
                  </button>
                </>
              )}
              {rollableLeg && (
                <FrozenActionTooltip frozen={frozen}>
                  <button type="button" className="btn btn-outline-primary" disabled={frozen !== undefined} onClick={() => onRollLeg(rollableLeg.id)}>
                    Roll Option
                  </button>
                </FrozenActionTooltip>
              )}
              <FrozenActionTooltip frozen={frozen}>
                <button type="button" className="btn btn-outline-danger" disabled={frozen !== undefined} onClick={() => setShowClose(true)}>
                  Close Position
                </button>
              </FrozenActionTooltip>
            </div>
          )}
          </div>
          {payoff && (
            <div className="position-payoff-chart">
              <ApexChart
                type="area"
                height={196}
                series={[{ name: "P&L at Expiration", data: payoffChartPoints.map((p) => ({ x: p.price, y: p.pnl })) }]}
                options={{
                  xaxis: { type: "numeric", labels: { formatter: (value: string) => formatCurrency(Number(value)) } },
                  // Top of the axis is the max gain + 5% (Marcelo, 2026-09-30). Ticks are anchored on $0 and step in multiples of that top, so
                  // the top and $0 are always ticks (a bare `max` leaves Apex's ticks on odd values).
                  yaxis: { ...payoffYAxis, labels: { formatter: (value: number) => formatCurrency(Math.round(value) + 0, 0) } },
                  // Apex leaves ~30px above the plot: pull the chart up so its top gridline lines up with the top of the legs table beside it.
                  // No animations: every tick moves the Current line and re-renders the chart, which would otherwise replay a morph each time.
                chart: { offsetY: -30, parentHeightOffset: 0, animations: { enabled: false } },
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
