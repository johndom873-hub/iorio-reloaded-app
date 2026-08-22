import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { ApexChart } from "./charts/ApexChart";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { ApiError } from "../api/client";
import {
  closePosition,
  fetchGreeks,
  fetchPosition,
  fetchUnrealizedPnl,
  updatePosition,
  type Greeks,
  type Position,
} from "../api/positions";
import { fetchTickerChart } from "../api/tickerDetail";
import { computePayoff } from "../lib/payoff";
import { formatCurrency, formatDate, formatNumber, formatPercentageValue, formatSignedPnl, pnlBadgeClass } from "../lib/formatters";
import { positionTotalPnl, positionTotalPnlPercent } from "../lib/positionPnl";

interface PositionDetailModalProps {
  positionId: string;
  onClose: () => void;
  onChanged: () => void;
}

interface CloseLegDraft {
  legId: string;
  exitPrice: string;
  exitAt: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PositionDetailModal({ positionId, onClose, onChanged }: PositionDetailModalProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, number | null>>({});

  const [notesDraft, setNotesDraft] = useState("");
  const [priceTargetDraft, setPriceTargetDraft] = useState("");
  const [closeTriggerDraft, setCloseTriggerDraft] = useState("");
  const [savingFields, setSavingFields] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeLegs, setCloseLegs] = useState<CloseLegDraft[]>([]);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

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
        fetchGreeks(optionLegIds)
          .then(setGreeksByLegId)
          .catch(() => {});
      }

      if (result.status === "open") {
        fetchUnrealizedPnl([result.id])
          .then(setUnrealizedPnlByPositionId)
          .catch(() => {});
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

  const payoff = useMemo(() => (position ? computePayoff(position.strategyKey, position.legs) : null), [position]);

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
    setCloseLegs(position.legs.map((leg) => ({ legId: leg.id, exitPrice: "", exitAt: todayIsoDate() })));
    setCloseError(null);
    setShowCloseForm(true);
  }

  async function handleConfirmClose() {
    if (!position) return;
    for (const draft of closeLegs) {
      if (!draft.exitPrice) {
        setCloseError("Exit price is required for every leg.");
        return;
      }
    }
    setClosing(true);
    setCloseError(null);
    try {
      await closePosition(
        position.id,
        closeLegs.map((draft) => ({
          legId: draft.legId,
          exitPrice: Number(draft.exitPrice),
          exitAt: new Date(`${draft.exitAt}T00:00:00Z`).toISOString(),
        })),
      );
      onChanged();
      onClose();
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "Failed to close position.");
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
                    <span className="badge bg-azure-lt text-dark ms-2" style={{ fontSize: "0.72rem" }}>
                      {position.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
                    </span>
                    <span
                      className={`badge ms-2 ${position.status === "open" ? "bg-success-lt" : "bg-secondary-lt"} text-dark`}
                      style={{ fontSize: "0.72rem" }}
                    >
                      {position.status === "open" ? "Open" : "Closed"}
                    </span>
                    {(() => {
                      const pnl = positionTotalPnl(position, unrealizedPnlByPositionId);
                      if (pnl === "loading") return <Spinner size="sm" label="Loading P&L" />;
                      if (pnl === null) return null;
                      const pct = positionTotalPnlPercent(position, pnl);
                      return (
                        <>
                          <span className={`badge ms-2 ${pnlBadgeClass(pnl)}`} style={{ fontSize: "0.72rem" }}>
                            {formatSignedPnl(pnl)}
                          </span>
                          {pct !== null && (
                            <span className={`badge ms-2 ${pnlBadgeClass(pct)}`} style={{ fontSize: "0.72rem" }}>
                              {pct > 0 ? "+" : ""}
                              {formatPercentageValue(pct)}
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
                              {leg.legType === "option"
                                ? formatNumber(greeksByLegId[leg.id]?.delta ?? null, 2)
                                : "—"}
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
                                borderColor: "#f59f00",
                                label: { text: "Breakeven", style: { fontSize: "0.7rem" } },
                              },
                              ...(currentPrice !== null
                                ? [
                                    {
                                      x: currentPrice,
                                      borderColor: "#4263eb",
                                      label: { text: "Current", style: { fontSize: "0.7rem" } },
                                    },
                                  ]
                                : []),
                            ],
                            yaxis: [{ y: 0, borderColor: "#adb5bd", strokeDashArray: 4 }],
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
                      {!showCloseForm ? (
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
                                    Exit Price
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="form-control"
                                    value={draft.exitPrice}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setCloseLegs((prev) =>
                                        prev.map((d, i) => (i === index ? { ...d, exitPrice: value } : d)),
                                      );
                                    }}
                                  />
                                </div>
                                <div className="col-12 col-sm-4">
                                  <label className="form-label" style={{ fontSize: "0.8rem" }}>
                                    Exit Date
                                  </label>
                                  <input
                                    type="date"
                                    className="form-control"
                                    value={draft.exitAt}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setCloseLegs((prev) =>
                                        prev.map((d, i) => (i === index ? { ...d, exitAt: value } : d)),
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
                              onClick={handleConfirmClose}
                            >
                              {closing && <Spinner size="sm" />}
                              Confirm Close
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
