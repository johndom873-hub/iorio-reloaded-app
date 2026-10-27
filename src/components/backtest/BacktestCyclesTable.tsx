import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import {
  fetchBacktestCycleDetail,
  fetchBacktestSessionStockPrices,
  type BacktestCycle,
  type BacktestCycleDetail,
  type BacktestCycleGap,
  type BacktestCycleTimelineRow,
  type BacktestIdleStretch,
  type BacktestNoCallRun,
  type BacktestSessionDay,
  type BacktestSessionStockPrices,
} from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage, formatSignedPercentage, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import {
  accountReturnOver,
  backtestCycleLabel,
  backtestCycleMetricExplanation,
  cycleBucketOrder,
  closeToCloseReturn,
  cycleStockDollars,
  describeBreakEven,
  describeCycleTimelineEvent,
  describeIdleStretchReason,
  describeIdleStretchRules,
  describeLadderRung,
  describeNoCallRun,
  describeNoCallRunRules,
  describeOpenCycles,
  describeSessionSpan,
  summarizeCycleTotals,
} from "../../lib/backtestPresentation";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { DataTable, type DataTableColumn, type DataTableExtraRow } from "../DataTable/DataTable";
import { DataTableStickyPanel } from "../DataTable/DataTableStickyPanel";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { BacktestCard, BacktestCardTitle, BacktestCollapseToggle } from "./backtestBits";

// The Wheel cycles table (mockup approved 2026-10-20): every cycle oldest first; with one symbol shown, an Idle row for
// each stretch with no cycle open; a cycle's row opens to its trades (the platform's cycle timeline, whose premium and
// stock add up to the cycle's figures) and the runs of days its shares had no Call (No-Call days, approved 2026-10-27).
// Every row puts its values in the table's own columns.

type CycleStatusFilter = "all" | "open" | "closed";
type CycleNoCallFilter = "all" | "withNoCallDays";

type CyclesTableRow =
  | { kind: "cycle"; key: string; cycle: BacktestCycle }
  | { kind: "gap"; key: string; gap: BacktestCycleGap }
  | { kind: "trade"; key: string; cycle: BacktestCycle; row: BacktestCycleTimelineRow }
  | { kind: "noCall"; key: string; cycle: BacktestCycle; run: BacktestNoCallRun };

type CycleDetailState = { status: "loading" } | { status: "loaded"; detail: BacktestCycleDetail | null } | { status: "failed"; error: string };

const cycleKeyOf = (cycle: Pick<BacktestCycle, "symbol" | "cycleNumber">) => `${cycle.symbol}-${cycle.cycleNumber}`;

const stockMoveExplanation = "The stock's move over the stretch: the close of its last session ÷ the close of the session before it − 1, on split-adjusted closes.";

const dash = <span className="text-secondary">—</span>;

function SignedDollars({ value, bold = false, cents = false }: { value: number; bold?: boolean; cents?: boolean }) {
  return <span className={`${pnlTextClass(value)}${bold ? " fw-semibold" : ""}`}>{formatSignedPnl(value, cents ? 2 : 0)}</span>;
}

/** A trade's dollars in cents; nothing booked shows as a dash. */
const tradeDollars = (value: number) => (value === 0 ? dash : <SignedDollars value={value} cents />);

/** Each strategy's share of the cycle in the platform's badges and order: CSP, N/S, CC, Hedge, the ones that took part. */
function CycleStrategies({ cycle }: { cycle: BacktestCycle }) {
  const parts = cycleBucketOrder.filter((bucket) => cycle.buckets[bucket].total !== 0 || cycle.buckets[bucket].premium !== 0 || cycle.buckets[bucket].capital !== 0);
  if (parts.length === 0) return dash;
  return (
    <span className="d-inline-flex flex-wrap align-items-center column-gap-2 row-gap-1">
      {parts.map((bucket) => (
        <span key={bucket} className="d-inline-flex align-items-center gap-1 text-nowrap">
          <CycleBucketBadge bucket={bucket} />
          <SignedDollars value={cycle.buckets[bucket].total} />
        </span>
      ))}
    </span>
  );
}

interface CellContext {
  isCycleOpen: (cycle: BacktestCycle) => boolean;
  /** A trading date's number in the session (1 = its first day); null for a date that is not one of its days. */
  sessionNumberOf: (date: string) => number | null;
  lastSessionNumber: number | null;
  lastSessionDate: string | null;
  /** The account's return from a day's mark to the mark after another (null last day: to the session's end); null in a session of several symbols. */
  accountReturn: (firstDate: string, lastDate: string | null) => number | null;
  /** Buy and hold of a symbol over a stretch, close to close; null until its prices are read or when a close is missing. */
  buyAndHold: (symbol: string, firstDate: string, lastDate: string) => number | null;
  /** A symbol's price on a day, as traded: the 10:00 price or the close; null when not known. */
  priceOn: (symbol: string, date: string, at: "tenOclock" | "close") => number | null;
  /** The traded price ÷ the split-adjusted one on a day: 1 with no split after it in the period, 10 before a 10-for-1. */
  splitFactorOn: (symbol: string, date: string) => number;
}

/** A signed percentage in green or red; a grey one on an Idle or Stock only row. */
function SignedPercent({ fraction, plain = false }: { fraction: number | null; plain?: boolean }) {
  if (fraction === null) return dash;
  return <span className={plain ? undefined : pnlTextClass(fraction)}>{formatSignedPercentage(fraction, 1)}</span>;
}

/**
 * A price as traded; on a day before a split, the price chart's split-adjusted figure in a tooltip (Marcelo 2026-10-21:
 * the chart's $133.91 and the table's $1,333.50 were the same NFLX day either side of its 10-for-1).
 */
function priceText(price: number | null, splitFactor = 1): ReactNode {
  if (price === null) return dash;
  if (Math.abs(splitFactor - 1) < 0.001) return formatCurrency(price);
  return (
    <TooltipSpan text={`As traded. On the price chart's split-adjusted scale: ${formatCurrency(price / splitFactor)} (÷ ${formatNumber(splitFactor, 3)}, for the splits after this day)`} className="dotted-underline-label">
      {formatCurrency(price)}
    </TooltipSpan>
  );
}
const cashText = (share: number | null | undefined) => (share == null ? dash : formatPercentage(share, 0));

/** An Idle row's cells: a stretch between cycles. */
function stretchCell(key: string, stretch: BacktestIdleStretch, own: { label: ReactNode; sessions: string; reason: string; rules: string; accountReturn: ReactNode; price: number | null; splitFactor: number }): ReactNode {
  switch (key) {
    case "cycle":
      return own.label;
    case "return":
      return own.accountReturn;
    case "buyAndHold":
      return stretch.stockMove === null ? (
        dash
      ) : (
        <TooltipSpan text={stockMoveExplanation} className="dotted-underline-label">
          {formatSignedPercentage(stretch.stockMove, 1)}
        </TooltipSpan>
      );
    case "opened":
      return stretch.firstIdleDay;
    case "closed":
      return stretch.lastIdleDay;
    case "sessions":
      return own.sessions;
    case "price":
      return priceText(own.price, own.splitFactor);
    case "cash":
      return cashText(stretch.freeCashShareAtStart);
    case "strategies":
      return (
        <TooltipSpan text={own.rules} multiline className="dotted-underline-label backtest-cycle-row-detail">
          {own.reason}
        </TooltipSpan>
      );
    default:
      return dash;
  }
}

function gapCell(key: string, gap: BacktestCycleGap, context: CellContext): ReactNode {
  return stretchCell(key, gap, {
    label: "Idle",
    sessions: describeSessionSpan(context.sessionNumberOf(gap.firstIdleDay), context.sessionNumberOf(gap.lastIdleDay)),
    reason: describeIdleStretchReason(gap, "No entry", gap.entryFilterLimits),
    rules: describeIdleStretchRules(gap, "No entry", gap.entryFilterLimits),
    accountReturn: <SignedPercent fraction={context.accountReturn(gap.firstIdleDay, gap.lastIdleDay)} plain />,
    price: context.priceOn(gap.symbol, gap.firstIdleDay, "tenOclock"),
    splitFactor: context.splitFactorOn(gap.symbol, gap.firstIdleDay),
  });
}

/** A run of days with shares and no Call is one of a cycle's breakdown rows: its first and last days, its span, its price on its first day, its shares and its length, and why. */
function noCallCell(key: string, cycle: BacktestCycle, run: BacktestNoCallRun, context: CellContext): ReactNode {
  switch (key) {
    case "cycle":
      return <span className="backtest-cycle-event-name">No Call</span>;
    case "opened":
      return run.firstDay;
    case "closed":
      return run.lastDay;
    case "sessions":
      return describeSessionSpan(context.sessionNumberOf(run.firstDay), context.sessionNumberOf(run.lastDay));
    case "price":
      return priceText(context.priceOn(cycle.symbol, run.firstDay, "tenOclock"), context.splitFactorOn(cycle.symbol, run.firstDay));
    case "shares":
      return formatNumber(run.sharesHeld);
    case "noCallDays":
      return formatNumber(run.sessions);
    case "strategies":
      return (
        <TooltipSpan text={describeNoCallRunRules(run)} multiline className="dotted-underline-label backtest-cycle-row-detail">
          {describeNoCallRun(run, context.buyAndHold(cycle.symbol, run.firstDay, run.lastDay))}
        </TooltipSpan>
      );
    default:
      return null;
  }
}

/** A cycle's no-Call days of its days with shares ("40 of 58"); a dash with none. */
const noCallDaysText = (noCallDays: BacktestCycle["noCallDays"]) => (noCallDays && noCallDays.days > 0 ? `${formatNumber(noCallDays.days)} of ${formatNumber(noCallDays.shareDays)}` : dash);

function tradeCell(key: string, cycle: BacktestCycle, row: BacktestCycleTimelineRow, context: CellContext): ReactNode {
  const event = describeCycleTimelineEvent(row);
  switch (key) {
    case "cycle":
      // The strategy that owns the trade stands for it; what happened is the row's description.
      return (
        <span className="backtest-cycle-event-name">
          <CycleBucketBadge bucket={row.bucket} />
        </span>
      );
    case "pnl":
      return tradeDollars(row.premiumDollars + row.stockDollars);
    case "opened":
      return row.tradingDate;
    case "closed":
      return event.opensOption && row.expiryDate !== null ? row.expiryDate : null;
    case "sessions":
      return describeSessionSpan(context.sessionNumberOf(row.tradingDate));
    case "price":
      return priceText(context.priceOn(cycle.symbol, row.tradingDate, event.priceAt), context.splitFactorOn(cycle.symbol, row.tradingDate));
    case "breakEven":
      // A share purchase shows its price (Marcelo 2026-10-23); an option sold while shares were held, the break-even before it.
      if (event.name === "Bought shares") return row.stockPrice === null ? null : formatCurrency(row.stockPrice);
      return row.breakEvenAtSale == null ? null : formatCurrency(row.breakEvenAtSale);
    case "shares":
      return row.sharesHeld == null ? null : formatNumber(row.sharesHeld);
    case "cash":
      return cashText(row.freeCashShare);
    case "premium":
      return tradeDollars(row.premiumDollars);
    case "stock":
      return tradeDollars(row.stockDollars);
    case "strategies":
      return (
        <span className="backtest-cycle-row-detail">
          {event.order && <span className={`badge ${event.order === "Sell" ? "bg-danger" : "bg-success"}`}>{event.order}</span>}
          {row.ladderRung ? (
            <TooltipSpan text={describeLadderRung(row.ladderRung, { strike: row.strike, contracts: row.quantity / 100, stockPrice: context.priceOn(cycle.symbol, row.tradingDate, "tenOclock") })} multiline className="dotted-underline-label">
              {event.detail}
            </TooltipSpan>
          ) : (
            <span>{event.detail}</span>
          )}
        </span>
      );
    default:
      return null;
  }
}

function cycleCell(key: string, cycle: BacktestCycle, context: CellContext): ReactNode {
  switch (key) {
    case "cycle": {
      // The whole row opens and closes the cycle: the button (in the cell's padding) gives it a keyboard stop and says so.
      const isOpen = context.isCycleOpen(cycle);
      return (
        <>
          <button type="button" className="backtest-cycle-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the trades of ${backtestCycleLabel(cycle)}`}>
            {isOpen ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
          </button>
          {backtestCycleLabel(cycle)}
        </>
      );
    }
    case "pnl":
      return <SignedDollars value={cycle.totalDollars} bold />;
    case "return":
      return <SignedPercent fraction={context.accountReturn(cycle.openedOn, cycle.closedOn)} />;
    case "buyAndHold": {
      const lastDate = cycle.closedOn ?? context.lastSessionDate;
      return <SignedPercent fraction={lastDate === null ? null : context.buyAndHold(cycle.symbol, cycle.openedOn, lastDate)} />;
    }
    case "status":
      return cycle.status === "open" ? <span className="fw-semibold">Open</span> : <span className="text-secondary">Closed</span>;
    case "opened":
      return cycle.openedOn;
    case "closed":
      return cycle.closedOn ?? <span className="text-secondary">open</span>;
    case "sessions":
      return describeSessionSpan(context.sessionNumberOf(cycle.openedOn), cycle.closedOn === null ? context.lastSessionNumber : context.sessionNumberOf(cycle.closedOn));
    case "price":
      return priceText(context.priceOn(cycle.symbol, cycle.openedOn, "tenOclock"), context.splitFactorOn(cycle.symbol, cycle.openedOn));
    case "breakEven":
      return cycle.status === "open" && cycle.cashBreakEvenPerShare != null ? describeBreakEven(cycle.cashBreakEvenPerShare) : dash;
    // An open cycle: the latest; a closed one: the most shares it held and its lowest Cash, the day on hover.
    case "shares":
      if (cycle.status === "open") return cycle.sharesHeldNow != null ? formatNumber(cycle.sharesHeldNow) : dash;
      return cycle.sharesHeldMost ? (
        <TooltipSpan text={`The most shares the cycle held: ${formatNumber(cycle.sharesHeldMost.shares)} on ${formatDayMonthYear(cycle.sharesHeldMost.on)}`} className="dotted-underline-label">
          {formatNumber(cycle.sharesHeldMost.shares)}
        </TooltipSpan>
      ) : (
        dash
      );
    case "noCallDays":
      return noCallDaysText(cycle.noCallDays);
    case "cash":
      if (cycle.status === "open") return cashText(cycle.freeCashShareNow);
      return cycle.freeCashShareLowest ? (
        <TooltipSpan text={`The cycle's lowest Cash: ${formatPercentage(cycle.freeCashShareLowest.share, 0)} on ${formatDayMonthYear(cycle.freeCashShareLowest.on)}`} className="dotted-underline-label">
          {cashText(cycle.freeCashShareLowest.share)}
        </TooltipSpan>
      ) : (
        dash
      );
    case "premium":
      return <SignedDollars value={cycle.netPremiumDollars} />;
    case "stock":
      return <SignedDollars value={cycleStockDollars(cycle)} />;
    case "strategies":
      return <CycleStrategies cycle={cycle} />;
    default:
      return null;
  }
}

function cellOf(row: CyclesTableRow, key: string, context: CellContext): ReactNode {
  switch (row.kind) {
    case "cycle":
      return cycleCell(key, row.cycle, context);
    case "gap":
      return gapCell(key, row.gap, context);
    case "trade":
      return tradeCell(key, row.cycle, row.row, context);
    case "noCall":
      return noCallCell(key, row.cycle, row.run, context);
  }
}

const columnDefinitions: Omit<DataTableColumn<CyclesTableRow>, "render">[] = [
  { key: "cycle", header: "Cycle", cellClassName: "text-nowrap fw-semibold backtest-cycle-label-cell", headerClassName: "backtest-cycle-label-cell" },
  { key: "pnl", header: "Cycle P&L", headerTitle: `${backtestCycleMetricExplanation.cyclePnl} A trade's row: its premium + stock.`, align: "right" },
  {
    key: "return",
    header: "Return",
    headerTitle:
      "The account's return over the cycle: its value at the 10:00 mark of the session after the cycle closed (an open cycle: the session's last mark) ÷ its value at the 10:00 mark of the day the cycle opened − 1. Marks come before that day's orders. Idle rows: the same over the stretch (interest on cash). Interest is included; a session of several symbols shows none (the account is every symbol's).",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "buyAndHold",
    header: "B&H",
    headerTitle: "Buy and hold of the stock over the same days, close to close: the close of the last day (an open cycle: the session's last) ÷ the close of the trading day before the first − 1, on split-adjusted closes.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  { key: "status", header: "Status", headerTitle: "Open: the symbol is not flat yet at the session's end, and its P&L is at the last marks. Closed: the symbol went flat again." },
  { key: "opened", header: "Opened", headerTitle: "A cycle's first day; an idle stretch's or a No Call run's first session; a trade's day.", cellClassName: "font-mono text-nowrap" },
  { key: "closed", header: "Closed", headerTitle: "A cycle's last day; an idle stretch's or a No Call run's last session; an option sold or bought: its expiry.", cellClassName: "font-mono text-nowrap" },
  {
    key: "sessions",
    header: "Session #",
    headerTitle: "The session's trading days, numbered from 1 on its first (weekends and holidays have none): a cycle's, an idle stretch's or a No Call run's first → last (an open cycle's to the session's end); a trade's own.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "price",
    header: "Price",
    headerTitle: "The stock price as traded. A cycle, a stretch or a No Call run: the 10:00 price on its first day. A trade: the 10:00 price the day's looks saw; an assignment, a hand-over or a mark: that day's close.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "breakEven",
    header: "B-E",
    headerTitle:
      "Break-even, in cash: (cost of every share bought in the cycle − what shares that left it brought in − net premium) ÷ shares held; selling the shares held at it leaves the cycle flat (Free once below zero). In a Vol Farmer session it is the hedge rule's: the hedge Puts' realized P&L in place of the net premium (the Calls' premium too where the session's hedge rule counts it). An open cycle: now. An option sold while the cycle held shares: the break-even just before the sale (a call on held shares under a break-even rule: the floor its strike was held to). A share purchase: its price.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "shares",
    header: "Shares",
    headerTitle: "Shares held, as traded on the row's day. A closed cycle: the most it held (the day on hover); an open cycle: at the last marks. A trade: once everything done at that look is done (a look's rows show the same number). A No Call run: the shares held on its first day.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "noCallDays",
    header: "No-Call days",
    headerTitle:
      "A cycle's session days with shares and no Call open at any time of the day, of its session days with shares. A Call covers every day from its sale to its expiry or buy-back, both included (as the Covered Calls tile counts them); shares a put's assignment delivers at the close count from the next session. A No Call row: its sessions.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "cash",
    header: "Cash",
    headerTitle:
      "Free cash ÷ the account value: the cash not locked in open Cash-Secured Puts (strike × 100 × contracts), as the engine counts what it may still spend, over the account's value at that day's 10:00 marks (so a flat account after a day's gains can read a hair over 100%); the whole account's in a session of several symbols. A trade: once everything done at that look is done. A closed cycle: its lowest, at each day's 10:00 marks and after each of its looks (the day on hover); an open cycle: at the session's last day. Idle stretches: at their first day's 10:00 marks.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  { key: "premium", header: "Net premium", headerTitle: "Premiums in − buybacks − commissions.", align: "right" },
  { key: "stock", header: "Stock P&L", headerTitle: "What the shares made: the put's assignment charge and the stock's P&L while the strategies held it.", align: "right" },
  {
    key: "strategies",
    header: "By strategy",
    headerTitle: "Each strategy's part of the cycle P&L, as the platform's Profit & Loss scoreboard attributes it. A trade: the strategy that owns it and what happened. Idle stretches and No Call runs: why nothing was sold, the full rules in the tooltip.",
  },
];

/** A cycle's trades and its No Call runs, each run before the first trade dated on or after its first session. */
function breakdownRows(cycle: BacktestCycle, detail: BacktestCycleDetail): CyclesTableRow[] {
  const pending = [...detail.noCallRuns].sort((a, b) => a.firstDay.localeCompare(b.firstDay));
  const rows: CyclesTableRow[] = [];
  const noCallRow = (run: BacktestNoCallRun): CyclesTableRow => ({ kind: "noCall", key: `no-call-${cycleKeyOf(cycle)}-${run.firstDay}`, cycle, run });
  // Within one moment: the shares first, then the Calls and other options, then the hedge's Puts (Marcelo 2026-10-21 and
  // 2026-10-23); rows of a kind keep the derivation's order. A moment's rows share their Shares, B-E and Cash, so the
  // order changes no figure.
  const rankWithinMoment = (row: BacktestCycleTimelineRow) => (row.instrument === "stock" ? 0 : row.bucket === "hedge" ? 2 : 1);
  const ordered = detail.timeline.map((row, index) => ({ row, index })).sort((a, b) => (a.row.at !== null && a.row.at === b.row.at ? rankWithinMoment(a.row) - rankWithinMoment(b.row) : 0) || a.index - b.index);
  ordered.forEach(({ row, index }) => {
    while (pending.length > 0 && pending[0]!.firstDay <= row.tradingDate) rows.push(noCallRow(pending.shift()!));
    rows.push({ kind: "trade", key: `trade-${cycleKeyOf(cycle)}-${index}`, cycle, row });
  });
  return [...rows, ...pending.map(noCallRow)];
}

/** Every wheel cycle of the session, oldest first, all on one table; filter by symbol and status. With one symbol shown, a
 *  row for each stretch with no cycle open. A cycle's row opens to its trades. Collapsible (remembered in this browser). */
export function BacktestCyclesTable({
  sessionId,
  status,
  cycles,
  cycleGaps,
  symbols,
  sessionDays,
}: {
  sessionId: string;
  /** The run's status: its stock prices are read again when it changes. */
  status: string;
  cycles: BacktestCycle[];
  cycleGaps: BacktestCycleGap[];
  symbols: string[];
  sessionDays: readonly Pick<BacktestSessionDay, "tradingDate" | "accountValue">[];
}) {
  const [isOpen, setIsOpen] = useCollapsibleCard("backtest-cycles", true);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CycleStatusFilter>("all");
  const [noCallFilter, setNoCallFilter] = useState<CycleNoCallFilter>("all");
  const [openCycleKeys, setOpenCycleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [details, setDetails] = useState<ReadonlyMap<string, CycleDetailState>>(() => new Map());
  // Each read of the session (a running one is polled) reads its opened cycles' trades again; a slower, older answer is dropped.
  const readGeneration = useRef(0);
  const loadDetail = useCallback(
    (cycle: BacktestCycle) => {
      const key = cycleKeyOf(cycle);
      const generation = readGeneration.current;
      setDetails((current) => (current.get(key)?.status === "loaded" ? current : new Map(current).set(key, { status: "loading" })));
      fetchBacktestCycleDetail(sessionId, cycle.symbol, cycle.cycleNumber).then(
        (detail) => generation === readGeneration.current && setDetails((current) => new Map(current).set(key, { status: "loaded", detail })),
        (error: unknown) => generation === readGeneration.current && setDetails((current) => new Map(current).set(key, { status: "failed", error: error instanceof Error ? error.message : String(error) })),
      );
    },
    [sessionId],
  );
  const openCycleKeysRef = useRef(openCycleKeys);
  useEffect(() => {
    openCycleKeysRef.current = openCycleKeys;
  }, [openCycleKeys]);
  useEffect(() => {
    readGeneration.current += 1;
    setDetails((current) => new Map([...current].filter(([key]) => openCycleKeysRef.current.has(key))));
    for (const cycle of cycles) if (openCycleKeysRef.current.has(cycleKeyOf(cycle))) loadDetail(cycle);
  }, [cycles, loadDetail]);

  // Each symbol's prices day by day (Price, B&H), read once per run status; a symbol that cannot be read shows dashes.
  const [stockPrices, setStockPrices] = useState<ReadonlyMap<string, BacktestSessionStockPrices>>(() => new Map());
  const symbolsKey = symbols.join(",");
  useEffect(() => {
    let current = true;
    for (const symbol of symbolsKey.split(","))
      fetchBacktestSessionStockPrices(sessionId, symbol).then(
        (prices) => current && setStockPrices((previous) => new Map(previous).set(symbol, prices)),
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [sessionId, symbolsKey, status]);
  const context = useMemo<CellContext>(() => {
    const numbers = new Map(sessionDays.map((day, index) => [day.tradingDate, index + 1]));
    const pricesByDate = new Map([...stockPrices].map(([symbol, prices]) => [symbol, new Map(prices.days.map((day) => [day[0], day]))]));
    const adjustedCloses = new Map([...stockPrices].map(([symbol, prices]) => [symbol, prices.days.map((day): [string, number | null] => [day[0], day[3]])]));
    return {
      isCycleOpen: (cycle) => openCycleKeys.has(cycleKeyOf(cycle)),
      sessionNumberOf: (date) => numbers.get(date) ?? null,
      lastSessionNumber: sessionDays.length === 0 ? null : sessionDays.length,
      lastSessionDate: sessionDays.at(-1)?.tradingDate ?? null,
      accountReturn: (firstDate, lastDate) => (symbols.length === 1 ? accountReturnOver(sessionDays, firstDate, lastDate) : null),
      buyAndHold: (symbol, firstDate, lastDate) => closeToCloseReturn(adjustedCloses.get(symbol) ?? [], firstDate, lastDate),
      priceOn: (symbol, date, at) => pricesByDate.get(symbol)?.get(date)?.[at === "tenOclock" ? 1 : 2] ?? null,
      splitFactorOn: (symbol, date) => {
        const day = pricesByDate.get(symbol)?.get(date);
        return day && day[2] !== null && day[3] !== null && day[3] > 0 ? Math.round((day[2] / day[3]) * 1000) / 1000 : 1;
      },
    };
  }, [sessionDays, openCycleKeys, stockPrices, symbols.length]);
  const columns = useMemo<DataTableColumn<CyclesTableRow>[]>(() => columnDefinitions.map((column) => ({ ...column, render: (row: CyclesTableRow) => cellOf(row, column.key, context) })), [context]);
  const totals = summarizeCycleTotals(cycles);
  const title = "Wheel cycles";
  const description = `${pluralizeCount(totals.closedCount, "closed cycle")} · ${describeOpenCycles(totals.openCount, totals.openDollars)}`;
  const toggle = <BacktestCollapseToggle isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} />;

  if (!isOpen || cycles.length === 0) {
    return (
      <BacktestCard title={title} description={cycles.length === 0 ? "no cycle yet" : description} actions={cycles.length === 0 ? undefined : toggle} className="mb-3">
        {null}
      </BacktestCard>
    );
  }

  const filtered = cycles
    .filter((cycle) => (symbolFilter === "" || cycle.symbol === symbolFilter) && (statusFilter === "all" || cycle.status === statusFilter) && (noCallFilter === "all" || (cycle.noCallDays?.days ?? 0) > 0))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.symbol.localeCompare(b.symbol));
  const filteredTotals = summarizeCycleTotals(filtered);
  const filteredPnl = filteredTotals.closedDollars + filteredTotals.openDollars;

  // Gaps mean something only along one symbol's cycles: a session of one symbol, or one picked. Each goes before the
  // cycle after it, else (that cycle filtered out, or none: to the session's end) after the cycle before it. The cycles
  // with no-Call days are listed without them.
  const gapSymbol = symbols.length === 1 ? symbols[0]! : symbolFilter === "" ? null : symbolFilter;
  const shownCycleNumbers = new Set(filtered.filter((cycle) => cycle.symbol === gapSymbol).map((cycle) => cycle.cycleNumber));
  const gapsBefore = new Map<number, BacktestCycleGap[]>();
  const gapsAfter = new Map<number, BacktestCycleGap[]>();
  if (gapSymbol !== null && statusFilter !== "open" && noCallFilter === "all") {
    for (const gap of cycleGaps.filter((entry) => entry.symbol === gapSymbol)) {
      const anchor = gap.beforeCycleNumber !== null && shownCycleNumbers.has(gap.beforeCycleNumber) ? { map: gapsBefore, cycleNumber: gap.beforeCycleNumber } : gap.afterCycleNumber !== null && shownCycleNumbers.has(gap.afterCycleNumber) ? { map: gapsAfter, cycleNumber: gap.afterCycleNumber } : null;
      if (anchor) anchor.map.set(anchor.cycleNumber, [...(anchor.map.get(anchor.cycleNumber) ?? []), gap]);
    }
  }
  const gapRows = (cycle: BacktestCycle, map: Map<number, BacktestCycleGap[]>): CyclesTableRow[] => (cycle.symbol === gapSymbol ? (map.get(cycle.cycleNumber) ?? []).map((gap) => ({ kind: "gap", key: `gap-${gap.symbol}-${gap.firstIdleDay}`, gap })) : []);
  const tableRows = filtered.flatMap((cycle): CyclesTableRow[] => {
    const state = openCycleKeys.has(cycleKeyOf(cycle)) ? details.get(cycleKeyOf(cycle)) : undefined;
    const breakdown = state?.status === "loaded" && state.detail !== null ? breakdownRows(cycle, state.detail) : [];
    return [...gapRows(cycle, gapsBefore), { kind: "cycle", key: cycleKeyOf(cycle), cycle }, ...breakdown, ...gapRows(cycle, gapsAfter)];
  });
  // While an opened cycle's trades load, or when they cannot be shown, one full-width row says so under it.
  const extraRows = (row: CyclesTableRow): { after: DataTableExtraRow[] } | null => {
    if (row.kind !== "cycle" || !openCycleKeys.has(row.key)) return null;
    const state = details.get(row.key);
    if (state?.status === "loaded" && state.detail !== null) return null;
    const content =
      state === undefined || state.status === "loading" ? (
        <Spinner size="sm" label="Loading the cycle's trades" />
      ) : state.status === "failed" ? (
        <div className="alert alert-danger mb-0">{state.error}</div>
      ) : (
        <span className="text-secondary">This session was run before cycles kept their trades.</span>
      );
    return { after: [{ key: `state-${row.key}`, className: "backtest-cycle-state-row", content: <DataTableStickyPanel className="backtest-cycle-state">{content}</DataTableStickyPanel> }] };
  };
  const toggleCycle = (row: CyclesTableRow) => {
    if (row.kind !== "cycle") return;
    const opening = !openCycleKeys.has(row.key);
    setOpenCycleKeys((keys) => {
      const next = new Set(keys);
      if (!next.delete(row.key)) next.add(row.key);
      return next;
    });
    if (opening && details.get(row.key)?.status !== "loaded") loadDetail(row.cycle);
  };
  const rowClassName = (row: CyclesTableRow) => {
    if (row.kind === "cycle") return openCycleKeys.has(row.key) ? "table-active" : undefined;
    // An assignment's row and a Vol Farmer crossing's rows are framed (theme.css).
    if (row.kind === "trade") return /^(Put|Call) assigned/.test(row.row.label) || row.row.crossing === true ? "backtest-cycle-trade-row backtest-cycle-highlighted-row" : "backtest-cycle-trade-row";
    return row.kind === "noCall" ? "backtest-cycle-trade-row backtest-cycle-idle-row" : "backtest-cycle-idle-row";
  };

  return (
    <div className="mb-3">
      <DataTable
        tableId="backtest-cycles"
        columns={columns}
        rows={tableRows}
        rowKey={(row) => row.key}
        emptyMessage="No cycle matches the filters."
        dense
        onRowClick={toggleCycle}
        isRowClickable={(row) => row.kind === "cycle"}
        rowClassName={rowClassName}
        extraRows={extraRows}
        toolbar={
          <>
            <BacktestCardTitle title={title} description={description} />
            <div className="d-flex flex-wrap align-items-center gap-2">
              {symbols.length > 1 && (
                <select className="form-select w-auto" aria-label="Symbol" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
                  <option value="">All symbols</option>
                  {symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              )}
              <select className="form-select w-auto" aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CycleStatusFilter)}>
                <option value="all">Open and closed</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
              <select className="form-select w-auto" aria-label="No-Call days" value={noCallFilter} onChange={(event) => setNoCallFilter(event.target.value as CycleNoCallFilter)}>
                <option value="all">All cycles</option>
                <option value="withNoCallDays">With no-Call days</option>
              </select>
              {toggle}
            </div>
          </>
        }
        footerCells={{
          cycle: filtered.length === cycles.length ? "All cycles" : `${pluralizeCount(filtered.length, "cycle")} shown`,
          pnl: <SignedDollars value={filteredPnl} bold />,
          noCallDays: noCallDaysText({ days: filtered.reduce((sum, cycle) => sum + (cycle.noCallDays?.days ?? 0), 0), shareDays: filtered.reduce((sum, cycle) => sum + (cycle.noCallDays?.shareDays ?? 0), 0) }),
          premium: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycle.netPremiumDollars, 0)} />,
          stock: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycleStockDollars(cycle), 0)} />,
        }}
      />
    </div>
  );
}
