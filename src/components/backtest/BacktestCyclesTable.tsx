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
  type BacktestSessionDay,
  type BacktestSessionStockPrices,
  type BacktestStockOnlyStretch,
} from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatCurrency, formatNumber, formatSignedPercentage, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
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
// stock add up to the cycle's figures) and the stretches its shares had no call on. Every row puts its values in the
// table's own columns.

type CycleStatusFilter = "all" | "open" | "closed";

type CyclesTableRow =
  | { kind: "cycle"; key: string; cycle: BacktestCycle }
  | { kind: "gap"; key: string; gap: BacktestCycleGap }
  | { kind: "trade"; key: string; cycle: BacktestCycle; row: BacktestCycleTimelineRow }
  | { kind: "stockOnly"; key: string; cycle: BacktestCycle; stretch: BacktestStockOnlyStretch };

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
}

/** A signed percentage in green or red; a grey one on an Idle or Stock only row. */
function SignedPercent({ fraction, plain = false }: { fraction: number | null; plain?: boolean }) {
  if (fraction === null) return dash;
  return <span className={plain ? undefined : pnlTextClass(fraction)}>{formatSignedPercentage(fraction, 1)}</span>;
}

const priceText = (price: number | null) => (price === null ? dash : formatCurrency(price));

/** A stretch's cells (an Idle row between cycles, a Stock only row in a cycle's trades). */
function stretchCell(key: string, stretch: BacktestIdleStretch, own: { label: ReactNode; sessions: string; reason: string; rules: string; accountReturn: ReactNode; price: number | null }): ReactNode {
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
      return priceText(own.price);
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
  });
}

/** A stock-only stretch is one of a cycle's breakdown rows: its Session # is its first session's alone. */
function stockOnlyCell(key: string, cycle: BacktestCycle, stretch: BacktestStockOnlyStretch, context: CellContext): ReactNode {
  if (["pnl", "status", "premium", "stock", "breakEven"].includes(key)) return null;
  return stretchCell(key, stretch, {
    label: <span className="backtest-cycle-event-name">Stock only</span>,
    sessions: describeSessionSpan(context.sessionNumberOf(stretch.firstIdleDay)),
    reason: describeIdleStretchReason(stretch, `No option on ${formatNumber(stretch.sharesHeld)} shares`),
    rules: describeIdleStretchRules(stretch, "No call"),
    accountReturn: null,
    price: context.priceOn(cycle.symbol, stretch.firstIdleDay, "tenOclock"),
  });
}

function tradeCell(key: string, cycle: BacktestCycle, row: BacktestCycleTimelineRow, context: CellContext): ReactNode {
  const event = describeCycleTimelineEvent(row);
  switch (key) {
    case "cycle":
      return <span className="backtest-cycle-event-name">{event.name}</span>;
    case "pnl":
      return tradeDollars(row.premiumDollars + row.stockDollars);
    case "opened":
      return row.tradingDate;
    case "closed":
      return event.opensOption && row.expiryDate !== null ? row.expiryDate : null;
    case "sessions":
      return describeSessionSpan(context.sessionNumberOf(row.tradingDate));
    case "price":
      return priceText(context.priceOn(cycle.symbol, row.tradingDate, event.priceAt));
    case "breakEven":
      return row.breakEvenAtSale == null ? null : formatCurrency(row.breakEvenAtSale);
    case "premium":
      return tradeDollars(row.premiumDollars);
    case "stock":
      return tradeDollars(row.stockDollars);
    case "strategies":
      return (
        <span className="backtest-cycle-row-detail">
          <CycleBucketBadge bucket={row.bucket} />
          <span>{event.detail}</span>
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
      return priceText(context.priceOn(cycle.symbol, cycle.openedOn, "tenOclock"));
    case "breakEven":
      return cycle.status === "open" && cycle.cashBreakEvenPerShare != null ? describeBreakEven(cycle.cashBreakEvenPerShare) : dash;
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
    case "stockOnly":
      return stockOnlyCell(key, row.cycle, row.stretch, context);
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
  { key: "opened", header: "Opened", headerTitle: "A cycle's first day; an idle or stock-only stretch's first session; a trade's day.", cellClassName: "font-mono text-nowrap" },
  { key: "closed", header: "Closed", headerTitle: "A cycle's last day; an idle or stock-only stretch's last session; an option sold or bought: its expiry.", cellClassName: "font-mono text-nowrap" },
  {
    key: "sessions",
    header: "Session #",
    headerTitle: "The session's trading days, numbered from 1 on its first (weekends and holidays have none): a cycle's or an idle stretch's first → last (an open cycle's to the session's end); a trade's own, a stock-only stretch's first.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "price",
    header: "Price",
    headerTitle: "The stock price as traded. A cycle or a stretch: the 10:00 price on its first day. A trade: the 10:00 price the day's looks saw; an assignment, a hand-over or a mark: that day's close.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  {
    key: "breakEven",
    header: "B-E",
    headerTitle:
      "Break-even, in cash: (cost of every share bought in the cycle − what shares that left it brought in − net premium) ÷ shares held; selling the shares held at it leaves the cycle flat (Free once below zero). An open cycle: now. An option sold while the cycle held shares: the break-even just before the sale (a call on held shares under a break-even rule: the floor its strike was held to).",
    align: "right",
    cellClassName: "text-nowrap",
  },
  { key: "premium", header: "Net premium", headerTitle: "Premiums in − buybacks − commissions.", align: "right" },
  { key: "stock", header: "Stock P&L", headerTitle: "What the shares made: the put's assignment charge and the stock's P&L while the strategies held it.", align: "right" },
  {
    key: "strategies",
    header: "By strategy",
    headerTitle: "Each strategy's part of the cycle P&L, as the platform's Profit & Loss scoreboard attributes it. A trade: the strategy that owns it and what happened. Idle and stock-only stretches: why nothing was sold, the full rules in the tooltip.",
  },
];

/** A cycle's trades and its stock-only stretches, each stretch before the first trade dated on or after its first session. */
function breakdownRows(cycle: BacktestCycle, detail: BacktestCycleDetail): CyclesTableRow[] {
  const pending = [...detail.stockOnlyStretches].sort((a, b) => a.firstIdleDay.localeCompare(b.firstIdleDay));
  const rows: CyclesTableRow[] = [];
  const stockOnlyRow = (stretch: BacktestStockOnlyStretch): CyclesTableRow => ({ kind: "stockOnly", key: `stock-only-${cycleKeyOf(cycle)}-${stretch.firstIdleDay}`, cycle, stretch });
  detail.timeline.forEach((row, index) => {
    while (pending.length > 0 && pending[0]!.firstIdleDay <= row.tradingDate) rows.push(stockOnlyRow(pending.shift()!));
    rows.push({ kind: "trade", key: `trade-${cycleKeyOf(cycle)}-${index}`, cycle, row });
  });
  return [...rows, ...pending.map(stockOnlyRow)];
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
    .filter((cycle) => (symbolFilter === "" || cycle.symbol === symbolFilter) && (statusFilter === "all" || cycle.status === statusFilter))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.symbol.localeCompare(b.symbol));
  const filteredTotals = summarizeCycleTotals(filtered);
  const filteredPnl = filteredTotals.closedDollars + filteredTotals.openDollars;

  // Gaps mean something only along one symbol's cycles: a session of one symbol, or one picked. Each goes before the
  // cycle after it, else (that cycle filtered out, or none: to the session's end) after the cycle before it.
  const gapSymbol = symbols.length === 1 ? symbols[0]! : symbolFilter === "" ? null : symbolFilter;
  const shownCycleNumbers = new Set(filtered.filter((cycle) => cycle.symbol === gapSymbol).map((cycle) => cycle.cycleNumber));
  const gapsBefore = new Map<number, BacktestCycleGap[]>();
  const gapsAfter = new Map<number, BacktestCycleGap[]>();
  if (gapSymbol !== null && statusFilter !== "open") {
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
    if (row.kind === "trade") return /^(Put|Call) assigned/.test(row.row.label) ? "backtest-cycle-trade-row backtest-cycle-assigned-row" : "backtest-cycle-trade-row";
    return row.kind === "stockOnly" ? "backtest-cycle-trade-row backtest-cycle-idle-row" : "backtest-cycle-idle-row";
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
              {toggle}
            </div>
          </>
        }
        footerCells={{
          cycle: filtered.length === cycles.length ? "All cycles" : `${pluralizeCount(filtered.length, "cycle")} shown`,
          pnl: <SignedDollars value={filteredPnl} bold />,
          premium: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycle.netPremiumDollars, 0)} />,
          stock: <SignedDollars value={filtered.reduce((sum, cycle) => sum + cycleStockDollars(cycle), 0)} />,
        }}
      />
    </div>
  );
}
