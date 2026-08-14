import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPanePrimitive,
  type Logical,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Spinner } from "../Spinner";
import { useTheme } from "../../contexts/ThemeContext";
import { ApiError } from "../../api/client";
import { fetchTickerChart, type ChartRange, type PriceBar } from "../../api/tickerDetail";

// Ported from menaris-admin-app's LwChart.js — same range set, bar
// granularity, tick formatting, and hover header, stripped of Saxo-specific
// plumbing (auth flow, instrument mapping) and rewired to our own
// IBKR-backed /tickers/:symbol/chart endpoint (see fetchTickerOverview.ts
// for the per-range bar-size mapping, matched to menaris's RANGE_CONFIG).

const ranges: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "All"];
const dailyRanges = new Set<ChartRange>(["1Y", "5Y", "All"]);
const chartHeight = 460;

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || v === 0) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(2) + "K";
  return String(v);
}

function fmtLocal(utcSec: number, type: TickMarkType): string {
  const d = new Date(utcSec * 1000);
  switch (type) {
    case TickMarkType.Time: {
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5, 0, 0);
      return d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    }
    case TickMarkType.TimeWithSeconds:
      return d.toLocaleTimeString("en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
      });
    case TickMarkType.DayOfMonth:
      return String(d.getUTCDate());
    case TickMarkType.Month:
      return d.toLocaleString("en", { month: "short", timeZone: "UTC" });
    case TickMarkType.Year:
      return String(d.getUTCFullYear());
    default:
      return "";
  }
}

function makeTickMarkFormatter(range: ChartRange): (time: Time, type: TickMarkType) => string {
  if (range === "5D") {
    return (time, type) =>
      type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds ? "" : fmtLocal(time as number, type);
  }
  if (range === "3M" || range === "6M" || dailyRanges.has(range)) {
    return (time, type) =>
      type === TickMarkType.DayOfMonth || type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
        ? ""
        : fmtLocal(time as number, type);
  }
  return (time, type) => fmtLocal(time as number, type);
}

function tickCharLen(range: ChartRange): number {
  if (range === "5D") return 12;
  if (range === "3M") return 15;
  if (range === "6M") return 10;
  if (dailyRanges.has(range)) return 8;
  return 5;
}

function makeTimeFormatter(range: ChartRange): (utcSec: number) => string {
  return (utcSec) => {
    const d = new Date(utcSec * 1000);
    const day = d.getUTCDate();
    const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
    const yr = String(d.getUTCFullYear()).slice(2);
    const datePart = `${day} ${mon} '${yr}`;
    if (dailyRanges.has(range)) return datePart;
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${datePart} ${hh}:${mm}`;
  };
}

// LW Charts v5 draws a vertical grid line at every tick-mark position
// regardless of the tickMarkFormatter's output — the only clean fix is to
// disable built-in vertLines and draw our own at real calendar boundaries.
function getGridBoundaries(fromSec: number, toSec: number, range: ChartRange): number[] {
  const boundaries: number[] = [];
  const fromDate = new Date(fromSec * 1000);
  const toDate = new Date(toSec * 1000);

  if (range === "1D") {
    const d = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), fromDate.getUTCHours()));
    while (d.getTime() / 1000 <= toDate.getTime() / 1000) {
      boundaries.push(d.getTime() / 1000);
      d.setUTCHours(d.getUTCHours() + 1);
    }
  } else if (range === "5D") {
    const d = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
    while (d.getTime() / 1000 <= toDate.getTime() / 1000) {
      boundaries.push(d.getTime() / 1000);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  } else if (range === "1M") {
    const d = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    while (d.getTime() / 1000 <= toDate.getTime() / 1000) {
      boundaries.push(d.getTime() / 1000);
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else if (range === "3M" || range === "6M" || range === "1Y") {
    const d = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
    while (d.getTime() / 1000 <= toDate.getTime() / 1000) {
      boundaries.push(d.getTime() / 1000);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else {
    const d = new Date(Date.UTC(fromDate.getUTCFullYear(), 0, 1));
    while (d.getTime() / 1000 <= toDate.getTime() / 1000) {
      boundaries.push(d.getTime() / 1000);
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
  }
  return boundaries;
}

class GridLineRenderer {
  private lines: number[] = [];
  private color: string;
  constructor(color: string) {
    this.color = color;
  }
  setLines(lines: number[]) {
    this.lines = lines;
  }
  setColor(color: string) {
    this.color = color;
  }
  draw(target: any) {
    if (!this.lines.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio }: any) => {
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = Math.max(1, Math.floor(horizontalPixelRatio));
      ctx.beginPath();
      for (const x of this.lines) {
        const bx = Math.round(x * horizontalPixelRatio);
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx, bitmapSize.height);
      }
      ctx.stroke();
      ctx.restore();
    });
  }
}

class GridLinePrimitive {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private range: ChartRange;
  private renderer: GridLineRenderer;
  private onVisibleRangeChange = () => this.requestUpdate?.();

  constructor(initialRange: ChartRange, color: string) {
    this.range = initialRange;
    this.renderer = new GridLineRenderer(color);
  }

  setRange(range: ChartRange) {
    this.range = range;
    this.requestUpdate?.();
  }

  setColor(color: string) {
    this.renderer.setColor(color);
    this.requestUpdate?.();
  }

  attached({ chart, requestUpdate }: { chart: IChartApi; requestUpdate: () => void }) {
    this.chart = chart;
    this.requestUpdate = requestUpdate;
    chart.timeScale().subscribeVisibleLogicalRangeChange(this.onVisibleRangeChange);
  }

  detached() {
    this.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(this.onVisibleRangeChange);
    this.chart = null;
    this.requestUpdate = null;
  }

  updateAllViews() {
    const chart = this.chart;
    if (!chart) {
      this.renderer.setLines([]);
      return;
    }
    const ts = chart.timeScale();
    const visible = ts.getVisibleRange();
    if (!visible) {
      this.renderer.setLines([]);
      return;
    }
    const boundaries = getGridBoundaries(visible.from as number, visible.to as number, this.range);
    const lines: number[] = [];
    for (const t of boundaries) {
      const idx = ts.timeToIndex(t as Time, true);
      if (idx === null) continue;
      const x = ts.logicalToCoordinate(idx as unknown as Logical);
      if (x !== null) lines.push(x);
    }
    this.renderer.setLines(lines);
  }

  paneViews() {
    return [{ zOrder: () => "bottom" as const, renderer: () => this.renderer }];
  }
}

interface HoveredBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface TickerPriceChartProps {
  symbol: string;
  // Seeds the default 3M range from the parent's SSE stream (see
  // TickerDetailModal) so this component's own first fetch — otherwise a
  // redundant duplicate of data the stream already delivered — is skipped.
  // Only consulted on mount; switching ranges afterward always fetches.
  initialBars?: PriceBar[];
}

// White in dark mode, near-black in light mode — matches the app's own
// theme rather than the hardcoded #000000 the original menaris chart used
// (which only ever ran in a light-themed admin panel).
const textColorByTheme = { light: "#1d273b", dark: "#f9fafb" } as const;
const gridColorByTheme = { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.12)" } as const;

export function TickerPriceChart({ symbol, initialBars }: TickerPriceChartProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const gridPrimitiveRef = useRef<GridLinePrimitive | null>(null);

  const [range, setRange] = useState<ChartRange>("3M");
  const [bars, setBars] = useState<PriceBar[] | null>(initialBars ?? null);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "empty">(
    initialBars ? (initialBars.length ? "ok" : "empty") : "loading",
  );
  const [hoveredBar, setHoveredBar] = useState<HoveredBar | null>(null);

  // Only the very first range effect run should be skipped when seeded —
  // every later run (a real range switch) must fetch normally.
  const skipNextLoadRef = useRef(initialBars != null);

  const loadChart = useCallback(async (r: ChartRange) => {
    setStatus("loading");
    try {
      const result = await fetchTickerChart(symbol, r);
      if (!result.length) {
        setStatus("empty");
        return;
      }
      setBars(result);
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError) console.error(err.message);
    }
  }, [symbol]);

  useEffect(() => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    loadChart(range);
  }, [loadChart, range]);

  // Create the chart instance once on mount.
  useEffect(() => {
    if (!containerRef.current) return;

    const isMobile = () => (containerRef.current?.clientWidth ?? 0) < 768;
    const touchOpts = (mobile: boolean) => ({
      handleScale: { mouseWheel: false, pinchZoom: !mobile },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: !mobile, vertTouchDrag: !mobile },
    });

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeight,
      autoSize: false,
      layout: {
        fontFamily: "inherit",
        background: { color: "transparent" },
        textColor: textColorByTheme[theme],
        attributionLogo: false,
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.02, bottom: 0.05 } },
      leftPriceScale: { visible: false },
      localization: { timeFormatter: makeTimeFormatter(range) },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: makeTickMarkFormatter(range),
        tickMarkMaxCharacterLength: tickCharLen(range),
      },
      ...touchOpts(isMobile()),
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(150,150,150,0.5)", style: LineStyle.Dashed, width: 1 },
        horzLine: { color: "rgba(150,150,150,0.5)", style: LineStyle.Dashed, width: 1 },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: gridColorByTheme[theme] },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#2fb344",
      downColor: "#d63939",
      borderVisible: false,
      wickUpColor: "#2fb344",
      wickDownColor: "#d63939",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) {
        setHoveredBar(null);
        return;
      }
      const candle = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
      const vol = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      if (candle) setHoveredBar({ o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: vol?.value ?? 0 });
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width, ...touchOpts(width < 768) });
    });
    resizeObserver.observe(containerRef.current);

    const gridPrimitive = new GridLinePrimitive(range, gridColorByTheme[theme]);
    chart.panes()[0].attachPrimitive(gridPrimitive as unknown as IPanePrimitive);

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    gridPrimitiveRef.current = gridPrimitive;

    return () => {
      resizeObserver.disconnect();
      chart.panes()[0]?.detachPrimitive(gridPrimitive as unknown as IPanePrimitive);
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Range changed: retarget tick formatting, char length, time formatter, and grid boundaries.
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { timeFormatter: makeTimeFormatter(range) },
      timeScale: { tickMarkFormatter: makeTickMarkFormatter(range), tickMarkMaxCharacterLength: tickCharLen(range) },
    });
    gridPrimitiveRef.current?.setRange(range);
  }, [range]);

  // Theme changed: retint text/grid without rebuilding the chart instance.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: textColorByTheme[theme] },
      grid: { horzLines: { color: gridColorByTheme[theme] } },
    });
    gridPrimitiveRef.current?.setColor(gridColorByTheme[theme]);
  }, [theme]);

  useEffect(() => {
    if (!bars?.length || !candleRef.current || !volumeRef.current) return;

    const candleData = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumeData = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(47,179,68,0.3)" : "rgba(214,57,57,0.3)",
    }));

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);

    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    const isUp = prev ? last.close >= prev.close : true;
    if (priceLineRef.current) candleRef.current.removePriceLine(priceLineRef.current);
    priceLineRef.current = candleRef.current.createPriceLine({
      price: last.close,
      color: isUp ? "#2fb344" : "#d63939",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "",
    });

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  const lastBar = bars?.[bars.length - 1];
  const prevBar = bars && bars.length > 1 ? bars[bars.length - 2] : null;
  const displayBar: HoveredBar | null =
    hoveredBar ?? (lastBar ? { o: lastBar.open, h: lastBar.high, l: lastBar.low, c: lastBar.close, v: lastBar.volume } : null);
  const change = displayBar && prevBar ? displayBar.c - prevBar.close : null;
  const changePct = change != null && prevBar?.close ? (change / prevBar.close) * 100 : null;
  const isError = status === "error" || status === "empty";

  return (
    <div className="card mb-0">
      <div
        className="card-header py-2 d-flex flex-column-reverse flex-md-row align-items-md-center justify-content-md-between"
        style={{ gap: "0.5rem" }}
      >
        <div
          className="d-flex align-items-center flex-wrap"
          style={{ fontSize: "0.72rem", fontVariantNumeric: "tabular-nums", gap: "0.5rem" }}
        >
          {displayBar ? (
            <>
              <span>
                <strong>O</strong> <span >{fmt(displayBar.o)}</span>
              </span>
              <span>
                <strong>H</strong> <span >{fmt(displayBar.h)}</span>
              </span>
              <span>
                <strong>L</strong> <span >{fmt(displayBar.l)}</span>
              </span>
              <span>
                <strong>C</strong> <span >{fmt(displayBar.c)}</span>
              </span>
              {change != null && (
                <strong className={change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted"}>
                  {change >= 0 ? "+" : ""}
                  {fmt(change)} ({(changePct ?? 0) >= 0 ? "+" : ""}
                  {fmt(changePct)}%)
                </strong>
              )}
              <span>
                <strong>Vol</strong> <span >{fmtVol(displayBar.v)}</span>
              </span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>
        <div className="d-flex gap-1 flex-wrap flex-shrink-0">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              className={`btn py-1 px-2 ${range === r ? "btn-primary" : "btn-ghost-secondary"}`}
              style={{ fontSize: "0.72rem", minWidth: 32 }}
              disabled={status === "loading"}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="card-body p-0" style={{ position: "relative" }}>
        {status === "loading" && (
          <div
            className="d-flex align-items-center justify-content-center"
            style={{ position: "absolute", inset: 0, zIndex: 1, background: "rgba(0,0,0,0.05)" }}
          >
            <Spinner size="sm" label="Loading chart" />
          </div>
        )}
        {isError && (
          <div className="d-flex align-items-center justify-content-center" style={{ height: chartHeight }}>
            <span className="text-muted small">
              {status === "empty" ? "No price history available for this range." : "Failed to load chart data."}
            </span>
          </div>
        )}
        <div style={{ display: isError ? "none" : undefined }}>
          <div ref={containerRef} style={{ height: chartHeight }} />
        </div>
      </div>
    </div>
  );
}
