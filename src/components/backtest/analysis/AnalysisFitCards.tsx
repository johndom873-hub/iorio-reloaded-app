import { useState } from "react";
import { IconAlertCircle, IconAlertTriangle, IconCheck, IconCircleCheck, IconCircleX, IconX } from "@tabler/icons-react";
import { analysisEveryDayPotFormulasVersion, type AnalysisBacktestFigures, type AnalysisFigures } from "../../../api/backtestAnalysis";
import {
  firstRungCap,
  fitHistoryByYear,
  liquidityLevel,
  lotPriceCeiling,
  potOnDayFrom,
  potRange,
  roundPot,
  rungPriceCeiling,
  shockFor,
  type AnalysisFitYear,
  type AnalysisLevel,
  type AnalysisPanelValues,
} from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonth, formatDayMonthYear, formatNumber, formatOptionContractLabel, formatPercentage, formatPercentagePoints } from "../../../lib/formatters";
import { ColumnVisibilityPopover } from "../../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../DataTable/useColumnVisibility";
import { TooltipSpan } from "../../TooltipSpan";
import { BacktestSegmentedSwitch } from "../backtestBits";
import { AnalysisCard, AnalysisNote } from "./analysisBits";

// The fit at the values shown (at the last stored 10:00 price) and over the history (each day against the pot the analysis
// backtest's ladder sized from), the pot size (the X% points of the daily smallest and largest pots, every day), when
// orders are too large (the analysis backtest's order records), and the recommended shock. Formulas approved 2026-10-15.

const levelIcons: Record<AnalysisLevel, typeof IconCircleCheck> = { good: IconCircleCheck, fair: IconAlertCircle, poor: IconCircleX };

function YesNo({ ok }: { ok: boolean }) {
  return (
    <span className={`badge ${ok ? "bg-success text-success-fg" : "bg-danger text-danger-fg"} d-inline-flex align-items-center gap-1`} style={{ fontSize: "0.72rem" }}>
      {ok ? <IconCheck size={12} aria-hidden="true" /> : <IconX size={12} aria-hidden="true" />}
      {ok ? "Yes" : "No"}
    </span>
  );
}

function RangeBar({ min, max, okFrom, okTo, at }: { min: number; max: number; okFrom: number; okTo: number; at: number }) {
  const position = (value: number) => Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="analysis-range-bar" aria-hidden="true">
      {okTo > okFrom && <span className="is-ok" style={{ left: `${position(okFrom)}%`, right: `${100 - position(okTo)}%` }} />}
      <span className="is-at" style={{ left: `${position(at)}%` }} />
    </div>
  );
}

const fitHistoryColumns = [
  { key: "days", header: "Days" },
  { key: "lot", header: "Lot: days it didn't fit" },
  { key: "rung", header: "Rung: days it didn't fit" },
];

function FitHistory({ figures, values, shock, showingTrial }: { figures: AnalysisFigures; values: AnalysisPanelValues; shock: number; showingTrial: boolean }) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-fit-history", fitHistoryColumns.map((column) => column.key));
  const backtest = figures.analysisBacktest && "sessionId" in figures.analysisBacktest ? figures.analysisBacktest : null;
  const potOnDay = potOnDayFrom(backtest?.potPath);
  if (potOnDay === null) {
    const why = showingTrial
      ? "This run with your values has no backtest (runs before 2026-10-19 skipped it): Analyse Only again to see the fit history with a live-like pot."
      : figures.formulasVersion < analysisEveryDayPotFormulasVersion
        ? "Computed with an older version of the formulas: Update Analysis to see the fit history with a live-like pot."
        : `The fit history follows the analysis backtest's account, which this analysis does not have${figures.analysisBacktest && "error" in figures.analysisBacktest ? `: ${figures.analysisBacktest.error}` : "."}`;
    return (
      <div className="mt-3">
        <h4 className="subheader mb-2">Fit over the history</h4>
        <AnalysisNote tone="plain">
          <p>{why}</p>
        </AnalysisNote>
      </div>
    );
  }
  const byYear = fitHistoryByYear(figures.fitDays, values, potOnDay);
  const pots = figures.fitDays.map(([date]) => potOnDay(date));
  const years = Object.keys(byYear).sort();
  const total = years.reduce<AnalysisFitYear>((sum, year) => ({ days: sum.days + byYear[year]!.days, lotFails: sum.lotFails + byYear[year]!.lotFails, rungFails: sum.rungFails + byYear[year]!.rungFails }), { days: 0, lotFails: 0, rungFails: 0 });
  const cell = (key: string, fails: number, days: number, what: string) => {
    if (!isColumnVisible(key)) return null;
    const share = days === 0 ? 0 : (days - fails) / days;
    const level = liquidityLevel(share);
    const Icon = levelIcons[level];
    return (
      <TooltipSpan key={key} as="td" className={`text-end analysis-cell-${level}`} text={`${what}: ${fails} of ${days} days didn't fit; ${days - fails} did (${formatPercentage(share, 0)})`}>
        <span className="analysis-rag-cell">
          {formatNumber(fails)}
          <span style={{ fontSize: "0.7rem" }}>
            {fails > 0 ? Math.floor(share * 100) : 100}% fit
          </span>
          <Icon size={14} aria-hidden="true" />
        </span>
      </TooltipSpan>
    );
  };
  const yearNote = (year: string) => {
    if (year === years[0]) return <span className="analysis-year-note">from {formatDayMonth(figures.fitDays[0]![0])}</span>;
    if (year === years.at(-1)) return <span className="analysis-year-note">to {formatDayMonth(figures.fitDays.at(-1)![0])}</span>;
    return null;
  };
  const row = (label: React.ReactNode, data: AnalysisFitYear, key: string, what: string) => (
    <tr key={key}>
      <th scope="row">{label}</th>
      {isColumnVisible("days") && <td className="text-end">{formatNumber(data.days)}</td>}
      {cell("lot", data.lotFails, data.days, `${what}: the share budget buys a lot`)}
      {cell("rung", data.rungFails, data.days, `${what}: a Put at the first cap fits a rung`)}
    </tr>
  );
  const fixed = values.ladderShockPct !== null;
  return (
    <div className="mt-3">
      <div className="d-flex align-items-center justify-content-between gap-2">
        <h4 className="subheader mb-0">Fit over the history</h4>
        <ColumnVisibilityPopover columns={fitHistoryColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />
      </div>
      <p className="text-secondary my-2" style={{ fontSize: "0.75rem" }}>
        Each day's 10:00 price as traded, and {fixed ? `your ${Math.round(shock * 100)}% shock` : "that day's shock from the rule"}. Each day's pot follows the analysis backtest's account, as a live pot follows the account: the larger of the account at the open cycle's start and last night's ({formatCurrency(Math.min(...pots), 0)} to {formatCurrency(Math.max(...pots), 0)} over these days).
      </p>
      <div className="analysis-rag-table table-responsive">
        <table className="table table-sm mb-0">
          <thead className="table-light">
            <tr>
              <th>Year</th>
              {fitHistoryColumns
                .filter((column) => isColumnVisible(column.key))
                .map((column) => (
                  <th key={column.key} className="text-end">
                    {column.header}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) =>
              row(
                <>
                  {year}
                  {yearNote(year)}
                </>,
                byYear[year]!,
                year,
                year,
              ),
            )}
            {row("All", total, "all", "All days")}
          </tbody>
        </table>
      </div>
      <p className="text-secondary mt-2 mb-1" style={{ fontSize: "0.75rem" }}>
        At a {formatCurrency(values.potDollars, 0)} pot: lot ceiling {formatCurrency(lotPriceCeiling(values))} · rung ceiling {formatCurrency(rungPriceCeiling(values, shock))} at S = {Math.round(shock * 100)}%; above these prices a check fails. Both are drawn on the price chart when they fall within its range.
      </p>
      <p className="mb-0">
        <span className="analysis-formula">lot ceiling = pot × p ÷ 100 · rung ceiling = pot × (1 − p) ÷ (100 × (n − S))</span>
      </p>
    </div>
  );
}

interface FitCardsProps {
  symbol: string;
  figures: AnalysisFigures;
  shown: AnalysisPanelValues;
  showingTrial: boolean;
  stale: boolean;
}

export function AnalysisFitCard({ symbol, figures, shown, showingTrial, stale }: FitCardsProps) {
  const lastDay = figures.chains.lastDay;
  const title = showingTrial ? "Fit at your values (not saved)" : `Fit at ${symbol}'s settings`;
  if (!lastDay || lastDay.spot === null) {
    return (
      <AnalysisCard title={title}>
        <div className="card-body text-secondary">No 10:00 price on the last stored day: the fit cannot be checked.</div>
      </AnalysisCard>
    );
  }
  const price = lastDay.spot;
  const share = shown.ladderSharesPct / 100;
  const shock = shockFor(shown, figures.shock.shock);
  const cap = firstRungCap(price, shock, shown.ladderRungs);
  const budget = shown.potDollars * share;
  const reserve = shown.potDollars - budget;
  const rung = reserve / shown.ladderRungs;
  const lotCost = price * 100;
  const lots = Math.floor(budget / lotCost);
  const lotFits = budget >= lotCost;
  const putFits = rung >= cap * 100;
  const sharesLow = lotCost / shown.potDollars;
  const sharesHigh = 1 - (100 * price * (shown.ladderRungs - shock)) / shown.potDollars;
  const smallestPot = Math.max(lotCost / share, (100 * price * (shown.ladderRungs - shock)) / (1 - share));
  const mostRungs = Math.floor(reserve / (100 * price) + shock);
  // The first rung's Puts that passed every filter on the last stored day, best yield first.
  const puts = figures.chains.chainMap
    .filter((contract) => {
      if (contract.right !== "P" || contract.delta === null || contract.yieldAtMid === null || contract.strike > cap + 1e-9) return false;
      const mid = (contract.bid + contract.ask) / 2;
      const absDelta = Math.abs(contract.delta);
      return contract.dte >= shown.minDte && contract.dte <= shown.maxDte && absDelta >= shown.minAbsDelta && absDelta <= shown.maxAbsDelta && contract.bid >= 0.05 && mid > 0 && (contract.ask - contract.bid) / mid <= shown.maxSpreadPctOfMid / 100 && Math.floor(contract.previousVolume * 0.2) >= 1;
    })
    .sort((a, b) => b.yieldAtMid! - a.yieldAtMid!);
  const best = puts[0] ?? null;
  const deltas = puts.map((contract) => Math.abs(contract.delta!));
  const potMax = Math.max(400_000, shown.potDollars * 1.5, smallestPot * 1.5);
  const rungsMax = Math.max(20, mostRungs + 2, shown.ladderRungs + 2);
  const fits = lotFits && putFits;
  return (
    <AnalysisCard
      title={title}
      stale={stale}
      actions={
        <span className={`badge ${fits ? "bg-success text-success-fg" : "bg-danger text-danger-fg"} d-inline-flex align-items-center gap-1`} style={{ fontSize: "0.72rem" }}>
          {fits ? <IconCheck size={12} aria-hidden="true" /> : <IconX size={12} aria-hidden="true" />}
          {fits ? "Fits" : "Doesn't fit"}
        </span>
      }
      footer={
        <>
          <p className="mb-1">
            <span className="analysis-formula">K1 = P × (1 − S ÷ n) · lot: pot × p ≥ P × 100 · Put: pot × (1 − p) ÷ n ≥ K1 × 100</span>
          </p>
          <p className="mb-0">A cycle starting now: nothing committed and the shares bought at today's price, so the floor is that price × (1 − S) and the first rung has the highest cap and binds.</p>
        </>
      }
    >
      <div className="card-body">
        <p className="text-secondary" style={{ fontSize: "0.8rem", margin: "0 0 0.9rem" }}>
          Pot {formatCurrency(shown.potDollars, 0)}, shares {shown.ladderSharesPct}%, {shown.ladderRungs} rungs, shock {Math.round(shock * 100)}%. Price at the 10:00 quote on {formatDayMonthYear(lastDay.date)}: {formatCurrency(price)}.
        </p>
        <ul className="analysis-check-list">
          <li>
            <YesNo ok={lotFits} />
            <div>
              <b>The share budget buys one lot</b>
              <div className="analysis-check-detail">
                {formatCurrency(budget, 0)} for shares; 100 × {formatCurrency(price)} = {formatCurrency(lotCost, 0)} a lot, so {lots} lot{lots === 1 ? "" : "s"}.
              </div>
            </div>
          </li>
          <li>
            <YesNo ok={putFits} />
            <div>
              <b>One ladder Put fits a rung</b>
              <div className="analysis-check-detail">
                Each rung holds {formatCurrency(rung, 0)} (the {formatCurrency(reserve, 0)} reserve in {shown.ladderRungs}). First rung's cap = {formatCurrency(price)} × (1 − {Math.round(shock * 100)}% ÷ {shown.ladderRungs}) = {formatCurrency(cap)}, so a Put at the cap needs {formatCurrency(cap * 100, 0)}; any Put below it needs less.
              </div>
            </div>
          </li>
        </ul>
        <div className="analysis-boxed">
          {best ? (
            <>
              The first rung's actual best on {formatDayMonthYear(lastDay.date)}: <b>{formatOptionContractLabel({ symbol, strike: best.strike, right: "P", expiry: best.expiry, dte: best.dte })}</b>, {formatPercentage(best.yieldAtMid)} a year at the mid, |delta| {Math.abs(best.delta!).toFixed(2)}, needs {formatCurrency(best.strike * 100, 0)}
              {best.strike * 100 > rung ? `, more than the ${formatCurrency(rung, 0)} rung holds` : ""}. {puts.length} Put{puts.length === 1 ? "" : "s"} passed under the cap (|delta| {Math.min(...deltas).toFixed(2)}–{Math.max(...deltas).toFixed(2)}).
            </>
          ) : (
            `No Put passed the filters under the ${formatCurrency(cap)} cap on ${formatDayMonthYear(lastDay.date)}.`
          )}
        </div>
        <h4 className="subheader">Ranges that work</h4>
        <div className="text-secondary" style={{ fontSize: "0.75rem" }}>
          Each with the other values as set. The dot is the value set.
        </div>
        <div className="d-flex flex-column gap-2 mt-2" style={{ fontSize: "0.8125rem" }}>
          {(
            [
              ["Shares", sharesHigh > sharesLow ? `${formatPercentage(sharesLow)} to ${formatPercentage(sharesHigh)}` : "none", <RangeBar key="s" min={0} max={1} okFrom={sharesLow} okTo={sharesHigh} at={share} />],
              [`Smallest pot at ${shown.ladderSharesPct}%`, formatCurrency(Math.round(smallestPot), 0), <RangeBar key="p" min={0} max={potMax} okFrom={smallestPot} okTo={potMax} at={shown.potDollars} />],
              ["Most rungs", mostRungs >= 1 ? String(mostRungs) : "none", <RangeBar key="r" min={1} max={rungsMax} okFrom={1} okTo={mostRungs} at={shown.ladderRungs} />],
            ] as const
          ).map(([label, value, bar]) => (
            <div key={label} className="d-grid align-items-center gap-3" style={{ gridTemplateColumns: "minmax(0, 9rem) minmax(0, 8rem) minmax(0, 1fr)" }}>
              <span>{label}</span>
              <span className="font-mono text-nowrap">{value}</span>
              {bar}
            </div>
          ))}
        </div>
        <FitHistory figures={figures} values={shown} shock={shock} showingTrial={showingTrial} />
      </div>
    </AnalysisCard>
  );
}

const potPrefsKey = "iorio.analysis.potRange";
function readPotPrefs(): { percent: number; window: "12m" | "all" } {
  try {
    const stored = JSON.parse(localStorage.getItem(potPrefsKey) ?? "{}") as { percent?: unknown; window?: unknown };
    return { percent: typeof stored.percent === "number" && stored.percent >= 1 && stored.percent <= 100 ? stored.percent : 80, window: stored.window === "all" ? "all" : "12m" };
  } catch {
    return { percent: 80, window: "12m" };
  }
}

export function AnalysisPotCard({ symbol, figures, shown, showingTrial, stale }: FitCardsProps) {
  const [prefs, setPrefs] = useState(readPotPrefs);
  const [percentText, setPercentText] = useState(String(prefs.percent));
  const savePrefs = (next: { percent: number; window: "12m" | "all" }) => {
    setPrefs(next);
    try {
      localStorage.setItem(potPrefsKey, JSON.stringify(next));
    } catch {
      // Storage unavailable: the choice still applies while the window is open.
    }
  };
  const everyDayLargest = figures.formulasVersion >= analysisEveryDayPotFormulasVersion;
  const range = potRange({ fitDays: figures.fitDays, values: shown, percent: prefs.percent, window: prefs.window, lastDate: figures.optionLastDate, everyDayLargest });
  const daysLeftOut = [
    range.daysWithoutPut > 0 ? `${formatNumber(range.daysWithoutPut)} day${range.daysWithoutPut === 1 ? "" : "s"} with no qualifying Put` : null,
    range.daysWithoutCall > 0 ? `${formatNumber(range.daysWithoutCall)} day${range.daysWithoutCall === 1 ? "" : "s"} with no qualifying Call` : null,
  ].filter((text): text is string => text !== null);
  const pot = shown.potDollars;
  const inside = range.suits && pot >= range.smallest! && pot <= range.largest!;
  const scaleMax = Math.max(pot, range.smallest ?? 0, range.largest ?? 0) * 1.25;
  const position = (value: number) => Math.max(0, Math.min(100, (value / scaleMax) * 100));
  const windowText = prefs.window === "12m" && range.from ? `the last 12 months (from ${formatDayMonthYear(range.from)})` : "all history";
  const reasons: string[] = [];
  if (!range.suits && range.largest !== null && range.largest < pot) reasons.push(`the volume is too thin for large pots: on ${prefs.percent}% of days the best contracts' limits allowed at most ${formatCurrency(roundPot(range.largest), 0)}${range.thinnestYear ? ` (in ${range.thinnestYear[0]} the median day allowed ${formatCurrency(roundPot(range.thinnestYear[1]), 0)})` : ""}`);
  if (!range.suits && range.smallest !== null && range.smallest > pot) reasons.push(`the price outgrew small pots: on ${prefs.percent}% of days a lot and a rung needed ${formatCurrency(roundPot(range.smallest), 0)} or more`);
  if (!range.suits && reasons.length === 0 && range.smallest !== null && range.largest !== null) reasons.push(`the smallest pot that fits (${formatCurrency(roundPot(range.smallest), 0)}) is above the largest whose orders fit (${formatCurrency(roundPot(range.largest), 0)})`);
  const shockText = shown.ladderShockPct === null ? "the rule's shock" : `shock ${shown.ladderShockPct}%`;
  return (
    <AnalysisCard
      title={`Pot size for ${symbol}`}
      description={`At ${showingTrial ? "your values" : `${symbol}'s settings`}: ${shown.ladderSharesPct}% shares, ${shown.ladderRungs} rungs, ${shockText}`}
      stale={stale}
      footer={
        <>
          <p className="mb-1">
            <span className="analysis-formula">each day: smallest = max(100 × P ÷ p, 100 × P × (n − S) ÷ (1 − p))</span> at that day's 10:00 price as traded and that day's shock.
          </p>
          <p className="mb-1">
            <span className="analysis-formula">each day: largest = min(Put limit × strike × 100 × n ÷ (1 − p), Call limit × 100 × P ÷ p)</span>, from that day's best Put under the first rung's cap and best Call for a new Covered Call entry; limit = floor(20% × the previous complete session's volume); a day with no qualifying Put or no qualifying Call is left out and counted apart.
          </p>
          {figures.largestPotWithoutModel && <p className="mb-1">The lab's volatility-edge filter or Edge Yield ranking is on: the largest pot's contracts were chosen without it, by premium yield.</p>}
          <p className="mb-0">Changing the share or the window recomputes from the stored daily values. Your share and window are remembered in this browser.</p>
        </>
      }
    >
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <label className="d-inline-flex align-items-center gap-2 mb-0" htmlFor="analysis-pot-percent" style={{ fontSize: "0.8rem" }}>
            Fits on at least
            <span className="input-group" style={{ width: "11.5rem" }}>
              <input
                id="analysis-pot-percent"
                className="form-control"
                style={{ minWidth: "4.5rem" }}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={5}
                value={percentText}
                onChange={(event) => {
                  setPercentText(event.target.value);
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value >= 1 && value <= 100) savePrefs({ ...prefs, percent: value });
                }}
              />
              <span className="input-group-text">% of days</span>
            </span>
          </label>
          <BacktestSegmentedSwitch
            ariaLabel="Window"
            options={[
              { value: "12m", label: "Last 12 months" },
              { value: "all", label: "All history" },
            ]}
            value={prefs.window}
            onChange={(value) => savePrefs({ ...prefs, window: value })}
          />
        </div>
        {range.suits ? (
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className="font-mono fw-semibold" style={{ fontSize: "1.25rem" }}>
              {formatCurrency(roundPot(range.smallest!), 0)} to {formatCurrency(roundPot(range.largest!), 0)}
            </span>
            <span className={`badge ${inside ? "bg-success text-success-fg" : "bg-warning text-warning-fg"} d-inline-flex align-items-center gap-1`} style={{ fontSize: "0.72rem" }}>
              {inside ? <IconCheck size={12} aria-hidden="true" /> : <IconAlertTriangle size={12} aria-hidden="true" />}
              {formatCurrency(pot, 0)} is {inside ? "inside" : "outside"}
            </span>
          </div>
        ) : !everyDayLargest ? (
          <AnalysisNote tone="info">
            <p>Computed with an older version of the formulas: Update Analysis for the largest pot over every day.</p>
          </AnalysisNote>
        ) : (
          <AnalysisNote tone="warn" live>
            <p>
              <b>No pot suits {symbol} at these settings</b> over {windowText}: {reasons.join("; and ")}.
            </p>
          </AnalysisNote>
        )}
        {range.smallest !== null && (
          <>
            <div className="analysis-range-bar mt-3" aria-hidden="true">
              {range.largest !== null &&
                (range.suits ? (
                  <span className="is-ok" style={{ left: `${position(range.smallest)}%`, right: `${100 - position(range.largest)}%` }} />
                ) : (
                  <span className="is-gap" style={{ left: `${position(Math.min(range.smallest, range.largest))}%`, right: `${100 - position(Math.max(range.smallest, range.largest))}%` }} />
                ))}
              <span className="is-at" style={{ left: `${position(pot)}%` }} title={`Pot ${formatCurrency(pot, 0)}`} />
            </div>
            <div className="d-flex justify-content-between text-secondary font-mono" style={{ fontSize: "0.68rem" }}>
              <span>$0</span>
              <span>{formatCurrency(roundPot(scaleMax), 0)}</span>
            </div>
          </>
        )}
        <dl className="analysis-kv mt-3">
          <dt>Smallest pot</dt>
          <dd>
            {range.smallest === null ? "—" : formatCurrency(roundPot(range.smallest), 0)}
            <span className="analysis-sub">
              a lot and a rung fit on {prefs.percent}% of {formatNumber(range.days)} days
            </span>
          </dd>
          <dt>Largest pot</dt>
          <dd>
            {range.largest === null ? "—" : formatCurrency(roundPot(range.largest), 0)}
            <span className="analysis-sub">
              orders fit the best contracts' volume limits on {prefs.percent}% of {formatNumber(range.largestDays)} days{range.largestDays > 0 ? ` · Calls set it on ${formatNumber(range.callBinding)}` : ""}
            </span>
            {daysLeftOut.length > 0 && (
              <span className="analysis-sub">
                {formatNumber(range.days - range.largestDays)} days left out: {daysLeftOut.join(", ")}
              </span>
            )}
          </dd>
        </dl>
      </div>
    </AnalysisCard>
  );
}

const tooLargeColumns = [
  { key: "sale", header: "Sale days" },
  { key: "callMulti", header: "Calls over one strike" },
  { key: "putMulti", header: "Puts over one strike" },
  { key: "given", header: "Yield given up, median" },
  { key: "putUnsold", header: "Put orders partly unsold" },
  { key: "callUnsold", header: "Call orders partly unsold" },
];

export function AnalysisTooLargeCard({ figures, stale, onOpenSession }: { figures: AnalysisFigures; stale: boolean; onOpenSession: (sessionId: string) => void }) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-too-large", tooLargeColumns.map((column) => column.key));
  const backtest: AnalysisBacktestFigures | null = figures.analysisBacktest && "sessionId" in figures.analysisBacktest ? figures.analysisBacktest : null;
  const title = "When orders are too large";
  const description = "Orders that wanted more contracts than the best contract's volume limit, from the analysis's own backtest";
  if (!backtest) {
    return (
      <AnalysisCard title={title} description={description}>
        <div className="card-body">
          <AnalysisNote tone="plain">
            <p>{figures.analysisBacktest && "error" in figures.analysisBacktest ? figures.analysisBacktest.error : "This analysis has no backtest yet: Update Analysis runs it."}</p>
          </AnalysisNote>
        </div>
      </AnalysisCard>
    );
  }
  const years = Object.keys(backtest.byYear).sort();
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length === 0 ? null : sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const days = (predicate: (row: AnalysisBacktestFigures["tooLargeDays"][number]) => boolean) => new Set(backtest.tooLargeDays.filter(predicate).map((row) => row[0])).size;
  const all = {
    sale: backtest.saleDays,
    callMulti: days(([, right, givenUp]) => right === "C" && givenUp !== null),
    putMulti: days(([, right, givenUp]) => right === "P" && givenUp !== null),
    given: median(backtest.tooLargeDays.flatMap(([, , givenUp]) => (givenUp === null ? [] : [givenUp]))),
    putUnsold: days(([, right, , unsold]) => right === "P" && unsold > 0),
    callUnsold: days(([, right, , unsold]) => right === "C" && unsold > 0),
  };
  const cells = (values: typeof all) =>
    (
      [
        ["sale", formatNumber(values.sale)],
        ["callMulti", formatNumber(values.callMulti)],
        ["putMulti", formatNumber(values.putMulti)],
        ["given", formatPercentagePoints(values.given)],
        ["putUnsold", formatNumber(values.putUnsold)],
        ["callUnsold", formatNumber(values.callUnsold)],
      ] as const
    )
      .filter(([key]) => isColumnVisible(key))
      .map(([key, text]) => (
        <td key={key} className="text-end">
          {text}
        </td>
      ));
  const metrics = backtest.metrics;
  return (
    <AnalysisCard
      title={title}
      description={description}
      stale={stale}
      actions={<ColumnVisibilityPopover columns={tooLargeColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
      footer={
        <>
          <p className="mb-1">Days are sale days: days the backtest sold at least one contract. Yield given up = the best contract's premium yield − the contract-weighted yield of what the order filled. A Put order is partly unsold when the collateral left could still cover a contract at its last strike.</p>
          <p className="mb-0">
            The backtest: “
            <button type="button" className="analysis-link" onClick={() => onOpenSession(backtest.sessionId)}>
              {backtest.name}
            </button>
            ” ({formatNumber(backtest.orderCount)} orders on {formatNumber(backtest.saleDays)} sale days{metrics ? `; CAGR ${formatPercentage(metrics.cagr)}, Max drawdown ${formatPercentage(metrics.maxDrawdown)}` : ""}).
          </p>
        </>
      }
    >
      <div className="card-body pb-2">
        <p className="mb-0" style={{ fontSize: "0.8125rem" }}>
          Calls want the lots held; a ladder Put wants the rung's collateral ÷ (strike × 100). The best contract allows floor(20% × the previous complete session's volume). When an order wants more, the rest goes to the next contract in the ranking, at a lower yield, and what nothing can take goes unsold.
        </p>
      </div>
      <div className="table-responsive">
        <table className="table table-sm card-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Year</th>
              {tooLargeColumns
                .filter((column) => isColumnVisible(column.key))
                .map((column) => (
                  <th key={column.key} className="text-end">
                    {column.header}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const row = backtest.byYear[year]!;
              return (
                <tr key={year}>
                  <th scope="row" className="font-mono fw-medium">
                    {year}
                  </th>
                  {cells({ sale: row.saleDays, callMulti: row.callDaysOverOneStrike, putMulti: row.putDaysOverOneStrike, given: row.medianYieldGivenUp, putUnsold: row.putDaysPartlyUnsold, callUnsold: row.callDaysPartlyUnsold })}
                </tr>
              );
            })}
            <tr className="table-totals-row">
              <th scope="row">All</th>
              {cells(all)}
            </tr>
          </tbody>
        </table>
      </div>
    </AnalysisCard>
  );
}

export function AnalysisShockCard({ figures, ladderShockMinPct, ladderShockMaxPct, lookbackYears }: { figures: AnalysisFigures; ladderShockMinPct: number; ladderShockMaxPct: number; lookbackYears: number }) {
  const shock = figures.shock;
  const raw = shock.maxDrawdown;
  const drawdown = figures.maxDrawdown.All;
  const firstBar = figures.bars[0]?.[0] ?? null;
  return (
    <AnalysisCard title="Recommended shock" description="For the CC + Put Ladder">
      <div className="card-body">
        <div className="analysis-shock-value">{formatPercentage(shock.shock, 0)}</div>
        <div className="analysis-shock-scale" aria-hidden="true">
          <span className="track" />
          <span className="band" style={{ left: `${ladderShockMinPct}%`, width: `${ladderShockMaxPct - ladderShockMinPct}%` }} />
          <span className="mark result" style={{ left: `${shock.shock * 100}%` }} />
          {raw !== null && <span className="mark raw" style={{ left: `${Math.min(100, raw * 100)}%` }} />}
          {[0, ladderShockMinPct, ladderShockMaxPct, 100].map((tick) => (
            <span key={tick} className="tick" style={{ left: `${tick}%` }}>
              {tick}%
            </span>
          ))}
        </div>
        <div className="analysis-legend">
          <span className="analysis-legend-item">
            <span className="analysis-shock-key result" />
            Shock {formatPercentage(shock.shock, 0)}
          </span>
          {raw !== null && (
            <span className="analysis-legend-item">
              <span className="analysis-shock-key raw" />
              Max drawdown {formatPercentage(raw)}
            </span>
          )}
          <span className="analysis-legend-item">
            <span className="analysis-shock-key band" />
            Allowed {ladderShockMinPct}–{ladderShockMaxPct}%
          </span>
        </div>
        <p className="mt-2 mb-0" style={{ fontSize: "0.8125rem" }}>
          For a cycle starting {formatDayMonthYear(shock.startDate)}: the {lookbackYears} years before (from {formatDayMonthYear(shock.windowFrom)}) hold {formatNumber(shock.closes)} closes{firstBar && firstBar > shock.windowFrom ? `, all of the history since ${formatDayMonthYear(firstBar)}` : ""}.{" "}
          {shock.closes < 250 || raw === null
            ? `Under 250 closes: the rule uses its new-listing value, ${formatPercentage(shock.shock, 0)}.`
            : `Their Max drawdown is ${formatPercentage(-raw)}${drawdown ? ` (${formatDayMonthYear(drawdown.peakDate)} to ${formatDayMonthYear(drawdown.troughDate)})` : ""}; the rule keeps it within ${ladderShockMinPct}–${ladderShockMaxPct}%, so ${formatPercentage(shock.shock, 0)}.`}
        </p>
        <p className="text-secondary mt-2 mb-0" style={{ fontSize: "0.78rem" }}>
          Rule approved 14 Oct 2026: the stock's Max drawdown over the {lookbackYears} years before a cycle starts, kept within {ladderShockMinPct}–{ladderShockMaxPct}%; the new-listing value when those years hold under 250 closes. Live, each cycle fixes its own.
        </p>
      </div>
    </AnalysisCard>
  );
}
