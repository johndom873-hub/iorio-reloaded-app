import { useMemo, useState } from "react";
import { Spinner } from "./Spinner";
import { ApexChart } from "./charts/ApexChart";
import { ClosePositionModal } from "./ClosePositionModal";
import { RollPositionModal } from "./RollPositionModal";
import { RecoveryPathModal } from "./RecoveryPathModal";
import { ApiError } from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import { fetchRollCandidate, updatePosition, type Greeks, type Position, type RollCandidate, type UnrealizedPnlResult } from "../api/positions";
import { computePayoff } from "../lib/payoff";
import {
  formatCurrency,
  formatCurrencyTrimmed,
  formatDate,
  formatExpiryWithDte,
  formatNumber,
  formatPercentageValue,
  formatSignedPnl,
  pnlBadgeClass,
  pnlTextClass,
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
  currentPrice: number | null;
  onChanged: () => void;
  /** Scrolls to this ticker's option chain so the user can pick a strike to sell against held shares. */
  onSellCall: () => void;
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
  currentPrice,
  onChanged,
  onSellCall,
}: PositionCardProps) {
  const { theme } = useTheme();
  const annotationColors = annotationColorsByTheme[theme];

  const [notesDraft, setNotesDraft] = useState(position.notes ?? "");
  const [priceTargetDraft, setPriceTargetDraft] = useState(position.priceTarget ?? "");
  const [closeTriggerDraft, setCloseTriggerDraft] = useState(position.closeTriggerNotes ?? "");
  const [savingFields, setSavingFields] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const payoff = useMemo(
    () => (position.strategyKey !== "unstructured" ? computePayoff(position.strategyKey, position.legs) : null),
    [position],
  );

  async function handleSaveFields() {
    setSavingFields(true);
    setSaveError(null);
    try {
      await updatePosition(position.id, {
        notes: notesDraft.trim() || null,
        priceTarget: priceTargetDraft ? Number(priceTargetDraft) : null,
        closeTriggerNotes: closeTriggerDraft.trim() || null,
      });
      onChanged();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setSavingFields(false);
    }
  }

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
    <div className="card mb-3">
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
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
      </div>
      <div className="card-body">
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
                <th className="text-end">Exit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {position.legs.map((leg) => {
                const rollEligible = position.status === "open" && leg.legType === "option" && leg.side === "short" && !leg.exitAt;
                return (
                  <tr key={leg.id}>
                    <td>{leg.legType === "stock" ? "Stock" : leg.optionType === "call" ? "Call" : "Put"}</td>
                    <td>{leg.side}</td>
                    <td className="text-end">{leg.quantity}</td>
                    <td className="text-end">{leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—"}</td>
                    <td>{formatExpiryWithDte(leg.expiryDate, position.status === "closed" ? position.openedAt : undefined)}</td>
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
                    <td className="text-end">{leg.exitPrice ? formatCurrency(Number(leg.exitPrice)) : "—"}</td>
                    <td className="text-end">
                      {rollEligible && (
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
                tooltip: {
                  x: { formatter: (value: number) => formatCurrency(value) },
                  y: { formatter: (value: number) => formatSignedPnl(value) },
                },
                annotations: {
                  xaxis: [
                    { x: payoff.breakeven, borderColor: annotationColors.breakeven, label: { text: "Breakeven", style: { fontSize: "0.7rem" } } },
                    ...(currentPrice !== null
                      ? [{ x: currentPrice, borderColor: annotationColors.current, label: { text: "Current", style: { fontSize: "0.7rem" } } }]
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

        {/* Price Target/Close Trigger Notes/Notes are for a position being
            actively managed toward a plan — an unstructured position is
            leftover stock nobody chose to hold, so those fields are just
            noise here; the relevant actions are Sell Call and Close. */}
        {!isUnstructured && (
          <div className="mb-3">
            {saveError && <div className="alert alert-danger">{saveError}</div>}
            <div className="row g-3">
              <div className="col-12 col-sm-6 col-md-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Price Target
                </label>
                <input type="number" step="0.01" className="form-control" value={priceTargetDraft} onChange={(event) => setPriceTargetDraft(event.target.value)} />
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Close Trigger Notes
                </label>
                <input type="text" className="form-control" value={closeTriggerDraft} onChange={(event) => setCloseTriggerDraft(event.target.value)} />
              </div>
              <div className="col-12">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>
                  Notes
                </label>
                <input type="text" className="form-control" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} />
              </div>
            </div>
            <button type="button" className="btn btn-outline-primary mt-3 d-inline-flex align-items-center gap-1" disabled={savingFields} onClick={handleSaveFields}>
              {savingFields && <Spinner size="sm" />}
              Save
            </button>
          </div>
        )}

        {position.status === "open" && (
          <div className="border-top pt-3 d-flex flex-wrap gap-2">
            {isUnstructured && hasOpenStockLeg && (
              <>
                <button type="button" className="btn btn-outline-warning" onClick={onSellCall}>
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

      {showRecoveryPath && <RecoveryPathModal positionId={position.id} symbol={position.symbol} onClose={() => setShowRecoveryPath(false)} />}

      {rollCandidate && (
        <RollPositionModal
          alert={{
            symbol: rollCandidate.symbol,
            relatedPositionId: rollCandidate.relatedPositionId,
            suggestedStructure: rollCandidate.suggestedStructure,
          }}
          onClose={() => setRollCandidate(null)}
          onRolled={() => {
            setRollCandidate(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
