import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { fetchSignalsRoadmap, fetchSignalsScreen, openSignalsScreenStream, type DayQuotesFrameStatus, type RoadmapItem, type SignalGrade, type SignalsScreenRow } from "../api/signals";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { FlashingNumber } from "../components/FlashingNumber";
import { PageHeader } from "../components/layout/PageHeader";
import { ModelCaveatBadge, RoadmapEtaText } from "../components/signals/ModelCaveatBadge";
import { SignalsTickerModal } from "../components/SignalsTickerModal";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { TooltipSpan } from "../components/TooltipSpan";
import { VolatilitySurfaceModal } from "../components/VolatilitySurfaceModal";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import { formatCurrency, formatDate, formatDateTime, formatPercentage, formatRelativeTime, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass, formatShortAge } from "../lib/formatters";
import { describeCandidate, describeDayQuotesStatus, describeRoll, gradeBadgeClass, gradeExplanation, gradeLabel, priceSourceLabel, quoteSourceLabel, roadmapStatusBadgeClass, roadmapStatusLabel, signalsColumnExplanation, unscoredReasonLabel } from "../lib/signalsPresentation";
import { useTooltip } from "../hooks/useTooltip";

// Signals screen (stage 3 of the build; mockup approved 2026-09-22, v3):
// every shortlist ticker, scored against the 10:00 ET fitted surface at live
// prices. First paint from GET /signals, then the signalsScreen stream
// replaces the rows at most once a second. A row opens the Signals modal
// (stage 4), kept in the URL as ?signal=SYMBOL like Ticker Detail's ?ticker=.

type StreamState = "connecting" | "live" | "failed";

const badgeFontSize = { fontSize: "0.72rem" } as const;

function GradeBadge({ grade }: { grade: SignalGrade }) {
  const ref = useTooltip<HTMLSpanElement>(gradeExplanation);
  return (
    <span ref={ref} className={`badge ${gradeBadgeClass[grade]}`} style={badgeFontSize} tabIndex={0}>
      {gradeLabel[grade]}
    </span>
  );
}

/**
 * Roll Signals badge (variant B, approved 2026-09-24): solid, in the best roll's grade colour, counting the
 * held legs with a roll above Avoid. Click opens the modal on that roll.
 */
function RollBadge({ row, onClick }: { row: SignalsScreenRow; onClick: (legId: string) => void }) {
  const best = row.bestRoll;
  const held = best ? row.heldLegs.find((leg) => leg.legId === best.legId) : undefined;
  const tooltip = best && held ? `${signalsColumnExplanation.roll} Best: ${describeRoll(best, held)} · ${formatVolatilityPoints(best.netRollEdge)} (${formatSignedPnl(best.netRollEdgeDollars, 0)}) · net credit ${formatCurrency(best.netCreditPerShare)}/sh.` : "";
  const ref = useTooltip<HTMLButtonElement>(tooltip);
  if (!best || row.rollCount === 0) return null;
  return (
    <button ref={ref} type="button" className={`badge border-0 d-inline-flex align-items-center gap-1 px-2 py-1 ${gradeBadgeClass[best.grade]}`} style={{ ...badgeFontSize, cursor: "pointer" }} onClick={() => onClick(best.legId)}>
      <IconRefresh size={12} />
      {row.rollCount} roll{row.rollCount === 1 ? "" : "s"} · {gradeLabel[best.grade]}
    </button>
  );
}

function UnscoredBadge({ row }: { row: SignalsScreenRow }) {
  return (
    <span className="text-secondary">
      <span className="badge bg-secondary-lt me-1" style={badgeFontSize}>
        Unscored
      </span>
      {row.unscoredReason ? unscoredReasonLabel[row.unscoredReason] : ""}
    </span>
  );
}

function VolatilityFlagBadge({ row }: { row: SignalsScreenRow }) {
  const flag = row.elevatedVolatility;
  const title = flag
    ? `21-day / 126-day volatility = ${flag.ratio.toFixed(2)} vs threshold ${flag.threshold.toFixed(2)} (${flag.thresholdSource === "own_p90" ? "this ticker's own 90th percentile" : "fixed fallback until a year of history"})`
    : undefined;
  const ref = useTooltip<HTMLSpanElement>(title);
  if (!flag) return <span className="text-secondary">n/a</span>;
  return (
    <span ref={ref} className={`badge ${flag.elevated ? "bg-danger-lt" : "bg-secondary-lt"}`} style={badgeFontSize} tabIndex={0}>
      {flag.elevated ? "Elevated" : "Normal"}
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
        {formatShortAge(best.quotedAt) ?? "—"}
      </TooltipSpan>
    );
  }
  return (
    <TooltipSpan className="font-mono text-secondary" text={quoteSourceLabel.snapshot}>
      10:00
    </TooltipSpan>
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
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const [dayQuotes, setDayQuotes] = useState<DayQuotesFrameStatus | null>(null);
  const [modalSymbol, setModalSymbol] = useTickerDetailSymbol("signal");
  // Roll Signals: `?roll=<legId>` beside `?signal=` pre-selects that leg's best roll in the modal (badge click, Telegram link).
  const [searchParams, setSearchParams] = useSearchParams();
  const modalRollLegId = searchParams.get("roll");
  const openModalOnRoll = useCallback(
    (symbol: string, legId: string) =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.set("signal", symbol);
          params.set("roll", legId);
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const closeModal = useCallback(
    () =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.delete("signal");
          params.delete("roll");
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const [surfaceModalSymbol, setSurfaceModalSymbol] = useState<string | null>(null);
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSignalsScreen(), fetchSignalsRoadmap()])
      .then(([screenRows, roadmapResponse]) => {
        if (cancelled) return;
        // A live frame may already have replaced the rows; the REST answer must not roll them back.
        setRows((current) => (current.length > 0 ? current : screenRows));
        setRoadmap(roadmapResponse.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the Signals screen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      },
      () => setStreamState("failed"),
      { bestContractLines: modalSymbol === null },
    );
  }, [modalSymbol]);

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
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => setModalSymbol(row.symbol)}>
            {row.symbol}
          </button>
        ),
      },
      {
        key: "name",
        header: "Name",
        render: (row) => <span className="text-secondary">{row.companyName ?? "—"}</span>,
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
      { key: "best", header: "Best opportunity", headerTitle: signalsColumnExplanation.best, render: (row) => (row.best ? <span className="text-nowrap">{describeCandidate(row.best)}</span> : <UnscoredBadge row={row} />) },
      { key: "grade", header: "Grade", headerTitle: signalsColumnExplanation.grade, render: (row) => (row.best ? <GradeBadge grade={row.best.grade} /> : null) },
      {
        key: "netEdge",
        header: "Net Edge",
        align: "right",
        headerTitle: signalsColumnExplanation.netEdge,
        render: (row) =>
          row.best ? (
            <FlashingNumber value={row.best.netEdge} precision={3} className={`font-mono ${pnlTextClass(row.best.netEdge)}`}>
              {formatVolatilityPoints(row.best.netEdge)}
            </FlashingNumber>
          ) : null,
      },
      {
        key: "edgeDollars",
        header: "Edge $",
        align: "right",
        headerTitle: signalsColumnExplanation.edgeDollars,
        render: (row) =>
          row.best ? (
            <FlashingNumber value={row.best.edgeDollars} precision={0} className={`font-mono ${pnlTextClass(row.best.edgeDollars)}`}>
              {formatSignedPnl(row.best.edgeDollars, 0)}
            </FlashingNumber>
          ) : null,
      },
      { key: "quotes", header: "Quotes", headerTitle: signalsColumnExplanation.quotes, render: (row) => <QuoteSourceCell row={row} /> },
      { key: "atmIv", header: "ATM IV", align: "right", headerTitle: signalsColumnExplanation.atmIv, render: (row) => <span className="font-mono">{formatPercentage(row.atmImpliedVolatility, 1)}</span> },
      { key: "forecast", header: "Forecast RV", align: "right", headerTitle: signalsColumnExplanation.forecast, render: (row) => <span className="font-mono">{formatPercentage(row.forecast?.volatility, 1)}</span> },
      {
        key: "momentum",
        header: "Mom.",
        align: "right",
        headerTitle: signalsColumnExplanation.momentum,
        render: (row) => (row.momentum === null ? <span className="text-secondary">n/a</span> : <span className={`font-mono ${pnlTextClass(row.momentum)}`}>{formatSignedPercentageValue(row.momentum * 100, 0)}</span>),
      },
      { key: "volFlag", header: "Vol flag", headerTitle: signalsColumnExplanation.volFlag, render: (row) => <VolatilityFlagBadge row={row} /> },
      { key: "earnings", header: "Earnings", headerTitle: signalsColumnExplanation.earnings, render: (row) => <span className="font-mono text-nowrap">{row.nextEarningsDateIso ? formatDate(row.nextEarningsDateIso) : "—"}</span> },
      {
        key: "surface",
        header: "Surface",
        headerTitle: signalsColumnExplanation.surface,
        render: (row) =>
          row.totalSliceCount > 0 ? (
            <button type="button" className="btn btn-link p-0 text-decoration-none text-secondary font-mono" onClick={() => setSurfaceModalSymbol(row.symbol)}>
              {row.fittedSliceCount}/{row.totalSliceCount} ok
            </button>
          ) : (
            <span className="text-secondary">—</span>
          ),
      },
      {
        // Badges column (2026-09-24): blank header; a "model" badge only when the ticker has a caveat of its own,
        // a roll badge only when an open short leg has a credit roll above Avoid. Empty otherwise.
        key: "badges",
        header: "",
        render: (row) => (
          <span className="d-inline-flex align-items-center gap-1 justify-content-end w-100">
            <ModelCaveatBadge symbol={row.symbol} caveats={row.caveats} />
            <RollBadge row={row} onClick={(legId) => openModalOnRoll(row.symbol, legId)} />
          </span>
        ),
      },
    ],
    [setModalSymbol, openModalOnRoll],
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
          Dates are projected from today's real data counts (one capture per trading day), so they move if the nightly capture starts late. Each item is a reminder to ask for it to be wired in once its data is ready.
        </div>
      </div>
    </details>
  );

  const gradesNote = (
    <div className="card-footer text-secondary" style={{ fontSize: "0.8rem" }}>
      <strong>Grades</strong> are fixed net-Edge cut points: <strong>Strong</strong> 10vp or more, <strong>Good</strong> 5-10vp, <strong>Weak</strong> 0-5vp, the rest <strong>Avoid</strong>. Any contract with net Edge at or below zero is <strong>Avoid</strong>. Raw numbers are always beside the grade. Click a ticker for its full opportunity list.
    </div>
  );

  return (
    <>
      <PageHeader title="Signals" subtitle="Live opportunity scoring for your shortlist · scores use the 10:00 ET surface, live prices" />

      <div className="d-none d-md-block">
        <DataTable
          tableId="signals"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.tickerId}
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
          {rows.map((row) => (
            <div key={row.tickerId} className="card">
              <div className="card-body py-2">
                <div className="d-flex justify-content-between align-items-center">
                  <span>
                    <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => setModalSymbol(row.symbol)}>
                      {row.symbol}
                    </button>{" "}
                    <TickColoredPrice value={row.spotPrice} initialReference={row.previousClose?.close ?? null} precision={2} title={priceSourceLabel[row.priceSource]}>
                      <span className="font-mono">{formatCurrency(row.spotPrice)}</span>
                    </TickColoredPrice>{" "}
                    <span className={`font-mono ${pnlTextClass(row.dayChangePercent)}`} style={{ fontSize: "0.8rem" }}>
                      {formatSignedPercentageValue(row.dayChangePercent, 1)}
                    </span>
                  </span>
                  {row.best ? <GradeBadge grade={row.best.grade} /> : <span className="badge bg-secondary-lt" style={badgeFontSize}>Unscored</span>}
                </div>
                <div className="d-flex justify-content-between gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
                  {row.best ? (
                    <>
                      <span>{describeCandidate(row.best)}</span>
                      <span className={`font-mono ${pnlTextClass(row.best.netEdge)}`}>{formatVolatilityPoints(row.best.netEdge)}</span>
                      <span className="font-mono">{formatSignedPnl(row.best.edgeDollars, 0)}</span>
                    </>
                  ) : (
                    <span>{row.unscoredReason ? unscoredReasonLabel[row.unscoredReason] : ""}</span>
                  )}
                </div>
                <div className="d-flex justify-content-between align-items-center gap-2 text-secondary" style={{ fontSize: "0.8rem" }}>
                  <span>Mom {row.momentum === null ? "n/a" : formatSignedPercentageValue(row.momentum * 100, 0)}</span>
                  <span>Vol {row.elevatedVolatility ? (row.elevatedVolatility.elevated ? "elevated" : "normal") : "n/a"}</span>
                  <QuoteSourceCell row={row} />
                </div>
                {(row.caveats.length > 0 || (row.bestRoll !== null && row.rollCount > 0)) && (
                  <div className="d-flex justify-content-end align-items-center gap-1 mt-1">
                    <ModelCaveatBadge symbol={row.symbol} caveats={row.caveats} />
                    <RollBadge row={row} onClick={(legId) => openModalOnRoll(row.symbol, legId)} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {modalSymbol && <SignalsTickerModal key={`${modalSymbol}|${modalRollLegId ?? ""}`} symbol={modalSymbol} initialRollLegId={modalRollLegId} onClose={closeModal} />}
      {surfaceModalSymbol && <VolatilitySurfaceModal symbol={surfaceModalSymbol} onClose={() => setSurfaceModalSymbol(null)} />}

    </>
  );
}
