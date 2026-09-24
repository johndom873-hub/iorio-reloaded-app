import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchNextTickerCalendarEvents, type NextTickerCalendarEvents } from "../api/calendarEvents";
import { ApiError } from "../api/client";
import { fetchSignalsRoadmap, fetchTickerSignals, openSignalsTickerStream, type RoadmapItem, type SignalCandidate, type SignalStrategyKey, type TickerSignals } from "../api/signals";
import { openTickerDetailStream, type PriceBar, type TickerOverview, type TickerTechnicals } from "../api/tickerDetail";
import { useTickerPositions } from "../hooks/useTickerPositions";
import type { AdaptivePriority, OrderRequest } from "../api/positions";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { SignalOrderSetupForm } from "./SignalOrderSetupForm";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatNumber, formatPercentage, formatPercentageValue, formatQuotePrice, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass } from "../lib/formatters";
import { gradeBadgeClass, gradeExplanation, gradeLabel, signalFlagExplanation, signalFlagLetter, unscoredReasonLabel } from "../lib/signalsPresentation";
import { IvHistoryChart } from "./charts/IvHistoryChart";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { DataTable, type DataTableColumn } from "./DataTable/DataTable";
import { FlashingNumber } from "./FlashingNumber";
import { NotAccountedForChip } from "./signals/NotAccountedForChip";
import { Spinner } from "./Spinner";
import { StrategyBadge } from "./StrategyBadge";
import { TickerHeaderStrip } from "./TickerHeaderStrip";
import { TickerPositionsCards } from "./TickerPositionsCards";
import { TooltipSpan } from "./TooltipSpan";
import { useTooltip } from "../hooks/useTooltip";

// Signals modal (stage 4; mockup approved 2026-09-22, v3). Same header,
// Positions and Wheel-cycle cards as Ticker Detail, then the live graded
// opportunity list, the selected expiry's chain (calls left / puts right, OTM
// side only), the order-setup slot (stage 5) and the charts at the bottom.
// Data: GET /signals/:symbol for the first paint, the signalsTicker stream for
// live re-scoring, and the ticker-detail stream restricted to
// overview/chart/technicals so it never opens the ~96-line option chain.

interface SignalsTickerModalProps {
  symbol: string;
  onClose: () => void;
}

type StrategyFilter = "all" | SignalStrategyKey;
type DteFilter = "all" | "short" | "medium" | "long";
const dteFilters: { key: DteFilter; label: string; matches: (dte: number) => boolean }[] = [
  { key: "all", label: "All expiries", matches: () => true },
  { key: "short", label: "≤ 21d", matches: (dte) => dte <= 21 },
  { key: "medium", label: "22-45d", matches: (dte) => dte > 21 && dte <= 45 },
  { key: "long", label: "46-90d", matches: (dte) => dte > 45 },
];

const badgeFontSize = { fontSize: "0.72rem" } as const;
const candidateKey = (candidate: SignalCandidate) => `${candidate.expiry}|${candidate.strike}|${candidate.strategyKey === "covered_call" ? "C" : "P"}`;

function GradeBadge({ candidate }: { candidate: SignalCandidate }) {
  const ref = useTooltip<HTMLSpanElement>(gradeExplanation);
  return (
    <span ref={ref} className={`badge ${gradeBadgeClass[candidate.grade]}`} style={badgeFontSize} tabIndex={0}>
      {gradeLabel[candidate.grade]}
    </span>
  );
}

function FlagBadges({ candidate }: { candidate: SignalCandidate }) {
  if (candidate.flags.length === 0) return null;
  return (
    <span className="d-inline-flex gap-1">
      {candidate.flags.map((flag) => (
        <TooltipSpan key={flag} className="badge bg-warning-lt" style={badgeFontSize} text={signalFlagExplanation[flag]}>
          {signalFlagLetter[flag]}
        </TooltipSpan>
      ))}
    </span>
  );
}

function SegmentedButtons<TKey extends string>({ value, options, onChange }: { value: TKey; options: { key: TKey; label: string }[]; onChange: (key: TKey) => void }) {
  return (
    <div className="btn-group" role="group">
      {options.map((option) => (
        <button key={option.key} type="button" className={`btn btn-sm ${option.key === value ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => onChange(option.key)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ExpiryChainGrid({ candidates, expiry, spotPrice, selectedKey, onSelect }: { candidates: SignalCandidate[]; expiry: string; spotPrice: number | null; selectedKey: string | null; onSelect: (candidate: SignalCandidate) => void }) {
  const rows = useMemo(() => {
    const byStrike = new Map<number, { call?: SignalCandidate; put?: SignalCandidate }>();
    for (const candidate of candidates) {
      if (candidate.expiry !== expiry) continue;
      const entry = byStrike.get(candidate.strike) ?? {};
      if (candidate.strategyKey === "covered_call") entry.call = candidate;
      else entry.put = candidate;
      byStrike.set(candidate.strike, entry);
    }
    return [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  }, [candidates, expiry]);
  const spotMarkerIndex = spotPrice === null ? -1 : rows.findIndex(([strike]) => strike >= spotPrice);

  const sideCells = (candidate: SignalCandidate | undefined) =>
    candidate ? (
      <>
        <td className="text-end font-mono">{formatQuotePrice(candidate.bid)}</td>
        <td className="text-end font-mono">{formatQuotePrice(candidate.ask)}</td>
        <td className="text-end font-mono">{formatSignedDelta(candidate.delta)}</td>
        <td className="text-end">
          <GradeBadge candidate={candidate} />
        </td>
      </>
    ) : (
      <>
        <td />
        <td />
        <td />
        <td />
      </>
    );

  return (
    <div className="table-responsive">
      <table className="table table-sm table-hover table-vcenter card-table" style={{ fontSize: "0.8rem" }}>
        <thead className="table-light">
          <tr>
            <th colSpan={4} className="text-center">
              Calls
            </th>
            <th className="text-center">Strike</th>
            <th colSpan={4} className="text-center">
              Puts
            </th>
          </tr>
          <tr>
            <th className="text-end">Bid</th>
            <th className="text-end">Ask</th>
            <th className="text-end">Δ</th>
            <th className="text-end">Grade</th>
            <th className="text-center">·</th>
            <th className="text-end">Bid</th>
            <th className="text-end">Ask</th>
            <th className="text-end">Δ</th>
            <th className="text-end">Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([strike, entry], index) => {
            const candidate = entry.call ?? entry.put;
            const key = candidate ? candidateKey(candidate) : String(strike);
            return (
              <FragmentRow key={key} showSpotMarkerBefore={index === spotMarkerIndex} spotPrice={spotPrice}>
                <tr className={selectedKey === key ? "table-active" : undefined} style={{ cursor: candidate ? "pointer" : undefined }} onClick={candidate ? () => onSelect(candidate) : undefined}>
                  {sideCells(entry.call)}
                  <td className="text-center fw-bold font-mono">{formatCurrencyTrimmed(strike)}</td>
                  {sideCells(entry.put)}
                </tr>
              </FragmentRow>
            );
          })}
          {spotMarkerIndex === -1 && spotPrice !== null && rows.length > 0 && <SpotMarkerRow spotPrice={spotPrice} />}
        </tbody>
      </table>
    </div>
  );
}

function SpotMarkerRow({ spotPrice }: { spotPrice: number }) {
  return (
    <tr>
      <td colSpan={9} className="text-center fw-semibold bg-info-lt" style={{ fontSize: "0.72rem" }}>
        ▼ Spot {formatCurrency(spotPrice)} ▼
      </td>
    </tr>
  );
}

function FragmentRow({ showSpotMarkerBefore, spotPrice, children }: { showSpotMarkerBefore: boolean; spotPrice: number | null; children: ReactNode }) {
  return (
    <>
      {showSpotMarkerBefore && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} />}
      {children}
    </>
  );
}

function formatSignedDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
}

export function SignalsTickerModal({ symbol, onClose }: SignalsTickerModalProps) {
  const [signals, setSignals] = useState<TickerSignals | null>(null);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [liveQuoteContractCount, setLiveQuoteContractCount] = useState<number | null>(null);
  const [uncompensatedAsOf, setUncompensatedAsOf] = useState<{ spotPrice: number; at: string } | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);

  const [overview, setOverview] = useState<TickerOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [chartBars, setChartBars] = useState<PriceBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [technicals, setTechnicals] = useState<TickerTechnicals | null>(null);
  const [nextCalendarEvents, setNextCalendarEvents] = useState<NextTickerCalendarEvents | null>(null);

  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectionReference, setSelectionReference] = useState<{ netEdge: number; atIso: string } | null>(null);
  const [pendingOrder, setPendingOrder] = useState<{ order: OrderRequest; adaptivePriority: AdaptivePriority } | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>("all");
  const [dteFilter, setDteFilter] = useState<DteFilter>("all");
  const [showAvoid, setShowAvoid] = useState(false);
  const [rollNotice, setRollNotice] = useState<string | null>(null);

  const tickerPositions = useTickerPositions(symbol);

  // Informational modal, no action required — closable via ESC or backdrop click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Rendered manually rather than via Bootstrap's JS Modal instance, so nothing else locks background scroll.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSignals(null);
    setSignalsError(null);
    setSelectedExpiry(null);
    setSelectedKey(null);
    Promise.all([fetchTickerSignals(symbol), fetchSignalsRoadmap()])
      .then(([result, roadmapResponse]) => {
        if (cancelled) return;
        setSignals((current) => current ?? result); // a live frame may already have arrived
        setRoadmap(roadmapResponse.items);
      })
      .catch((err) => {
        if (!cancelled) setSignalsError(err instanceof ApiError ? err.message : "Could not load the signals for this ticker.");
      });
    fetchNextTickerCalendarEvents(symbol)
      .then((result) => {
        if (!cancelled) setNextCalendarEvents(result);
      })
      .catch(() => {
        if (!cancelled) setNextCalendarEvents({ nextEarningsDate: null, nextExDividendDate: null });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Header pricing, chart and technicals — never the option chain (~96 IBKR lines) nor a second spot line.
  useEffect(() => {
    setOverview(null);
    setOverviewError(null);
    setChartBars(null);
    setChartError(null);
    setTechnicals(null);
    return openTickerDetailStream(
      symbol,
      (event) => {
        switch (event.type) {
          case "overview":
            setOverview(event.data);
            break;
          case "chart":
            setChartBars(event.data);
            break;
          case "technicals":
            setTechnicals(event.data);
            break;
          case "error":
            if (event.section === "overview") setOverviewError(event.message);
            if (event.section === "chart") setChartError(event.message);
            break;
          case "streamError":
            setOverviewError(event.message);
            break;
          default:
            break;
        }
      },
      { sections: ["overview", "chart", "technicals"] },
    );
  }, [symbol]);

  // Live re-scoring; re-opened when the user picks another expiry (the live quote set follows it).
  useEffect(() => {
    setStreamFailed(false);
    return openSignalsTickerStream(
      symbol,
      selectedExpiry,
      (frame) => {
        setSignals(frame.signals);
        setLiveQuoteContractCount(frame.liveQuoteContracts.length);
        setUncompensatedAsOf(frame.uncompensatedAsOf);
        setStreamFailed(false);
      },
      () => setStreamFailed(true),
    );
  }, [symbol, selectedExpiry]);

  const effectiveExpiry = selectedExpiry ?? signals?.best?.expiry ?? null;
  const spotPrice = signals?.spotPrice ?? overview?.pricing.last ?? null;

  const rankedCandidates = useMemo(() => (signals ? [...signals.candidates].sort((a, b) => b.edgeDollars - a.edgeDollars || b.netEdge - a.netEdge) : []), [signals]);
  const filteredCandidates = useMemo(() => {
    const dteMatches = dteFilters.find((filter) => filter.key === dteFilter)!.matches;
    return rankedCandidates.filter((candidate) => (strategyFilter === "all" || candidate.strategyKey === strategyFilter) && dteMatches(candidate.dte));
  }, [rankedCandidates, strategyFilter, dteFilter]);
  const shownCandidates = useMemo(() => (showAvoid ? filteredCandidates : filteredCandidates.filter((candidate) => candidate.grade !== "avoid")), [filteredCandidates, showAvoid]);
  const hiddenAvoidCount = filteredCandidates.length - shownCandidates.length;
  // Ann. Yield heatmap: quintile rank among the shown candidates, lowest yield = tier 1 (muted) to highest = tier 5 (vivid).
  const yieldTierByKey = useMemo(() => {
    const ranked = [...shownCandidates].sort((a, b) => a.annualizedYield - b.annualizedYield);
    const tiers = new Map<string, number>();
    ranked.forEach((candidate, index) => tiers.set(candidateKey(candidate), Math.min(5, Math.floor((index / ranked.length) * 5) + 1)));
    return tiers;
  }, [shownCandidates]);
  const selectedCandidate = useMemo(() => (selectedKey ? (signals?.candidates.find((candidate) => candidateKey(candidate) === selectedKey) ?? null) : null), [signals, selectedKey]);

  function selectCandidate(candidate: SignalCandidate) {
    if (pendingOrder) return; // an order under review keeps its contract until cancelled or filled
    setSelectedKey(candidateKey(candidate));
    setSelectionReference({ netEdge: candidate.netEdge, atIso: new Date().toISOString() });
    if (candidate.expiry !== effectiveExpiry) setSelectedExpiry(candidate.expiry);
  }
  function clearSelection() {
    setPendingOrder(null);
    setSelectedKey(null);
    setSelectionReference(null);
  }

  const opportunityColumns = useMemo<DataTableColumn<SignalCandidate & { rank: number }>[]>(
    () => [
      { key: "rank", header: "#", render: (row) => <span className="text-secondary font-mono">{row.rank}</span> },
      { key: "strategy", header: "Type", align: "center", render: (row) => <StrategyBadge strategyKey={row.strategyKey} /> },
      {
        key: "trade",
        header: "Trade",
        render: (row) => (
          <span className="text-nowrap">
            <strong>
              {row.strategyKey === "covered_call" ? "C" : "P"}
              {formatCurrencyTrimmed(row.strike).replace("$", "")}
            </strong> <span className="text-secondary">{row.dte}DTE</span>
          </span>
        ),
      },
      { key: "grade", header: "Grade", align: "center", headerTitle: gradeExplanation, render: (row) => <GradeBadge candidate={row} /> },
      {
        key: "netEdge",
        header: "Net Edge",
        align: "right",
        headerTitle: "Surface IV at the strike minus forecast volatility minus friction, in volatility points",
        render: (row) => (
          <FlashingNumber value={row.netEdge} precision={3} className={`font-mono ${pnlTextClass(row.netEdge)}`}>
            {formatVolatilityPoints(row.netEdge)}
          </FlashingNumber>
        ),
      },
      {
        key: "edgeDollars",
        header: "Edge $",
        align: "right",
        headerTitle: "Net Edge x vega x 100: the excess premium in dollars per contract",
        render: (row) => (
          <FlashingNumber value={row.edgeDollars} precision={0} className={`font-mono ${pnlTextClass(row.edgeDollars)}`}>
            {formatSignedPnl(row.edgeDollars, 0)}
          </FlashingNumber>
        ),
      },
      { key: "friction", header: "Friction", align: "right", headerTitle: "Half-spread plus commission, in volatility points", render: (row) => <span className="font-mono text-secondary">{formatVolatilityPoints(row.frictionVolatility).replace("+", "")}</span> },
      {
        key: "iv",
        header: "Surf. / mid IV",
        align: "right",
        headerTitle: "Surface IV at this strike vs this contract's own mid IV",
        render: (row) => (
          <span className="font-mono text-nowrap">
            {formatPercentage(row.surfaceImpliedVolatility, 1)} / {formatPercentage(row.midImpliedVolatility, 1)}
          </span>
        ),
      },
      { key: "delta", header: "Delta", align: "right", render: (row) => <span className="font-mono">{formatSignedDelta(row.delta)}</span> },
      {
        key: "spread",
        header: "Spread",
        align: "right",
        headerTitle: "(Ask − Bid) / Mid",
        render: (row) => (
          <TooltipSpan className={`font-mono ${row.quoteSource === "live" ? "" : "text-secondary"}`} text={row.quoteSource === "live" ? "Live quote" : "10:00 ET snapshot quote"}>
            {formatPercentageValue(row.spreadPercent, 1)}
            {row.quoteSource === "snapshot" ? "*" : ""}
          </TooltipSpan>
        ),
      },
      { key: "yield", header: "Ann. yield", align: "right", render: (row) => <span className={`font-mono heat-yield-${yieldTierByKey.get(candidateKey(row)) ?? 1}`}>{formatPercentage(row.annualizedYield, 0)}</span> },
      { key: "uncompensated", header: "Drift", align: "right", headerTitle: "Share of P&L variance from delta drift (UncompensatedShare)", render: (row) => <span className="font-mono text-secondary">{row.uncompensatedSharePercent === null ? "…" : `${row.uncompensatedSharePercent.toFixed(0)}%`}</span> },
      { key: "flags", header: "Flags", render: (row) => <FlagBadges candidate={row} /> },
    ],
    [yieldTierByKey],
  );
  const opportunityRows = useMemo(() => shownCandidates.map((candidate, index) => ({ ...candidate, rank: index + 1 })), [shownCandidates]);

  const liveLabel = streamFailed ? "Live stream unavailable — snapshot values" : signals?.priceSource === "live" ? `Live · quotes streaming for ${liveQuoteContractCount ?? 0} contracts` : "Connecting live prices…";

  const positionsCards = (
    <TickerPositionsCards
      symbol={symbol}
      data={tickerPositions}
      currentPrice={spotPrice}
      onRollSelect={() => setRollNotice("Rolls are reviewed from the Ticker Detail modal (Trade Alerts or Positions), not from Signals.")}
      onSellCall={(prefill) => {
        const match = prefill ? signals?.candidates.find((candidate) => candidate.strategyKey === "covered_call" && candidate.strike === prefill.strike && candidate.expiry === prefill.expiry) : undefined;
        if (match) selectCandidate(match);
        else setRollNotice(prefill ? "That call is not among the scored candidates for this ticker." : "Pick a call from the opportunities below.");
      }}
    />
  );

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
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-inset">
          <div className="modal-content">
            <div className="modal-header">
              <div>
                <div className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.68rem", letterSpacing: "0.06em" }}>
                  Signals
                </div>
                <h5 className="modal-title">
                  {symbol}
                  {(signals?.companyName ?? overview?.companyName) && <span className="text-secondary fw-normal"> — {signals?.companyName ?? overview?.companyName}</span>}
                </h5>
              </div>
              <div className="ms-auto me-3 d-inline-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.75rem" }}>
                {signals?.priceSource === "live" && !streamFailed && <span className="iorio-pulse-dot" />}
                {liveLabel}
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {overviewError && <div className="alert alert-danger">{overviewError}</div>}
              {!overviewError && !overview && (
                <div className="d-flex justify-content-center py-3">
                  <Spinner label="Loading pricing" />
                </div>
              )}
              {overview && <TickerHeaderStrip symbol={symbol} overview={overview} spotPrice={spotPrice} nextCalendarEvents={nextCalendarEvents} onShortlisted={() => setOverview((prev) => (prev ? { ...prev, isShortlisted: true } : prev))} />}

              {signalsError && <div className="alert alert-danger">{signalsError}</div>}
              {signals && (
                <div className="d-flex flex-wrap align-items-center gap-3 mb-3" style={{ fontSize: "0.8rem" }}>
                  <SignalMetric label="ATM IV (30d)" value={formatPercentage(signals.atmImpliedVolatility, 1)} />
                  <SignalMetric label={`Forecast RV (${signals.forecast?.windowDays ?? 63}d)`} value={formatPercentage(signals.forecast?.volatility, 1)} />
                  <SignalMetric label="IV − forecast" value={signals.atmImpliedVolatility !== null && signals.forecast ? formatVolatilityPoints(signals.atmImpliedVolatility - signals.forecast.volatility) : "—"} />
                  <SignalMetric label="Momentum 12-1" value={signals.momentum === null ? "n/a" : formatSignedPercentageValue(signals.momentum * 100, 0)} />
                  <SignalMetric label="Skew (30d)" value={signals.skew ? formatVolatilityPoints(signals.skew.skew) : "—"} />
                  <SignalMetric label="Vol flag" value={signals.elevatedVolatility ? `${signals.elevatedVolatility.elevated ? "Elevated" : "Normal"} (${signals.elevatedVolatility.ratio.toFixed(2)} vs ${signals.elevatedVolatility.threshold.toFixed(2)})` : "n/a"} />
                  <SignalMetric label="Shares free" value={formatNumber(signals.freeShares, 0)} />
                  <SignalMetric label="Cash free" value={formatCurrency(signals.freeCash, 0)} />
                  <span className="ms-auto">
                    <NotAccountedForChip symbol={symbol} caveats={signals.caveats} generalItems={roadmap} label="not accounted for" />
                  </span>
                </div>
              )}

              {rollNotice && (
                <div className="alert alert-info py-2" style={{ fontSize: "0.85rem" }}>
                  {rollNotice}
                </div>
              )}
              {signals && signals.unscoredReason && (
                <>
                  <div className="alert alert-secondary">
                    <span className="badge bg-secondary-lt me-2" style={badgeFontSize}>
                      Unscored
                    </span>
                    {unscoredReasonLabel[signals.unscoredReason]}
                  </div>
                  {positionsCards}
                </>
              )}

              {signals && !signals.unscoredReason && (
                <div className="d-flex flex-column flex-lg-row gap-3">
                  <div style={{ minWidth: 0, flex: "1 1 68%" }}>
                    <DataTable
                      tableId="signals-opportunities"
                      dense
                      maxVisibleRows={15}
                      columns={opportunityColumns}
                      rows={opportunityRows}
                      rowKey={(row) => candidateKey(row)}
                      emptyMessage={hiddenAvoidCount > 0 ? `No candidate has positive net Edge right now. Tick "Show Avoid" to see the ${hiddenAvoidCount} hidden.` : "No candidates match the filters."}
                      onRowClick={selectCandidate}
                      rowClassName={(row) => [candidateKey(row) === selectedKey ? "table-active" : "", row.grade === "avoid" ? "text-secondary" : ""].filter(Boolean).join(" ") || undefined}
                      toolbar={
                        <div className="d-flex flex-wrap align-items-center gap-2 w-100" style={{ fontSize: "0.8rem" }}>
                          <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                            Opportunities
                          </span>
                          <SegmentedButtons
                            value={strategyFilter}
                            options={[
                              { key: "all", label: "All" },
                              { key: "cash_secured_put", label: "Puts (CSP)" },
                              { key: "covered_call", label: "Calls (CC)" },
                            ]}
                            onChange={setStrategyFilter}
                          />
                          <SegmentedButtons value={dteFilter} options={dteFilters.map(({ key, label }) => ({ key, label }))} onChange={setDteFilter} />
                          <label className="form-check form-check-inline mb-0 text-secondary">
                            <input type="checkbox" className="form-check-input" checked={showAvoid} onChange={(event) => setShowAvoid(event.target.checked)} />
                            <span className="form-check-label">Show Avoid ({hiddenAvoidCount} hidden)</span>
                          </label>
                          {uncompensatedAsOf && <span className="text-secondary ms-auto">Delta drift as of {formatCurrency(uncompensatedAsOf.spotPrice)}</span>}
                        </div>
                      }
                      afterTable={
                        <div className="card-footer text-secondary" style={{ fontSize: "0.75rem" }}>
                          * quote from the 10:00 ET snapshot; live quotes stream only for the selected expiry's contracts and the top-ranked candidates (up to 40).
                        </div>
                      }
                    />

                    {effectiveExpiry && (
                      <div className="card mt-3">
                        <div className="card-header py-2">
                          <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                            Option chain · {formatDate(effectiveExpiry)} expiry
                          </span>
                          <span className="text-secondary ms-2" style={{ fontSize: "0.75rem" }}>
                            (graded rows carry the same pills as an alert would; click a row to select it)
                          </span>
                        </div>
                        <ExpiryChainGrid candidates={signals.candidates} expiry={effectiveExpiry} spotPrice={spotPrice} selectedKey={selectedKey} onSelect={selectCandidate} />
                      </div>
                    )}

                    <div className="mt-3">{positionsCards}</div>
                  </div>

                  <div style={{ flex: "1 1 32%", minWidth: "19rem" }}>
                    <div className="card">
                      <div className="card-body">
                        {pendingOrder ? (
                          <OrderReviewPanel
                            order={pendingOrder.order}
                            initialAdaptivePriority={pendingOrder.adaptivePriority}
                            liveSpotPrice={spotPrice}
                            onCancelled={clearSelection}
                            onFilled={() => {
                              clearSelection();
                              void tickerPositions.loadPositions();
                            }}
                          />
                        ) : selectedCandidate && selectionReference ? (
                          <SignalOrderSetupForm
                            symbol={symbol}
                            signals={signals}
                            candidate={selectedCandidate}
                            spotPrice={spotPrice}
                            netEdgeAtSelection={selectionReference.netEdge}
                            selectedAtIso={selectionReference.atIso}
                            onCancel={clearSelection}
                            onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                          />
                        ) : (
                          <>
                            <div className="text-secondary text-uppercase fw-bold mb-2" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                              Order setup
                            </div>
                            <p className="text-secondary mb-0" style={{ fontSize: "0.85rem" }}>
                              Select an opportunity or a chain quote.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4">
                {chartError && <div className="alert alert-danger">{chartError}</div>}
                {!chartError && !chartBars && (
                  <div className="d-flex justify-content-center py-3">
                    <Spinner label="Loading chart" />
                  </div>
                )}
                {chartBars && <TickerPriceChart symbol={symbol} initialBars={chartBars} technicals={technicals} />}
              </div>
              <div className="mt-3">
                <IvHistoryChart symbol={symbol} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SignalMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="d-inline-flex flex-column">
      <span className="text-secondary" style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span className="font-mono fw-semibold">{value}</span>
    </span>
  );
}
