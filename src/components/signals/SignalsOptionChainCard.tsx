import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { SignalCandidate, SignalGrade, SignalsChain, SignalsChainCell } from "../../api/signals";
import { FLASH_DURATION_MS, flashClassName, useFlashOnChange } from "../../hooks/useFlashOnChange";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCurrency, formatCurrencyTrimmed, formatPercentage, formatQuotePrice } from "../../lib/formatters";
import { computeAnnualizedYield } from "../../lib/payoff";
import { chainCellStateExplanation, describeChainExpiryTab, escapeTooltipHtml, gradeBadgeClass, gradeLabel, isChainContractInTheMoney, signalContractKey } from "../../lib/signalsPresentation";
import { DottedLabelTooltip } from "../HelpTooltip";
import { Spinner } from "../Spinner";

// The Signals modal's full option chain (mockup approved 2026-09-29): every
// stored strike of one expiry, calls left / puts right on desktop, one side at
// a time with a Calls/Puts toggle on a phone. Any cell can be picked; the
// modal decides whether it is a candidate (order form straight away) or needs
// the contract endpoint first.

export interface ChainContractRef {
  expiry: string;
  strike: number;
  right: "C" | "P";
}

interface SignalsOptionChainCardProps {
  chain: SignalsChain | null;
  loading: boolean;
  error: string | null;
  /** The live spot, for the marker row. */
  spotPrice: number | null;
  /** The modal's live-scored candidates by signalContractKey: a candidate cell shows (and flashes) these rather than the chain's fetch-time copy. */
  liveCandidatesByKey: Map<string, SignalCandidate>;
  /** Cells of the contracts holding a live line, scored at the live spot by the stream: they replace the chain's fetch-time cell. */
  liveChainCells: Record<string, SignalsChainCell>;
  selectedContractKey: string | null;
  /** While an order is under review nothing else can be picked. */
  pickingDisabled: boolean;
  phoneSide: "C" | "P";
  onPhoneSideChange: (side: "C" | "P") => void;
  onSelectExpiry: (expiry: string) => void;
  onPickContract: (contract: ChainContractRef, cell: SignalsChainCell) => void;
}

const phoneLayoutQuery = "(max-width: 991.98px)";

/** Chain cell as displayed: a candidate takes the live-scored bid/ask/delta/grade when the modal has it. */
function displayedCell(cell: SignalsChainCell, liveCandidate: SignalCandidate | undefined): { bid: number | null; ask: number | null; delta: number | null; grade: SignalGrade | null } {
  if (cell.state === "candidate" && liveCandidate) return { bid: liveCandidate.bid, ask: liveCandidate.ask, delta: liveCandidate.delta, grade: liveCandidate.grade };
  return { bid: cell.bid, ask: cell.ask, delta: cell.delta, grade: cell.grade };
}

type ChainColumn = "bid" | "ask" | "delta" | "yield" | "grade";

// Calls mirror the puts around the strike column (Marcelo, 2026-09-30): grade, yield, Δ, bid, ask | strike | bid, ask, Δ, yield, grade.
// A phone shows one side with the strike leading, so it always uses the puts order.
const putsColumnOrder: ChainColumn[] = ["bid", "ask", "delta", "yield", "grade"];
const callsColumnOrder: ChainColumn[] = ["grade", "yield", "delta", "bid", "ask"];

function chainColumnOrder(right: "C" | "P", hasLeadingStrike: boolean): ChainColumn[] {
  return right === "C" && !hasLeadingStrike ? callsColumnOrder : putsColumnOrder;
}

const chainColumnLabels: Record<ChainColumn, ReactNode> = {
  bid: <span>Bid</span>,
  ask: <span>Ask</span>,
  delta: <span>Δ</span>,
  yield: <DottedLabelTooltip label="Yield" tooltipHtml="Annualised yield at the mid price: (mid ÷ strike for a put, ÷ spot for a call) × 365 ÷ days to expiry." focusable={false} />,
  grade: <span>Grade</span>,
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

function formatChainDelta(delta: number | null): string {
  return delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
}

function describeCellForScreenReader(contract: ChainContractRef, cell: SignalsChainCell, grade: SignalGrade | null): string {
  const contractLabel = `${contract.right === "C" ? "Call" : "Put"} ${formatCurrencyTrimmed(contract.strike)}`;
  if (cell.state === "candidate") return `${contractLabel}, Signals candidate${grade ? `, graded ${gradeLabel[grade]}` : ""}`;
  if (cell.state === "filtered") return `${contractLabel}, filtered: ${cell.reason ?? "not a Signals candidate"}`;
  if (cell.state === "unscored") return `${contractLabel}, not graded: ${cell.reason ?? "this ticker has no score"}`;
  return `${contractLabel}, not in today's capture or refresh`;
}

function ChainCellButton({ contract, cell, liveCandidate, dte, spotPrice, selected, disabled, showStrike, unscoredLabel, onPick }: { contract: ChainContractRef; cell: SignalsChainCell; liveCandidate: SignalCandidate | undefined; dte: number | null; spotPrice: number | null; selected: boolean; disabled: boolean; showStrike: boolean; unscoredLabel: string; onPick: () => void }) {
  const shown = displayedCell(cell, liveCandidate);
  // Cells update between fetches (live frames); compared at the displayed 2 decimals.
  const bidFlash = useFlashOnChange(cell.state !== "not_captured" ? shown.bid : null, FLASH_DURATION_MS, 2);
  const askFlash = useFlashOnChange(cell.state !== "not_captured" ? shown.ask : null, FLASH_DURATION_MS, 2);
  const deltaFlash = useFlashOnChange(cell.state !== "not_captured" ? shown.delta : null, FLASH_DURATION_MS, 2);
  // Annualised yield at the mid (approved formula, lib/payoff); a call needs the spot for its capital base.
  const yieldFraction = shown.bid !== null && shown.ask !== null && dte !== null ? computeAnnualizedYield(contract.right === "C" ? "covered_call" : "cash_secured_put", { premium: (shown.bid + shown.ask) / 2, dte, strike: contract.strike, spotPrice: spotPrice ?? 0 }) : null;
  const yieldFlash = useFlashOnChange(cell.state !== "not_captured" && yieldFraction !== null ? yieldFraction * 100 : null, FLASH_DURATION_MS, 0);
  const notCaptured = cell.state === "not_captured";
  const columnCells: Record<ChainColumn, ReactNode> = {
    bid: <span className={`font-mono ${flashClassName(bidFlash)}`}>{formatQuotePrice(shown.bid)}</span>,
    ask: <span className={`font-mono ${flashClassName(askFlash)}`}>{formatQuotePrice(shown.ask)}</span>,
    delta: <span className={`font-mono ${flashClassName(deltaFlash)}`}>{formatChainDelta(shown.delta)}</span>,
    yield: <span className={`font-mono signals-chain-yield ${flashClassName(yieldFlash)}`}>{formatPercentage(yieldFraction, 0)}</span>,
    grade: (
      <span className="d-flex justify-content-end">
        {cell.state === "candidate" && shown.grade && (
          <span className={`badge ${gradeBadgeClass[shown.grade]}`} style={{ fontSize: "0.72rem" }}>
            {gradeLabel[shown.grade]}
          </span>
        )}
        {cell.state === "unscored" && <DottedLabelTooltip label={unscoredLabel} tooltipHtml={escapeTooltipHtml(cell.reason ?? "This ticker has no score")} className="text-secondary signals-chain-filtered-label" focusable={false} />}
        {cell.state === "filtered" && <DottedLabelTooltip label="Filtered" tooltipHtml={escapeTooltipHtml(cell.reason ?? "Not a Signals candidate")} className="text-secondary signals-chain-filtered-label" focusable={false} />}
      </span>
    ),
  };
  return (
    <button
      type="button"
      className={`signals-chain-cell${showStrike ? " has-strike" : ""}${selected ? " is-selected" : ""}${notCaptured ? " text-secondary" : ""}`}
      aria-label={describeCellForScreenReader(contract, cell, shown.grade)}
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

function SpotMarkerRow({ spotPrice, columnCount, markerRef }: { spotPrice: number; columnCount: number; markerRef: (element: HTMLTableRowElement | null) => void }) {
  return (
    <tr ref={markerRef} className="signals-chain-spot-row">
      <td colSpan={columnCount} className="p-0">
        <div className="signals-chain-spot-marker iorio-note-amber">
          <span className="signals-chain-spot-line" />
          <span className="font-mono fw-semibold">{formatCurrency(spotPrice)}</span>
          <span className="signals-chain-spot-line" />
        </div>
      </td>
    </tr>
  );
}

export function SignalsOptionChainCard({ chain, loading, error, spotPrice, liveCandidatesByKey, liveChainCells, selectedContractKey, pickingDisabled, phoneSide, onPhoneSideChange, onSelectExpiry, onPickContract }: SignalsOptionChainCardProps) {
  const isPhoneLayout = useMediaQuery(phoneLayoutQuery);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const expiryTabsRef = useRef<HTMLDivElement | null>(null);
  const spotMarkerRef = useRef<HTMLTableRowElement | null>(null);
  const setSpotMarker = (element: HTMLTableRowElement | null) => {
    spotMarkerRef.current = element;
  };

  const selectedExpiry = chain?.selectedExpiry ?? null;
  const selectedExpiryDte = chain?.expiries.find((expiry) => expiry.expiry === selectedExpiry)?.dte ?? null;
  const allRows = chain?.strikes ?? [];
  // A phone shows one side at a time, so its in-the-money strikes are dropped as rows; the desktop keeps the shared strike column and blanks the cell.
  // The contract under an open order review stays visible even if the spot has since carried it in the money.
  const isHiddenAsInTheMoney = (strike: number, right: "C" | "P") => isChainContractInTheMoney(right, strike, spotPrice) && signalContractKey({ expiry: selectedExpiry ?? "", strike, right }) !== selectedContractKey;
  const rows = isPhoneLayout ? allRows.filter((row) => !isHiddenAsInTheMoney(row.strike, phoneSide)) : allRows;
  // With every visible strike below the spot (a phone's puts) the marker closes the list.
  const spotMarkerIndex = spotPrice === null || rows.length === 0 ? -1 : rows.findIndex((row) => row.strike >= spotPrice) === -1 ? rows.length : rows.findIndex((row) => row.strike >= spotPrice);

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
  }, [chain, isPhoneLayout, phoneSide]);

  // Keep the active expiry tab visible in the horizontally scrolled strip (a phone shows 3-4 tabs); scrollLeft only, so the modal itself doesn't move.
  useEffect(() => {
    const strip = expiryTabsRef.current;
    const activeTab = strip?.querySelector<HTMLElement>(".is-active");
    if (!strip || !activeTab) return;
    const tabLeft = activeTab.offsetLeft - strip.offsetLeft;
    if (tabLeft < strip.scrollLeft || tabLeft + activeTab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, tabLeft - (strip.clientWidth - activeTab.offsetWidth) / 2);
  }, [selectedExpiry, isPhoneLayout]);

  // Live lines only for what is on screen (useVisibleLiveContracts): each row names its shown, out-of-the-money contracts.
  const liveRowAttributes = (strike: number, rights: ("C" | "P")[]) => {
    const keys = selectedExpiry ? rights.filter((right) => !isHiddenAsInTheMoney(strike, right)).map((right) => signalContractKey({ expiry: selectedExpiry, strike, right })) : [];
    return keys.length > 0 ? { "data-live-contracts": keys.join(",") } : {};
  };

  // A ticker still being analysed reads "Analysing" on its cells, the same word as its row and banner; any other reason reads "Unscored".
  const unscoredLabel = chain?.unscoredReason === "analysing" ? "Analysing" : "Unscored";
  const cellFor = (strike: number, right: "C" | "P", cell: SignalsChainCell, showStrike: boolean) => {
    const contract: ChainContractRef = { expiry: selectedExpiry ?? "", strike, right };
    const key = signalContractKey(contract);
    if (isHiddenAsInTheMoney(strike, right)) return <div className="signals-chain-cell is-in-the-money" aria-hidden="true" />;
    const shownCell = liveChainCells[key] ?? cell;
    return (
      <ChainCellButton
        contract={contract}
        cell={shownCell}
        liveCandidate={shownCell.state === "candidate" && !liveChainCells[key] ? liveCandidatesByKey.get(key) : undefined}
        dte={selectedExpiryDte}
        spotPrice={spotPrice}
        selected={key === selectedContractKey}
        disabled={pickingDisabled}
        showStrike={showStrike}
        unscoredLabel={unscoredLabel}
        onPick={() => onPickContract(contract, shownCell)}
      />
    );
  };

  return (
    <div className="card mt-3">
      <div className="card-header py-2 d-flex flex-wrap align-items-center gap-2">
        <span className="text-secondary text-uppercase fw-bold" style={{ fontSize: "0.72rem", letterSpacing: "0.06em" }}>
          Option chain
        </span>
        <span className="text-secondary ms-lg-auto" style={{ fontSize: "0.75rem" }}>
          Pick any out-of-the-money contract, call or put, to build an order
        </span>
      </div>

      {chain && chain.expiries.length > 0 && (
        <div ref={expiryTabsRef} className="signals-chain-expiry-tabs border-bottom" role="tablist" aria-label="Expiry">
          {chain.expiries.map((expiry) => {
            const active = expiry.expiry === selectedExpiry;
            return (
              <button key={expiry.expiry} type="button" role="tab" aria-selected={active} className={`signals-chain-expiry-tab${active ? " is-active" : ""}`} onClick={() => onSelectExpiry(expiry.expiry)}>
                {describeChainExpiryTab(expiry)}
                {expiry.hasCandidate && (
                  <>
                    <span className="signals-chain-candidate-dot" aria-hidden="true" />
                    <span className="visually-hidden">, has Signals candidates</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isPhoneLayout && chain && (
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
      {!error && !loading && chain && rows.length === 0 && (
        <div className="card-body text-secondary" style={{ fontSize: "0.85rem" }}>
          No option chain stored for this ticker yet.
        </div>
      )}

      {!error && !loading && chain && rows.length > 0 && (
        <div ref={scrollContainerRef} className={`signals-chain-scroll${isPhoneLayout ? " is-phone" : ""}`}>
          {isPhoneLayout ? (
            <table className="table table-sm card-table mb-0 signals-chain-table">
              <thead className="table-light">
                <tr>
                  <th className="p-0">
                    <div className="signals-chain-column-labels has-strike">
                      <span className="text-start">Strike</span>
                      <ChainColumnLabels right="P" hasLeadingStrike />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <Fragment key={row.strike}>
                    {index === spotMarkerIndex && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
                    <tr {...liveRowAttributes(row.strike, [phoneSide])}>
                      <td className="p-0">{cellFor(row.strike, phoneSide, phoneSide === "C" ? row.call : row.put, true)}</td>
                    </tr>
                  </Fragment>
                ))}
                {spotMarkerIndex === rows.length && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={1} markerRef={setSpotMarker} />}
              </tbody>
            </table>
          ) : (
            <table className="table table-sm card-table mb-0 signals-chain-table is-two-sided">
              <thead className="table-light">
                <tr>
                  <th className="p-0">
                    <div className="text-center pt-1">Calls</div>
                    <div className="signals-chain-column-labels">
                      <ChainColumnLabels right="C" hasLeadingStrike={false} />
                    </div>
                  </th>
                  <th className="text-center align-bottom signals-chain-strike-column">Strike</th>
                  <th className="p-0">
                    <div className="text-center pt-1">Puts</div>
                    <div className="signals-chain-column-labels">
                      <ChainColumnLabels right="P" hasLeadingStrike={false} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <Fragment key={row.strike}>
                    {index === spotMarkerIndex && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={3} markerRef={setSpotMarker} />}
                    <tr {...liveRowAttributes(row.strike, ["C", "P"])}>
                      <td className="p-0">{cellFor(row.strike, "C", row.call, false)}</td>
                      <td className="text-center align-middle fw-bold font-mono signals-chain-strike-column">{formatCurrencyTrimmed(row.strike).replace("$", "")}</td>
                      <td className="p-0">{cellFor(row.strike, "P", row.put, false)}</td>
                    </tr>
                  </Fragment>
                ))}
                {spotMarkerIndex === rows.length && spotPrice !== null && <SpotMarkerRow spotPrice={spotPrice} columnCount={3} markerRef={setSpotMarker} />}
              </tbody>
            </table>
          )}
        </div>
      )}

      {chain && rows.length > 0 && (
        <div className="card-footer d-flex flex-wrap gap-2 column-gap-4 text-secondary" style={{ fontSize: "0.75rem" }}>
          <span className="d-inline-flex align-items-center gap-2">
            <span className={`badge ${gradeBadgeClass.good}`} style={{ fontSize: "0.72rem" }}>
              {gradeLabel.good}
            </span>
            {chainCellStateExplanation.candidate}
          </span>
          {chain.unscoredReason ? (
            <span className="d-inline-flex align-items-center gap-2">
              <span className="dotted-underline-label signals-chain-filtered-label">{unscoredLabel}</span>
              {chainCellStateExplanation.unscored}
            </span>
          ) : (
            <span className="d-inline-flex align-items-center gap-2">
              <span className="dotted-underline-label signals-chain-filtered-label">Filtered</span>
              {chainCellStateExplanation.filtered}
            </span>
          )}
          <span className="d-inline-flex align-items-center gap-2">
            <span className="font-mono">—</span>
            {chainCellStateExplanation.notCaptured}
          </span>
        </div>
      )}
    </div>
  );
}
