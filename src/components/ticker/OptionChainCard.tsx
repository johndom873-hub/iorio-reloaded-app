import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { optionContractKey, type LiveContractQuote, type TickerOptionChain } from "../../api/tickerTrading";
import { FLASH_DURATION_MS, flashClassName, useFlashOnChange } from "../../hooks/useFlashOnChange";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCompactNumber, formatCurrency, formatCurrencyTrimmed, formatPercentage, formatQuotePrice, formatSignedPercentage } from "../../lib/formatters";
import { describeChainExpiryTab, isChainContractInTheMoney } from "../../lib/optionChainPresentation";
import { computeAnnualizedYield, computeFrictionDollarsPerContract } from "../../lib/payoff";
import { DottedLabelTooltip } from "../HelpTooltip";
import { Spinner } from "../Spinner";

// The Ticker modal's option chain (2026-10-27, from the Signals chain without its grades): every listed expiry, the
// strikes of the selected one, calls left / puts right on desktop, one side at a time with a Calls/Puts toggle on a
// phone. Each cell shows the live bid and ask with the contracts at each (IBKR's sizes), delta, implied volatility and
// yield of the contracts on screen (the `optionQuotes` stream); any out-of-the-money contract can be picked to build an
// order. Buy LEAPS mode (2026-10-27) shows the Calls only, every strike in and out of the money, with the same bid, ask,
// delta and IV and, in place of the yield, the breakeven at expiry (strike + mid) and how far the stock must rise to
// reach it (desktop only).

/** Sell: covered calls and cash-secured puts. Buy LEAPS: a long Call. */
export type OptionChainMode = "sell" | "leaps";

export interface ChainContractRef {
  expiry: string;
  strike: number;
  right: "C" | "P";
}

interface OptionChainCardProps {
  chain: TickerOptionChain | null;
  loading: boolean;
  error: string | null;
  /** The live spot, for the marker row and the call yields. */
  spotPrice: number | null;
  /** Live quotes by optionContractKey. */
  liveQuotes: Record<string, LiveContractQuote>;
  /** λ (0..1), the Risk & Limits spread cost share: the yields are after the same costs as the order form's. */
  spreadShareCharged: number | null;
  selectedContractKey: string | null;
  /** While an order is under review nothing else can be picked. */
  pickingDisabled: boolean;
  phoneSide: "C" | "P";
  onPhoneSideChange: (side: "C" | "P") => void;
  mode: OptionChainMode;
  /** While an order is under review the mode stays as it is. */
  modeSwitchDisabled: boolean;
  onModeChange: (mode: OptionChainMode) => void;
  onSelectExpiry: (expiry: string) => void;
  onPickContract: (contract: ChainContractRef) => void;
}

const phoneLayoutQuery = "(max-width: 991.98px)";

type ChainColumn = "bid" | "ask" | "delta" | "iv" | "yield";

// Calls mirror the puts around the strike column: yield, IV, Δ, bid, ask | strike | bid, ask, Δ, IV, yield.
// A phone shows one side with the strike leading, so it always uses the puts order.
const putsColumnOrder: ChainColumn[] = ["bid", "ask", "delta", "iv", "yield"];
const callsColumnOrder: ChainColumn[] = ["yield", "iv", "delta", "bid", "ask"];

function chainColumnOrder(right: "C" | "P", hasLeadingStrike: boolean): ChainColumn[] {
  return right === "C" && !hasLeadingStrike ? callsColumnOrder : putsColumnOrder;
}

const chainColumnLabels: Record<ChainColumn, ReactNode> = {
  bid: <span>Bid</span>,
  ask: <span>Ask</span>,
  delta: <DottedLabelTooltip label="Δ" tooltipHtml="Delta from the contract's own mid price, on the forward (the same delta the CC + Put Ladder uses)." focusable={false} />,
  iv: <DottedLabelTooltip label="IV" tooltipHtml="Implied volatility of the contract's mid price, a year." focusable={false} />,
  yield: <DottedLabelTooltip label="Yield" tooltipHtml="Annualised yield at the mid price after costs: (mid − costs) ÷ (strike − mid) for a put, ÷ (spot − mid) for a call, × 365 ÷ days to expiry. Costs: the Risk &amp; Limits spread cost share of the half-spread plus $0.68 commission per contract." focusable={false} />,
};

function ChainColumnLabels({ right, hasLeadingStrike }: { right: "C" | "P"; hasLeadingStrike: boolean }) {
  return (
    <>
      {chainColumnOrder(right, hasLeadingStrike).map((column) => (
        <Fragment key={column}>{chainColumnLabels[column]}</Fragment>
      ))}
    </>
  );
}

/** A bid or ask with the contracts at it, from 1,000 shortened to 2 significant digits ("4.6k", "10k") so it stays one line:
    after the price where the column has room, under it where it doesn't (theme.css). */
function QuoteWithSize({ price, size, flashClass }: { price: number | null; size: number | null; flashClass: string }) {
  return (
    <span className="option-chain-quote-box">
      <span className="option-chain-quote">
        <span className={`font-mono ${flashClass}`}>{formatQuotePrice(price)}</span>
        {price !== null && size !== null && <span className="option-chain-size font-mono">{formatCompactNumber(size, 2)}</span>}
      </span>
    </span>
  );
}

function formatChainDelta(delta: number | null): string {
  return delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
}

function ChainCellButton({ contract, quote, dte, spotPrice, spreadShareCharged, selected, disabled, showStrike, onPick }: { contract: ChainContractRef; quote: LiveContractQuote | undefined; dte: number | null; spotPrice: number | null; spreadShareCharged: number | null; selected: boolean; disabled: boolean; showStrike: boolean; onPick: () => void }) {
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const delta = quote?.delta ?? null;
  const impliedVolatility = quote?.impliedVolatility ?? null;
  const bidFlash = useFlashOnChange(bid, FLASH_DURATION_MS, 2);
  const askFlash = useFlashOnChange(ask, FLASH_DURATION_MS, 2);
  const deltaFlash = useFlashOnChange(delta, FLASH_DURATION_MS, 2);
  const yieldFraction = bid !== null && ask !== null && dte !== null && spreadShareCharged !== null ? computeAnnualizedYield(contract.right === "C" ? "covered_call" : "cash_secured_put", { premium: (bid + ask) / 2, dte: Math.max(dte, 1), strike: contract.strike, spotPrice: spotPrice ?? 0, frictionDollarsPerContract: computeFrictionDollarsPerContract({ bid, ask, spreadShareCharged }) }) : null;
  const yieldFlash = useFlashOnChange(yieldFraction !== null ? yieldFraction * 100 : null, FLASH_DURATION_MS, 0);
  const columnCells: Record<ChainColumn, ReactNode> = {
    bid: <QuoteWithSize price={bid} size={quote?.bidSize ?? null} flashClass={flashClassName(bidFlash)} />,
    ask: <QuoteWithSize price={ask} size={quote?.askSize ?? null} flashClass={flashClassName(askFlash)} />,
    delta: <span className={`font-mono ${flashClassName(deltaFlash)}`}>{formatChainDelta(delta)}</span>,
    iv: <span className="font-mono">{formatPercentage(impliedVolatility, 1)}</span>,
    yield: <span className={`font-mono ${yieldFraction === null ? "text-secondary" : "option-chain-yield"} ${flashClassName(yieldFlash)}`}>{formatPercentage(yieldFraction, 0)}</span>,
  };
  return (
    <button
      type="button"
      className={`option-chain-cell${showStrike ? " has-strike" : ""}${selected ? " is-selected" : ""}${quote ? "" : " text-secondary"}`}
      aria-label={`${contract.right === "C" ? "Call" : "Put"} ${formatCurrencyTrimmed(contract.strike)}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
    >
      {showStrike && <span className="font-mono fw-bold text-start text-body">{formatCurrencyTrimmed(contract.strike).replace("$", "")}</span>}
      {chainColumnOrder(contract.right, showStrike).map((column) => (
        <Fragment key={column}>{columnCells[column]}</Fragment>
      ))}
    </button>
  );
}

// The Sell chain's bid, ask, delta and IV, then the breakeven columns in place of the yield; a phone keeps the first four.
type LeapsChainColumn = "bid" | "ask" | "delta" | "iv" | "breakeven" | "toBreakeven";
const leapsColumnOrder: LeapsChainColumn[] = ["bid", "ask", "delta", "iv", "breakeven", "toBreakeven"];
const leapsPhoneColumnOrder: LeapsChainColumn[] = ["bid", "ask", "delta", "iv"];

const leapsColumnLabels: Record<LeapsChainColumn, ReactNode> = {
  bid: chainColumnLabels.bid,
  ask: chainColumnLabels.ask,
  delta: chainColumnLabels.delta,
  iv: chainColumnLabels.iv,
  breakeven: <DottedLabelTooltip label="Breakeven" tooltipHtml="The stock price at expiry where the Call pays back its cost: strike + mid." focusable={false} />,
  toBreakeven: <DottedLabelTooltip label="To breakeven" tooltipHtml="How far the stock must rise by expiry to reach the breakeven: breakeven ÷ price − 1." focusable={false} />,
};

function LeapsChainCellButton({ contract, quote, spotPrice, inTheMoney, selected, disabled, compact, onPick }: { contract: ChainContractRef; quote: LiveContractQuote | undefined; spotPrice: number | null; inTheMoney: boolean; selected: boolean; disabled: boolean; compact: boolean; onPick: () => void }) {
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const delta = quote?.delta ?? null;
  const breakeven = mid === null ? null : contract.strike + mid;
  const bidFlash = useFlashOnChange(bid, FLASH_DURATION_MS, 2);
  const askFlash = useFlashOnChange(ask, FLASH_DURATION_MS, 2);
  const columnCells: Record<LeapsChainColumn, ReactNode> = {
    bid: <QuoteWithSize price={bid} size={quote?.bidSize ?? null} flashClass={flashClassName(bidFlash)} />,
    ask: <QuoteWithSize price={ask} size={quote?.askSize ?? null} flashClass={flashClassName(askFlash)} />,
    delta: <span className="font-mono">{formatChainDelta(delta)}</span>,
    iv: <span className="font-mono">{formatPercentage(quote?.impliedVolatility ?? null, 1)}</span>,
    breakeven: <span className="font-mono">{formatCurrency(breakeven)}</span>,
    toBreakeven: <span className="font-mono">{breakeven !== null && spotPrice !== null && spotPrice > 0 ? formatSignedPercentage(breakeven / spotPrice - 1, 1) : "—"}</span>,
  };
  return (
    <button type="button" className={`option-chain-cell is-leaps${compact ? " is-compact" : ""}${selected ? " is-selected" : ""}${quote ? "" : " text-secondary"}`} aria-label={`Call ${formatCurrencyTrimmed(contract.strike)}${inTheMoney ? ", in the money" : ""}`} aria-pressed={selected} disabled={disabled} onClick={onPick}>
      <span className="font-mono fw-bold text-start text-body">
        {formatCurrencyTrimmed(contract.strike).replace("$", "")}
        {inTheMoney && <span className="option-chain-itm-tag text-secondary ms-1">ITM</span>}
      </span>
      {(compact ? leapsPhoneColumnOrder : leapsColumnOrder).map((column) => (
        <Fragment key={column}>{columnCells[column]}</Fragment>
      ))}
    </button>
  );
}

function SpotMarkerRow({ spotPrice, columnCount, markerRef }: { spotPrice: number; columnCount: number; markerRef: (element: HTMLTableRowElement | null) => void }) {
  return (
    <tr ref={markerRef} className="option-chain-spot-row">
      <td colSpan={columnCount} className="p-0">
        <div className="option-chain-spot-marker iorio-note-amber">
          <span className="option-chain-spot-line" />
          <span className="font-mono fw-semibold">{formatCurrency(spotPrice)}</span>
          <span className="option-chain-spot-line" />
        </div>
      </td>
    </tr>
  );
}

export function OptionChainCard({ chain, loading, error, spotPrice, liveQuotes, spreadShareCharged, selectedContractKey, pickingDisabled, phoneSide, onPhoneSideChange, mode, modeSwitchDisabled, onModeChange, onSelectExpiry, onPickContract }: OptionChainCardProps) {
  const isLeapsMode = mode === "leaps";
  const isPhoneLayout = useMediaQuery(phoneLayoutQuery);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const expiryTabsRef = useRef<HTMLDivElement | null>(null);
  const spotMarkerRef = useRef<HTMLTableRowElement | null>(null);
  const setSpotMarker = (element: HTMLTableRowElement | null) => {
    spotMarkerRef.current = element;
  };

  const selectedExpiry = chain?.selectedExpiry ?? null;
  const selectedExpiryDte = chain?.expiries.find((expiry) => expiry.expiry === selectedExpiry)?.dte ?? null;
  const allStrikes = chain?.strikes ?? [];
  // A phone shows one side at a time, so its in-the-money strikes are dropped as rows; the desktop keeps the shared strike column and blanks the cell.
  // The contract under an open order review stays visible even if the spot has since carried it in the money.
  // Buy LEAPS shows every strike.
  const isHiddenAsInTheMoney = (strike: number, right: "C" | "P") => !isLeapsMode && isChainContractInTheMoney(right, strike, spotPrice) && optionContractKey({ expiry: selectedExpiry ?? "", strike, right }) !== selectedContractKey;
  const strikes = isPhoneLayout && !isLeapsMode ? allStrikes.filter((strike) => !isHiddenAsInTheMoney(strike, phoneSide)) : allStrikes;
  // With every visible strike below the spot (a phone's puts) the marker closes the list.
  const spotMarkerIndex = spotPrice === null || strikes.length === 0 ? -1 : strikes.findIndex((strike) => strike >= spotPrice) === -1 ? strikes.length : strikes.findIndex((strike) => strike >= spotPrice);

  // A chain has ~90 strikes: open each expiry (and each phone side) centred on the spot.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const marker = spotMarkerRef.current;
    if (!container || container.clientHeight === 0) return;
    if (!marker) {
      container.scrollTop = 0;
      return;
    }
    const offsetWithinContainer = marker.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, offsetWithinContainer - container.clientHeight / 2);
    // Re-centre only when the rows themselves change, not on every live spot tick.
  }, [chain, isPhoneLayout, phoneSide, mode]);

  // Keep the active expiry tab visible in the horizontally scrolled strip; scrollLeft only, so the modal itself doesn't move.
  useEffect(() => {
    const strip = expiryTabsRef.current;
    const activeTab = strip?.querySelector<HTMLElement>(".is-active");
    if (!strip || !activeTab) return;
    const tabLeft = activeTab.offsetLeft - strip.offsetLeft;
    if (tabLeft < strip.scrollLeft || tabLeft + activeTab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, tabLeft - (strip.clientWidth - activeTab.offsetWidth) / 2);
  }, [selectedExpiry, isPhoneLayout]);

  // Live lines only for what is on screen (useVisibleLiveContracts): each row names its shown, out-of-the-money contracts.
  const liveRowAttributes = (strike: number, rights: ("C" | "P")[]) => {
    const keys = selectedExpiry ? rights.filter((right) => !isHiddenAsInTheMoney(strike, right)).map((right) => optionContractKey({ expiry: selectedExpiry, strike, right })) : [];
    return keys.length > 0 ? { "data-live-contracts": keys.join(",") } : {};
  };

  const cellFor = (strike: number, right: "C" | "P", showStrike: boolean) => {
    const contract: ChainContractRef = { expiry: selectedExpiry ?? "", strike, right };
    const key = optionContractKey(contract);
    if (isHiddenAsInTheMoney(strike, right)) return <div className="option-chain-cell is-in-the-money" aria-hidden="true" />;
    return <ChainCellButton contract={contract} quote={liveQuotes[key]} dte={selectedExpiryDte} spotPrice={spotPrice} spreadShareCharged={spreadShareCharged} selected={key === selectedContractKey} disabled={pickingDisabled} showStrike={showStrike} onPick={() => onPickContract(contract)} />;
  };

  const leapsCellFor = (strike: number) => {
    const contract: ChainContractRef = { expiry: selectedExpiry ?? "", strike, right: "C" };
    const key = optionContractKey(contract);
    return <LeapsChainCellButton contract={contract} quote={liveQuotes[key]} spotPrice={spotPrice} inTheMoney={isChainContractInTheMoney("C", strike, spotPrice)} selected={key === selectedContractKey} disabled={pickingDisabled} compact={isPhoneLayout} onPick={() => onPickContract(contract)} />;
  };

  return (
    <div className="card mt-3">
      <div className="card-header py-2 d-flex flex-wrap align-items-center gap-2">
        <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
          Option chain
        </span>
        <div className={`btn-group option-chain-mode-toggle${isPhoneLayout ? " w-100 order-last" : ""}`} role="group" aria-label="Sell or buy">
          {(["sell", "leaps"] as const).map((option) => (
            <button key={option} type="button" className={`btn ${mode === option ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={mode === option} disabled={modeSwitchDisabled && mode !== option} onClick={() => onModeChange(option)}>
              {option === "sell" ? "Sell" : "Buy LEAPS"}
            </button>
          ))}
        </div>
        <span className="text-secondary ms-lg-auto" style={{ fontSize: "0.75rem" }}>
          {isLeapsMode ? "Every Call strike, in and out of the money · pick one to buy" : "Live quotes for the contracts on screen · pick any out-of-the-money contract to build an order"}
        </span>
      </div>

      {chain && chain.expiries.length > 0 && (
        <div ref={expiryTabsRef} className="option-chain-expiry-tabs border-bottom" role="tablist" aria-label="Expiry">
          {chain.expiries.map((expiry) => {
            const active = expiry.expiry === selectedExpiry;
            return (
              <button key={expiry.expiry} type="button" role="tab" aria-selected={active} className={`option-chain-expiry-tab${active ? " is-active" : ""}`} onClick={() => onSelectExpiry(expiry.expiry)}>
                {describeChainExpiryTab(expiry)}
              </button>
            );
          })}
        </div>
      )}

      {isPhoneLayout && chain && !isLeapsMode && (
        <div className="px-3 pt-2">
          <div className="btn-group w-100" role="group" aria-label="Calls or puts">
            {(["C", "P"] as const).map((side) => (
              <button key={side} type="button" className={`btn ${phoneSide === side ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={phoneSide === side} onClick={() => onPhoneSideChange(side)}>
                {side === "C" ? "Calls" : "Puts"}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="card-body">
          <div className="alert alert-danger mb-0">{error}</div>
        </div>
      )}
      {!error && loading && (
        <div className="d-flex justify-content-center py-4">
          <Spinner label="Loading option chain" />
        </div>
      )}
      {!error && !loading && chain && strikes.length === 0 && (
        <div className="card-body text-secondary" style={{ fontSize: "0.85rem" }}>
          No listed strikes for this expiry.
        </div>
      )}

      {!error && !loading && chain && strikes.length > 0 && (
        <div className="option-chain-scroll-frame">
          <div ref={scrollContainerRef} className={`option-chain-scroll${isPhoneLayout ? " is-phone" : isLeapsMode ? "" : " is-two-sided"}`}>
            {isLeapsMode ? (
              <table className="table table-sm card-table mb-0 option-chain-table">
                <thead className="table-light">
                  <tr>
                    <th className="p-0">
                      <div className={`option-chain-column-labels is-leaps${isPhoneLayout ? " is-compact" : ""}`}>
                        <span className="text-start">Strike</span>
                        {(isPhoneLayout ? leapsPhoneColumnOrder : leapsColumnOrder).map((column) => (
                          <Fragment key={column}>{leapsColumnLabels[column]}</Fragment>
                        ))}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((strike, index) => (
                    <Fragment key={strike}>
                      {index === spotMarkerIndex && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
                      <tr {...liveRowAttributes(strike, ["C"])}>
                        <td className="p-0">{leapsCellFor(strike)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  {spotMarkerIndex === strikes.length && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
                </tbody>
              </table>
            ) : isPhoneLayout ? (
              <table className="table table-sm card-table mb-0 option-chain-table">
                <thead className="table-light">
                  <tr>
                    <th className="p-0">
                      <div className="option-chain-column-labels has-strike">
                        <span className="text-start">Strike</span>
                        <ChainColumnLabels right="P" hasLeadingStrike />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((strike, index) => (
                    <Fragment key={strike}>
                      {index === spotMarkerIndex && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
                      <tr {...liveRowAttributes(strike, [phoneSide])}>
                        <td className="p-0">{cellFor(strike, phoneSide, true)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  {spotMarkerIndex === strikes.length && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
                </tbody>
              </table>
            ) : (
              <table className="table table-sm card-table mb-0 option-chain-table is-two-sided">
                <thead className="table-light">
                  <tr>
                    <th className="p-0">
                      <div className="text-center pt-1">Calls</div>
                      <div className="option-chain-column-labels">
                        <ChainColumnLabels right="C" hasLeadingStrike={false} />
                      </div>
                    </th>
                    <th className="text-center align-bottom option-chain-strike-column">Strike</th>
                    <th className="p-0">
                      <div className="text-center pt-1">Puts</div>
                      <div className="option-chain-column-labels">
                        <ChainColumnLabels right="P" hasLeadingStrike={false} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((strike, index) => (
                    <Fragment key={strike}>
                      {index === spotMarkerIndex && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={3} markerRef={setSpotMarker} />}
                      <tr {...liveRowAttributes(strike, ["C", "P"])}>
                        <td className="p-0">{cellFor(strike, "C", false)}</td>
                        <td className="text-center align-middle fw-bold font-mono option-chain-strike-column">{formatCurrencyTrimmed(strike).replace("$", "")}</td>
                        <td className="p-0">{cellFor(strike, "P", false)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  {spotMarkerIndex === strikes.length && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={3} markerRef={setSpotMarker} />}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
