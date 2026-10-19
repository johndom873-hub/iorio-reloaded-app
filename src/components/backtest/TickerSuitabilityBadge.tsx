import type { Ref } from "react";
import { IconNotes } from "@tabler/icons-react";
import type { BacktestTickerSuitability } from "../../api/backtest";
import { useTooltip } from "../../hooks/useTooltip";
import { tickerSuitabilityBadgeClass, tickerSuitabilityLabel } from "../../lib/backtestPresentation";

interface TickerSuitabilityBadgeProps {
  symbol: string;
  /** Null: Pending. */
  suitability: BacktestTickerSuitability | null;
  /** Null for a trader: the badge only shows (only an admin marks a ticker). */
  onOpen: (() => void) | null;
}

/** The Data files table's Suitability cell: the badge, a note icon when there is a note, the note on hover; an admin's badge opens the window. */
export function TickerSuitabilityBadge({ symbol, suitability, onOpen }: TickerSuitabilityBadgeProps) {
  const status = suitability?.status ?? "pending";
  const note = suitability?.note || null;
  const tooltipRef = useTooltip<HTMLElement>(note, { multiline: true });
  const content = (
    <>
      <span className={`badge ${tickerSuitabilityBadgeClass[status]}`}>{tickerSuitabilityLabel[status]}</span>
      {note && <IconNotes size={14} stroke={2} aria-hidden="true" />}
    </>
  );
  if (!onOpen) {
    return (
      <span ref={tooltipRef} className="ticker-suitability-cell text-secondary" tabIndex={note ? 0 : undefined} aria-label={`${symbol}: ${tickerSuitabilityLabel[status]}${note ? `. ${note}` : ""}`}>
        {content}
      </span>
    );
  }
  return (
    <button
      ref={tooltipRef as Ref<HTMLButtonElement>}
      type="button"
      className="ticker-suitability-cell ticker-suitability-button text-secondary"
      aria-label={`${symbol}: ${tickerSuitabilityLabel[status]}${note ? ", has a note" : ""}. Open to change`}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
