import { useState, type ReactNode } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { AnalysisBook, PnlAnalysis } from "../../api/pnlAnalysis";
import { asShownDollars, formatCurrency, formatDayMonth, formatSignedPercentageValue, formatSignedPnl, pnlTextClass } from "../../lib/formatters";
import { bookChoiceLabels, minimumCalendarDaysForReturnOnCapital, returnOnCapitalPercent, strategyRows, sumComponents, waterfallSteps } from "../../lib/pnlAnalysisPresentation";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { TooltipSpan } from "../TooltipSpan";
import { PnlWaterfallChart } from "./PnlWaterfallChart";

const bucketNames = { csp: "Cash-secured puts", cc: "Covered calls", unstructured: "No strategy (shares)", leaps: "LEAPS", hedge: "Hedges (bought puts)" } as const;

const columns: { label: string; hint: string }[] = [
  { label: "Put premium", hint: "Puts sold less bought back, before commissions" },
  { label: "Call premium", hint: "Calls sold less bought back, before commissions" },
  { label: "Stock", hint: "Shares held by the strategy; for CSP the assignment charge, (expiry close − strike) × shares" },
  { label: "LEAPS", hint: "Bought calls of a LEAPS position, marked nightly" },
  { label: "Hedge", hint: "Bought puts, marked nightly" },
  { label: "Commissions", hint: "IBKR commissions on the fills" },
  { label: "Total", hint: "The row's P&L" },
  { label: "Realised", hint: "Total less the change in what is still open" },
  { label: "Unrealised", hint: "Change in the marks of what is still open" },
  { label: "Avg capital", hint: "Capital in use averaged over the calendar days: CSP strike × shares, shares at their cost into the strategy, LEAPS and hedges at what they cost" },
  { label: "RoC (ann.)", hint: "Total ÷ (Σ daily capital ÷ 365), from 90 days" },
];

function MoneyCell({ value: rawValue, bold }: { value: number | null; bold?: boolean }) {
  const value = rawValue === null ? null : asShownDollars(rawValue);
  return <td className={`text-end ${bold ? "fw-bold " : ""}${value === null ? "" : pnlTextClass(value)}`}>{value === null ? "" : formatSignedPnl(value, 0)}</td>;
}

// Where the P&L came from (mockup approved 2026-11-13): the waterfall, then every strategy by component, then what is no
// strategy's, down to the book's P&L from its nightly value.
export function PnlAttributionTab({ analysis, book }: { analysis: PnlAnalysis; book: AnalysisBook }) {
  const [split, setSplit] = useState(false);
  const isPhone = useMediaQuery("(max-width: 575.98px)");
  const bookAnalysis = analysis.books[book];
  const risk = bookAnalysis.risk;
  if (!risk) return <div className="text-secondary">The {bookChoiceLabels[book]} book has no nights in this period.</div>;
  const components = sumComponents(bookAnalysis.nights);
  const splitByBook = book === "all" && split;
  const rows = strategyRows(bookAnalysis, splitByBook);
  const calendarDays = risk.calendarDays;
  const totalOnlyRows: [string, number, string][] = [
    ["Interest", components.interest, "IBKR's interest on cash"],
    ["Dividends", components.dividends, "Dividends less withholding tax"],
    ["Fees & taxes", components.fees, "Market data and other fees, and their GST"],
    ["Other cash", components.otherCash, "Statement rows of another kind (a corporate action's cash)"],
    ["Cycles with incomplete data", components.flagged, "Cycles left out of the strategies because their fills can't be trusted (named in the By ticker tab)"],
    ["IBKR valuation of the account", components.ibkrValuation, "The account's P&L less Pluto's and Manual's: IBKR's own marks and accrued interest against the books' snapshot prices"],
    ["Unexplained", components.unexplained, "The book's P&L less everything above; nothing is hidden in the other rows"],
  ];
  const emptyCells = (count: number): ReactNode[] => Array.from({ length: count }, (_, index) => <td key={index} />);

  return (
    <>
      <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2 mb-1">
        <div className="fw-semibold">
          Where the {bookChoiceLabels[book]} P&amp;L came from{" "}
          <span className="text-secondary fw-normal" style={{ fontSize: "0.8rem" }}>
            {formatDayMonth(risk.baselineNight)} close to {formatDayMonth(risk.lastNight)} · {calendarDays} days
          </span>
        </div>
        <div className="text-secondary" style={{ fontSize: "0.8rem" }}>Green adds, red takes away; the last bar is the book's P&amp;L from its nightly value</div>
      </div>
      <PnlWaterfallChart steps={waterfallSteps(components)} total={components.bookPnl} orientation={isPhone ? "horizontal" : "vertical"} />

      <div className="d-flex justify-content-between align-items-center mt-3 mb-2">
        <div className="fw-semibold">By strategy and component</div>
        {book === "all" && (
          <label className="form-check form-switch mb-0" style={{ fontSize: "0.85rem" }}>
            <input className="form-check-input" type="checkbox" checked={split} onChange={() => setSplit((value) => !value)} />
            <span className="form-check-label">Split by book</span>
          </label>
        )}
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-vcenter card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Strategy</th>
              {columns.map((column) => (
                <TooltipSpan key={column.label} as="th" className="text-end" text={column.hint}>
                  {column.label}
                </TooltipSpan>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const returnOnCapital = returnOnCapitalPercent(row.total, row.capitalDays, calendarDays);
              return (
                <tr key={`${row.bucket}-${row.book ?? "all"}`}>
                  <td className="text-nowrap">
                    <CycleBucketBadge bucket={row.bucket} /> <span className={row.book ? "text-secondary" : ""}>{row.book ? bookChoiceLabels[row.book] : bucketNames[row.bucket]}</span>
                  </td>
                  <MoneyCell value={row.putPremium} />
                  <MoneyCell value={row.callPremium} />
                  <MoneyCell value={row.stock} />
                  <MoneyCell value={row.leaps} />
                  <MoneyCell value={row.hedge} />
                  <MoneyCell value={row.commissions} />
                  <MoneyCell value={row.total} bold />
                  <MoneyCell value={row.realized} />
                  <MoneyCell value={row.unrealized} />
                  <td className="text-end">{row.capitalDays > 0 && calendarDays > 0 ? formatCurrency(row.capitalDays / calendarDays, 0) : ""}</td>
                  <td className={`text-end ${returnOnCapital === null ? "text-secondary" : pnlTextClass(returnOnCapital)}`}>
                    {row.capitalDays <= 0 ? "" : returnOnCapital === null ? (
                      <>
                        —<div style={{ fontSize: "0.72rem", fontFamily: "var(--tblr-font-sans-serif)" }}>{calendarDays} of {minimumCalendarDaysForReturnOnCapital} days</div>
                      </>
                    ) : (
                      formatSignedPercentageValue(returnOnCapital, 1)
                    )}
                  </td>
                </tr>
              );
            })}
            {totalOnlyRows
              .filter(([label, value]) => Math.round(value) !== 0 || label === "Unexplained")
              .map(([label, value, hint]) => (
                <tr key={label}>
                  <td>
                    <TooltipSpan text={hint} className="dotted-underline-label">{label}</TooltipSpan>
                  </td>
                  {emptyCells(6)}
                  <MoneyCell value={value} bold />
                  <MoneyCell value={value} />
                  {emptyCells(3)}
                </tr>
              ))}
          </tbody>
          <tfoot className="table-totals-row">
            <tr>
              <td>{bookChoiceLabels[book]} P&amp;L</td>
              {[components.putPremium, components.callPremium, components.stock, components.leaps, components.hedge, components.commissions, components.bookPnl].map((value, index) => (
                <td key={index} className={`text-end ${pnlTextClass(asShownDollars(value))}`}>{formatSignedPnl(asShownDollars(value), 0)}</td>
              ))}
              {emptyCells(4)}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="text-secondary mt-2" style={{ fontSize: "0.75rem" }}>
        The rows add up to the book's P&amp;L from its nightly value. {book === "all" ? "Before the books began, everything counts as Manual when split." : "A ticker that changed book counts each night in the book it was in that night; hedges are always Manual's."}
      </div>
    </>
  );
}
