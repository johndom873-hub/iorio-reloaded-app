import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { bookLabels, fetchTickerSwitchPreview, type BookKey, type TickerSwitchPlan } from "../../api/books";
import { formatCurrency, formatSignedPnl, pluralize, pnlTextClass } from "../../lib/formatters";
import { ConfirmModal } from "../ConfirmModal";
import { Spinner } from "../Spinner";

interface PlutoStopsManagingConfirmProps {
  entryId: string;
  symbol: string;
  /** Whether Pluto is on for the ticker now: the switch turns it off when true, on when false. */
  botEnabled: boolean;
  openPositionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Whether a Pluto switch asks first: the ticker has open positions, which move between the books at the mark. */
export function plutoStopsManagingPositions(_botEnabled: boolean, openPositionCount: number): boolean {
  return openPositionCount > 0;
}

const markWords: Record<TickerSwitchPlan["legs"][number]["markSource"], string> = { live: "mid now", close: "last close", entry: "entry price" };

/**
 * Asks before Pluto is switched on or off for a ticker with open positions (Marcelo 2026-10-07; the books 2026-11-05,
 * mockup https://claude.ai/artifact/BsfaHtEXioGY52rbmVBHLr): each leg moves to the other book at its mark, the source
 * book takes its profit or loss on it, and the receiving book pays the legs' value. Switched off, Pluto stops managing them.
 */
export function PlutoStopsManagingConfirm({ entryId, symbol, botEnabled, openPositionCount, onConfirm, onCancel }: PlutoStopsManagingConfirmProps) {
  const enabling = !botEnabled;
  const [preview, setPreview] = useState<{ transfer: TickerSwitchPlan | null; availableCashAfter?: Record<BookKey, number | null> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchTickerSwitchPreview(entryId, enabling)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not price the positions that move."));
  }, [entryId, enabling]);

  const transfer = preview?.transfer ?? null;
  const pays = transfer && transfer.totalValueDollars >= 0 ? `${bookLabels[transfer.toBook]} pays ${bookLabels[transfer.fromBook]}` : transfer ? `${bookLabels[transfer.fromBook]} pays ${bookLabels[transfer.toBook]}` : "";
  const stopsManaging = !enabling ? ` Once it is off for ${symbol}, Pluto will not close or roll ${openPositionCount === 1 ? "it" : "them"}.` : "";

  return (
    <ConfirmModal
      title={enabling ? `Switch Pluto on for ${symbol}?` : `Stop Pluto managing ${symbol}?`}
      danger={!enabling}
      size={transfer && transfer.legs.length > 0 ? "lg" : undefined}
      confirmDisabled={preview === null && error === null}
      confirmLabel={transfer && transfer.legs.length > 0 ? `${enabling ? "Switch on" : "Switch off"} and move ${symbol}` : enabling ? "Switch on" : "Switch off"}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <div className="d-flex flex-column gap-2">
          {error && <div className="alert alert-danger mb-0">{error}</div>}
          {preview === null && error === null && <Spinner size="sm" label="Pricing the positions that move" />}
          {preview !== null && (transfer === null || transfer.legs.length === 0) && (
            <div>
              {symbol} has {pluralize(openPositionCount, "open position")}.{stopsManaging}
            </div>
          )}
          {transfer && transfer.legs.length > 0 && (
            <>
              <div style={{ fontSize: "0.85rem" }}>
                {symbol}'s open positions move from {bookLabels[transfer.fromBook]} to {bookLabels[transfer.toBook]} at today's mid. {bookLabels[transfer.fromBook]} takes its profit or loss on them now; {bookLabels[transfer.toBook]} holds them as if it had just opened them at these prices.{stopsManaging}
              </div>
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Leg</th>
                      <th className="text-end">Opened at</th>
                      <th className="text-end">Mark</th>
                      <th className="text-end">Value</th>
                      <th className="text-end">{bookLabels[transfer.fromBook]} realises</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfer.legs.map((leg) => (
                      <tr key={leg.legId}>
                        <td>{leg.label}</td>
                        <td className="text-end font-mono">{formatCurrency(leg.costBasisPrice)}</td>
                        <td className="text-end font-mono" title={markWords[leg.markSource]}>
                          {formatCurrency(leg.markPrice)}
                        </td>
                        <td className="text-end font-mono">{formatCurrency(leg.valueDollars, 0)}</td>
                        <td className={`text-end font-mono ${pnlTextClass(leg.realizedDollars)}`}>{formatSignedPnl(leg.realizedDollars, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <table className="table table-sm mb-0">
                <tbody>
                  <tr>
                    <td>{pays}</td>
                    <td className="text-end font-mono fw-bold">{formatCurrency(Math.abs(transfer.totalValueDollars), 0)}</td>
                  </tr>
                  {(["pluto", "manual"] as const).map((book) => (
                    <tr key={book}>
                      <td>{bookLabels[book]}'s available cash after</td>
                      <td className="text-end font-mono">{formatCurrency(preview?.availableCashAfter?.[book] ?? null, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                Neither book's value changes at the switch. Marks are the live mids now; outside market hours, the last close.
              </div>
            </>
          )}
        </div>
      }
    />
  );
}
