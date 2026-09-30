import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { fetchNextTickerCalendarEvents, type NextTickerCalendarEvents } from "../api/calendarEvents";
import { ApiError } from "../api/client";
import { fetchSignalContractScore, fetchSignalsChain, fetchTickerSignals, openSignalsQuotesStream, openSignalsTickerStream, type HeldLegScore, type MacroEvent, type RollSignalCandidate, type SignalCandidate, type SignalContractScore, type SignalsChain, type SignalsChainCellState, type SignalsQuotesFrame, type SignalStrategyKey, type TickerSignals } from "../api/signals";
import { useVisibleLiveContracts } from "../hooks/useVisibleLiveContracts";
import { openTickerDetailStream, type MacdSignal, type PriceBar, type TickerOverview, type TickerTechnicals } from "../api/tickerDetail";
import { useTickerPositions } from "../hooks/useTickerPositions";
import { cancelUnconfirmedOrder, type AdaptivePriority, type OrderRequest } from "../api/positions";
import { OrderReviewPanel, type OrderReviewQuoteSeed } from "./OrderReviewPanel";
import { RollSignalOrderSetupForm } from "./RollSignalOrderSetupForm";
import { SignalOrderSetupForm } from "./SignalOrderSetupForm";
import { ChainContractOrderSetupForm } from "./ChainContractOrderSetupForm";
import { SignalsOptionChainCard, type ChainContractRef } from "./signals/SignalsOptionChainCard";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatDateTime, formatNumber, formatPercentage, formatPercentageValue, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass } from "../lib/formatters";
import { candidateContractRight, describeHeldLeg, describeSupportResistanceLevel, describeNoCandidatesMessage, describeQuoteAgeRange, describeRollSignalFlag, describeSignalFlag, gradeBadgeClass, gradeExplanation, gradeLabel, heldLegUnscoredReasonLabel, netRollEdgeExplanation, quoteAgeCellLabel, quoteSourceLabel, rollFlagLetter, signalContractKey, signalFlagLetter, surfaceIvTrustClass, unscoredReasonLabel } from "../lib/signalsPresentation";
import { IvHistoryChart } from "./charts/IvHistoryChart";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { CollapsibleCard } from "./CollapsibleCard";
import { DataTable, type DataTableColumn } from "./DataTable/DataTable";
import { FlashingNumber } from "./FlashingNumber";
import { ModelCaveatBadge } from "./signals/ModelCaveatBadge";
import { Spinner } from "./Spinner";
import { StrategyBadge } from "./StrategyBadge";
import { TickerHeaderStrip } from "./TickerHeaderStrip";
import { TickerPositionsCards } from "./TickerPositionsCards";
import { TooltipSpan } from "./TooltipSpan";
import { useTooltip } from "../hooks/useTooltip";
import { useMediaQuery } from "../hooks/useMediaQuery";

// Signals modal (stage 4; mockup approved 2026-09-22, v3): the one ticker
// modal, opened from every ticker link (mounted once by
// SignalsTickerModalProvider). Header strip, the live graded opportunity list,
// the full option chain of one expiry (any call or put can be picked), the
// order-setup slot (stage 5), the Positions and Wheel-cycle cards, technicals
// and the charts at the bottom.
// Data: GET /signals/:symbol for the first paint, the signalsTicker stream for
// live re-scoring, and the ticker-detail stream (overview, pooled spot price,
// chart, technicals). A ticker outside the Signals universe (404) still gets
// the header, positions, technicals and charts.

interface SignalsTickerModalProps {
  symbol: string;
  /** Roll Signals: pre-select the best roll of this open short leg on open (the screen's roll badge, a Telegram link). */
  initialRollLegId?: string | null;
  /** Scrolls this position's card into view on open, forcing the Positions card open. */
  focusPositionId?: string | null;
  /** After an order fills or a position is closed/edited inside the modal, so pages showing positions can reload. */
  onPositionsChanged?: () => void;
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
const macdSignalBadgeClass: Record<MacdSignal, string> = { Bullish: "badge-change-pos", Bearish: "badge-change-neg", Neutral: "badge-change-flat" };
const noCreditRollNotice = "No credit roll to a lower-delta contract passes the Signals filters for that leg right now.";
const notInSignalsUniverseNotice = "Not in the Signals universe — not on the shortlist and no open short option. Signals scores appear once it's shortlisted.";
const candidateKey = (candidate: SignalCandidate) => signalContractKey({ expiry: candidate.expiry, strike: candidate.strike, right: candidateContractRight(candidate) });
const rollKey = (roll: RollSignalCandidate) => `${roll.legId}|${candidateKey(roll.replacement)}`;

function RollGradeBadge({ roll }: { roll: RollSignalCandidate }) {
  const ref = useTooltip<HTMLSpanElement>(netRollEdgeExplanation);
  return (
    <span ref={ref} className={`badge ${gradeBadgeClass[roll.grade]}`} style={badgeFontSize} tabIndex={0}>
      {gradeLabel[roll.grade]}
    </span>
  );
}

function RollFlagBadges({ roll, held }: { roll: RollSignalCandidate; held: HeldLegScore }) {
  if (roll.flags.length === 0) return null;
  return (
    <span className="d-inline-flex gap-1">
      {roll.flags.map((flag) => (
        <TooltipSpan key={flag} className="badge bg-warning-lt" style={badgeFontSize} text={describeRollSignalFlag(flag, held)}>
          {rollFlagLetter[flag]}
        </TooltipSpan>
      ))}
    </span>
  );
}

/**
 * "Your positions" (Roll Signals, mockup rev 4 approved 2026-09-24): one block per open short leg with
 * what holding it still offers and its ranked credit rolls; selecting a roll fills the order pane.
 */
const liveContractsSettleMs = 300;

function HeldLegRolls({ held, rolls, showAvoid, selectedRollKey, disabled, onSelect }: { held: HeldLegScore; rolls: RollSignalCandidate[]; showAvoid: boolean; selectedRollKey: string | null; disabled: boolean; onSelect: (roll: RollSignalCandidate) => void }) {
  const shown = showAvoid ? rolls : rolls.filter((roll) => roll.grade !== "avoid");
  const hiddenAvoid = rolls.length - shown.length;
  const heldKey = signalContractKey({ expiry: held.expiry, strike: held.strike, right: held.right });
  return (
    <div className="border rounded mb-2">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-2 py-1 border-bottom bg-secondary-lt" style={{ fontSize: "0.8rem" }} data-live-contracts={heldKey}>
        <span>
          Short <strong>{describeHeldLeg(held)}</strong> · {held.quantity} contract{held.quantity === 1 ? "" : "s"} · sold at {formatCurrency(held.entryPrice)}
        </span>
        {held.unscoredReason ? (
          <span className="text-secondary">Not scored: {heldLegUnscoredReasonLabel[held.unscoredReason]}</span>
        ) : (
          <span className="text-secondary">
            <span className="text-nowrap">
              Edge of holding <span className={`font-mono ${pnlTextClass(held.edge)}`}>{formatVolatilityPoints(held.edge)}</span>
            </span>{" "}
            · <span className="text-nowrap">
              friction to close <span className="font-mono">{formatVolatilityPoints(held.frictionVolatility).replace("+", "")}</span>
            </span>{" "}
            · <span className="text-nowrap">
              Δ <span className="font-mono">{held.delta === null ? "—" : held.delta.toFixed(2)}</span>
            </span>
            {held.flags.length > 0 && (
              <>
                {" "}
                · <RollFlagBadges roll={{ ...rolls[0]!, flags: held.flags } as RollSignalCandidate} held={held} />
              </>
            )}
          </span>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="text-secondary px-2 py-1" style={{ fontSize: "0.78rem" }}>
          {held.unscoredReason ? "" : hiddenAvoid > 0 ? `No roll with positive net roll Edge right now (${hiddenAvoid} Avoid hidden).` : "No credit roll to a lower-delta contract right now."}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover table-vcenter card-table mb-0" style={{ fontSize: "0.8rem" }}>
            <thead className="table-light">
              <tr>
                <th></th>
                <th>Roll to</th>
                <th className="text-center">Grade</th>
                <th className="text-end">Net Edge new</th>
                <th className="text-end">Net roll Edge</th>
                <th className="text-end">$</th>
                <th className="text-end">Net credit</th>
                <th className="text-end">Δ new</th>
                <th className="text-end">DTE</th>
                <th className="text-center">Flags</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((roll) => {
                const key = rollKey(roll);
                const isCall = roll.strategyKey === "covered_call";
                // A roll's price needs both legs: closing the held one and opening the replacement.
                const liveKeys = `${heldKey},${signalContractKey({ expiry: roll.replacement.expiry, strike: roll.replacement.strike, right: isCall ? "C" : "P" })}`;
                return (
                  <tr key={key} data-live-contracts={liveKeys} className={[selectedRollKey === key ? "table-active" : "", roll.grade === "avoid" ? "text-secondary" : ""].filter(Boolean).join(" ") || undefined} style={{ cursor: disabled ? undefined : "pointer" }} onClick={disabled ? undefined : () => onSelect(roll)}>
                    <td>
                      <input type="radio" className="form-check-input" checked={selectedRollKey === key} readOnly aria-label={`Select roll to ${describeHeldLeg({ right: isCall ? "C" : "P", strike: roll.replacement.strike, dte: roll.replacement.dte })}`} />
                    </td>
                    <td className="text-nowrap">
                      <strong>
                        {isCall ? "C" : "P"}
                        {formatCurrencyTrimmed(roll.replacement.strike).replace("$", "")}
                      </strong>{" "}
                      <span className="text-secondary">{formatDate(roll.replacement.expiry)}</span>
                    </td>
                    <td className="text-center">
                      <RollGradeBadge roll={roll} />
                    </td>
                    <td className="text-end">
                      <span className={`font-mono ${pnlTextClass(roll.replacement.netEdge)}`}>{formatVolatilityPoints(roll.replacement.netEdge)}</span>
                    </td>
                    <td className="text-end">
                      <FlashingNumber value={roll.netRollEdge} precision={3} className={`font-mono ${pnlTextClass(roll.netRollEdge)}`}>
                        {formatVolatilityPoints(roll.netRollEdge)}
                      </FlashingNumber>
                    </td>
                    <td className="text-end">
                      <FlashingNumber value={roll.netRollEdgeDollars} precision={0} className={`font-mono ${pnlTextClass(roll.netRollEdgeDollars)}`}>
                        {formatSignedPnl(roll.netRollEdgeDollars, 0)}
                      </FlashingNumber>
                    </td>
                    <td className="text-end font-mono">{formatCurrency(roll.netCreditPerShare)}</td>
                    <td className="text-end font-mono">{formatSignedDelta(roll.replacement.delta)}</td>
                    <td className="text-end font-mono">{roll.replacement.dte}</td>
                    <td className="text-center">
                      <RollFlagBadges roll={roll} held={held} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GradeBadge({ candidate }: { candidate: SignalCandidate }) {
  const ref = useTooltip<HTMLSpanElement>(gradeExplanation);
  return (
    <span ref={ref} className={`badge ${gradeBadgeClass[candidate.grade]}`} style={badgeFontSize} tabIndex={0}>
      {gradeLabel[candidate.grade]}
    </span>
  );
}

function FlagBadges({ candidate, macroEvents }: { candidate: SignalCandidate; macroEvents: MacroEvent[] }) {
  if (candidate.flags.length === 0) return null;
  return (
    <span className="d-inline-flex gap-1">
      {candidate.flags.map((flag) => (
        <TooltipSpan key={flag} className="badge bg-warning-lt" style={badgeFontSize} text={describeSignalFlag(flag, candidate, macroEvents)}>
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

function formatSignedDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
}

// SignalCandidate has no gamma/theta/last of its own (see OrderReviewQuoteSeed's
// own comment) -- mid IV is preferred over the surface fit since it's closer to
// what the live stream's own impliedVolatility will read once it arrives.
function signalCandidateToQuoteSeed(candidate: SignalCandidate | null): OrderReviewQuoteSeed | null {
  if (!candidate) return null;
  return {
    bid: candidate.bid,
    ask: candidate.ask,
    impliedVolatility: candidate.midImpliedVolatility ?? candidate.surfaceImpliedVolatility,
    delta: candidate.delta,
    theta: null,
    vega: candidate.vega,
  };
}

function signalContractScoreToQuoteSeed(contract: SignalContractScore | null): OrderReviewQuoteSeed | null {
  if (!contract) return null;
  if (contract.scored) return signalCandidateToQuoteSeed(contract);
  return { bid: contract.bid, ask: contract.ask, impliedVolatility: null, delta: contract.delta, theta: null, vega: null };
}

/** A chain contract picked outside the candidates list, scored on demand by GET /signals/:symbol/contract. */
interface ChainContractPick {
  key: string;
  contract: ChainContractRef;
  /** The chain cell it was picked from (null when picked from elsewhere, e.g. Recovery Path): filtered gets the amber notice. */
  originCellState: SignalsChainCellState | null;
  selectedAtIso: string;
  status: "loading" | "ready" | "error";
  result: SignalContractScore | null;
  error: string | null;
}

const chainPickNotice = (pick: ChainContractPick, reason: string) => (
  <div className={`signals-chain-notice ${pick.originCellState === "filtered" ? "iorio-note-amber" : "text-secondary"}`}>
    {reason}. Your order limits still apply.
  </div>
);

export function SignalsTickerModal({ symbol, initialRollLegId = null, focusPositionId = null, onPositionsChanged, onClose }: SignalsTickerModalProps) {
  const [signals, setSignals] = useState<TickerSignals | null>(null);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  // GET /signals/:symbol answers 404 for a ticker neither shortlisted nor carrying an open short option leg.
  const [notInSignalsUniverse, setNotInSignalsUniverse] = useState(false);
  const [signalsReloadKey, setSignalsReloadKey] = useState(0);
  const [uncompensatedAsOf, setUncompensatedAsOf] = useState<{ spotPrice: number; at: string } | null>(null);
  const [quotesFrame, setQuotesFrame] = useState<SignalsQuotesFrame | null>(null);
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);

  const [overview, setOverview] = useState<TickerOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  // The shared pooled live stock price (same line as every other screen); never the 9:30 capture's signals.spotPrice.
  const [liveSpotPrice, setLiveSpotPrice] = useState<number | null>(null);
  const [chartBars, setChartBars] = useState<PriceBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [technicals, setTechnicals] = useState<TickerTechnicals | null>(null);
  const [technicalsError, setTechnicalsError] = useState<string | null>(null);
  const [nextCalendarEvents, setNextCalendarEvents] = useState<NextTickerCalendarEvents | null>(null);

  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectionReference, setSelectionReference] = useState<{ netEdge: number; atIso: string } | null>(null);
  const [selectedRollKey, setSelectedRollKey] = useState<string | null>(null);
  const [rollSelectionReference, setRollSelectionReference] = useState<{ netRollEdge: number; atIso: string } | null>(null);
  const [pendingRollLegId, setPendingRollLegId] = useState<string | null>(initialRollLegId);
  // Bumped on a fill so the stream reloads its inputs (a rolled leg is a new open leg the running stream never saw).
  const [streamKey, setStreamKey] = useState(0);
  const [pendingOrder, setPendingOrder] = useState<{ order: OrderRequest; adaptivePriority: AdaptivePriority } | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>("all");
  const [dteFilter, setDteFilter] = useState<DteFilter>("all");
  const [showAvoid, setShowAvoid] = useState(false);
  const [rollNotice, setRollNotice] = useState<string | null>(null);

  const [chain, setChain] = useState<SignalsChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  // The chain's expiry until the user picks one: the best candidate's, captured once the first scores are in (undefined = not yet).
  const [chainDefaultExpiry, setChainDefaultExpiry] = useState<string | null | undefined>(undefined);
  const [chainPhoneSide, setChainPhoneSide] = useState<"C" | "P">("C");
  const [chainNotice, setChainNotice] = useState<string | null>(null);
  const [chainPick, setChainPick] = useState<ChainContractPick | null>(null);
  const chainPickRequestIdRef = useRef(0);
  const chainCardRef = useRef<HTMLDivElement | null>(null);
  const isPhoneLayout = useMediaQuery("(max-width: 991.98px)");

  const tickerPositions = useTickerPositions(symbol);
  const focusedPositionRef = useRef<HTMLDivElement | null>(null);
  // The Roll / Sell Call buttons sit on the position cards below the order setup: bring the result into view.
  const rollNoticeRef = useRef<HTMLDivElement | null>(null);
  const orderSetupRef = useRef<HTMLDivElement | null>(null);
  const scrollOrderSetupIntoView = useCallback((block: ScrollLogicalPosition = "nearest") => {
    requestAnimationFrame(() => orderSetupRef.current?.scrollIntoView({ behavior: "smooth", block }));
  }, []);
  const [positionsForceOpenSignal, setPositionsForceOpenSignal] = useState(0);

  // Informational modal, no action required — closable via ESC or backdrop click.
  // Closing with an order still under review cancels it (best effort).
  const requestClose = useCallback(() => {
    cancelUnconfirmedOrder(pendingOrder?.order);
    onClose();
  }, [onClose, pendingOrder]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

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
    setSignalsError(null);
    fetchTickerSignals(symbol)
      .then((result) => {
        if (cancelled) return;
        setNotInSignalsUniverse(false);
        setSignals((current) => current ?? result); // a live frame may already have arrived
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotInSignalsUniverse(true);
        else setSignalsError(err instanceof ApiError ? err.message : "Could not load the signals for this ticker.");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, signalsReloadKey]);

  useEffect(() => {
    let cancelled = false;
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

  // Header pricing (overview + the pooled spot line), chart and technicals.
  useEffect(() => {
    return openTickerDetailStream(
      symbol,
      (event) => {
        switch (event.type) {
          case "overview":
            setOverview(event.data);
            break;
          case "spot":
            setLiveSpotPrice(event.data.last);
            break;
          case "chart":
            setChartBars(event.data);
            break;
          case "technicals":
            setTechnicals(event.data);
            break;
          case "error":
            if (event.section === "overview") setOverviewError(event.message);
            else if (event.section === "chart") setChartError(event.message);
            else if (event.section === "technicals") setTechnicalsError(event.message);
            break;
          case "streamError":
            setOverviewError(event.message);
            break;
          default:
            break;
        }
      },
      { sections: ["overview", "spot", "chart", "technicals"] },
    );
  }, [symbol]);

  // Live re-scoring; re-opened when the user picks another expiry (the live quote set follows it).
  // Not opened for a ticker outside the Signals universe (it would only answer 404).
  useEffect(() => {
    setStreamFailed(false);
    if (notInSignalsUniverse) return;
    return openSignalsTickerStream(
      symbol,
      null,
      (frame) => {
        setSignals(frame.signals);
        setUncompensatedAsOf(frame.uncompensatedAsOf);
        setStreamFailed(false);
      },
      () => setStreamFailed(true),
    );
  }, [symbol, streamKey, notInSignalsUniverse]);

  // Live option quotes only for what is on screen (useVisibleLiveContracts): the set is
  // settled for 300 ms before the stream is reopened, so scrolling does not churn IBKR subscriptions.
  const visibleLiveContracts = useVisibleLiveContracts(modalContentRef);
  const [subscribedLiveContracts, setSubscribedLiveContracts] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setSubscribedLiveContracts(visibleLiveContracts), liveContractsSettleMs);
    return () => clearTimeout(timer);
  }, [visibleLiveContracts]);
  useEffect(() => {
    if (notInSignalsUniverse || subscribedLiveContracts.length === 0) {
      setQuotesFrame(null);
      return;
    }
    return openSignalsQuotesStream(symbol, subscribedLiveContracts, setQuotesFrame, () => setQuotesFrame(null));
  }, [symbol, subscribedLiveContracts, notInSignalsUniverse, streamKey]);

  const effectiveExpiry = selectedExpiry ?? chainDefaultExpiry ?? signals?.best?.expiry ?? null;
  // Displayed everywhere in the modal: the pooled live price, the overview's last before its first tick.
  const spotPrice = liveSpotPrice ?? overview?.pricing.last ?? null;
  // Read at request time only: the chain and a picked contract are scored at the spot of that moment, not re-fetched per tick.
  const spotPriceRef = useRef(spotPrice);
  spotPriceRef.current = spotPrice;

  const signalsSettled = signals !== null || signalsError !== null || notInSignalsUniverse;
  useEffect(() => {
    if (signalsSettled && chainDefaultExpiry === undefined) setChainDefaultExpiry(signals?.best?.expiry ?? null);
  }, [signalsSettled, chainDefaultExpiry, signals]);
  // Wait for a spot (or a settled overview) so the first chain is scored at the same spot as the live candidates.
  const chainSpotSettled = spotPrice !== null || overview !== null || overviewError !== null;
  const requestedChainExpiry = selectedExpiry ?? chainDefaultExpiry ?? null;
  const chainReady = chainDefaultExpiry !== undefined && chainSpotSettled;
  useEffect(() => {
    if (!chainReady) return;
    let cancelled = false;
    setChainLoading(true);
    setChainError(null);
    fetchSignalsChain(symbol, requestedChainExpiry, spotPriceRef.current)
      .then((result) => {
        if (!cancelled) setChain(result);
      })
      .catch((err) => {
        if (!cancelled) setChainError(err instanceof ApiError ? err.message : "Could not load the option chain.");
      })
      .finally(() => {
        if (!cancelled) setChainLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, requestedChainExpiry, chainReady, streamKey]);
  // Order building only: the scoring spot as a last resort so an order can still be sized before any price arrives.
  const spotPriceForOrders = spotPrice ?? signals?.spotPrice ?? null;
  const ivShift = effectiveExpiry ? (signals?.ivShiftByExpiry[effectiveExpiry] ?? null) : null;
  const ivShiftValue = !effectiveExpiry
    ? "—"
    : !ivShift || ivShift.quoteCount === 0
      ? "0.0vp (no fresh quotes)"
      : ivShift.quoteCount < 5
        ? `0.0vp (fewer than 5 fresh quotes: ${ivShift.quoteCount})`
        : `${formatVolatilityPoints(ivShift.shiftVolatilityPoints / 100)} from ${ivShift.quoteCount} quotes`;

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
  const selectedRoll = useMemo(() => (selectedRollKey ? (signals?.rolls.find((roll) => rollKey(roll) === selectedRollKey) ?? null) : null), [signals, selectedRollKey]);
  const selectedRollHeldLeg = useMemo(() => (selectedRoll ? (signals?.heldLegs.find((leg) => leg.legId === selectedRoll.legId) ?? null) : null), [signals, selectedRoll]);
  // The contract behind pendingOrder is whichever of these produced it --
  // selectedKey/selectedRollKey (and so selectedCandidate/selectedRoll) stay
  // set for the order's whole pending_confirmation lifetime (see
  // selectCandidate/selectRoll above), so this is still the right quote at
  // the instant OrderReviewPanel mounts. Seeds its Live Quote card instantly
  // instead of a multi-second spinner for a fresh subscribe.
  const pendingOrderQuoteSeed = selectedCandidate || selectedRoll ? signalCandidateToQuoteSeed(selectedCandidate ?? selectedRoll?.replacement ?? null) : signalContractScoreToQuoteSeed(chainPick?.result ?? null);
  // The ticker stream's candidates, with the on-screen ones replaced by their live-scored version (keeping the ticker
  // stream's Monte Carlo share, which only it computes). Order and filtering stay on the ticker stream's values so a
  // live re-grade never reshuffles the rows on screen (and with them the live set).
  const liveCandidatesByKey = useMemo(
    () =>
      new Map(
        (signals?.candidates ?? []).map((candidate) => {
          const key = candidateKey(candidate);
          const live = quotesFrame?.candidates[key];
          return [key, live ? { ...live, uncompensatedSharePercent: candidate.uncompensatedSharePercent } : candidate];
        }),
      ),
    [signals, quotesFrame],
  );
  const displayedHeldLegs = useMemo(() => (signals?.heldLegs ?? []).map((held) => quotesFrame?.heldLegs[held.legId] ?? held), [signals, quotesFrame]);
  const rollsByLegId = useMemo(() => {
    const byLeg = new Map<string, RollSignalCandidate[]>();
    for (const roll of signals?.rolls ?? []) {
      const live = quotesFrame?.rolls[rollKey(roll)];
      byLeg.set(roll.legId, [...(byLeg.get(roll.legId) ?? []), live ? { ...live, replacement: { ...live.replacement, uncompensatedSharePercent: roll.replacement.uncompensatedSharePercent } } : roll]);
    }
    return byLeg;
  }, [signals, quotesFrame]);

  function selectCandidate(candidate: SignalCandidate) {
    if (pendingOrder) return; // an order under review keeps its contract until cancelled or filled
    setChainPick(null);
    setChainNotice(null);
    setSelectedRollKey(null);
    setRollSelectionReference(null);
    setSelectedKey(candidateKey(candidate));
    setSelectionReference({ netEdge: candidate.netEdge, atIso: new Date().toISOString() });
    if (candidate.expiry !== effectiveExpiry) setSelectedExpiry(candidate.expiry);
  }
  const selectRoll = useCallback(
    (roll: RollSignalCandidate) => {
      if (pendingOrder) return;
      setChainPick(null);
      setSelectedKey(null);
      setSelectionReference(null);
      setSelectedRollKey(rollKey(roll));
      setRollSelectionReference({ netRollEdge: roll.netRollEdge, atIso: new Date().toISOString() });
    },
    [pendingOrder],
  );
  function clearSelection() {
    setPendingOrder(null);
    setChainPick(null);
    setSelectedKey(null);
    setSelectionReference(null);
    setSelectedRollKey(null);
    setRollSelectionReference(null);
  }
  // Any chain contract: a live candidate goes straight to the Signal form; anything else is scored on demand
  // (one pooled live quote when the market is open, so this can take a few seconds).
  function pickChainContract(contract: ChainContractRef, originCellState: SignalsChainCellState | null) {
    if (pendingOrder) return;
    setChainNotice(null);
    const key = signalContractKey(contract);
    const liveCandidate = liveCandidatesByKey.get(key);
    if (liveCandidate) {
      selectCandidate(liveCandidate);
      return;
    }
    setSelectedKey(null);
    setSelectionReference(null);
    setSelectedRollKey(null);
    setRollSelectionReference(null);
    if (contract.expiry !== chain?.selectedExpiry) setSelectedExpiry(contract.expiry);
    const requestId = ++chainPickRequestIdRef.current;
    setChainPick({ key, contract, originCellState, selectedAtIso: new Date().toISOString(), status: "loading", result: null, error: null });
    fetchSignalContractScore(symbol, contract, spotPriceRef.current)
      .then((result) => {
        if (requestId === chainPickRequestIdRef.current) setChainPick((current) => (current && current.key === key ? { ...current, status: "ready", result } : current));
      })
      .catch((err) => {
        if (requestId !== chainPickRequestIdRef.current) return;
        const message = err instanceof ApiError ? err.message : "Could not get a quote for this contract.";
        setChainPick((current) => (current && current.key === key ? { ...current, status: "error", error: message } : current));
      });
  }
  const scrollChainIntoView = useCallback(() => {
    requestAnimationFrame(() => chainCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  // A roll badge / Telegram link opens on a leg: pre-select its best roll once the scores are in.
  useEffect(() => {
    if (!pendingRollLegId || !signals) return;
    const best = signals.rolls.find((roll) => roll.legId === pendingRollLegId); // rolls arrive best-first
    if (best) selectRoll(best);
    else if (signals.heldLegs.some((leg) => leg.legId === pendingRollLegId)) setRollNotice(noCreditRollNotice);
    setPendingRollLegId(null);
  }, [pendingRollLegId, signals, selectRoll]);

  // Opened on a specific position: once positions and the Signals section above them have settled (so the
  // layout no longer shifts), force the Positions card open and scroll that position's card into view.
  const hasScrolledToFocusedPosition = useRef(false);
  const focusedPositionIsOpen = tickerPositions.positions?.some((position) => position.id === focusPositionId && position.status === "open") ?? false;
  useEffect(() => {
    if (hasScrolledToFocusedPosition.current || !focusPositionId || !focusedPositionIsOpen || !signalsSettled) return;
    setPositionsForceOpenSignal((signal) => signal + 1);
    // The card body (and so the ref) mounts a render after the force-open: poll a few frames for it.
    let animationFrameId = 0;
    let attempts = 0;
    function scrollWhenMounted() {
      if (focusedPositionRef.current) {
        hasScrolledToFocusedPosition.current = true;
        focusedPositionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 20) animationFrameId = requestAnimationFrame(scrollWhenMounted);
    }
    scrollWhenMounted();
    return () => cancelAnimationFrame(animationFrameId);
  }, [focusPositionId, focusedPositionIsOpen, signalsSettled]);

  useEffect(() => {
    if (rollNotice) rollNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rollNotice]);

  // A position card's Roll button: select that leg's best Signals roll (rolls arrive best-first).
  const rollLeg = useCallback(
    (legId: string) => {
      if (!signals) {
        setRollNotice(notInSignalsUniverse ? notInSignalsUniverseNotice : "Signals scores are still loading — try again in a moment.");
        return;
      }
      const best = signals.rolls.find((roll) => roll.legId === legId);
      if (best) {
        setRollNotice(null);
        selectRoll(best);
        scrollOrderSetupIntoView();
      } else setRollNotice(noCreditRollNotice);
    },
    [signals, notInSignalsUniverse, selectRoll, scrollOrderSetupIntoView],
  );

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
        headerTitle: "Surface IV at this strike vs this contract's own mid IV. Surface IV is coloured by how far it sits from mid: green within 2vp (grade is trustworthy), amber 2-5vp above mid, red beyond 5vp above mid (the live market has moved well below what was graded).",
        render: (row) => (
          <span className="font-mono text-nowrap">
            <span className={surfaceIvTrustClass(row.surfaceImpliedVolatility, row.midImpliedVolatility)}>{formatPercentage(row.surfaceImpliedVolatility, 1)}</span> / {formatPercentage(row.midImpliedVolatility, 1)}
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
          <TooltipSpan className={`font-mono ${row.quoteSource === "snapshot" ? "text-secondary" : ""}`} text={quoteSourceLabel[row.quoteSource]}>
            {formatPercentageValue(row.spreadPercent, 1)}
            {row.quoteSource === "snapshot" ? "*" : ""}
          </TooltipSpan>
        ),
      },
      {
        key: "quote",
        header: "Quote",
        headerTitle: "Where this row's bid/ask comes from: a live IBKR line (selected expiry), the Day Signals loop (age shown), or the 9:30 ET snapshot",
        render: (row) =>
          row.quoteSource === "live" ? (
            <TooltipSpan className="d-inline-flex align-items-center gap-2" text={quoteSourceLabel.live}>
              <span className="iorio-pulse-dot" />
              Live
            </TooltipSpan>
          ) : row.quoteSource === "day" ? (
            <TooltipSpan className="d-inline-flex align-items-center gap-2 font-mono" text={`${quoteSourceLabel.day}${row.quotedAt ? ` · received ${formatDateTime(row.quotedAt)}` : ""}`}>
              <span className="iorio-still-dot" />
              {quoteAgeCellLabel(row.quotedAt)}
            </TooltipSpan>
          ) : (
            <TooltipSpan className="font-mono text-secondary" text={signals?.snapshotCapturedAt ? `${formatDateTime(signals.snapshotCapturedAt)} snapshot quote — this contract is not in today's refresh pool` : quoteSourceLabel.snapshot}>
              Snapshot
            </TooltipSpan>
          ),
      },
      { key: "yield", header: "Ann. yield", align: "right", render: (row) => <span className={`font-mono heat-yield-${yieldTierByKey.get(candidateKey(row)) ?? 1}`}>{formatPercentage(row.annualizedYield, 0)}</span> },
      { key: "uncompensated", header: "Drift", align: "right", headerTitle: "Share of P&L variance from delta drift (UncompensatedShare)", render: (row) => <span className="font-mono text-secondary">{row.uncompensatedSharePercent === null ? "…" : `${row.uncompensatedSharePercent.toFixed(0)}%`}</span> },
      { key: "flags", header: "Flags", align: "center", render: (row) => <FlagBadges candidate={row} macroEvents={signals?.macroEvents ?? []} /> },
    ],
    [yieldTierByKey],
  );
  const opportunityRows = useMemo(() => shownCandidates.map((candidate, index) => ({ ...(liveCandidatesByKey.get(candidateKey(candidate)) ?? candidate), rank: index + 1 })), [shownCandidates, liveCandidatesByKey]);

  const dayQuoteAgeRange = describeQuoteAgeRange(signals?.dayQuotesAsOf);
  const liveLabel = notInSignalsUniverse
    ? liveSpotPrice !== null
      ? "Live stock price · not scored by Signals"
      : "Connecting live price…"
    : streamFailed
      ? "Live stream unavailable — snapshot values"
      : signals?.priceSource === "live"
        ? `Live · ${quotesFrame?.contractKeys.length ?? 0} contracts on screen live · ${dayQuoteAgeRange ? `the rest on day quotes ${dayQuoteAgeRange}` : "no day quotes yet"}`
        : "Connecting live prices…";
  const showLivePulse = notInSignalsUniverse ? liveSpotPrice !== null : signals?.priceSource === "live" && !streamFailed;

  const positionsCards = (
    <TickerPositionsCards
      symbol={symbol}
      data={tickerPositions}
      currentPrice={spotPrice}
      focusPositionId={focusPositionId ?? undefined}
      focusedPositionRef={focusedPositionRef}
      forceOpenSignal={positionsForceOpenSignal}
      onRollLeg={rollLeg}
      onPositionChanged={onPositionsChanged}
      onSellCall={(prefill) => {
        if (pendingOrder) {
          setRollNotice("Finish or cancel the order under review first.");
          return;
        }
        setRollNotice(null);
        setChainPhoneSide("C");
        // Recovery Path's Sell This: that exact contract, scored on demand when it is not a candidate.
        if (prefill) {
          const contract: ChainContractRef = { expiry: prefill.expiry, strike: prefill.strike, right: "C" };
          const originCell = chain?.selectedExpiry === prefill.expiry ? chain.strikes.find((row) => row.strike === prefill.strike)?.call : undefined;
          pickChainContract(contract, originCell?.state ?? null);
          scrollOrderSetupIntoView();
          return;
        }
        // Sell Call on held shares: the best covered call graded above Avoid, else the chain on its Calls side.
        const bestCall = rankedCandidates.find((candidate) => candidate.strategyKey === "covered_call" && candidate.grade !== "avoid");
        if (bestCall) {
          selectCandidate(bestCall);
          setChainNotice(null);
        } else setChainNotice("Pick a call from the chain.");
        scrollChainIntoView();
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
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-inset">
          <div className="modal-content">
            <div className="modal-header flex-wrap">
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.68rem", letterSpacing: "0.06em" }}>
                  Signals
                </div>
                <h5 className="modal-title">
                  {symbol}
                  {(signals?.companyName ?? overview?.companyName) && <span className="text-secondary fw-normal"> — {signals?.companyName ?? overview?.companyName}</span>}
                </h5>
              </div>
              <div className="signals-modal-live-status d-inline-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.75rem" }}>
                {showLivePulse && <span className="iorio-pulse-dot" />}
                {liveLabel}
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={requestClose} />
            </div>
            <div className="modal-body" ref={modalContentRef}>
              {overviewError && <div className="alert alert-danger">{overviewError}</div>}
              {!overviewError && !overview && (
                <div className="d-flex justify-content-center py-3">
                  <Spinner label="Loading pricing" />
                </div>
              )}
              {overview && (
                <TickerHeaderStrip
                  symbol={symbol}
                  overview={overview}
                  spotPrice={spotPrice}
                  nextCalendarEvents={nextCalendarEvents}
                  onShortlisted={() => {
                    setOverview((prev) => (prev ? { ...prev, isShortlisted: true } : prev));
                    if (notInSignalsUniverse) setSignalsReloadKey((key) => key + 1);
                  }}
                />
              )}

              {signalsError && <div className="alert alert-danger">{signalsError}</div>}
              {notInSignalsUniverse && (
                <div className="alert alert-secondary py-2" style={{ fontSize: "0.85rem" }}>
                  {notInSignalsUniverseNotice}
                </div>
              )}
              {!signals && !signalsError && !notInSignalsUniverse && (
                <div className="d-flex justify-content-center py-3">
                  <Spinner label="Loading signals" />
                </div>
              )}
              {signals && (
                <div className="d-flex flex-wrap align-items-center gap-3 mb-3" style={{ fontSize: "0.8rem" }}>
                  <SignalMetric label="ATM IV (30d)" value={formatPercentage(signals.atmImpliedVolatility, 1)} />
                  <SignalMetric label={`Forecast RV (${signals.forecast?.windowDays ?? 63}d)`} value={formatPercentage(signals.forecast?.volatility, 1)} />
                  <SignalMetric
                    label="IV − forecast"
                    value={signals.atmImpliedVolatility !== null && signals.forecast ? formatVolatilityPoints(signals.atmImpliedVolatility - signals.forecast.volatility) : "—"}
                    valueClassName={signals.atmImpliedVolatility !== null && signals.forecast ? pnlTextClass(signals.atmImpliedVolatility - signals.forecast.volatility) : ""}
                  />
                  <SignalMetric label={`Intraday IV shift${effectiveExpiry ? ` (${formatDate(effectiveExpiry)})` : ""}`} value={ivShiftValue} />
                  <SignalMetric label="Momentum 12-1" value={signals.momentum === null ? "n/a" : formatSignedPercentageValue(signals.momentum * 100, 0)} />
                  <SignalMetric label="Skew (30d)" value={signals.skew ? formatVolatilityPoints(signals.skew.skew) : "—"} />
                  <SignalMetric label="Vol flag" value={signals.elevatedVolatility ? `${signals.elevatedVolatility.elevated ? "Elevated" : "Normal"} (${signals.elevatedVolatility.ratio.toFixed(2)} vs ${signals.elevatedVolatility.threshold.toFixed(2)})` : "n/a"} />
                  <SignalMetric label="Shares free" value={formatNumber(signals.freeShares, 0)} />
                  <SignalMetric label="Cash free" value={formatCurrency(signals.freeCash, 0)} />
                  <span className="ms-auto">
                    <ModelCaveatBadge symbol={symbol} caveats={signals.caveats} />
                  </span>
                </div>
              )}

              {rollNotice && (
                <div ref={rollNoticeRef} className="alert alert-info py-2" style={{ fontSize: "0.85rem" }}>
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
                </>
              )}

              {(signals || notInSignalsUniverse) && (
                <div className="d-flex flex-column flex-lg-row gap-3">
                  <div style={{ minWidth: 0, flex: "1 1 68%" }}>
                    {signals && !signals.unscoredReason && signals.heldLegs.length > 0 && (
                      <div className="card mb-3">
                        <div className="card-header py-2 d-flex flex-wrap align-items-center gap-2">
                          <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                            Your positions
                          </span>
                          <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
                            credit rolls to a lower-delta contract, graded on net roll Edge; click a roll to set up the order
                          </span>
                        </div>
                        <div className="card-body py-2">
                          {displayedHeldLegs.map((held) => (
                            <HeldLegRolls key={held.legId} held={held} rolls={rollsByLegId.get(held.legId) ?? []} showAvoid={showAvoid} selectedRollKey={selectedRollKey} disabled={pendingOrder !== null} onSelect={selectRoll} />
                          ))}
                        </div>
                      </div>
                    )}
                    {signals && !signals.unscoredReason && (
                      <DataTable
                        tableId="signals-opportunities"
                        dense
                        maxVisibleRows={10}
                        columns={opportunityColumns}
                        rows={opportunityRows}
                        rowKey={(row) => candidateKey(row)}
                        rowAttributes={(row) => ({ "data-live-contracts": candidateKey(row) })}
                        emptyMessage={hiddenAvoidCount > 0 ? `No candidate has positive net Edge right now. Tick "Show Avoid" to see the ${hiddenAvoidCount} hidden.` : signals.noCandidatesReason ? describeNoCandidatesMessage(signals.noCandidatesReason) : "No candidates match the filters."}
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
                            <span className="text-secondary ms-auto">
                              {uncompensatedAsOf && <>Delta drift as of {formatCurrency(uncompensatedAsOf.spotPrice)} · </>}
                              quotes: <span className="font-mono">{signals.quoteSourceCounts.live} live</span> · <span className="font-mono">{signals.quoteSourceCounts.day} day</span> · <span className="font-mono">{signals.quoteSourceCounts.snapshot} snapshot</span>
                            </span>
                          </div>
                        }
                        afterTable={
                          <div className="card-footer text-secondary" style={{ fontSize: "0.75rem" }}>
                            * quote from the 9:30 ET snapshot. Live quotes stream only for the contracts on screen; every other pooled contract shows the Day Signals loop's latest quote with its age.
                          </div>
                        }
                      />
                    )}

                    <div ref={chainCardRef} style={{ scrollMarginTop: "1rem" }}>
                      {chainNotice && (
                        <div className="alert alert-info py-2 mt-3 mb-0" style={{ fontSize: "0.85rem" }}>
                          {chainNotice}
                        </div>
                      )}
                      <SignalsOptionChainCard
                        chain={chain}
                        loading={chainLoading || (!chain && !chainError)}
                        error={chainError}
                        spotPrice={spotPrice}
                        liveCandidatesByKey={liveCandidatesByKey}
                        liveChainCells={quotesFrame?.cells ?? {}}
                        selectedContractKey={selectedKey ?? chainPick?.key ?? null}
                        pickingDisabled={pendingOrder !== null}
                        phoneSide={chainPhoneSide}
                        onPhoneSideChange={setChainPhoneSide}
                        onSelectExpiry={(expiry) => {
                          if (expiry !== chain?.selectedExpiry) setSelectedExpiry(expiry);
                        }}
                        onPickContract={(contract, cell) => {
                          pickChainContract(contract, cell.state);
                          // On a phone the order pane sits below the chain: bring its top into view.
                          if (isPhoneLayout) scrollOrderSetupIntoView("start");
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ flex: "1 1 32%", minWidth: "19rem" }}>
                    <div ref={orderSetupRef} className="card">
                      <div className="card-body">
                        {pendingOrder ? (
                          <OrderReviewPanel
                            order={pendingOrder.order}
                            onOrderChange={(order) => setPendingOrder((current) => (current ? { ...current, order } : current))}
                            initialAdaptivePriority={pendingOrder.adaptivePriority}
                            liveSpotPrice={spotPriceForOrders}
                            initialQuote={pendingOrderQuoteSeed}
                            onCancelled={clearSelection}
                            onFilled={() => {
                              clearSelection();
                              void tickerPositions.loadPositions();
                              setStreamKey((key) => key + 1);
                              onPositionsChanged?.();
                            }}
                          />
                        ) : signals && selectedRoll && selectedRollHeldLeg && rollSelectionReference ? (
                          <RollSignalOrderSetupForm
                            symbol={symbol}
                            signals={signals}
                            roll={selectedRoll}
                            held={selectedRollHeldLeg}
                            spotPrice={spotPriceForOrders}
                            netRollEdgeAtSelection={rollSelectionReference.netRollEdge}
                            selectedAtIso={rollSelectionReference.atIso}
                            onCancel={clearSelection}
                            onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                          />
                        ) : signals && selectedCandidate && selectionReference ? (
                          <SignalOrderSetupForm
                            symbol={symbol}
                            signals={signals}
                            candidate={selectedCandidate}
                            spotPrice={spotPriceForOrders}
                            netEdgeAtSelection={selectionReference.netEdge}
                            selectedAtIso={selectionReference.atIso}
                            onCancel={clearSelection}
                            onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                          />
                        ) : chainPick ? (
                          chainPick.status === "loading" ? (
                            <div className="d-flex align-items-center gap-2 text-secondary py-3" style={{ fontSize: "0.85rem" }}>
                              <Spinner size="sm" />
                              Getting a live quote…
                            </div>
                          ) : chainPick.status === "error" || !chainPick.result ? (
                            <div className="d-flex flex-column gap-2">
                              <div className="alert alert-danger mb-0">{chainPick.error ?? "Could not get a quote for this contract."}</div>
                              <div>
                                <button type="button" className="btn btn-outline-secondary" onClick={clearSelection}>
                                  Close
                                </button>
                              </div>
                            </div>
                          ) : chainPick.result.scored && signals ? (
                            <SignalOrderSetupForm
                              key={chainPick.key}
                              symbol={symbol}
                              signals={signals}
                              candidate={chainPick.result}
                              spotPrice={spotPriceForOrders}
                              netEdgeAtSelection={chainPick.result.netEdge}
                              selectedAtIso={chainPick.selectedAtIso}
                              notice={chainPick.result.notCandidateReason ? chainPickNotice(chainPick, chainPick.result.notCandidateReason) : null}
                              onCancel={clearSelection}
                              onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                            />
                          ) : (
                            <ChainContractOrderSetupForm
                              key={chainPick.key}
                              symbol={symbol}
                              contract={chainPick.result}
                              freeShares={signals?.freeShares ?? null}
                              spotPrice={spotPriceForOrders}
                              notice={chainPick.result.notCandidateReason ? chainPickNotice(chainPick, chainPick.result.notCandidateReason) : null}
                              onCancel={clearSelection}
                              onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                            />
                          )
                        ) : (
                          <>
                            <div className="text-secondary text-uppercase fw-bold mb-2" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                              Order setup
                            </div>
                            <p className="text-secondary mb-0" style={{ fontSize: "0.85rem" }}>
                              {signals && !signals.unscoredReason ? `Select an opportunity, any contract in the chain${signals.heldLegs.length > 0 ? " or a roll of one of your positions" : ""}.` : "Pick any contract in the chain."}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4">{positionsCards}</div>

              <TechnicalsCard technicals={technicals} technicalsError={technicalsError} />

              <div className="mt-3">
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

function TechnicalsCard({ technicals, technicalsError }: { technicals: TickerTechnicals | null; technicalsError: string | null }) {
  const { support, resistance } = technicals?.supportResistance ?? { support: null, resistance: null };
  return (
    <CollapsibleCard title="Technicals" storageKey="signals-modal-technicals">
      {technicalsError && <div className="alert alert-danger mb-0">{technicalsError}</div>}
      {!technicalsError && !technicals && (
        <div className="d-flex justify-content-center py-3">
          <Spinner size="sm" label="Loading technicals" />
        </div>
      )}
      {technicals && (
        <div className="d-flex flex-column gap-1">
          <div className="d-flex flex-wrap align-items-center gap-3 font-mono" style={{ fontSize: "0.85rem" }}>
            <span>
              MA7 <strong>{formatCurrency(technicals.movingAverages.ma7)}</strong>
            </span>
            <span>
              MA25 <strong>{formatCurrency(technicals.movingAverages.ma25)}</strong>
            </span>
            <span>
              MA99 <strong>{formatCurrency(technicals.movingAverages.ma99)}</strong>
            </span>
            <span>
              RSI <strong>{formatNumber(technicals.rsi, 2)}</strong>
            </span>
            <span className="d-inline-flex align-items-center gap-1">
              MACD <span className={`badge ${macdSignalBadgeClass[technicals.macdSignal]}`} style={badgeFontSize}>{technicals.macdSignal}</span>
            </span>
          </div>
          <div className="d-flex flex-wrap gap-3 text-secondary font-mono" style={{ fontSize: "0.8rem" }}>
            {support ? (
              <span>
                {describeSupportResistanceLevel("support", support).label} <strong className="text-body">{formatCurrency(support.price)}</strong> ({describeSupportResistanceLevel("support", support).detail})
              </span>
            ) : (
              <span>Support —</span>
            )}
            {resistance ? (
              <span>
                {describeSupportResistanceLevel("resistance", resistance).label} <strong className="text-body">{formatCurrency(resistance.price)}</strong> ({describeSupportResistanceLevel("resistance", resistance).detail})
              </span>
            ) : (
              <span>Resistance —</span>
            )}
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}

function SignalMetric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <span className="d-inline-flex flex-column">
      <span className="text-secondary" style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span className={`font-mono fw-semibold ${valueClassName ?? ""}`}>{value}</span>
    </span>
  );
}
