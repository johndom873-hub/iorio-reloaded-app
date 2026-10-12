import { useEffect, useMemo, useRef, useState } from "react";
import { PlutoManagedMark } from "../components/PlutoManagedMark";
import { usePlutoEnabledSymbols } from "../hooks/usePlutoEnabledSymbols";
import { IconAlertTriangle, IconChevronDown } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import { fetchSignalsRoadmap, fetchSignalsScreen, openSignalsScreenStream, type DayQuotesFrameStatus, type RoadmapItem, type SignalGrade, type SignalsScreenRow } from "../api/signals";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { FlashingNumber } from "../components/FlashingNumber";
import { FlashingText } from "../components/FlashingText";
import { PageHeader } from "../components/layout/PageHeader";
import { ModelCaveatBadge, RoadmapEtaText } from "../components/signals/ModelCaveatBadge";
import { RollBadge } from "../components/signals/RollBadge";
import { Spinner } from "../components/Spinner";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { TooltipSpan } from "../components/TooltipSpan";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";
import { daysToExpiry, formatCurrency, formatDateTime, formatDaysToExpiry, formatPercentage, formatRelativeTime, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass } from "../lib/formatters";
import { candidateContractKey, describeCandidateCompact, describeDayQuotesStatus, describeNoSignalBadge, dollarsPerTenThousandOfExposure, type NoSignalBadge, gradeBadgeClass, gradeExplanation, gradeLabel, modelColumnExplanation, priceSourceLabel, quoteSourceLabel, roadmapStatusBadgeClass, roadmapStatusLabel, signalsColumnExplanation, restScoresFallbackMs } from "../lib/signalsPresentation";
import { useTooltip } from "../hooks/useTooltip";
import { QuoteAgeLabel } from "../components/QuoteAgeLabel";

// Signals screen (stage 3 of the build; mockup approved 2026-09-22, v3):
// every shortlist ticker, scored against the 10:00 ET fitted surface at live
// prices. First paint from GET /signals, then the signalsScreen stream
// replaces the rows at most once a second. A row opens the Signals modal
// (stage 4, mounted globally), kept in the URL as ?signal=SYMBOL.

type StreamState = "connecting" | "live" | "failed";

const badgeFontSize = { fontSize: "0.72rem" } as const;

function GradeBadge({ grade, explanation = modelColumnExplanation.grade, faded = false }: { grade: SignalGrade; explanation?: string; faded?: boolean }) {
  const ref = useTooltip<HTMLSpanElement>(explanation);
  return (
    <span ref={ref} className={`badge ${gradeBadgeClass[grade]}`} style={faded ? { ...badgeFontSize, opacity: 0.8 } : badgeFontSize} tabIndex={0}>
      {gradeLabel[grade]}
    </span>
  );
}

// The valuation model's column groups (mockup approved 2026-10-10).
const modelGroup = { label: "Valuation model · what Pluto acts on", className: "signals-model-group", title: "The valuation model's figures for each ticker's top signal: what Pluto ranks, sizes and acts on." };
const dayBasisGroup = { label: "Day basis", className: "signals-day-basis-group", title: "Volatilities on trading days, the basis the model compares them on." };
const oldEdgeGroup = { label: "Old Edge · 63-day · phasing out", className: "signals-old-group", title: "The previous Edge measure (63-day forecast, volatility points), shown until it is retired." };
const modelCell = "signals-model-cell";

/** The top signal's model figures, or null when the ticker has none or the model could not value it. */
function topModel(row: SignalsScreenRow) {
  return row.best?.model ?? null;
}

/** A per-contract dollar figure per $10,000 of the top signal's EXP $. */
function topPerTenThousand(row: SignalsScreenRow, pick: (model: NonNullable<ReturnType<typeof topModel>>) => number): number | null {
  const model = topModel(row);
  return model ? dollarsPerTenThousandOfExposure(pick(model), model.capitalAtRiskDollars) : null;
}

/**
 * Rows in Pluto's order: the top signal's Edge Yield, highest first, at the precision shown (whole percent), so a tick that
 * does not change the figure on screen does not move a row; ties keep the previous order. Tickers without one go last.
 */
function rankRowsByEdgeYield(rows: SignalsScreenRow[], previousOrder: Map<string, number>): SignalsScreenRow[] {
  const shownEdgeYield = (row: SignalsScreenRow) => {
    const model = topModel(row);
    return model ? Math.round(model.expectedAnnualizedReturn * 100) : null;
  };
  const indexed = rows.map((row, index) => ({ row, edgeYield: shownEdgeYield(row), previous: previousOrder.get(row.tickerId) ?? rows.length + index }));
  indexed.sort((a, b) => (a.edgeYield === null ? 1 : 0) - (b.edgeYield === null ? 1 : 0) || (b.edgeYield ?? 0) - (a.edgeYield ?? 0) || a.previous - b.previous);
  return indexed.map((entry) => entry.row);
}

/** A model fraction as a whole percent ("34%"); flashes only when the shown figure changes. */
function ModelPercent({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="font-mono text-secondary">—</span>;
  return (
    <FlashingNumber value={value} precision={2} className="font-mono">
      {formatPercentage(value, 0)}
    </FlashingNumber>
  );
}

/** A yearly rate as a signed whole percent ("+40%"), green above zero and red below. */
function ModelSignedPercent({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="font-mono text-secondary">—</span>;
  return (
    <FlashingNumber value={value} precision={2} className={`font-mono ${pnlTextClass(value)}`}>
      {formatSignedPercentageValue(value * 100, 0)}
    </FlashingNumber>
  );
}

/** Whole dollars, signed ("+$35", "−$1,119"), green above zero and red below. */
function ModelDollars({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-secondary">—</span>;
  return (
    <FlashingNumber value={value} precision={0} className={`font-mono ${pnlTextClass(value)}`}>
      {formatSignedPnl(value, 0)}
    </FlashingNumber>
  );
}

/** No top signal: the badge (Analysing / Unscored / No candidates / Filtered) with the reason always shown under it (approved mockup 2026-10-03). */
function UnscoredBadge({ row }: { row: SignalsScreenRow }) {
  const badge = describeNoSignalBadge(row);
  return (
    <div className="d-flex flex-column align-items-start gap-1">
      <NoSignalBadgeLabel badge={badge} />
      {badge.reason && <span className="text-secondary signals-no-signal-reason">{badge.reason}</span>}
    </div>
  );
}

function NoSignalBadgeLabel({ badge }: { badge: NoSignalBadge }) {
  return (
    <span className={`badge ${badge.className} d-inline-flex align-items-center gap-1`} style={badgeFontSize}>
      {badge.spinning && <Spinner size="sm" className="iorio-badge-spinner" />}
      {badge.label}
    </span>
  );
}

/** What the best opportunity's numbers rest on: a live line (pulse dot), a day quote (age), or the snapshot (mockup rev 2). */
function QuoteSourceCell({ row }: { row: SignalsScreenRow }) {
  const best = row.best;
  if (!best) return <span className="text-secondary">—</span>;
  if (best.quoteSource === "live") {
    return (
      <TooltipSpan className="d-inline-flex align-items-center gap-2" text={quoteSourceLabel.live}>
        <span className="iorio-pulse-dot" />
        Live
      </TooltipSpan>
    );
  }
  if (best.quoteSource === "day") {
    return (
      <TooltipSpan className="d-inline-flex align-items-center gap-2 font-mono" text={`${quoteSourceLabel.day}${best.quotedAt ? ` · received ${formatDateTime(best.quotedAt)}` : ""}`}>
        <span className="iorio-still-dot" />
        <QuoteAgeLabel quotedAt={best.quotedAt} />
      </TooltipSpan>
    );
  }
  return (
    <TooltipSpan className="font-mono text-secondary" text={row.snapshotCapturedAt ? `${formatDateTime(row.snapshotCapturedAt)} snapshot quote — this contract is not in today's refresh pool` : quoteSourceLabel.snapshot}>
      Snapshot
    </TooltipSpan>
  );
}

/** One label/value pair of a phone card's model grid. */
function MobileFigure({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <span>
      <span className="signals-mobile-model-label">{label} </span>
      <span className={tone}>{value}</span>
    </span>
  );
}

function RoadmapItemRows({ items }: { items: RoadmapItem[] }) {
  return (
    <div className="list-group list-group-flush">
      {items.map((item) => (
        <div key={item.id} className="list-group-item px-0">
          <div className="row g-2 align-items-start">
            <div className="col-12 col-lg-5">
              <div className="fw-semibold">{item.title}</div>
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>
                {item.summary}
              </div>
            </div>
            <div className="col-12 col-lg-3 text-secondary" style={{ fontSize: "0.8rem" }}>
              Needs: {item.needs}
            </div>
            <div className="col-6 col-lg-2">
              <span className={`badge ${roadmapStatusBadgeClass[item.status]}`} style={badgeFontSize}>
                {roadmapStatusLabel[item.status]}
              </span>
            </div>
            <div className="col-6 col-lg-2"><RoadmapEtaText eta={item.eta} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function latestSnapshotCapturedAt(rows: SignalsScreenRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => (row.snapshotCapturedAt && (!latest || row.snapshotCapturedAt > latest) ? row.snapshotCapturedAt : latest), null);
}

export function SignalsPage() {
  const [rows, setRows] = useState<SignalsScreenRow[]>([]);
  const plutoEnabledSymbols = usePlutoEnabledSymbols();
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [restRows, setRestRows] = useState<SignalsScreenRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const [dayQuotes, setDayQuotes] = useState<DayQuotesFrameStatus | null>(null);
  const { symbol: modalSymbol, open: openTickerModal } = useSignalsTickerModal();
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSignalsScreen(), fetchSignalsRoadmap()])
      .then(([screenRows, roadmapResponse]) => {
        if (cancelled) return;
        setRestRows(screenRows);
        setRoadmap(roadmapResponse.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the Signals screen.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The REST rows are scored at the 10:00 snapshot spot: shown only if no live frame has arrived after a short wait (or the stream
  // failed), so the list never opens on stale grades that the live prices then correct.
  useEffect(() => {
    if (!restRows) return;
    const showRestRows = () => {
      // A live frame may already have replaced the rows; the REST answer must not roll them back.
      setRows((current) => (current.length > 0 ? current : restRows));
      setLoading(false);
    };
    if (streamState === "failed") {
      showRestRows();
      return;
    }
    const timer = setTimeout(showRestRows, restScoresFallbackMs);
    return () => clearTimeout(timer);
  }, [restRows, streamState]);

  // Re-opened when the modal opens/closes: the modal holds its own live lines, so the screen's
  // one-per-ticker best-contract lines are released while it is open (approved 2026-09-24).
  useEffect(() => {
    setStreamState("connecting");
    return openSignalsScreenStream(
      (frame) => {
        setRows(frame.rows);
        setDayQuotes(frame.dayQuotes);
        setLastFrameAt(frame.at);
        setStreamState("live");
        setLoading(false);
      },
      () => setStreamState("failed"),
      { bestContractLines: modalSymbol === null },
    );
  }, [modalSymbol]);

  // Rows in Pluto's order, kept stable between frames (see rankRowsByEdgeYield).
  const previousOrderRef = useRef(new Map<string, number>());
  const rankedRows = useMemo(() => {
    const ranked = rankRowsByEdgeYield(rows, previousOrderRef.current);
    previousOrderRef.current = new Map(ranked.map((row, index) => [row.tickerId, index]));
    return ranked;
  }, [rows]);

  const anyLivePrice = rows.some((row) => row.priceSource === "live");
  const liveStatus =
    streamState === "failed" ? { label: "Live prices unavailable — showing snapshot prices", tone: "text-danger" } : anyLivePrice ? { label: "Live prices connected", tone: "text-success" } : streamState === "live" ? { label: "Live stream connected — waiting for prices", tone: "text-secondary" } : { label: "Connecting live prices…", tone: "text-secondary" };
  const snapshotCapturedAt = latestSnapshotCapturedAt(rows);
  const liveStatusTooltipRef = useTooltip<HTMLSpanElement>(lastFrameAt ? `Last update ${formatDateTime(lastFrameAt)}` : undefined);
  const dayQuotesStatus = describeDayQuotesStatus(dayQuotes);
  const dayQuotesTooltipRef = useTooltip<HTMLSpanElement>(
    dayQuotes?.loop
      ? `Live bid/ask for the day's pooled expiries, refreshed continuously on 10 IBKR lines. ${dayQuotes.status.tickerCount} tickers · ${dayQuotes.status.expiryCount} expiries · ${dayQuotes.status.quoteCount} quotes${dayQuotes.loop.lastError ? ` · last error: ${dayQuotes.loop.lastError}` : ""}`
      : "The Day Signals refresh loop runs on the API server while the market is open.",
  );

  const columns = useMemo<DataTableColumn<SignalsScreenRow>[]>(
    () => [
      {
        key: "ticker",
        header: "Ticker",
        render: (row) => (
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => openTickerModal(row.symbol)}>
            {row.symbol}
            <PlutoManagedMark symbol={row.symbol} managed={plutoEnabledSymbols.has(row.symbol)} />
          </button>
        ),
      },
      {
        key: "price",
        header: "Price",
        align: "right",
        headerTitle: signalsColumnExplanation.price,
        render: (row) => (
          <TickColoredPrice value={row.spotPrice} initialReference={row.previousClose?.close ?? null} precision={2} title={priceSourceLabel[row.priceSource]}>
            <span className="font-mono">{formatCurrency(row.spotPrice)}</span>
          </TickColoredPrice>
        ),
      },
      {
        key: "day",
        header: "Day",
        align: "right",
        headerTitle: signalsColumnExplanation.day,
        render: (row) => <span className={`font-mono ${pnlTextClass(row.dayChangePercent)}`}>{formatSignedPercentageValue(row.dayChangePercent, 1)}</span>,
      },
      {
        key: "best",
        header: "Top signal",
        headerTitle: modelColumnExplanation.topSignal,
        group: modelGroup,
        cellClassName: modelCell,
        render: (row) =>
          row.best ? (
            <FlashingText changeKey={candidateContractKey(row.best)} className="text-nowrap">
              {describeCandidateCompact(row.best)}
            </FlashingText>
          ) : (
            <UnscoredBadge row={row} />
          ),
      },
      { key: "modelGrade", header: "Grade", headerTitle: modelColumnExplanation.grade, group: modelGroup, cellClassName: modelCell, render: (row) => (topModel(row) ? <GradeBadge grade={topModel(row)!.grade} /> : null) },
      {
        key: "edgeMargin",
        header: "Edge margin",
        align: "right",
        headerTitle: modelColumnExplanation.margin,
        group: modelGroup,
        cellClassName: modelCell,
        render: (row) => <ModelPercent value={topModel(row)?.edgeMargin} />,
      },
      { key: "edgePer10k", header: "Edge $ /10k", align: "right", headerTitle: modelColumnExplanation.edgePer10k, group: modelGroup, cellClassName: modelCell, render: (row) => <ModelDollars value={topPerTenThousand(row, (model) => model.expectedPnlDollars)} /> },
      { key: "edgeYield", header: "Edge Yield", align: "right", headerTitle: modelColumnExplanation.edgeYield, group: modelGroup, cellClassName: modelCell, render: (row) => <ModelSignedPercent value={topModel(row)?.expectedAnnualizedReturn} /> },
      { key: "histYield", header: "Hist Yield", align: "right", headerTitle: modelColumnExplanation.histYield, group: modelGroup, cellClassName: modelCell, render: (row) => <ModelSignedPercent value={topModel(row)?.calibratedAnnualizedReturn} /> },
      { key: "pop", header: "PoP", align: "right", headerTitle: modelColumnExplanation.pop, group: modelGroup, cellClassName: modelCell, render: (row) => <ModelPercent value={topModel(row)?.probabilityOfProfit} /> },
      { key: "worstPer10k", header: "Worst 5% /10k", align: "right", headerTitle: modelColumnExplanation.worstPer10k, group: modelGroup, cellClassName: modelCell, render: (row) => <ModelDollars value={topPerTenThousand(row, (model) => model.expectedShortfallDollars)} /> },
      { key: "quotes", header: "Quotes", headerTitle: signalsColumnExplanation.quotes, render: (row) => <QuoteSourceCell row={row} /> },
      {
        key: "atmIv",
        header: "ATM IV",
        align: "right",
        headerTitle: modelColumnExplanation.dayBasisAtmIv,
        group: dayBasisGroup,
        render: (row) => {
          const atm = row.atmImpliedVolatilityPerSession;
          const forecast = row.modelForecast?.annualizedVolatility ?? null;
          return <span className={`font-mono ${atm !== null && forecast !== null ? pnlTextClass(atm - forecast) : ""}`}>{formatPercentage(atm, 1)}</span>;
        },
      },
      { key: "forecast", header: "FV 21d", align: "right", headerTitle: modelColumnExplanation.forecast21, group: dayBasisGroup, render: (row) => <span className="font-mono">{formatPercentage(row.modelForecast?.annualizedVolatility, 1)}</span> },
      { key: "grade", header: "Grade", headerTitle: gradeExplanation, group: oldEdgeGroup, render: (row) => (row.best ? <GradeBadge grade={row.best.grade} explanation={gradeExplanation} faded /> : null) },
      {
        key: "netEdge",
        header: "Net Edge",
        align: "right",
        headerTitle: signalsColumnExplanation.netEdge,
        group: oldEdgeGroup,
        render: (row) => (row.best ? <span className="font-mono text-secondary">{formatVolatilityPoints(row.best.netEdge)}</span> : null),
      },
      {
        key: "edgeDollars",
        header: "Edge $",
        align: "right",
        headerTitle: signalsColumnExplanation.edgeDollars,
        group: oldEdgeGroup,
        render: (row) => (row.best ? <span className="font-mono text-secondary">{formatSignedPnl(row.best.edgeDollars, 0)}</span> : null),
      },
      {
        key: "momentum",
        header: "Mom.",
        align: "right",
        headerTitle: signalsColumnExplanation.momentum,
        render: (row) => (row.momentum === null ? <span className="text-secondary">n/a</span> : <span className={`font-mono ${pnlTextClass(row.momentum)}`}>{formatSignedPercentageValue(row.momentum * 100, 0)}</span>),
      },
      { key: "earnings", header: "Earnings", headerTitle: signalsColumnExplanation.earnings, render: (row) => <span className="font-mono text-nowrap">{row.nextEarningsDateIso ? formatDaysToExpiry(daysToExpiry(row.nextEarningsDateIso)) : "—"}</span> },
      {
        // Badges column (2026-09-24): blank header; a "model" badge only when the ticker has a caveat of its own,
        // a roll badge only when an open short leg has a credit roll above Avoid. Empty otherwise.
        key: "badges",
        header: "",
        render: (row) => (
          <span className="d-inline-flex align-items-center gap-1 justify-content-end w-100">
            <ModelCaveatBadge symbol={row.symbol} caveats={row.caveats} />
            <RollBadge row={row} onClick={(legId) => openTickerModal(row.symbol, { rollLegId: legId })} />
          </span>
        ),
      },
    ],
    [openTickerModal, plutoEnabledSymbols],
  );

  if (error) {
    return (
      <>
        <PageHeader title="Signals" />
        <div className="alert alert-danger mt-3">{error}</div>
      </>
    );
  }

  const toolbar = (
    <div className="d-flex align-items-center gap-3 flex-wrap" style={{ fontSize: "0.8rem" }}>
      <span ref={liveStatusTooltipRef} className={`d-inline-flex align-items-center gap-2 ${liveStatus.tone}`} tabIndex={lastFrameAt ? 0 : undefined}>
        {anyLivePrice && <span className="iorio-pulse-dot" />}
        {liveStatus.label}
      </span>
      <span ref={dayQuotesTooltipRef} className={`d-inline-flex align-items-center gap-2 ${dayQuotesStatus.tone}`} tabIndex={0}>
        <span className={dayQuotesStatus.pulse ? "iorio-pulse-dot iorio-pulse-dot-muted" : "iorio-still-dot"} />
        {dayQuotesStatus.label}
      </span>
      <span className="text-secondary">{snapshotCapturedAt ? `Surface snapshot ${formatDateTime(snapshotCapturedAt)} · ${formatRelativeTime(snapshotCapturedAt) ?? ""}` : "No surface snapshot yet"}</span>
    </div>
  );

  const roadmapSection = roadmap.length > 0 && (
    <details className="px-3 py-2 border-bottom" open={roadmapOpen} onToggle={(event) => setRoadmapOpen(event.currentTarget.open)}>
      <summary className="d-flex align-items-center gap-2 iorio-summary-no-marker" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
        <IconAlertTriangle size={16} className="text-warning" />
        <span>
          <strong>{roadmap.length}</strong> measures are not accounted for yet. Open for what each one is waiting on and when it should be ready.
        </span>
        <IconChevronDown
          size={18}
          className="text-muted ms-auto"
          style={{ transform: roadmapOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
        />
      </summary>
      <div className="pt-2">
        <RoadmapItemRows items={roadmap} />
        <div className="text-secondary pt-2" style={{ fontSize: "0.78rem" }}>
          Each item is a reminder to ask for it to be wired in once what it waits on is ready.
        </div>
      </div>
    </details>
  );

  const gradesNote = (
    <div className="card-footer text-secondary" style={{ fontSize: "0.8rem", lineHeight: 1.55 }}>
      <strong>Edge margin</strong>: how far the price is above the model's fair value, as a share of the price (1 − fair ÷ mid); it sets the grade: <strong>Strong</strong> 20% or more · <strong>Good</strong> 10% to 20% · <strong>Weak</strong> 0% to 10%. <strong>Edge $ /10k</strong>: the expected profit per contract held to expiry, after costs, per $10,000 of EXP $ (the exposure: the cash reserved at the strike for a put, the shares at their price for a covered call, less the premium received). <strong>Edge Yield</strong>: that expected profit as a yearly rate on EXP $, over the calendar days left; rows and each ticker's top signal are ranked by it, as Pluto ranks. <strong>Hist Yield</strong>: the same after history's correction, what similar at-the-money sales actually earned. <strong>PoP</strong>: chance the sale ends in profit. <strong>Worst 5% /10k</strong>: the average result of the worst one-in-twenty outcomes, per $10,000 of EXP $. A covered call counts the shares with the call, so it is judged like a cash-secured put. ATM IV and FV are on the day basis (trading days); ATM IV is green above FV, red below. <strong>Old Edge</strong>: the 63-day forecast in volatility points, until retired. Click a ticker for its full opportunity list.
    </div>
  );

  return (
    <>
      <PageHeader title="Signals" subtitle="Live opportunity scoring for your shortlist · scores use the 10:00 ET surface, live prices" />

      <div className="d-none d-md-block">
        <DataTable
          tableId="signals"
          columns={columns}
          rows={rankedRows}
          rowKey={(row) => row.tickerId}
          rowClassName={(row) => (row.unscoredReason === "analysing" ? "signals-row-analysing" : row.unscoredReason ? "signals-row-unscored" : undefined)}
          loading={loading && rows.length === 0}
          emptyMessage="No tickers on the shortlist."
          toolbar={toolbar}
          beforeTable={roadmapSection}
          afterTable={gradesNote}
        />
      </div>

      <div className="d-md-none">
        <div className="card mb-3">
          <div className="card-body py-2">{toolbar}</div>
          {roadmapSection}
        </div>
        <div className="d-flex flex-column gap-2">
          {rankedRows.map((row) => {
            const model = topModel(row);
            return (
              <div key={row.tickerId} className="card position-relative">
                <div className="card-body py-2 d-flex flex-column gap-1">
                  <div className="d-flex justify-content-between align-items-baseline gap-2">
                    {/* stretched-link: the whole card opens the ticker (a 44px+ tap target, as the mockup's card link). */}
                    <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold stretched-link position-static" onClick={() => openTickerModal(row.symbol)}>
                      {row.symbol}
                      <PlutoManagedMark symbol={row.symbol} managed={plutoEnabledSymbols.has(row.symbol)} />
                    </button>
                    <span className="font-mono" style={{ fontSize: "0.85rem" }}>
                      <TickColoredPrice value={row.spotPrice} initialReference={row.previousClose?.close ?? null} precision={2} title={priceSourceLabel[row.priceSource]}>
                        <span>{formatCurrency(row.spotPrice)}</span>
                      </TickColoredPrice>{" "}
                      <span className={pnlTextClass(row.dayChangePercent)}>{formatSignedPercentageValue(row.dayChangePercent, 1)}</span>
                    </span>
                  </div>
                  {row.best ? (
                    <>
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <span className="fw-semibold">{describeCandidateCompact(row.best)}</span>
                        {model ? <GradeBadge grade={model.grade} /> : <GradeBadge grade={row.best.grade} explanation={gradeExplanation} faded />}
                        {model && (
                          <span className="font-mono" style={{ fontSize: "0.82rem" }}>
                            <span className="signals-mobile-model-label">margin </span>
                            {formatPercentage(model.edgeMargin, 0)}
                          </span>
                        )}
                      </div>
                      {model ? (
                        <div className="signals-mobile-model-grid font-mono">
                          <MobileFigure label="Edge/10k" value={formatSignedPnl(topPerTenThousand(row, (entry) => entry.expectedPnlDollars), 0)} tone={pnlTextClass(topPerTenThousand(row, (entry) => entry.expectedPnlDollars))} />
                          <MobileFigure label="Edge Yield" value={formatSignedPercentageValue(model.expectedAnnualizedReturn * 100, 0)} tone={pnlTextClass(model.expectedAnnualizedReturn)} />
                          <MobileFigure label="Hist Yield" value={formatSignedPercentageValue(model.calibratedAnnualizedReturn * 100, 0)} tone={pnlTextClass(model.calibratedAnnualizedReturn)} />
                          <MobileFigure label="PoP" value={formatPercentage(model.probabilityOfProfit, 0)} />
                          <MobileFigure label="Worst/10k" value={formatSignedPnl(topPerTenThousand(row, (entry) => entry.expectedShortfallDollars), 0)} tone={pnlTextClass(topPerTenThousand(row, (entry) => entry.expectedShortfallDollars))} />
                          <MobileFigure label="Old" value={formatVolatilityPoints(row.best.netEdge)} tone="text-secondary" />
                        </div>
                      ) : (
                        <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
                          Not valued by the model · old Edge <span className="font-mono">{formatVolatilityPoints(row.best.netEdge)}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <UnscoredBadge row={row} />
                  )}
                  <div className="d-flex justify-content-between align-items-center gap-2 text-secondary" style={{ fontSize: "0.78rem" }}>
                    <span>Mom {row.momentum === null ? "n/a" : formatSignedPercentageValue(row.momentum * 100, 0)}</span>
                    <span>Vol {row.elevatedVolatility ? (row.elevatedVolatility.elevated ? "elevated" : "normal") : "n/a"}</span>
                    <QuoteSourceCell row={row} />
                  </div>
                  {(row.caveats.length > 0 || (row.bestRoll !== null && row.rollCount > 0)) && (
                    // Above the stretched link, so the badges keep their own actions.
                    <div className="d-flex justify-content-end align-items-center gap-1 position-relative" style={{ zIndex: 2 }}>
                      <ModelCaveatBadge symbol={row.symbol} caveats={row.caveats} />
                      <RollBadge row={row} onClick={(legId) => openTickerModal(row.symbol, { rollLegId: legId })} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-secondary mb-0" style={{ fontSize: "0.72rem", lineHeight: 1.45 }}>
            Edge/10k and Worst/10k: per $10,000 of EXP $ (net of the premium). Edge Yield: the expected profit as a yearly rate on EXP $; Hist Yield: the same after history's correction. Old = the 63-day Edge, until retired.
          </p>
        </div>
      </div>

    </>
  );
}
