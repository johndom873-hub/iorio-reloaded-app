import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconChevronDown } from "@tabler/icons-react";
import { ApiError } from "../api/client";
import { fetchSignalsRoadmap, fetchSignalsScreen, openSignalsScreenStream, type RoadmapItem, type SignalGrade, type SignalsScreenRow } from "../api/signals";
import { retryTickerBackfill, type TickerBackfillRun } from "../api/shortlist";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { FlashingNumber } from "../components/FlashingNumber";
import { PageHeader } from "../components/layout/PageHeader";
import { NotAccountedForChip, RoadmapEtaText } from "../components/signals/NotAccountedForChip";
import { SignalsTickerModal } from "../components/SignalsTickerModal";
import { TickColoredPrice } from "../components/TickColoredPrice";
import { TickerPrepModal } from "../components/shortlist/TickerPrepModal";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";
import { formatCurrency, formatDate, formatDateTime, formatPercentage, formatRelativeTime, formatSignedPercentageValue, formatSignedPnl, formatVolatilityPoints, pnlTextClass } from "../lib/formatters";
import { describeCandidate, gradeBadgeClass, gradeExplanation, gradeLabel, priceSourceLabel, roadmapStatusBadgeClass, roadmapStatusLabel, signalsColumnExplanation, unscoredReasonLabel } from "../lib/signalsPresentation";

// Signals screen (stage 3 of the build; mockup approved 2026-09-22, v3):
// every shortlist ticker, scored against the 10:00 ET fitted surface at live
// prices. First paint from GET /signals, then the signalsScreen stream
// replaces the rows at most once a second. A row opens the Signals modal
// (stage 4), kept in the URL as ?signal=SYMBOL like Ticker Detail's ?ticker=.

type StreamState = "connecting" | "live" | "failed";

const badgeFontSize = { fontSize: "0.72rem" } as const;

function GradeBadge({ grade }: { grade: SignalGrade }) {
  return (
    <span className={`badge ${gradeBadgeClass[grade]}`} style={badgeFontSize} title={gradeExplanation}>
      {gradeLabel[grade]}
    </span>
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
  if (!flag) return <span className="text-secondary">n/a</span>;
  const title = `21-day / 126-day volatility = ${flag.ratio.toFixed(2)} vs threshold ${flag.threshold.toFixed(2)} (${flag.thresholdSource === "own_p90" ? "this ticker's own 90th percentile" : "fixed fallback until a year of history"})`;
  return (
    <span className={`badge ${flag.elevated ? "bg-danger-lt" : "bg-secondary-lt"}`} style={badgeFontSize} title={title}>
      {flag.elevated ? "Elevated" : "Normal"}
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
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const [modalSymbol, setModalSymbol] = useTickerDetailSymbol("signal");
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [backfillTicker, setBackfillTicker] = useState<{ tickerId: string; symbol: string; companyName: string | null } | null>(null);
  const [backfillStartingTickerId, setBackfillStartingTickerId] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  // Bumped when a backfill finishes so the screen stream reconnects and re-reads the ticker's
  // (now longer/adjusted) daily bars — the running stream loaded its inputs once at connection time.
  const [streamKey, setStreamKey] = useState(0);

  const handleStartBackfill = useCallback(async (row: SignalsScreenRow) => {
    setBackfillStartingTickerId(row.tickerId);
    try {
      setBackfillError(null);
      await retryTickerBackfill(row.tickerId);
      setBackfillTicker({ tickerId: row.tickerId, symbol: row.symbol, companyName: row.companyName });
    } catch (err) {
      setBackfillError(err instanceof ApiError ? err.message : `Failed to start the backfill for ${row.symbol}.`);
    } finally {
      setBackfillStartingTickerId(null);
    }
  }, []);

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

  useEffect(() => {
    setStreamState("connecting");
    return openSignalsScreenStream(
      (frame) => {
        setRows(frame.rows);
        setLastFrameAt(frame.at);
        setStreamState("live");
      },
      () => setStreamState("failed"),
    );
  }, [streamKey]);

  const anyLivePrice = rows.some((row) => row.priceSource === "live");
  const liveStatus =
    streamState === "failed" ? { label: "Live prices unavailable — showing snapshot prices", tone: "text-danger" } : anyLivePrice ? { label: "Live prices connected", tone: "text-success" } : streamState === "live" ? { label: "Live stream connected — waiting for prices", tone: "text-secondary" } : { label: "Connecting live prices…", tone: "text-secondary" };
  const snapshotCapturedAt = latestSnapshotCapturedAt(rows);

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
      { key: "name", header: "Name", render: (row) => <span className="text-secondary">{row.companyName ?? "—"}</span> },
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
      { key: "surface", header: "Surface", headerTitle: signalsColumnExplanation.surface, render: (row) => <span className="text-secondary">{row.totalSliceCount > 0 ? `${row.fittedSliceCount}/${row.totalSliceCount} ok` : "—"}</span> },
      {
        key: "notAccountedFor",
        header: "Not accounted for",
        headerTitle: signalsColumnExplanation.notAccountedFor,
        render: (row) => (
          <NotAccountedForChip
            symbol={row.symbol}
            caveats={row.caveats}
            generalItems={roadmap}
            onBackfillHistory={() => handleStartBackfill(row)}
            backfillStarting={backfillStartingTickerId === row.tickerId}
          />
        ),
      },
    ],
    [roadmap, backfillStartingTickerId, handleStartBackfill],
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
      <span className={`d-inline-flex align-items-center gap-2 ${liveStatus.tone}`} title={lastFrameAt ? `Last update ${formatDateTime(lastFrameAt)}` : undefined}>
        {anyLivePrice && <span className="iorio-pulse-dot" />}
        {liveStatus.label}
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
      <strong>Grades</strong> are cut from each ticker's own live net-Edge distribution across its candidates: <strong>Strong</strong> top 10%, <strong>Good</strong> next 20%, <strong>Marginal</strong> next 30%, the rest <strong>Avoid</strong>. Any contract with net Edge at or below zero is <strong>Avoid</strong> whatever its rank, so a ticker where everything is negative shows no false "Strong". Raw numbers are always beside the grade. Click a ticker for its full opportunity list.
    </div>
  );

  return (
    <>
      <PageHeader title="Signals" subtitle="Live opportunity scoring for your shortlist · scores use the 10:00 ET surface, live prices" />

      {backfillError && <div className="alert alert-danger mt-2">{backfillError}</div>}

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
                  <NotAccountedForChip
                    symbol={row.symbol}
                    caveats={row.caveats}
                    generalItems={roadmap}
                    onBackfillHistory={() => handleStartBackfill(row)}
                    backfillStarting={backfillStartingTickerId === row.tickerId}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modalSymbol && <SignalsTickerModal symbol={modalSymbol} onClose={() => setModalSymbol(null)} />}

      {backfillTicker && (
        <TickerPrepModal
          tickerId={backfillTicker.tickerId}
          symbol={backfillTicker.symbol}
          companyName={backfillTicker.companyName}
          onRunChange={(run: TickerBackfillRun | null) => {
            if (run && run.status !== "running") setStreamKey((key) => key + 1);
          }}
          onClose={() => setBackfillTicker(null)}
          completionNote={`${backfillTicker.symbol} is already re-scored live on the Signals screen — no need to wait.`}
        />
      )}
    </>
  );
}
