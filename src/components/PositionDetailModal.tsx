import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { ApexChart } from "./charts/ApexChart";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { ApiError } from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import {
  buildCloseOrder,
  fetchGreeks,
  fetchPosition,
  fetchUnrealizedPnl,
  updatePosition,
  type Greeks,
  type OrderRequest,
  type Position,
  type UnrealizedPnlResult,
} from "../api/positions";
import { fetchTickerChart } from "../api/tickerDetail";
import { computePayoff } from "../lib/payoff";
import { formatCurrency, formatDate, formatNumber, formatPercentageValue, formatSignedPnl, pnlBadgeClass } from "../lib/formatters";
import { positionPnlAsOfDate, positionTotalPnl, positionTotalPnlPercent, strategyBadgeClass, strategyLabel } from "../lib/positionPnl";

interface PositionDetailModalProps {
  positionId: string;
  onClose: () => void;
  onChanged: () => void;
}

interface CloseLegDraft {
  legId: string;
  limitPrice: string;
}

// Payoff chart annotation colors (breakeven, current-price, and zero-line
// markers) — same theme-aware pattern as ApexChart's own
// textColorByTheme/gridColorByTheme, since these are annotation-specific
// and not covered by ApexChart's shared merge. The light-mode values are
// unchanged from the original hardcoded colors; dark-mode gets brighter
// variants so they still read clearly against the dark navy body background.
const annotationColorsByTheme = {
  light: { breakeven: "#f59f00", current: "#4263eb", zero: "#adb5bd" },
  dark: { breakeven: "#f59f00", current: "#748ffc", zero: "#adb5bd" },
} as const;

export function PositionDetailModal({ positionId, onClose, onChanged }: PositionDetailModalProps) {
  const { theme } = useTheme();
  const annotationColors = annotationColorsByTheme[theme];
  const [position, setPosition] = useState<Position | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [greeksFetchFailed, setGreeksFetchFailed] = useState(false);
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});
  const [unrealizedPnlFetchFailed, setUnrealizedPnlFetchFailed] = useState(false);

  const [notesDraft, setNotesDraft] = useState("");
  const [priceTargetDraft, setPriceTargetDraft] = useState("");
  const [closeTriggerDraft, setCloseTriggerDraft] = useState("");
  const [savingFields, setSavingFields] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeLegs, setCloseLegs] = useState<CloseLegDraft[]>([]);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [pendingCloseOrder, setPendingCloseOrder] = useState<OrderRequest | null>(null);

  const hasSyncedFieldsRef = useRef(false);

  async function load() {
    try {
      setLoadError(null);
      const result = await fetchPosition(positionId);
      setPosition(result);
      if (!hasSyncedFieldsRef.current) {
        setNotesDraft(result.notes ?? "");
        setPriceTargetDraft(result.priceTarget ?? "");
        setCloseTriggerDraft(result.closeTriggerNotes ?? "");
        hasSyncedFieldsRef.current = true;
      }

      const optionLegIds =
        result.status === "open" ? result.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id) : [];
      if (optionLegIds.length > 0) {
        setGreeksFetchFailed(false);
        fetchGreeks(optionLegIds)
          .then(setGreeksByLegId)
          .catch(() => setGreeksFetchFailed(true));
      }

      if (result.status === "open") {
        setUnrealizedPnlFetchFailed(false);
        fetchUnrealizedPnl([result.id])
          .then(setUnrealizedPnlByPositionId)
          .catch(() => setUnrealizedPnlFetchFailed(true));
      }

      fetchTickerChart(result.symbol, "5D")
        .then((bars) => {
          const last = bars[bars.length - 1];
          if (last) setCurrentPrice(last.close);
        })
        .catch(() => {});
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load position.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // No payoff shape is defined for an "unstructured" holding — it isn't a
  // recognized strategy, just raw IBKR legs surfaced for review.
  const payoff = useMemo(
    () => (position && position.strategyKey !== "unstructured" ? computePayoff(position.strategyKey, position.legs) : null),
    [position],
  );

  async function handleSaveFields() {
    if (!position) return;
    setSavingFields(true);
    setSaveError(null);
    try {
      const updated = await updatePosition(position.id, {
        notes: notesDraft.trim() || null,
        priceTarget: priceTargetDraft ? Number(priceTargetDraft) : null,
        closeTriggerNotes: closeTriggerDraft.trim() || null,
      });
      setPosition(updated);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setSavingFields(false);
    }
  }

  function openCloseForm() {
    if (!position) return;
    setCloseLegs(position.legs.filter((leg) => !leg.exitAt).map((leg) => ({ legId: leg.id, limitPrice: "" })));
    setCloseError(null);
    setShowCloseForm(true);
  }

  async function handleBuildCloseOrder() {
    if (!position) return;
    for (const draft of closeLegs) {
      if (!draft.limitPrice) {
        setCloseError("A limit price is required for every leg.");
        return;
      }
    }
    setClosing(true);
    setCloseError(null);
    try {
      const order = await buildCloseOrder(
        position.id,
        closeLegs.map((draft) => ({ legId: draft.legId, limitPrice: Number(draft.limitPrice) })),
      );
      setPendingCloseOrder(order);
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "Failed to build close order.");
    } finally {
      setClosing(false);
    }
  }

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
                {position ? (
                  <>
                    {position.symbol}
                    <span className={`badge ms-2 ${strategyBadgeClass(position.strategyKey)}`}>
                      {strategyLabel(position.strategyKey)}
                    </span>
                    <span className={`badge ms-2 ${position.status === "open" ? "bg-success-lt" : "bg-secondary-lt"}`}>
                      {position.status === "open" ? "Open" : "Closed"}
                    </span>
                    {(() => {
                      const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
                      if (pnl === "loading") {
                        if (unrealizedPnlFetchFailed) {
                          return (
                            <span
                              className="badge bg-secondary-lt ms-2"
                              title="Failed to load live P&L data"
                            >
                              P&L —
                            </span>
                          );
                        }
                        return <Spinner size="sm" label="Loading P&L" />;
                      }
                      if (pnl === null)
                        return (
                          <span
                            className="badge bg-secondary-lt ms-2"
                            title="No live price or recent snapshot available for this position"
                          >
                            P&L —
                          </span>
                        );
                      const pct = positionTotalPnlPercent(position, pnl);
                      const asOfDate = positionPnlAsOfDate(position, unrealizedPnlByPositionId);
                      const asOfTitle = asOfDate ? `As of ${formatDate(asOfDate)} close` : undefined;
                      return (
                        <>
                          <span className={`badge ms-2 ${pnlBadgeClass(pnl)}`} title={asOfTitle}>
                            {formatSignedPnl(pnl)}
                          </span>
                          {pct !== null && (
                            <span className={`badge ms-2 ${pnlBadgeClass(pct)}`} title={asOfTitle}>
                              {pct > 0 ? "+" : ""}
                              {formatPercentageValue(pct, 2)}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  "Position"
                )}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {loadError && <div className="alert alert-danger">{loadError}</div>}
              {!loadError && !position && (
                <div className="d-flex justify-content-center py-3">
                  <Spinner label="Loading position" />
                </div>
              )}

              {position && (
                <>
                  <div className="table-responsive mb-4">
                    <table className="table table-sm table-vcenter card-table">
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
                        </tr>
                      </thead>
                      <tbody>
                        {position.legs.map((leg) => (
                          <tr key={leg.id}>
                            <td>{leg.legType === "stock" ? "Stock" : leg.optionType === "call" ? "Call" : "Put"}</td>
                            <td>{leg.side}</td>
                            <td className="text-end">{leg.quantity}</td>
                            <td className="text-end">{leg.strikePrice ? formatCurrency(Number(leg.strikePrice)) : "—"}</td>
                            <td>{leg.expiryDate ? formatDate(leg.expiryDate) : "—"}</td>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mb-4">
                    <TickerPriceChart symbol={position.symbol} />
                  </div>

                  {payoff && (
                    <div className="mb-4">
                      <h4 className="mb-2" style={{ fontSize: "1rem" }}>
                        Payoff at Expiration
                      </h4>
                      <div className="row mb-2">
                        <div className="col-4">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Max Gain
                          </div>
                          <div className="fw-bold text-success">{formatSignedPnl(payoff.maxGain)}</div>
                        </div>
                        <div className="col-4">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Max Loss
                          </div>
                          <div className="fw-bold text-danger">{formatSignedPnl(-payoff.maxLoss)}</div>
                        </div>
                        <div className="col-4">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Breakeven
                          </div>
                          <div className="fw-bold">{formatCurrency(payoff.breakeven)}</div>
                        </div>
                      </div>
                      <ApexChart
                        type="area"
                        height={260}
                        series={[{ name: "P&L at Expiration", data: payoff.points.map((p) => ({ x: p.price, y: p.pnl })) }]}
                        options={{
                          xaxis: {
                            type: "numeric",
                            labels: { formatter: (value: string) => formatCurrency(Number(value)) },
                          },
                          yaxis: { labels: { formatter: (value: number) => formatCurrency(value) } },
                          tooltip: {
                            x: { formatter: (value: number) => formatCurrency(value) },
                            y: { formatter: (value: number) => formatSignedPnl(value) },
                          },
                          annotations: {
                            xaxis: [
                              {
                                x: payoff.breakeven,
                                borderColor: annotationColors.breakeven,
                                label: { text: "Breakeven", style: { fontSize: "0.7rem" } },
                              },
                              ...(currentPrice !== null
                                ? [
                                    {
                                      x: currentPrice,
                                      borderColor: annotationColors.current,
                                      label: { text: "Current", style: { fontSize: "0.7rem" } },
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

                  <div className="mb-4">
                    {saveError && <div className="alert alert-danger">{saveError}</div>}
                    <div className="row g-3">
                      <div className="col-12 col-sm-6 col-md-3">
                        <label className="form-label" style={{ fontSize: "0.8rem" }}>
                          Price Target
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          value={priceTargetDraft}
                          onChange={(event) => setPriceTargetDraft(event.target.value)}
                        />
                      </div>
                      <div className="col-12 col-md-6">
                        <label className="form-label" style={{ fontSize: "0.8rem" }}>
                          Close Trigger Notes
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={closeTriggerDraft}
                          onChange={(event) => setCloseTriggerDraft(event.target.value)}
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label" style={{ fontSize: "0.8rem" }}>
                          Notes
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline-primary mt-3 d-inline-flex align-items-center gap-1"
                      disabled={savingFields}
                      onClick={handleSaveFields}
                    >
                      {savingFields && <Spinner size="sm" />}
                      Save
                    </button>
                  </div>

                  {position.status === "open" && (
                    <div className="border-top pt-3">
                      {pendingCloseOrder ? (
                        <OrderReviewPanel
                          order={pendingCloseOrder}
                          onCancelled={() => {
                            setPendingCloseOrder(null);
                            setShowCloseForm(false);
                          }}
                          onFilled={() => {
                            setPendingCloseOrder(null);
                            onChanged();
                            onClose();
                          }}
                        />
                      ) : !showCloseForm ? (
                        <button type="button" className="btn btn-outline-danger" onClick={openCloseForm}>
                          Close Position
                        </button>
                      ) : (
                        <div>
                          <h4 className="mb-2" style={{ fontSize: "1rem" }}>
                            Close Position
                          </h4>
                          {closeError && <div className="alert alert-danger">{closeError}</div>}
                          {closeLegs.map((draft, index) => {
                            const leg = position.legs.find((l) => l.id === draft.legId);
                            return (
                              <div className="row g-3 mb-2" key={draft.legId}>
                                <div className="col-12 col-sm-4">
                                  <label className="form-label" style={{ fontSize: "0.8rem" }}>
                                    {leg?.legType === "stock" ? "Stock" : leg?.optionType === "call" ? "Call" : "Put"}{" "}
                                    Limit Price
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="form-control"
                                    value={draft.limitPrice}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setCloseLegs((prev) =>
                                        prev.map((d, i) => (i === index ? { ...d, limitPrice: value } : d)),
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          <div className="d-flex gap-2 mt-2">
                            <button
                              type="button"
                              className="btn btn-danger d-inline-flex align-items-center gap-1"
                              disabled={closing}
                              onClick={handleBuildCloseOrder}
                            >
                              {closing && <Spinner size="sm" />}
                              Review Close Order
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              disabled={closing}
                              onClick={() => setShowCloseForm(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
