import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { fetchBacktestCycleDetail, type BacktestCycle, type BacktestCycleDetail, type BacktestCycleGap, type BacktestCycleTimelineRow, type BacktestIdleStretch, type BacktestUncoveredStretch } from "../../api/backtest";
import { useCollapsibleCard } from "../../hooks/useCollapsibleCard";
import { formatNumber, formatSignedPercentage, formatSignedPnl, pluralizeCount, pnlTextClass } from "../../lib/formatters";
import {
  backtestCycleLabel,
  backtestCycleMetricExplanation,
  cycleBucketOrder,
  cycleStockDollars,
  describeBreakEven,
  describeCycleTimelineEvent,
  describeIdleStretchReason,
  describeIdleStretchRules,
  describeOpenCycles,
  describeSessionSpan,
  describeUncoveredShares,
  summarizeCycleTotals,
} from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";
import { CycleBucketBadge } from "../CycleBucketBadge";
import { DataTable, type DataTableColumn, type DataTableExtraRow } from "../DataTable/DataTable";
import { DataTableStickyPanel } from "../DataTable/DataTableStickyPanel";
import { DottedLabelTooltip } from "../HelpTooltip";
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
  | { kind: "trade"; key: string; row: BacktestCycleTimelineRow }
  | { kind: "uncovered"; key: string; stretch: BacktestUncoveredStretch };

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
}

/** A stretch's cells (an Idle row between cycles, an Uncovered row in a cycle's trades); null for an empty cell. */
function stretchCell(key: string, stretch: BacktestIdleStretch, own: { label: ReactNode; sessions: string; reason: string; rules: string; shares: ReactNode }): ReactNode {
  switch (key) {
    case "cycle":
      return own.label;
    case "opened":
      return stretch.firstIdleDay;
    case "closed":
      return stretch.lastIdleDay;
    case "sessions":
      return own.sessions;
    case "age":
      return pluralizeCount(stretch.idleSessions, "session");
    case "stock":
      return stretch.stockMove === null ? (
        dash
      ) : (
        <TooltipSpan text={stockMoveExplanation} className="dotted-underline-label text-secondary">
          {formatSignedPercentage(stretch.stockMove, 1)}
        </TooltipSpan>
      );
    case "strategies":
      return (
        <TooltipSpan text={own.rules} multiline className="dotted-underline-label backtest-cycle-row-detail">
          {own.reason}
        </TooltipSpan>
      );
    case "shares":
      return own.shares;
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
    shares: dash,
  });
}

/** An uncovered stretch is one of a cycle's breakdown rows: its Session # is its first session's alone. */
function uncoveredCell(key: string, stretch: BacktestUncoveredStretch, context: CellContext): ReactNode {
  if (["pnl", "status", "assigned", "recovery", "premium", "breakEven", "flags"].includes(key)) return null;
  return stretchCell(key, stretch, {
    label: <span className="backtest-cycle-event-name">Uncovered</span>,
    sessions: describeSessionSpan(context.sessionNumberOf(stretch.firstIdleDay)),
    reason: describeIdleStretchReason(stretch, "No call"),
    rules: describeIdleStretchRules(stretch, "No call"),
    shares: describeUncoveredShares(stretch),
  });
}

function tradeCell(key: string, row: BacktestCycleTimelineRow, context: CellContext): ReactNode {
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
    case "shares":
      return formatNumber(row.quantity);
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
    case "status":
      return cycle.status === "open" ? <span className="fw-semibold">Open</span> : <span className="text-secondary">Closed</span>;
    case "opened":
      return cycle.openedOn;
    case "closed":
      return cycle.closedOn ?? <span className="text-secondary">open</span>;
    case "sessions":
      return describeSessionSpan(context.sessionNumberOf(cycle.openedOn), cycle.closedOn === null ? context.lastSessionNumber : context.sessionNumberOf(cycle.closedOn));
    case "assigned":
      return cycle.assignedOn ?? dash;
    case "recovery":
      return cycle.recoverySessions === null ? "—" : pluralizeCount(cycle.recoverySessions, "session");
    case "age":
      return cycle.status === "open" && cycle.ageSessions !== null ? pluralizeCount(cycle.ageSessions, "session") : "—";
    case "premium":
      return <SignedDollars value={cycle.netPremiumDollars} />;
    case "stock":
      return <SignedDollars value={cycleStockDollars(cycle)} />;
    case "strategies":
      return <CycleStrategies cycle={cycle} />;
    case "shares":
      return cycle.sharesHeld === 0 ? "—" : formatNumber(cycle.sharesHeld);
    case "breakEven":
      return describeBreakEven(cycle.breakEvenPerShare);
    case "flags":
      return cycle.dataFlags.length === 0 ? (
        dash
      ) : (
        <DottedLabelTooltip label={pluralizeCount(cycle.dataFlags.length, "flag")} tooltipHtml={escapeTooltipHtml(cycle.dataFlags.join("; "))} className="iorio-note-amber text-nowrap" />
      );
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
      return tradeCell(key, row.row, context);
    case "uncovered":
      return uncoveredCell(key, row.stretch, context);
  }
}

const columnDefinitions: Omit<DataTableColumn<CyclesTableRow>, "render">[] = [
  { key: "cycle", header: "Cycle", cellClassName: "text-nowrap fw-semibold backtest-cycle-label-cell", headerClassName: "backtest-cycle-label-cell" },
  { key: "pnl", header: "Cycle P&L", headerTitle: `${backtestCycleMetricExplanation.cyclePnl} A trade's row: its premium + stock.`, align: "right" },
  { key: "status", header: "Status", headerTitle: "Open: the symbol is not flat yet at the session's end, and its P&L is at the last marks. Closed: the symbol went flat again." },
  { key: "opened", header: "Opened", headerTitle: "A cycle's first day; an idle or uncovered stretch's first session; a trade's day.", cellClassName: "font-mono text-nowrap" },
  { key: "closed", header: "Closed", headerTitle: "A cycle's last day; an idle or uncovered stretch's last session; an option sold or bought: its expiry.", cellClassName: "font-mono text-nowrap" },
  {
    key: "sessions",
    header: "Session #",
    headerTitle: "The session's trading days, numbered from 1 on its first (weekends and holidays have none): a cycle's or an idle stretch's first → last (an open cycle's to the session's end); a trade's own, an uncovered stretch's first.",
    align: "right",
    cellClassName: "text-nowrap",
  },
  { key: "assigned", header: "Put assigned", headerTitle: "The first day a put of the cycle was assigned.", cellClassName: "font-mono text-nowrap" },
  { key: "recovery", header: "Recovery", headerTitle: "Trading sessions from the assignment to the cycle's close (closed cycles that had an assignment).", align: "right", cellClassName: "text-nowrap" },
  { key: "age", header: "Open for", headerTitle: "Open cycles: trading sessions from the assignment (else from the opening) to the session's last day. Idle and uncovered stretches: their sessions.", align: "right", cellClassName: "text-nowrap" },
  { key: "premium", header: "Net premium", headerTitle: "Premiums in − buybacks − commissions.", align: "right" },
  { key: "stock", header: "Stock P&L", headerTitle: "What the shares made: the put's assignment charge and the stock's P&L while the strategies held it. Idle and uncovered stretches (grey): the stock's move over them.", align: "right" },
  {
    key: "strategies",
    header: "By strategy",
    headerTitle: "Each strategy's part of the cycle P&L, as the platform's Profit & Loss scoreboard attributes it. A trade: the strategy that owns it and what happened. Idle and uncovered stretches: why nothing was sold, the full rules in the tooltip.",
  },
  { key: "shares", header: "Shares held", headerTitle: "Shares the cycle's ledger holds at the end: an open cycle's shares (a closed cycle with shares left has a data flag). A trade: its shares (1 contract = 100). Uncovered: the shares with no call, of those held.", align: "right", cellClassName: "text-nowrap" },
  { key: "breakEven", header: "Break-even", headerTitle: "The share price at which the cycle is flat, after its premiums: Free once the premiums have paid for the shares.", align: "right" },
  { key: "flags", header: "Data flags", headerTitle: "Where the platform's cycle engine found the cycle's ledger incomplete; its figures may be off." },
];

/** A cycle's trades and its uncovered stretches, each stretch before the first trade dated on or after its first session. */
function breakdownRows(cycle: BacktestCycle, detail: BacktestCycleDetail): CyclesTableRow[] {
  const pending = [...detail.uncoveredStretches].sort((a, b) => a.firstIdleDay.localeCompare(b.firstIdleDay));
  const rows: CyclesTableRow[] = [];
  const uncoveredRow = (stretch: BacktestUncoveredStretch): CyclesTableRow => ({ kind: "uncovered", key: `uncovered-${cycleKeyOf(cycle)}-${stretch.firstIdleDay}`, stretch });
  detail.timeline.forEach((row, index) => {
    while (pending.length > 0 && pending[0]!.firstIdleDay <= row.tradingDate) rows.push(uncoveredRow(pending.shift()!));
    rows.push({ kind: "trade", key: `trade-${cycleKeyOf(cycle)}-${index}`, row });
  });
  return [...rows, ...pending.map(uncoveredRow)];
}

/** Every wheel cycle of the session, oldest first, all on one table; filter by symbol and status. With one symbol shown, a
 *  row for each stretch with no cycle open. A cycle's row opens to its trades. Collapsible (remembered in this browser). */
export function BacktestCyclesTable({ sessionId, cycles, cycleGaps, symbols, sessionDays }: { sessionId: string; cycles: BacktestCycle[]; cycleGaps: BacktestCycleGap[]; symbols: string[]; sessionDays: readonly { tradingDate: string }[] }) {
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

  const context = useMemo<CellContext>(() => {
    const numbers = new Map(sessionDays.map((day, index) => [day.tradingDate, index + 1]));
    return { isCycleOpen: (cycle) => openCycleKeys.has(cycleKeyOf(cycle)), sessionNumberOf: (date) => numbers.get(date) ?? null, lastSessionNumber: sessionDays.length === 0 ? null : sessionDays.length };
  }, [sessionDays, openCycleKeys]);
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
    return row.kind === "trade" ? "backtest-cycle-trade-row" : row.kind === "uncovered" ? "backtest-cycle-trade-row backtest-cycle-idle-row" : "backtest-cycle-idle-row";
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
