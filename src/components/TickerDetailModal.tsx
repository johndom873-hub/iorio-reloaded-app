import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { IconStar } from "@tabler/icons-react";
import { Spinner } from "./Spinner";
import { OrderReviewPanel } from "./OrderReviewPanel";
import { TickerPriceChart } from "./charts/TickerPriceChart";
import { IvHistoryChart } from "./charts/IvHistoryChart";
import { PositionCard } from "./PositionCard";
import {
  openTickerDetailStream,
  type OptionQuote,
  type PriceBar,
  type TickerOverview,
} from "../api/tickerDetail";
import { fetchTradeAlerts, isRollAlert, refreshTickerAlerts, type NewTradeCandidate, type TradeAlert } from "../api/tradeAlerts";
import {
  buildOpenOrder,
  fetchGreeks,
  fetchPositionsBySymbol,
  fetchUnrealizedPnl,
  type Greeks,
  type OrderRequest,
  type Position,
  type UnrealizedPnlResult,
} from "../api/positions";
import { ApiError } from "../api/client";
import type { StrategyKey } from "../api/screener";
import { computeAnnualizedYield, computePayoff, type PayoffLegInput } from "../lib/payoff";
import { formatCurrency, formatCurrencyTrimmed, formatDate, formatExpiryWithDte, formatNumber, formatPercentage, formatSignedPnl, ibkrExpiryToIsoDate } from "../lib/formatters";
import { strategyBadgeClass, strategyLabel } from "../lib/positionPnl";

interface TickerDetailModalProps {
  symbol: string;
  onClose: () => void;
  /** Set when opened via "View Details" on a Trade Alert — jumps to that alert's expiry on load. */
  initialAlertId?: string;
  /** Set when opened from a specific position's row (e.g. Positions' symbol/notes columns) — scrolls that position's card into view when there's more than one for this symbol. */
  focusPositionId?: string;
}

type NewTradeAlert = TradeAlert & { suggestedStructure: NewTradeCandidate };

// What's currently selected for order building. Originally this was always a
// NewTradeAlert (order-building only reachable by clicking an alert row/pill)
// — fixed 2026-08-31: a symbol with no live trade alert at the strike you
// want (the exact "Sell Call against held shares, but the scanner hasn't
// surfaced anything yet" case) had NO way to build an order at all, since the
// API's sourceAlertId is optional but the UI never offered a path without
// one. Clicking any chain quote now creates a selection too; sourceAlert is
// only set when the selection did originate from (or matches) a real alert,
// giving it the frozen suggestedStructure fallback values live quotes don't
// have outside market hours.
interface ChainSelection {
  strategyKey: StrategyKey;
  strike: number;
  expiryYyyymmdd: string;
  sourceAlert?: NewTradeAlert;
}

interface StrikeRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

interface ExpiryGroup {
  expiry: string; // YYYYMMDD
  daysToExpiry: number;
  strikes: StrikeRow[];
}

function parseIbkrExpiry(expiry: string): Date {
  return new Date(`${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}T00:00:00Z`);
}

function formatExpiry(expiry: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
    parseIbkrExpiry(expiry),
  );
}

function groupOptionChain(quotes: OptionQuote[]): ExpiryGroup[] {
  const byExpiry = new Map<string, Map<number, StrikeRow>>();

  for (const quote of quotes) {
    if (!byExpiry.has(quote.expiry)) byExpiry.set(quote.expiry, new Map());
    const strikes = byExpiry.get(quote.expiry)!;
    if (!strikes.has(quote.strike)) strikes.set(quote.strike, { strike: quote.strike, call: null, put: null });
    const row = strikes.get(quote.strike)!;
    if (quote.right === "C") row.call = quote;
    else row.put = quote;
  }

  const today = new Date();
  return Array.from(byExpiry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiry, strikes]) => ({
      expiry,
      daysToExpiry: Math.round((parseIbkrExpiry(expiry).getTime() - today.getTime()) / 86_400_000),
      strikes: Array.from(strikes.values()).sort((a, b) => a.strike - b.strike),
    }));
}

function newTradeAlerts(alerts: TradeAlert[]): NewTradeAlert[] {
  // Roll alerts are deliberately left out of this view (2026-08-26) — the
  // chain-highlighting/order-setup flow here only knows how to flag a single
  // opportunity strike, which doesn't fit a roll's two-leg (close + replace)
  // shape. Roll alerts keep their existing Roll/Refresh/Reject card on the
  // Trade Alerts page, unchanged.
  return alerts.filter((alert): alert is NewTradeAlert => !isRollAlert(alert));
}

function midPrice(quote: OptionQuote): number | null {
  if (quote.bid !== null && quote.ask !== null) return (quote.bid + quote.ask) / 2;
  return quote.last;
}

function matchAlertToQuote(quote: OptionQuote, alerts: NewTradeAlert[]): NewTradeAlert | null {
  const isoExpiry = ibkrExpiryToIsoDate(quote.expiry);
  const wantsRight = quote.right;
  return (
    alerts.find((alert) => {
      const rightForStrategy = alert.strategyKey === "covered_call" ? "C" : "P";
      return (
        rightForStrategy === wantsRight &&
        alert.suggestedStructure.strike === quote.strike &&
        alert.suggestedStructure.expiry === isoExpiry
      );
    }) ?? null
  );
}

function findQuoteForAlert(alert: NewTradeAlert, quotes: OptionQuote[] | null): OptionQuote | null {
  if (!quotes) return null;
  const wantsRight = alert.strategyKey === "covered_call" ? "C" : "P";
  return (
    quotes.find(
      (q) => q.right === wantsRight && q.strike === alert.suggestedStructure.strike && ibkrExpiryToIsoDate(q.expiry) === alert.suggestedStructure.expiry,
    ) ?? null
  );
}

function StrategyBadge({ strategyKey }: { strategyKey: StrategyKey }) {
  return <span className="badge bg-azure-lt">{strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"}</span>;
}

// Recomputes an alert's delta/premium/DTE/yield from the live chain quote
// when one's available, instead of the alert's frozen scan-time values —
// approved 2026-08-26 after the two disagreeing (e.g. yield shown as 189%
// in this table vs. 398% on the same strike's chain badge, hours apart in
// scan time vs. live DTE) read as a bug. Falls back to the alert's stored
// suggestedStructure fields when the chain hasn't loaded that strike yet.
function liveAlertMetrics(
  alert: NewTradeAlert,
  optionChain: OptionQuote[] | null,
  expiryGroups: ExpiryGroup[],
  spotPrice: number | null,
): { dte: number; premium: number | null; delta: number | null; yieldValue: number | null } {
  const liveQuote = findQuoteForAlert(alert, optionChain);
  const group = expiryGroups.find((g) => g.expiry === alert.suggestedStructure.expiry.replaceAll("-", ""));
  const dte = group ? group.daysToExpiry : alert.suggestedStructure.dte;
  // (liveQuote ? midPrice(liveQuote) : ...) only fell back when the chain
  // hadn't matched a quote at all -- a matched quote with no live bid/ask/last
  // right now (e.g. outside market hours) made midPrice() return null and
  // this table show "-" instead of falling back the same way `delta` below
  // already does (found 2026-08-27, same table showing "-" for premium/yield
  // while a matching "Alert" badge quote clearly existed in the chain).
  const premium = (liveQuote ? midPrice(liveQuote) : null) ?? alert.suggestedStructure.premium;
  const delta = liveQuote?.delta ?? alert.suggestedStructure.delta;
  const yieldValue =
    spotPrice !== null
      ? computeAnnualizedYield(alert.strategyKey, { premium, dte, strike: alert.suggestedStructure.strike, spotPrice })
      : alert.suggestedStructure.annualizedYield;
  return { dte, premium, delta, yieldValue };
}

// Where the live spot price sits among a sorted strikes list — the row
// index to insert a marker BEFORE (see SpotPriceMarkerRow). strikes.length
// means "below every strike shown," -1 is never returned (findIndex falls
// through to strikes.length via the ?? below).
function findSpotPriceMarkerIndex(strikes: StrikeRow[], spotPrice: number | null): number | null {
  if (spotPrice === null || strikes.length === 0) return null;
  const firstAbove = strikes.findIndex((s) => s.strike > spotPrice);
  return firstAbove === -1 ? strikes.length : firstAbove;
}

// The price figure sits in its own cell, aligned with the STRIKE column
// above/below it (not just centered across the whole row) — beforeColSpan/
// afterColSpan are the column counts flanking that strike column at this
// table's width (desktop: 4 calls + 4 puts; mobile: strike is the first
// column, so only afterColSpan is used).
function SpotPriceMarkerRow({
  spotPrice,
  beforeColSpan = 0,
  afterColSpan = 0,
  priceCellClassName,
}: {
  spotPrice: number;
  beforeColSpan?: number;
  afterColSpan?: number;
  priceCellClassName: string;
}) {
  return (
    <tr className="bg-azure-lt">
      {beforeColSpan > 0 && <td colSpan={beforeColSpan} className="py-1" style={{ fontSize: "0.72rem" }} />}
      <td className={`${priceCellClassName} py-1`} style={{ fontSize: "0.72rem" }}>
        {formatCurrency(spotPrice)}
      </td>
      {afterColSpan > 0 && <td colSpan={afterColSpan} className="py-1" style={{ fontSize: "0.72rem" }} />}
    </tr>
  );
}

function AlertPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="badge bg-azure d-inline-flex align-items-center gap-1 border-0"
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <IconStar size={11} />
      Alert
    </button>
  );
}

function OptionSideCells({
  quote,
  dte,
  spotPrice,
  matchedAlert,
  onAlertClick,
  onQuoteClick,
}: {
  quote: OptionQuote | null;
  dte: number;
  spotPrice: number | null;
  matchedAlert: NewTradeAlert | null;
  onAlertClick: (alert: NewTradeAlert) => void;
  onQuoteClick: (quote: OptionQuote) => void;
}) {
  const strategyKey: StrategyKey | null = quote ? (quote.right === "C" ? "covered_call" : "cash_secured_put") : null;
  const yieldValue =
    quote && strategyKey && spotPrice !== null
      ? computeAnnualizedYield(strategyKey, { premium: midPrice(quote), dte, strike: quote.strike, spotPrice })
      : null;
  // Any quote (matched to an alert or not) is clickable to select it for
  // order building — a matched alert's pill takes the click there instead,
  // since it also carries the alert's rationale/frozen fallback values.
  const cellProps = quote ? { style: { cursor: "pointer" }, onClick: () => onQuoteClick(quote) } : {};

  return (
    <>
      <td className="text-end font-mono" {...cellProps}>{formatCurrency(quote?.bid ?? null)}</td>
      <td className="text-end font-mono" {...cellProps}>{formatCurrency(quote?.ask ?? null)}</td>
      <td className="text-end font-mono" {...cellProps}>{formatNumber(quote?.delta ?? null, 2)}</td>
      <td className="text-end" {...(matchedAlert ? {} : cellProps)}>
        <div className="d-inline-flex align-items-center gap-2">
          {matchedAlert && <AlertPill onClick={() => onAlertClick(matchedAlert)} />}
          <span className={`font-mono ${matchedAlert ? "text-success fw-semibold" : "text-secondary"}`}>{formatPercentage(yieldValue)}</span>
        </div>
      </td>
    </>
  );
}

export function TickerDetailModal({ symbol, onClose, initialAlertId, focusPositionId }: TickerDetailModalProps) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [greeksByLegId, setGreeksByLegId] = useState<Record<string, Greeks>>({});
  const [greeksFetchFailed, setGreeksFetchFailed] = useState(false);
  const [unrealizedPnlByPositionId, setUnrealizedPnlByPositionId] = useState<Record<string, UnrealizedPnlResult>>({});
  const [unrealizedPnlFetchFailed, setUnrealizedPnlFetchFailed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const focusedPositionRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledToFocus = useRef(false);

  const [overview, setOverview] = useState<TickerOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [chartBars, setChartBars] = useState<PriceBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  const [optionChain, setOptionChain] = useState<OptionQuote[] | null>(null);
  const [optionChainError, setOptionChainError] = useState<string | null>(null);

  // Whole-connection failure (e.g. the IBKR Gateway connection itself never
  // opened) — distinct from a single section's error, since nothing else
  // will arrive either in that case.
  const [streamError, setStreamError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<TradeAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [activeExpiry, setActiveExpiry] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChainSelection | null>(null);
  const [contractQty, setContractQty] = useState("1");
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const chainRef = useRef<HTMLDivElement | null>(null);
  const appliedInitialAlert = useRef(false);
  const appliedDefaultExpiry = useRef(false);

  useEffect(() => {
    setOverview(null);
    setOverviewError(null);
    setChartBars(null);
    setChartError(null);
    setOptionChain(null);
    setOptionChainError(null);
    setStreamError(null);
    setActiveExpiry(null);
    setSelection(null);
    setPendingOrder(null);
    appliedInitialAlert.current = false;
    appliedDefaultExpiry.current = false;

    const close = openTickerDetailStream(symbol, (event) => {
      switch (event.type) {
        case "overview":
          setOverview(event.data);
          break;
        case "chart":
          setChartBars(event.data);
          break;
        case "optionChain":
          setOptionChain(event.data);
          break;
        case "error":
          if (event.section === "overview") setOverviewError(event.message);
          else if (event.section === "chart") setChartError(event.message);
          else setOptionChainError(event.message);
          break;
        case "streamError":
          setStreamError(event.message);
          break;
        case "done":
          break;
      }
    });

    fetchTradeAlerts({ status: "pending", symbol })
      .then(setAlerts)
      .catch((err) => setAlertsError(err instanceof ApiError ? err.message : "Failed to load trade alerts."));

    setPositions(null);
    setPositionsError(null);
    hasScrolledToFocus.current = false;
    loadPositions();

    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Informational modal, no action required — closable via ESC or backdrop click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // This modal is rendered manually rather than via Bootstrap's JS Modal
  // instance, so nothing else locks background scroll — do it ourselves.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const expiryGroups = useMemo(() => groupOptionChain(optionChain ?? []), [optionChain]);
  const relevantAlerts = useMemo(() => newTradeAlerts(alerts ?? []), [alerts]);
  const alertExpiries = useMemo(
    () => new Set(relevantAlerts.map((alert) => alert.suggestedStructure.expiry.replaceAll("-", ""))),
    [relevantAlerts],
  );

  // Default to the first expiry that has an alert (if any), otherwise the
  // nearest expiry — runs once per chain load, not on every render.
  useEffect(() => {
    if (appliedDefaultExpiry.current || expiryGroups.length === 0) return;
    appliedDefaultExpiry.current = true;
    const withAlert = expiryGroups.find((g) => alertExpiries.has(g.expiry));
    setActiveExpiry((withAlert ?? expiryGroups[0]).expiry);
  }, [expiryGroups, alertExpiries]);

  // Opened via "Review" on a specific alert (Trade Alerts page) — jump
  // straight to it AND open the order panel, matching what clicking that
  // same alert's row/pill inside this modal already does. Previously this
  // only jumped/scrolled and left the order panel closed — fixed 2026-08-27,
  // see handleAlertPillClick below.
  useEffect(() => {
    if (appliedInitialAlert.current || !initialAlertId || relevantAlerts.length === 0 || expiryGroups.length === 0) return;
    const alert = relevantAlerts.find((a) => a.id === initialAlertId);
    if (!alert) return;
    appliedInitialAlert.current = true;
    const expiryYyyymmdd = alert.suggestedStructure.expiry.replaceAll("-", "");
    if (expiryGroups.some((g) => g.expiry === expiryYyyymmdd)) setActiveExpiry(expiryYyyymmdd);
    chainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    selectAlert(alert);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAlertId, relevantAlerts, expiryGroups]);

  // Opened from a specific position's row (e.g. Positions' symbol/notes
  // columns) — scrolls that position's card into view once positions have
  // loaded, relevant only when a symbol has more than one open position.
  useEffect(() => {
    if (hasScrolledToFocus.current || !focusPositionId || !positions) return;
    if (!focusedPositionRef.current) return;
    hasScrolledToFocus.current = true;
    focusedPositionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPositionId, positions]);

  function handleAlertRowClick(alert: NewTradeAlert) {
    const expiryYyyymmdd = alert.suggestedStructure.expiry.replaceAll("-", "");
    if (expiryGroups.some((g) => g.expiry === expiryYyyymmdd)) setActiveExpiry(expiryYyyymmdd);
    chainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    selectAlert(alert);
  }

  function selectAlert(alert: NewTradeAlert) {
    setSelection({
      strategyKey: alert.strategyKey,
      strike: alert.suggestedStructure.strike,
      expiryYyyymmdd: alert.suggestedStructure.expiry.replaceAll("-", ""),
      sourceAlert: alert,
    });
    setContractQty("1");
    setPendingOrder(null);
    setBuildError(null);
  }

  // Selecting a raw chain quote — the fix for the dead end where a ticker
  // with no matching trade alert had no way to build an order at all.
  // matchAlertToQuote still runs so clicking an alert-matched quote's bid/ask
  // cells (as opposed to its pill specifically) carries the same frozen
  // fallback values a pill click would.
  function selectQuote(quote: OptionQuote) {
    setSelection({
      strategyKey: quote.right === "C" ? "covered_call" : "cash_secured_put",
      strike: quote.strike,
      expiryYyyymmdd: quote.expiry,
      sourceAlert: matchAlertToQuote(quote, relevantAlerts) ?? undefined,
    });
    setContractQty("1");
    setPendingOrder(null);
    setBuildError(null);
  }

  // Same endpoint as the Trade Alerts page's per-ticker "Refresh" button —
  // confirmed 2026-08-27 there's no cheaper path from inside the modal even
  // though a lot of chain data is already resident here, since the alert
  // scan's strike/expiry selection is structurally different from what the
  // chain fetches (one-sided by strategy vs. the chain's near-the-money both
  // sides). Label switches between "Scan for Alerts" (none yet) and
  // "Refresh" (some exist) but both call the same thing.
  // Loads (or re-loads, after a Close/Roll/Save action) every position for
  // this symbol — open ones drive the actionable PositionCards, closed ones
  // the collapsed History list. Greeks/unrealized-P&L are fetched once here
  // across ALL open positions rather than per-card, since both endpoints
  // already accept arrays (see PositionCard's old standalone-modal ancestor,
  // PositionDetailModal, which fetched per-position before this merge).
  async function loadPositions() {
    try {
      setPositionsError(null);
      const result = await fetchPositionsBySymbol(symbol);
      setPositions(result);

      const openPositions = result.filter((p) => p.status === "open");
      const optionLegIds = openPositions.flatMap((p) => p.legs.filter((leg) => leg.legType === "option").map((leg) => leg.id));
      if (optionLegIds.length > 0) {
        setGreeksFetchFailed(false);
        fetchGreeks(optionLegIds)
          .then(setGreeksByLegId)
          .catch(() => setGreeksFetchFailed(true));
      } else {
        setGreeksByLegId({});
      }

      if (openPositions.length > 0) {
        setUnrealizedPnlFetchFailed(false);
        fetchUnrealizedPnl(openPositions.map((p) => p.id))
          .then(setUnrealizedPnlByPositionId)
          .catch(() => setUnrealizedPnlFetchFailed(true));
      } else {
        setUnrealizedPnlByPositionId({});
      }
    } catch (err) {
      setPositionsError(err instanceof ApiError ? err.message : "Failed to load positions.");
    }
  }

  async function handleScanOrRefresh() {
    setScanning(true);
    setScanError(null);
    try {
      await refreshTickerAlerts(symbol);
      const updated = await fetchTradeAlerts({ status: "pending", symbol });
      setAlerts(updated);
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : "Failed to scan for trade alerts.");
    } finally {
      setScanning(false);
    }
  }

  function closeOrderPanel() {
    setSelection(null);
    setPendingOrder(null);
    setBuildError(null);
  }

  async function handleReviewOrder() {
    if (!selection) return;
    const qty = Number(contractQty);
    if (!Number.isInteger(qty) || qty < 1) {
      setBuildError("Enter a valid number of contracts.");
      return;
    }

    setBuilding(true);
    setBuildError(null);
    try {
      const wantsRight = selection.strategyKey === "covered_call" ? "C" : "P";
      const liveQuote = optionChain?.find((q) => q.right === wantsRight && q.strike === selection.strike && q.expiry === selection.expiryYyyymmdd) ?? null;
      const premium = liveQuote ? midPrice(liveQuote) : selection.sourceAlert?.suggestedStructure.premium ?? null;
      if (premium === null) throw new Error("No live price available for this contract yet — try again when the market is open.");

      const order = await buildOpenOrder({
        symbol,
        strategyKey: selection.strategyKey,
        // No explicit stock leg — covered_call orders auto-fill it server-side,
        // netted against any shares already held uncovered for this symbol
        // (see routes/positions.ts POST /orders) rather than always buying a
        // fresh full lot. Ignored entirely for cash_secured_put.
        option: {
          quantity: qty,
          limitPrice: premium,
          strikePrice: selection.strike,
          expiryDate: ibkrExpiryToIsoDate(selection.expiryYyyymmdd),
        },
        sourceAlertId: selection.sourceAlert?.id,
      });
      setPendingOrder(order);
    } catch (err) {
      setBuildError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to build order.");
    } finally {
      setBuilding(false);
    }
  }

  const pricing = overview?.pricing;
  const spotPrice = pricing?.last ?? pricing?.previousClose ?? null;
  const change = pricing?.last != null && pricing?.previousClose != null ? pricing.last - pricing.previousClose : null;
  const changePercent = change != null && pricing?.previousClose ? change / pricing.previousClose : null;

  const activeGroup = expiryGroups.find((g) => g.expiry === activeExpiry) ?? null;
  const spotPriceMarkerIndex = activeGroup ? findSpotPriceMarkerIndex(activeGroup.strikes, spotPrice) : null;

  const selectedGroup = expiryGroups.find((g) => g.expiry === selection?.expiryYyyymmdd) ?? null;
  const liveQuoteForSelected = selection
    ? optionChain?.find(
        (q) => q.right === (selection.strategyKey === "covered_call" ? "C" : "P") && q.strike === selection.strike && q.expiry === selection.expiryYyyymmdd,
      ) ?? null
    : null;
  // Same fallback fix as liveAlertMetrics above: a matched quote with no live
  // price right now shouldn't stop this preview from showing the alert's own
  // last-known premium (order-build time still requires a genuinely live
  // price -- see handleReviewOrder's own separate `premium`/error below,
  // deliberately not given this same fallback). A selection with no source
  // alert (a raw chain click) has no frozen fallback at all — null until a
  // live quote arrives, same as everywhere else in this modal.
  const selectedPremium = (liveQuoteForSelected ? midPrice(liveQuoteForSelected) : null) ?? selection?.sourceAlert?.suggestedStructure.premium ?? null;
  const selectedDelta = liveQuoteForSelected?.delta ?? selection?.sourceAlert?.suggestedStructure.delta ?? null;
  const selectedDte = selectedGroup?.daysToExpiry ?? selection?.sourceAlert?.suggestedStructure.dte;
  const selectedYield =
    selection && spotPrice !== null && selectedDte !== undefined
      ? computeAnnualizedYield(selection.strategyKey, {
          premium: selectedPremium,
          dte: selectedDte,
          strike: selection.strike,
          spotPrice,
        })
      : selection?.sourceAlert?.suggestedStructure.annualizedYield ?? null;

  // Same payoff math as OrderReviewPanel/Trade Alerts (computePayoff, pure
  // math on entry price/strike, no live data needed) -- built directly from
  // the selected alert's strike/premium/spot rather than orderLegsToPayoffInput
  // since there's no OrderRequest yet at this "Order Setup" stage. Scales
  // with the contracts input so Max Gain/Max Loss/Breakeven reflect what the
  // user's actually about to build, not a fixed 1-contract preview.
  const selectedQty = Number(contractQty) || 1;
  const selectedPayoff =
    selection && selectedPremium !== null && spotPrice !== null
      ? computePayoff(selection.strategyKey, [
          ...(selection.strategyKey === "covered_call"
            ? [
                {
                  legType: "stock",
                  optionType: null,
                  entryPrice: String(spotPrice),
                  strikePrice: null,
                  quantity: selectedQty * 100,
                  multiplier: 1,
                } satisfies PayoffLegInput,
              ]
            : []),
          {
            legType: "option",
            optionType: selection.strategyKey === "covered_call" ? "call" : "put",
            entryPrice: String(selectedPremium),
            strikePrice: String(selection.strike),
            quantity: selectedQty,
            multiplier: 100,
          } satisfies PayoffLegInput,
        ])
      : null;

  // Deliberately two different shapes, not one wrapper around both: once
  // pendingOrder exists, OrderReviewPanel supplies its own "Order Review"
  // header and border (shared with Positions/Roll/Close, which have no
  // wrapper of their own to rely on) — reusing this component's header/
  // border around it too produced a visibly doubled header and a
  // border-within-a-border (found 2026-08-27).
  const orderSetupPanel = selection && pendingOrder && (
    <OrderReviewPanel
      order={pendingOrder}
      onCancelled={closeOrderPanel}
      onFilled={() => {
        closeOrderPanel();
        fetchTradeAlerts({ status: "pending", symbol }).then(setAlerts).catch(() => {});
      }}
    />
  );

  const orderSetupForm = selection && !pendingOrder && (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="text-secondary text-uppercase" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em" }}>
          Order Setup
        </div>
        <h4 className="mb-0" style={{ fontSize: "1.05rem" }}>
          {selection.strategyKey === "covered_call" ? "Covered Call" : "Cash-Secured Put"} · {symbol}
        </h4>
      </div>

      <>
          <div className="border rounded p-3">
            <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
              <span className="text-secondary">Expiry</span>
              <span className="fw-semibold font-mono">
                {formatExpiry(selection.expiryYyyymmdd)} ({selectedDte} DTE)
              </span>
            </div>
            <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
              <span className="text-secondary">Strike</span>
              <span className="fw-semibold font-mono">
                {formatCurrencyTrimmed(selection.strike)} {selection.strategyKey === "covered_call" ? "Call" : "Put"}
              </span>
            </div>
            <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
              <span className="text-secondary">Delta</span>
              <span className="fw-semibold font-mono">{formatNumber(selectedDelta, 2)}</span>
            </div>
            <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
              <span className="text-secondary">Premium (mid)</span>
              <span className="fw-semibold font-mono">{formatCurrency(selectedPremium)}</span>
            </div>
            <hr className="my-2" />
            <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
              <span className="text-secondary">Annualized Yield</span>
              <span className="fw-semibold font-mono text-success">{formatPercentage(selectedYield)}</span>
            </div>
            {selectedPayoff && (
              <>
                <hr className="my-2" />
                <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
                  <span className="text-secondary">Max Gain</span>
                  <span className="fw-semibold font-mono text-success">{formatSignedPnl(selectedPayoff.maxGain, 0)}</span>
                </div>
                <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
                  <span className="text-secondary">Max Loss</span>
                  <span className="fw-semibold font-mono text-danger">{formatSignedPnl(-selectedPayoff.maxLoss, 0)}</span>
                </div>
                <div className="d-flex justify-content-between py-1" style={{ fontSize: "0.85rem" }}>
                  <span className="text-secondary">Breakeven</span>
                  <span className="fw-semibold font-mono">{formatCurrency(selectedPayoff.breakeven)}</span>
                </div>
              </>
            )}
          </div>

          <div>
            <label className="form-label text-secondary text-uppercase" style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em" }}>
              Contracts
            </label>
            <input
              type="number"
              min={1}
              step={1}
              className="form-control font-mono"
              value={contractQty}
              onChange={(event) => setContractQty(event.target.value)}
            />
            {selection.strategyKey === "covered_call" && (
              <div className="text-secondary mt-1 font-mono" style={{ fontSize: "0.78rem" }}>
                = <strong>{(Number(contractQty) || 0) * 100}</strong> shares required ({contractQty || 0} contract
                {Number(contractQty) === 1 ? "" : "s"} × 100) — already-held shares on this symbol are netted out
                automatically when the order is built
              </div>
            )}
          </div>

          {buildError && <div className="alert alert-danger mb-0">{buildError}</div>}

          <div className="d-flex gap-2">
            <button type="button" className="btn btn-primary flex-fill d-inline-flex align-items-center justify-content-center gap-1" disabled={building} onClick={handleReviewOrder}>
              {building && <Spinner size="sm" />}
              Review Order
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={closeOrderPanel}>
              Cancel
            </button>
          </div>
      </>
    </div>
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
              <h5 className="modal-title">
                {symbol}
                {overview?.companyName && <span className="text-secondary fw-normal"> — {overview.companyName}</span>}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {streamError && <div className="alert alert-danger">{streamError}</div>}

              {!streamError && (
                <>
                  {overviewError && <div className="alert alert-danger">{overviewError}</div>}
                  {!overviewError && !overview && (
                    <div className="d-flex justify-content-center py-3">
                      <Spinner label="Loading pricing" />
                    </div>
                  )}
                  {overview && (
                    <div className="d-flex flex-wrap align-items-baseline gap-3 mb-3 font-mono">
                      <span className="h2 mb-0">{formatCurrency(spotPrice)}</span>
                      {change != null && (
                        <strong className={change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-secondary"}>
                          {change >= 0 ? "+" : ""}
                          {formatCurrency(change)} ({change >= 0 ? "+" : ""}
                          {formatPercentage(changePercent, 2)})
                        </strong>
                      )}
                      <span className="text-secondary small">
                        Bid {formatCurrency(pricing?.bid ?? null)} &middot; Ask {formatCurrency(pricing?.ask ?? null)}
                      </span>
                      <span className="text-secondary small">
                        Day range {formatCurrency(pricing?.low ?? null)} – {formatCurrency(pricing?.high ?? null)}
                      </span>
                      <span className="text-secondary small">Volume {formatNumber(pricing?.volume ?? null)}</span>
                      {overview.sector && <span className="badge bg-secondary-lt text-dark">{overview.sector}</span>}
                    </div>
                  )}

                  {/* ---------- Positions (consolidated 2026-08-31 modal-wiring-audit merge) ---------- */}
                  {positionsError && <div className="alert alert-danger">{positionsError}</div>}
                  {positions === null && !positionsError && (
                    <div className="d-flex justify-content-center py-2">
                      <Spinner size="sm" label="Loading positions" />
                    </div>
                  )}
                  {positions !== null && (() => {
                    const openPositions = positions.filter((p) => p.status === "open");
                    const closedPositions = positions.filter((p) => p.status === "closed");
                    if (openPositions.length === 0 && closedPositions.length === 0) return null;
                    return (
                      <div className="mb-4">
                        {openPositions.length > 0 && (
                          <>
                            <h4 className="mb-2" style={{ fontSize: "0.95rem" }}>
                              {openPositions.length === 1 ? "Position" : `Positions (${openPositions.length})`}
                            </h4>
                            {openPositions.map((position) => (
                              <div key={position.id} ref={position.id === focusPositionId ? focusedPositionRef : undefined}>
                                <PositionCard
                                  position={position}
                                  greeksByLegId={greeksByLegId}
                                  greeksFetchFailed={greeksFetchFailed}
                                  unrealizedPnlByPositionId={unrealizedPnlByPositionId}
                                  unrealizedPnlFetchFailed={unrealizedPnlFetchFailed}
                                  currentPrice={spotPrice}
                                  onChanged={loadPositions}
                                  onSellCall={() => chainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                                />
                              </div>
                            ))}
                          </>
                        )}
                        {closedPositions.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => setShowHistory((prev) => !prev)}
                            >
                              {showHistory ? "Hide" : "Show"} History ({closedPositions.length})
                            </button>
                            {showHistory && (
                              <div className="table-responsive mt-2 border rounded">
                                <table className="table table-sm table-vcenter card-table mb-0">
                                  <thead className="table-light">
                                    <tr>
                                      <th>Strategy</th>
                                      <th>Structure</th>
                                      <th>Opened</th>
                                      <th>Closed</th>
                                      <th className="text-end">Realized P&L</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {closedPositions.map((position) => (
                                      <tr key={position.id}>
                                        <td>
                                          <span className={`badge ${strategyBadgeClass(position.strategyKey)}`}>
                                            {strategyLabel(position.strategyKey)}
                                          </span>
                                        </td>
                                        <td className="small">
                                          {position.legs
                                            .map((leg) =>
                                              leg.legType === "stock"
                                                ? `${leg.side} ${leg.quantity} sh`
                                                : `${leg.side} ${leg.quantity}x ${leg.strikePrice ? formatCurrencyTrimmed(Number(leg.strikePrice)) : "—"}${leg.optionType === "call" ? "C" : "P"} exp ${formatExpiryWithDte(leg.expiryDate, position.openedAt)}`,
                                            )
                                            .join(" / ")}
                                        </td>
                                        <td>{formatDate(position.openedAt)}</td>
                                        <td>{position.closedAt ? formatDate(position.closedAt) : "—"}</td>
                                        <td className="text-end font-mono">{formatSignedPnl(Number(position.realizedPnl))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Trade Alerts + Option Chain share this row's left column;
                      the order panel (when open) spans the FULL height of both,
                      not just the chain table next to it. */}
                  <div className="d-flex flex-column flex-lg-row gap-3">
                  <div style={{ minWidth: 0, flex: selection ? "1 1 68%" : "1 1 100%" }}>
                  {/* ---------- Trade Alerts ---------- */}
                  {alertsError && <div className="alert alert-danger">{alertsError}</div>}
                  {alerts !== null && !alertsError && (
                    <div className="mb-4">
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <h4 className="mb-0" style={{ fontSize: "0.95rem" }}>
                          Trade Alerts{" "}
                          {relevantAlerts.length > 0 && <span className="text-secondary fw-normal">({relevantAlerts.length})</span>}
                        </h4>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                          disabled={scanning}
                          onClick={handleScanOrRefresh}
                        >
                          {scanning && <Spinner size="sm" />}
                          {relevantAlerts.length > 0 ? "Refresh" : "Scan for Alerts"}
                        </button>
                      </div>
                      {scanError && <div className="alert alert-danger">{scanError}</div>}

                      {relevantAlerts.length === 0 && !scanning && <p className="text-secondary mb-0">No active trade alerts.</p>}

                      {relevantAlerts.length > 0 && (
                        <>
                      <p className="text-secondary small mb-2">Click a row to jump to that expiry and flag the strike below.</p>

                      {/* Desktop/tablet: full table */}
                      <div className="table-responsive border rounded d-none d-md-block">
                        <table className="table table-sm table-vcenter card-table table-hover mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Strategy</th>
                              <th>Expiry</th>
                              <th className="text-end">Strike</th>
                              <th className="text-end">Delta</th>
                              <th className="text-end">Premium</th>
                              <th className="text-end">Ann. Yield</th>
                              <th style={{ width: 24 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {relevantAlerts.map((alert) => {
                              const live = liveAlertMetrics(alert, optionChain, expiryGroups, spotPrice);
                              return (
                                <tr key={alert.id} style={{ cursor: "pointer" }} onClick={() => handleAlertRowClick(alert)}>
                                  <td>
                                    <StrategyBadge strategyKey={alert.strategyKey} />
                                  </td>
                                  <td>
                                    {formatExpiry(alert.suggestedStructure.expiry.replaceAll("-", ""))}{" "}
                                    <span className="text-secondary">({live.dte} DTE)</span>
                                  </td>
                                  <td className="text-end font-mono">{formatCurrencyTrimmed(alert.suggestedStructure.strike)}</td>
                                  <td className="text-end font-mono">{formatNumber(live.delta, 2)}</td>
                                  <td className="text-end font-mono">{formatCurrency(live.premium)}</td>
                                  <td className="text-end font-mono">
                                    <span className="badge badge-change-pos">{formatPercentage(live.yieldValue)}</span>
                                  </td>
                                  <td className="text-secondary">›</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile: compact tappable cards instead of a squeezed table */}
                      <div className="d-md-none d-flex flex-column gap-2">
                        {relevantAlerts.map((alert) => {
                          const live = liveAlertMetrics(alert, optionChain, expiryGroups, spotPrice);
                          return (
                            <div
                              key={alert.id}
                              className="border rounded p-2 d-flex align-items-center justify-content-between gap-2"
                              style={{ cursor: "pointer" }}
                              onClick={() => handleAlertRowClick(alert)}
                            >
                              <div>
                                <StrategyBadge strategyKey={alert.strategyKey} />
                                <div className="fw-bold mt-1 font-mono">
                                  {formatCurrencyTrimmed(alert.suggestedStructure.strike)} · {formatExpiry(alert.suggestedStructure.expiry.replaceAll("-", ""))}
                                </div>
                                <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
                                  Δ {formatNumber(live.delta, 2)} · Prem {formatCurrency(live.premium)} · {live.dte} DTE
                                </div>
                              </div>
                              <div className="text-end d-flex flex-column align-items-end gap-1">
                                <span className="badge badge-change-pos font-mono">{formatPercentage(live.yieldValue)}</span>
                                <span className="text-secondary">›</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ---------- Option Chain ---------- */}
                  <div ref={chainRef}>
                    <h4 className="mb-2">Option Chain</h4>
                    <p className="text-secondary small mb-3">
                      Near-the-money strikes for the nearest expiries in the strategies' trading window. Yield shown for every strike;
                      flagged strikes match an open trade alert.
                    </p>

                    {optionChainError && <div className="alert alert-danger">{optionChainError}</div>}
                    {!optionChainError && !optionChain && (
                      <div className="d-flex justify-content-center py-3">
                        <Spinner label="Loading option chain" />
                      </div>
                    )}
                    {optionChain && expiryGroups.length === 0 && <p className="text-muted">No option chain data available.</p>}

                    {expiryGroups.length > 0 && (
                      <>
                          <ul className="nav nav-tabs mb-0 flex-nowrap overflow-auto">
                            {expiryGroups.map((group) => (
                              <li className="nav-item" key={group.expiry}>
                                <button
                                  type="button"
                                  className={`nav-link position-relative text-nowrap ${activeExpiry === group.expiry ? "active" : ""}`}
                                  onClick={() => setActiveExpiry(group.expiry)}
                                >
                                  {formatExpiry(group.expiry)}
                                  <span className="text-secondary fw-normal ms-1">{group.daysToExpiry}D</span>
                                  {alertExpiries.has(group.expiry) && (
                                    <span
                                      className="position-absolute bg-danger rounded-circle"
                                      style={{ width: 6, height: 6, top: 6, right: 6 }}
                                    />
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>

                          {activeGroup && (
                            <>
                              {/* Desktop: calls | strike | puts, side by side */}
                              <div className="table-responsive border border-top-0 rounded-bottom d-none d-lg-block">
                                <table className="table table-sm table-vcenter card-table table-hover mb-0">
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
                                      <th className="text-end">Delta</th>
                                      <th className="text-end">Yield</th>
                                      <th className="text-center">·</th>
                                      <th className="text-end">Bid</th>
                                      <th className="text-end">Ask</th>
                                      <th className="text-end">Delta</th>
                                      <th className="text-end">Yield</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {activeGroup.strikes.map((row, index) => {
                                      const callAlert = row.call ? matchAlertToQuote(row.call, relevantAlerts) : null;
                                      const putAlert = row.put ? matchAlertToQuote(row.put, relevantAlerts) : null;
                                      return (
                                        <Fragment key={row.strike}>
                                          {spotPriceMarkerIndex === index && spotPrice !== null && (
                                            <SpotPriceMarkerRow spotPrice={spotPrice} beforeColSpan={4} afterColSpan={4} priceCellClassName="text-center fw-bold font-mono" />
                                          )}
                                          <tr className={callAlert || putAlert ? "table-active" : undefined}>
                                            <OptionSideCells
                                              quote={row.call}
                                              dte={activeGroup.daysToExpiry}
                                              spotPrice={spotPrice}
                                              matchedAlert={callAlert}
                                              onAlertClick={selectAlert}
                                              onQuoteClick={selectQuote}
                                            />
                                            <td className="text-center fw-bold font-mono">{formatCurrencyTrimmed(row.strike)}</td>
                                            <OptionSideCells
                                              quote={row.put}
                                              dte={activeGroup.daysToExpiry}
                                              spotPrice={spotPrice}
                                              matchedAlert={putAlert}
                                              onAlertClick={selectAlert}
                                              onQuoteClick={selectQuote}
                                            />
                                          </tr>
                                        </Fragment>
                                      );
                                    })}
                                    {spotPriceMarkerIndex === activeGroup.strikes.length && spotPrice !== null && (
                                      <SpotPriceMarkerRow spotPrice={spotPrice} beforeColSpan={4} afterColSpan={4} priceCellClassName="text-center fw-bold font-mono" />
                                    )}
                                  </tbody>
                                </table>
                              </div>

                              {/* Mobile: calls table, then puts table, stacked */}
                              <div className="d-lg-none">
                                {(["call", "put"] as const).map((side) => (
                                  <div key={side} className="mb-2">
                                    <div className="text-secondary text-uppercase fw-bold mt-2 mb-1" style={{ fontSize: "0.68rem", letterSpacing: "0.06em" }}>
                                      {side === "call" ? "Calls" : "Puts"}
                                    </div>
                                    <div className="table-responsive border rounded">
                                      <table className="table table-sm table-vcenter card-table table-hover mb-0">
                                        <thead className="table-light">
                                          <tr>
                                            <th>Strike</th>
                                            <th className="text-end">Bid</th>
                                            <th className="text-end">Ask</th>
                                            <th className="text-end">Delta</th>
                                            <th className="text-end">Yield</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {activeGroup.strikes.map((row, index) => {
                                            const quote = side === "call" ? row.call : row.put;
                                            const matchedAlert = quote ? matchAlertToQuote(quote, relevantAlerts) : null;
                                            return (
                                              <Fragment key={row.strike}>
                                                {spotPriceMarkerIndex === index && spotPrice !== null && (
                                                  <SpotPriceMarkerRow spotPrice={spotPrice} afterColSpan={4} priceCellClassName="fw-bold font-mono" />
                                                )}
                                                <tr className={matchedAlert ? "table-active" : undefined}>
                                                  <td className="fw-bold font-mono">{formatCurrencyTrimmed(row.strike)}</td>
                                                  <OptionSideCells
                                                    quote={quote}
                                                    dte={activeGroup.daysToExpiry}
                                                    spotPrice={spotPrice}
                                                    matchedAlert={matchedAlert}
                                                    onAlertClick={selectAlert}
                                                    onQuoteClick={selectQuote}
                                                  />
                                                </tr>
                                              </Fragment>
                                            );
                                          })}
                                          {spotPriceMarkerIndex === activeGroup.strikes.length && spotPrice !== null && (
                                            <SpotPriceMarkerRow spotPrice={spotPrice} afterColSpan={4} priceCellClassName="fw-bold font-mono" />
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                      </>
                    )}
                  </div>
                  </div>

                  {/* Order setup / review — spans the full height of the
                      Trade Alerts + Option Chain column on desktop (not a
                      cramped sidebar next to just the chain table), sticky
                      so it stays in view while that column scrolls. Inline
                      card on mobile instead, below everything. */}
                  {selection && (
                    <div
                      className={pendingOrder ? "d-none d-lg-block" : "border rounded p-4 d-none d-lg-block"}
                      style={{ flex: "1 1 32%", maxWidth: "420px", minWidth: 0, alignSelf: "flex-start", position: "sticky", top: 0 }}
                    >
                      {orderSetupForm}
                      {orderSetupPanel}
                    </div>
                  )}
                  </div>

                  {selection && (
                    <div className={pendingOrder ? "mt-3 d-lg-none" : "border rounded p-3 mt-3 d-lg-none"}>
                      {orderSetupForm}
                      {orderSetupPanel}
                    </div>
                  )}

                  {/* ---------- Chart ---------- */}
                  <div className="mt-4">
                    {chartError && <div className="alert alert-danger">{chartError}</div>}
                    {!chartError && !chartBars && (
                      <div className="d-flex justify-content-center py-3">
                        <Spinner label="Loading chart" />
                      </div>
                    )}
                    {chartBars && <TickerPriceChart symbol={symbol} initialBars={chartBars} />}
                  </div>

                  {/* ---------- IV History ---------- */}
                  <div className="mt-3">
                    <IvHistoryChart symbol={symbol} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
