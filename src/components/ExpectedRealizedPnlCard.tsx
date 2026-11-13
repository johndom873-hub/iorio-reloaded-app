import type { ReactNode } from "react";
import type { CommissionPreviewLeg } from "../api/orderChecks";
import type { LegSide, OrderLeg, OrderRequest } from "../api/positions";
import { useCommissionPreviewPerLeg, type OrderCommissionPreviewState } from "../hooks/useOrderCommissionPreview";
import { estimateClosingLegRealizedPnl } from "../lib/closingLegRealizedPnlEstimate";
import { daysToExpiry, formatCurrency, formatExpiryDayMonthWithDte, formatOptionContractLabel, formatPerSharePrice, formatSignedPnl, ibkrExpiryToIsoDate, pnlTextClass, todayInEasternIso } from "../lib/formatters";
import { DottedLabelTooltip } from "./HelpTooltip";
import { Spinner } from "./Spinner";

// Labels leave the ticker out: the window around the review step already names it, and a symbol shown as plain text breaks
// the rule that every ticker opens the Ticker modal.

/** What the review step needs to know about a position leg an order closes, beyond the order's own leg. */
export interface ClosingLegEntry {
  positionLegId: string;
  legType: "stock" | "option";
  side: LegSide;
  /** Shares per contract (1 for stock). */
  multiplier: number;
  /** IBKR's entry price per share, already net of the opening commission. */
  entryPrice: number;
}

interface ExpectedRealizedPnlCardProps {
  order: OrderRequest;
  closingLegEntries: ClosingLegEntry[];
  /** A covered call's Call bought back alone: the shares it keeps. */
  sharesKept?: number;
  /** Shown with sharesKept: the cash the buy-back takes from the order's book. */
  availableCashToTrade?: number | null;
  bookLabel?: string | null;
}

interface ClosingLeg {
  orderLeg: OrderLeg;
  entry: ClosingLegEntry;
}

function isoExpiryOf(orderLeg: OrderLeg): string | null {
  if (!orderLeg.expiry) return null;
  return orderLeg.expiry.length === 8 ? ibkrExpiryToIsoDate(orderLeg.expiry) : orderLeg.expiry;
}

function contractLabelOf(orderLeg: OrderLeg): string {
  const expiryIso = isoExpiryOf(orderLeg);
  if (orderLeg.strike === undefined || !orderLeg.right || !expiryIso) return orderLeg.right === "P" ? "Put" : "Call";
  return formatOptionContractLabel({ strike: orderLeg.strike, right: orderLeg.right, expiry: expiryIso, dte: daysToExpiry(expiryIso, todayInEasternIso()) });
}

/** "20 Nov Call": the contract a roll opens, as its note names it. */
function newContractShortLabelOf(orderLeg: OrderLeg): string {
  const expiryIso = isoExpiryOf(orderLeg);
  return `${expiryIso ? `${formatExpiryDayMonthWithDte(expiryIso, null)} ` : ""}${orderLeg.right === "P" ? "Put" : "Call"}`;
}

function commissionPreviewLegOf(orderLeg: OrderLeg): CommissionPreviewLeg {
  const { role, action, symbol, quantity, unitPrice, strike, expiry, right } = orderLeg;
  return role === "option" ? { role, action, symbol, quantity, unitPrice, strike, expiry, right } : { role, action, symbol, quantity, unitPrice };
}

function Row({ label, detail, value, tone, strong, bordered }: { label: ReactNode; detail?: string; value: ReactNode; tone?: string; strong?: "semibold" | "bold"; bordered?: boolean }) {
  return (
    <div className={`d-flex justify-content-between align-items-baseline gap-3 ${bordered ? "border-top mt-2 pt-2" : "py-1"}`} style={{ fontSize: strong === "bold" ? "0.95rem" : "0.85rem" }}>
      <div>
        <span className={strong ? `fw-${strong}` : "text-secondary"}>{label}</span>
        {detail && (
          <div className="text-secondary font-mono" style={{ fontSize: "0.75rem" }}>
            {detail}
          </div>
        )}
      </div>
      <span className={`font-mono text-end text-nowrap ${strong ? `fw-${strong}` : ""} ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function CommissionRow({ state }: { state: OrderCommissionPreviewState | undefined }) {
  const preview = state?.preview ?? null;
  if (!preview) {
    return <Row label="Commission" value={state?.failed ? "unavailable" : <Spinner size="sm" label="Loading commission" />} />;
  }
  const label =
    preview.source === "estimate" ? (
      <>
        <DottedLabelTooltip label="Commission" className="text-secondary" tooltipHtml={`IBKR did not return a figure (${preview.estimateReason ?? "no reason given"}). Estimated from your recent fills.`} />{" "}
        <span className="badge bg-secondary-lt" style={{ fontSize: "0.72rem" }}>
          est.
        </span>
      </>
    ) : (
      <DottedLabelTooltip label="Commission · worst case" className="text-secondary" tooltipHtml="IBKR's maximum commission for this leg, asked as an order of its own." />
    );
  return <Row label={label} value={formatSignedPnl(-preview.commissionDollars)} />;
}

// The proceeds and cost rows of one closing leg: a short leg received its entry price and pays the limit back, a long leg
// paid its entry price and receives the limit.
function legAmountRows(leg: ClosingLeg) {
  const { orderLeg, entry } = leg;
  const unitsPerQuantity = entry.legType === "option" ? entry.multiplier : 1;
  const unitsSuffix = entry.legType === "option" ? ` × ${entry.multiplier}` : "";
  const entryDetail = `${orderLeg.quantity} × ${formatPerSharePrice(entry.entryPrice)}${unitsSuffix}`;
  const limitDetail = `${orderLeg.quantity} × ${formatPerSharePrice(orderLeg.unitPrice)}${unitsSuffix}`;
  const entryDollars = entry.entryPrice * orderLeg.quantity * unitsPerQuantity;
  const limitDollars = orderLeg.unitPrice * orderLeg.quantity * unitsPerQuantity;
  const entryTooltip =
    entry.side === "short"
      ? "What it was sold for per share, less its opening commission (IBKR's average cost)."
      : "What it cost per share, including its opening commission (IBKR's average cost).";
  const entryRowLabel = entry.side === "short" ? (entry.legType === "option" ? "Premium received" : "Sold short") : "Cost";
  const entryRow = <Row key="entry" label={<DottedLabelTooltip label={entryRowLabel} className="text-secondary" tooltipHtml={entryTooltip} />} detail={entryDetail} value={formatSignedPnl(entry.side === "short" ? entryDollars : -entryDollars)} />;
  const limitRow = <Row key="limit" label={entry.side === "short" ? "Bought back" : "Sold"} detail={limitDetail} value={formatSignedPnl(entry.side === "short" ? -limitDollars : limitDollars)} />;
  return entry.side === "short" ? [entryRow, limitRow] : [limitRow, entryRow];
}

/**
 * The review step's realised P&L if a close or roll fills at its limits (approved 2026-11-13): each leg it closes, its
 * premium or sale against its entry price less the closing commission (estimateClosingLegRealizedPnl), then the total.
 */
export function ExpectedRealizedPnlCard({ order, closingLegEntries, sharesKept, availableCashToTrade, bookLabel }: ExpectedRealizedPnlCardProps) {
  const entryByLegId = new Map(closingLegEntries.map((entry) => [entry.positionLegId, entry]));
  const closingLegs: ClosingLeg[] = order.payload.legs.flatMap((orderLeg) => {
    const entry = orderLeg.positionLegId ? entryByLegId.get(orderLeg.positionLegId) : undefined;
    return entry ? [{ orderLeg, entry }] : [];
  });
  const commissionStates = useCommissionPreviewPerLeg(closingLegs.length > 0 ? closingLegs.map((leg) => commissionPreviewLegOf(leg.orderLeg)) : null);
  if (closingLegs.length === 0) return null;

  const realizedByLeg = closingLegs.map((leg, index) => {
    const commission = commissionStates[index]?.preview?.commissionDollars;
    return commission === undefined
      ? null
      : estimateClosingLegRealizedPnl({
          legType: leg.entry.legType,
          side: leg.entry.side,
          quantityToClose: leg.orderLeg.quantity,
          multiplier: leg.entry.multiplier,
          entryPrice: leg.entry.entryPrice,
          limitPrice: leg.orderLeg.unitPrice,
          closingCommissionDollars: commission,
        });
  });
  const totalRealized = realizedByLeg.every((value): value is number => value !== null) ? realizedByLeg.reduce((sum, value) => sum + value, 0) : null;
  const isSingleLeg = closingLegs.length === 1;
  const isCombo = order.payload.legs.length > 1;
  const openingOptionLeg = order.payload.legs.find((orderLeg) => orderLeg.role === "option" && !orderLeg.positionLegId);
  const buyBackCashDollars =
    sharesKept !== undefined && isSingleLeg && commissionStates[0]?.preview
      ? closingLegs[0]!.orderLeg.unitPrice * closingLegs[0]!.orderLeg.quantity * closingLegs[0]!.entry.multiplier + commissionStates[0].preview.commissionDollars
      : null;

  const valueOrSpinner = (value: number | null) => (value === null ? commissionStates.some((state) => state.failed) ? "—" : <Spinner size="sm" label="Loading realised P&L" /> : formatSignedPnl(value));
  const heading = `Expected realised P&L · at your limit${isSingleLeg ? "" : "s"}`;

  return (
    <>
      <div className="border rounded p-3">
        <div className="text-secondary text-uppercase mb-2" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em" }}>
          {isCombo ? (
            <DottedLabelTooltip
              label={heading}
              tooltipHtml="If the order fills at the limit prices shown. IBKR fills a combo at its net price and can split it between the legs differently from these limits: the total stays the same, each leg's share can move. A better fill raises it."
            />
          ) : (
            heading
          )}
        </div>
        {closingLegs.map((leg, index) => {
          const realizedLabel = leg.entry.legType === "option" ? `Realised on the ${leg.orderLeg.right === "P" ? "Put" : "Call"}` : "Realised on the shares";
          const realized = realizedByLeg[index] ?? null;
          return (
            <div key={leg.entry.positionLegId} className={index > 0 ? "mt-3 pt-2 border-top" : undefined}>
              <div className="fw-semibold mb-1" style={{ fontSize: "0.85rem" }}>
                {leg.entry.legType === "option" ? contractLabelOf(leg.orderLeg) : `${leg.orderLeg.quantity} shares`}
              </div>
              {legAmountRows(leg)}
              <CommissionRow state={commissionStates[index]} />
              <Row label={realizedLabel} value={valueOrSpinner(realized)} tone={pnlTextClass(realized)} strong={isSingleLeg ? "bold" : "semibold"} bordered={isSingleLeg} />
            </div>
          );
        })}
        {!isSingleLeg && <Row label="Total realised" value={valueOrSpinner(totalRealized)} tone={pnlTextClass(totalRealized)} strong="bold" bordered />}
        {sharesKept !== undefined && (
          <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
            The {sharesKept} shares stay open: nothing is realised on them.
          </div>
        )}
        {openingOptionLeg && (
          <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
            The new {newContractShortLabelOf(openingOptionLeg)}'s premium is realised when it is bought back, expires or is assigned.
          </div>
        )}
      </div>
      {sharesKept !== undefined && (
        <div className="d-flex flex-column gap-1" style={{ fontSize: "0.8rem" }}>
          <div className="d-flex justify-content-between">
            <span className="text-secondary">Available cash to trade{bookLabel ? ` (${bookLabel})` : ""}</span>
            <span className="font-mono fw-semibold">{availableCashToTrade != null ? formatCurrency(availableCashToTrade) : <Spinner size="sm" label="Loading available cash" />}</span>
          </div>
          <div className="d-flex justify-content-between">
            <span className="text-secondary">Cash this buy-back uses</span>
            <span className="font-mono fw-semibold text-danger">{buyBackCashDollars !== null ? formatSignedPnl(-buyBackCashDollars) : <Spinner size="sm" label="Loading commission" />}</span>
          </div>
        </div>
      )}
    </>
  );
}
