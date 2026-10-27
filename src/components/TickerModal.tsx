import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchNextTickerCalendarEvents, type NextTickerCalendarEvents } from "../api/calendarEvents";
import { ApiError } from "../api/client";
import { cancelUnconfirmedOrder, type AdaptivePriority, type OrderRequest } from "../api/positions";
import { openTickerDetailStream, type MacdSignal, type PriceBar, type TickerOverview, type TickerTechnicals } from "../api/tickerDetail";
import { fetchTickerOptionChain, fetchTickerTradingContext, openOptionQuotesStream, optionContractKey, type LiveContractQuote, type OpenShortLeg, type OptionQuotesFrame, type TickerOptionChain, type TickerTradingContext } from "../api/tickerTrading";
import { fetchTickerVolatility, type VolatilityRow } from "../api/volatility";
import { useIsAdmin } from "../hooks/useAuth";
import { describeFrozenTicker, useFrozenTickers } from "../hooks/useFrozenTickers";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePlutoEnabledSymbols } from "../hooks/usePlutoEnabledSymbols";
import { useTickerPositions } from "../hooks/useTickerPositions";
import { useVisibleLiveContracts } from "../hooks/useVisibleLiveContracts";
import { plutoTickerOpenOrRollRefusal } from "../lib/accessLevelPresentation";
import { formatCurrency, formatDate, formatNumber, formatOptionContractLabel, formatPercentage, formatPercentageValue, formatVolatilityPoints, daysToExpiry, pluralize, pnlTextClass } from "../lib/formatters";
import { describeSupportResistanceLevel } from "../lib/tickerTechnicalsPresentation";
import { IvHistoryChart } from "./charts/IvHistoryChart";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { CollapsibleCard } from "./CollapsibleCard";
import { OrderReviewPanel, type OrderReviewQuoteSeed } from "./OrderReviewPanel";
import { Spinner } from "./Spinner";
import { TickerHeaderStrip } from "./TickerHeaderStrip";
import { TickerPositionsCards } from "./TickerPositionsCards";
import { OptionChainCard, type ChainContractRef } from "./ticker/OptionChainCard";
import { OpenOrderSetupForm } from "./ticker/OpenOrderSetupForm";
import { RollOrderSetupForm } from "./ticker/RollOrderSetupForm";

// The Ticker modal (2026-10-27, the Signals modal without Signals): the one ticker modal, opened from every ticker link
// (mounted once by TickerModalProvider). Header strip, the ticker's volatility figures, the full option chain of one
// expiry with live quotes for the contracts on screen (any out-of-the-money call or put can be picked), the order
// setup (a new covered call or cash-secured put, or a roll of a held short leg picked on the chain), the Positions and
// Wheel-cycle cards, technicals and the charts.

interface TickerModalProps {
  symbol: string;
  /** Opens in roll mode on this open short leg (a position card's Roll link, an assignment-risk alert). */
  initialRollLegId?: string | null;
  /** Scrolls this position's card into view on open, forcing the Positions card open. */
  focusPositionId?: string | null;
  /** After an order fills or a position is closed/edited inside the modal, so pages showing positions can reload. */
  onPositionsChanged?: () => void;
  onClose: () => void;
}

const badgeFontSize = { fontSize: "0.72rem" } as const;
const macdSignalBadgeClass: Record<MacdSignal, string> = { Bullish: "badge-change-pos", Bearish: "badge-change-neg", Neutral: "badge-change-flat" };
const liveContractsSettleMs = 300;

function quoteSeedOf(quote: LiveContractQuote | null): OrderReviewQuoteSeed | null {
  return quote ? { bid: quote.bid, ask: quote.ask, impliedVolatility: quote.impliedVolatility, delta: quote.delta, theta: null, vega: null } : null;
}

function describeHeldLeg(leg: OpenShortLeg): string {
  return formatOptionContractLabel({ strike: leg.strike, right: leg.right, expiry: leg.expiry, dte: daysToExpiry(leg.expiry) });
}

export function TickerModal({ symbol, initialRollLegId = null, focusPositionId = null, onPositionsChanged, onClose }: TickerModalProps) {
  const plutoEnabledSymbols = usePlutoEnabledSymbols();
  // A trader may not open or roll on a ticker Pluto trades (the API refuses it): every order form shows it as a blocking reason.
  const isAdmin = useIsAdmin();
  const accessLevelRefusal = plutoTickerOpenOrRollRefusal(symbol, { isAdmin, plutoTradesSymbol: plutoEnabledSymbols.has(symbol) });
  // A frozen ticker (a stock split until its records are rewritten) takes no orders: the order panel says why instead.
  const frozenTicker = useFrozenTickers().get(symbol);
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const isPhoneLayout = useMediaQuery("(max-width: 991.98px)");

  const [overview, setOverview] = useState<TickerOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [liveSpotPrice, setLiveSpotPrice] = useState<number | null>(null);
  const [chartBars, setChartBars] = useState<PriceBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [technicals, setTechnicals] = useState<TickerTechnicals | null>(null);
  const [technicalsError, setTechnicalsError] = useState<string | null>(null);
  const [nextCalendarEvents, setNextCalendarEvents] = useState<NextTickerCalendarEvents | null>(null);
  const [tradingContext, setTradingContext] = useState<TickerTradingContext | null>(null);
  const [tradingContextError, setTradingContextError] = useState<string | null>(null);
  const [volatility, setVolatility] = useState<VolatilityRow | null>(null);
  // Bumped on a fill so the trading context (free shares/cash, held legs) reloads.
  const [contextReloadKey, setContextReloadKey] = useState(0);

  const [chain, setChain] = useState<TickerOptionChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [chainPhoneSide, setChainPhoneSide] = useState<"C" | "P">("C");
  const [chainNotice, setChainNotice] = useState<string | null>(null);
  const [quotesFrame, setQuotesFrame] = useState<OptionQuotesFrame | null>(null);

  // The contract picked on the chain, and the held leg being rolled (roll mode: a chain click picks its replacement).
  const [pick, setPick] = useState<ChainContractRef | null>(null);
  const [rollModeLegId, setRollModeLegId] = useState<string | null>(initialRollLegId);
  const [pendingOrder, setPendingOrder] = useState<{ order: OrderRequest; adaptivePriority: AdaptivePriority } | null>(null);
  const [rollNotice, setRollNotice] = useState<string | null>(null);

  const tickerPositions = useTickerPositions(symbol);
  const focusedPositionRef = useRef<HTMLDivElement | null>(null);
  const rollNoticeRef = useRef<HTMLDivElement | null>(null);
  const orderSetupRef = useRef<HTMLDivElement | null>(null);
  const chainCardRef = useRef<HTMLDivElement | null>(null);
  const [positionsForceOpenSignal, setPositionsForceOpenSignal] = useState(0);
  const scrollOrderSetupIntoView = useCallback((block: ScrollLogicalPosition = "nearest") => {
    requestAnimationFrame(() => orderSetupRef.current?.scrollIntoView({ behavior: "smooth", block }));
  }, []);
  const scrollChainIntoView = useCallback(() => {
    requestAnimationFrame(() => chainCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  // Informational modal, no action required — closable via ESC or backdrop click. Closing with an order still under review cancels it (best effort).
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
    fetchNextTickerCalendarEvents(symbol)
      .then((result) => !cancelled && setNextCalendarEvents(result))
      .catch(() => !cancelled && setNextCalendarEvents({ nextEarningsDate: null, nextExDividendDate: null }));
    fetchTickerVolatility(symbol)
      .then((result) => !cancelled && setVolatility(result))
      .catch(() => !cancelled && setVolatility(null));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setTradingContextError(null);
    fetchTickerTradingContext(symbol)
      .then((result) => !cancelled && setTradingContext(result))
      .catch((err) => !cancelled && setTradingContextError(err instanceof ApiError ? err.message : "Could not load this ticker's trading details."));
    return () => {
      cancelled = true;
    };
  }, [symbol, contextReloadKey]);

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

  useEffect(() => {
    let cancelled = false;
    setChainLoading(true);
    setChainError(null);
    fetchTickerOptionChain(symbol, selectedExpiry)
      .then((result) => !cancelled && setChain(result))
      .catch((err) => !cancelled && setChainError(err instanceof ApiError ? err.message : "Could not load the option chain."))
      .finally(() => !cancelled && setChainLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, selectedExpiry]);

  const spotPrice = liveSpotPrice ?? quotesFrame?.spotPrice ?? overview?.pricing.last ?? chain?.spotPrice ?? null;
  const heldLegs = useMemo(() => tradingContext?.heldLegs ?? [], [tradingContext]);
  const rollModeLeg = rollModeLegId ? (heldLegs.find((leg) => leg.legId === rollModeLegId) ?? null) : null;

  // Live option quotes only for what is on screen (settled 300 ms so scrolling does not churn IBKR subscriptions),
  // plus the contracts an order under setup depends on: the pick and, for a roll, the held leg.
  const visibleLiveContracts = useVisibleLiveContracts(modalContentRef);
  const [subscribedLiveContracts, setSubscribedLiveContracts] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setSubscribedLiveContracts(visibleLiveContracts), liveContractsSettleMs);
    return () => clearTimeout(timer);
  }, [visibleLiveContracts]);
  const pickKey = pick ? optionContractKey(pick) : null;
  const heldLegKey = rollModeLeg ? optionContractKey(rollModeLeg) : null;
  const streamedContractsJoined = useMemo(() => [...new Set([...(pickKey ? [pickKey] : []), ...(heldLegKey ? [heldLegKey] : []), ...subscribedLiveContracts])].join(","), [pickKey, heldLegKey, subscribedLiveContracts]);
  useEffect(() => {
    const keys = streamedContractsJoined ? streamedContractsJoined.split(",") : [];
    if (keys.length === 0) {
      setQuotesFrame(null);
      return;
    }
    return openOptionQuotesStream(symbol, keys, setQuotesFrame, () => setQuotesFrame(null));
  }, [symbol, streamedContractsJoined]);
  const liveQuotes = quotesFrame?.quotes ?? {};

  function clearSelection() {
    setPendingOrder(null);
    setPick(null);
    setRollModeLegId(null);
    setChainNotice(null);
  }

  function pickChainContract(contract: ChainContractRef, forceNewTrade = false) {
    if (pendingOrder) return;
    setChainNotice(null);
    const rollTarget = forceNewTrade ? null : rollModeLeg;
    if (rollTarget) {
      const heldRightWord = rollTarget.right === "C" ? "call" : "put";
      if (contract.right !== rollTarget.right) {
        setChainNotice(`Rolling your ${heldRightWord}: pick a ${heldRightWord} on the chain, or cancel the roll to open a new trade.`);
        return;
      }
      if (contract.expiry === rollTarget.expiry && contract.strike === rollTarget.strike) {
        setChainNotice("That is the leg you already hold: pick a different strike or expiry to roll to.");
        return;
      }
    } else if (forceNewTrade) setRollModeLegId(null);
    if (contract.expiry !== chain?.selectedExpiry) setSelectedExpiry(contract.expiry);
    setPick(contract);
  }

  // A position card's Roll button: roll mode on that leg, and the chain on its side.
  const rollLeg = useCallback(
    (legId: string) => {
      if (pendingOrder) {
        setRollNotice("Finish or cancel the order under review first.");
        return;
      }
      const leg = heldLegs.find((entry) => entry.legId === legId);
      if (!leg) {
        setRollNotice(tradingContext ? "That leg is no longer open." : "This ticker's positions are still loading — try again in a moment.");
        return;
      }
      setRollNotice(null);
      setPick(null);
      setRollModeLegId(legId);
      setChainPhoneSide(leg.right);
      if (leg.expiry !== chain?.selectedExpiry && chain?.expiries.some((expiry) => expiry.expiry === leg.expiry)) setSelectedExpiry(leg.expiry);
      scrollChainIntoView();
    },
    [pendingOrder, heldLegs, tradingContext, chain, scrollChainIntoView],
  );

  // Opened on a leg (initialRollLegId): show its side of the chain once the legs are in.
  const appliedInitialRoll = useRef(false);
  useEffect(() => {
    if (appliedInitialRoll.current || !initialRollLegId || !tradingContext) return;
    appliedInitialRoll.current = true;
    const leg = tradingContext.heldLegs.find((entry) => entry.legId === initialRollLegId);
    if (leg) setChainPhoneSide(leg.right);
    else setRollModeLegId(null);
  }, [initialRollLegId, tradingContext]);

  // Opened on a specific position: force the Positions card open and scroll that position's card into view.
  const hasScrolledToFocusedPosition = useRef(false);
  const focusedPositionIsOpen = tickerPositions.positions?.some((position) => position.id === focusPositionId && position.status === "open") ?? false;
  useEffect(() => {
    if (hasScrolledToFocusedPosition.current || !focusPositionId || !focusedPositionIsOpen) return;
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
  }, [focusPositionId, focusedPositionIsOpen]);

  useEffect(() => {
    if (rollNotice) rollNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rollNotice]);

  const pickDte = pick ? (chain?.expiries.find((expiry) => expiry.expiry === pick.expiry)?.dte ?? daysToExpiry(pick.expiry)) : null;
  const pickQuote = pickKey ? (liveQuotes[pickKey] ?? null) : null;
  const heldQuote = heldLegKey ? (liveQuotes[heldLegKey] ?? null) : null;
  const earningsBeforePickExpiry = pick && tradingContext?.nextEarningsDateIso && tradingContext.nextEarningsDateIso <= pick.expiry ? tradingContext.nextEarningsDateIso : null;
  const earningsNotice = earningsBeforePickExpiry ? (
    <div className="iorio-note-amber" style={{ fontSize: "0.85rem" }}>
      {symbol} reports earnings on {formatDate(earningsBeforePickExpiry)}, before this contract expires: its premium includes the earnings move.
    </div>
  ) : null;

  const ivMinusForecast = volatility?.atmImpliedVolatility != null && volatility.forecast21 !== null ? volatility.atmImpliedVolatility - volatility.forecast21 : null;

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
        // Recovery Path's Sell This: that exact contract.
        if (prefill) {
          pickChainContract({ expiry: prefill.expiry, strike: prefill.strike, right: "C" }, true);
          scrollOrderSetupIntoView();
          return;
        }
        setRollModeLegId(null);
        setPick(null);
        setChainNotice("Pick a call from the chain.");
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
                  Ticker
                </div>
                <h5 className="modal-title">
                  {symbol}
                  {(tradingContext?.companyName ?? overview?.companyName) && <span className="text-secondary fw-normal"> — {tradingContext?.companyName ?? overview?.companyName}</span>}
                </h5>
              </div>
              <div className="ticker-modal-live-status d-inline-flex align-items-center gap-2 text-secondary" style={{ fontSize: "0.75rem" }}>
                {liveSpotPrice !== null && <span className="iorio-pulse-dot" />}
                {liveSpotPrice !== null ? `Live · quoting ${pluralize(Object.keys(liveQuotes).length, "contract")} on screen` : "Connecting live price…"}
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
                  plutoManaged={plutoEnabledSymbols.has(symbol)}
                  onShortlisted={() => {
                    setOverview((prev) => (prev ? { ...prev, isShortlisted: true } : prev));
                    fetchTickerVolatility(symbol)
                      .then(setVolatility)
                      .catch(() => setVolatility(null));
                  }}
                />
              )}

              {tradingContextError && <div className="alert alert-danger">{tradingContextError}</div>}
              <div className="d-flex flex-wrap align-items-center gap-3 mb-3" style={{ fontSize: "0.8rem" }}>
                <TickerMetric label={`ATM IV${volatility?.atmImpliedVolatilitySource === "close" ? " (last close)" : ""}`} value={formatPercentage(volatility?.atmImpliedVolatility ?? null, 1)} />
                <TickerMetric label="FV 21d" value={formatPercentage(volatility?.forecast21 ?? null, 1)} />
                <TickerMetric label="FV 63d" value={formatPercentage(volatility?.forecast63 ?? null, 1)} />
                <TickerMetric label="IV − FV 21d" value={ivMinusForecast === null ? "—" : formatVolatilityPoints(ivMinusForecast)} valueClassName={pnlTextClass(ivMinusForecast)} />
                <TickerMetric label="IV Rank" value={volatility?.ivRank == null ? "—" : formatNumber(volatility.ivRank, 0)} />
                <TickerMetric label="IV %ile" value={volatility?.ivPercentile == null ? "—" : formatPercentageValue(volatility.ivPercentile, 0)} />
                <TickerMetric label="Shares free" value={tradingContext ? formatNumber(tradingContext.freeShares, 0) : "—"} />
                <TickerMetric label="Cash free" value={tradingContext?.freeCash == null ? "—" : formatCurrency(tradingContext.freeCash, 0)} />
              </div>

              {rollNotice && (
                <div ref={rollNoticeRef} className="alert alert-info py-2" style={{ fontSize: "0.85rem" }}>
                  {rollNotice}
                </div>
              )}

              <div className="d-flex flex-column flex-lg-row gap-3">
                <div style={{ minWidth: 0, flex: "1 1 68%" }}>
                  <div ref={chainCardRef} style={{ scrollMarginTop: "1rem" }}>
                    {rollModeLeg && (
                      <div className="alert bg-primary text-white border-0 py-2 mb-0 d-flex flex-wrap align-items-center gap-2" style={{ fontSize: "0.9rem" }}>
                        <span className="fw-semibold">
                          Rolling your {describeHeldLeg(rollModeLeg)}: click any {rollModeLeg.right === "C" ? "call" : "put"} on the chain to roll to it.
                        </span>
                        <button type="button" className="btn btn-light ms-auto" disabled={pendingOrder !== null} onClick={clearSelection}>
                          Cancel roll
                        </button>
                      </div>
                    )}
                    {chainNotice && (
                      <div className="alert alert-info py-2 mt-3 mb-0" style={{ fontSize: "0.85rem" }}>
                        {chainNotice}
                      </div>
                    )}
                    <OptionChainCard
                      chain={chain}
                      loading={chainLoading || (!chain && !chainError)}
                      error={chainError}
                      spotPrice={spotPrice}
                      liveQuotes={liveQuotes}
                      spreadShareCharged={tradingContext?.spreadShareCharged ?? null}
                      selectedContractKey={pickKey}
                      pickingDisabled={pendingOrder !== null}
                      phoneSide={chainPhoneSide}
                      onPhoneSideChange={setChainPhoneSide}
                      onSelectExpiry={(expiry) => {
                        if (expiry !== chain?.selectedExpiry) setSelectedExpiry(expiry);
                      }}
                      onPickContract={(contract) => {
                        pickChainContract(contract);
                        // On a phone the order pane sits below the chain: bring its top into view.
                        if (isPhoneLayout) scrollOrderSetupIntoView("start");
                      }}
                    />
                  </div>
                </div>

                <div style={{ flex: "1 1 32%", minWidth: "19rem" }}>
                  <div ref={orderSetupRef} className="card">
                    <div className="card-body">
                      {frozenTicker ? (
                        <div className="alert alert-danger mb-0" role="alert">
                          {describeFrozenTicker(frozenTicker)}
                        </div>
                      ) : pendingOrder ? (
                        <OrderReviewPanel
                          order={pendingOrder.order}
                          onOrderChange={(order) => setPendingOrder((current) => (current ? { ...current, order } : current))}
                          initialAdaptivePriority={pendingOrder.adaptivePriority}
                          liveSpotPrice={spotPrice}
                          initialQuote={quoteSeedOf(pickQuote)}
                          onCancelled={clearSelection}
                          onFilled={() => {
                            clearSelection();
                            void tickerPositions.loadPositions();
                            setContextReloadKey((key) => key + 1);
                            onPositionsChanged?.();
                          }}
                        />
                      ) : pick && rollModeLeg ? (
                        <RollOrderSetupForm
                          key={pickKey!}
                          symbol={symbol}
                          held={rollModeLeg}
                          heldQuote={heldQuote}
                          target={{ expiry: pick.expiry, strike: pick.strike, dte: pickDte ?? 0 }}
                          targetQuote={pickQuote}
                          spotPrice={spotPrice}
                          spreadShareCharged={tradingContext?.spreadShareCharged ?? null}
                          notice={earningsNotice}
                          accessLevelRefusal={accessLevelRefusal}
                          onCancel={clearSelection}
                          onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                        />
                      ) : pick ? (
                        <OpenOrderSetupForm
                          key={pickKey!}
                          symbol={symbol}
                          contract={{ strategyKey: pick.right === "C" ? "covered_call" : "cash_secured_put", expiry: pick.expiry, strike: pick.strike, dte: pickDte ?? 0, bid: pickQuote?.bid ?? null, ask: pickQuote?.ask ?? null, delta: pickQuote?.delta ?? null }}
                          freeShares={tradingContext?.freeShares ?? null}
                          spotPrice={spotPrice}
                          spreadShareCharged={tradingContext?.spreadShareCharged ?? null}
                          notice={earningsNotice}
                          accessLevelRefusal={accessLevelRefusal}
                          onCancel={clearSelection}
                          onSubmitted={(order, adaptivePriority) => setPendingOrder({ order, adaptivePriority })}
                        />
                      ) : (
                        <>
                          <div className="text-secondary text-uppercase fw-bold mb-2" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                            Order setup
                          </div>
                          <p className="text-secondary mb-0" style={{ fontSize: "0.85rem" }}>
                            {rollModeLeg ? `Pick the ${rollModeLeg.right === "C" ? "call" : "put"} to roll to on the chain.` : "Pick any contract on the chain to sell a covered call or a cash-secured put, or Roll a position below."}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

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
              MACD{" "}
              <span className={`badge ${macdSignalBadgeClass[technicals.macdSignal]}`} style={badgeFontSize}>
                {technicals.macdSignal}
              </span>
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

function TickerMetric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <span className="d-inline-flex flex-column">
      <span className="text-secondary" style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span className={`font-mono fw-semibold ${valueClassName ?? ""}`}>{value}</span>
    </span>
  );
}
