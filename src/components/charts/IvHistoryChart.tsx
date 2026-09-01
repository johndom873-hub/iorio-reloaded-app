import { useCallback, useEffect, useRef, useState } from "react";
import { createChart, LineSeries, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { Spinner } from "../Spinner";
import { useTheme } from "../../contexts/ThemeContext";
import { ApiError } from "../../api/client";
import { fetchTickerIvChart, type IvChartRange } from "../../api/tickerDetail";
import { formatPercentageValue } from "../../lib/formatters";

// Second panel next to TickerPriceChart (approved 2026-08-31 — see
// PROGRESS.md, lib/ivMetrics.ts on the backend). Deliberately much simpler
// than TickerPriceChart: one line series instead of candles+volume, no
// custom grid-boundary primitive, no touch-gesture tuning — IV history is
// one value per day, not OHLC, and doesn't need that machinery. Kept as its
// own component/card rather than a mode toggle inside TickerPriceChart so
// this stays isolated from that component's more complex, already-verified
// candlestick logic.
const ranges: IvChartRange[] = ["1Y", "5Y", "All"];
const desktopChartHeight = 220;
const mobileChartHeight = 180;
const mobileBreakpointPx = 768;

function chartHeightForWidth(width: number): number {
  return width < mobileBreakpointPx ? mobileChartHeight : desktopChartHeight;
}

const textColorByTheme = { light: "#1d273b", dark: "#f9fafb" } as const;
const gridColorByTheme = { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.12)" } as const;
const lineColorByTheme = { light: "#4263eb", dark: "#748ffc" } as const;

interface IvHistoryChartProps {
  symbol: string;
}

export function IvHistoryChart({ symbol }: IvHistoryChartProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [range, setRange] = useState<IvChartRange>("1Y");
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "empty">("loading");
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const [latestValue, setLatestValue] = useState<number | null>(null);
  const [chartHeight, setChartHeight] = useState(desktopChartHeight);

  const loadChart = useCallback(
    async (r: IvChartRange) => {
      setStatus("loading");
      try {
        const points = await fetchTickerIvChart(symbol, r);
        if (!points.length) {
          setStatus("empty");
          return;
        }
        // Series stores percentage points (0-100), not the raw 0-1 fraction
        // IBKR/blackScholesPop.ts use — matches formatPercentageValue's
        // scale, and keeps the hover value and the default (latest) value
        // in the same units.
        seriesRef.current?.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value * 100 })));
        chartRef.current?.timeScale().fitContent();
        setLatestValue(points[points.length - 1]!.value * 100);
        setStatus("ok");
      } catch (err) {
        setStatus("error");
        if (err instanceof ApiError) console.error(err.message);
      }
    },
    [symbol],
  );

  useEffect(() => {
    loadChart(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, symbol]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initialHeight = chartHeightForWidth(containerRef.current.clientWidth);
    setChartHeight(initialHeight);

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: initialHeight,
      autoSize: false,
      layout: { fontFamily: "inherit", background: { color: "transparent" }, textColor: textColorByTheme[theme], attributionLogo: false },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      leftPriceScale: { visible: false },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(150,150,150,0.5)", style: LineStyle.Dashed, width: 1 },
        horzLine: { color: "rgba(150,150,150,0.5)", style: LineStyle.Dashed, width: 1 },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: gridColorByTheme[theme] } },
    });

    const series = chart.addSeries(LineSeries, {
      color: lineColorByTheme[theme],
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) {
        setHoveredValue(null);
        return;
      }
      const point = param.seriesData.get(series) as { value: number } | undefined;
      setHoveredValue(point ? point.value : null);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        const newHeight = chartHeightForWidth(width);
        chart.applyOptions({ width, height: newHeight });
        chart.timeScale().fitContent();
        setChartHeight(newHeight);
      }
    });
    resizeObserver.observe(containerRef.current);

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: textColorByTheme[theme] },
      grid: { horzLines: { color: gridColorByTheme[theme] } },
    });
    seriesRef.current?.applyOptions({ color: lineColorByTheme[theme] });
  }, [theme]);

  const isError = status === "error" || status === "empty";
  const displayValue = hoveredValue ?? latestValue;

  return (
    <div className="card mb-0">
      <div
        className="card-header py-2 d-flex flex-column-reverse flex-md-row align-items-md-center justify-content-md-between"
        style={{ gap: "0.5rem" }}
      >
        <div className="d-flex align-items-center gap-2" style={{ fontSize: "0.72rem" }}>
          <strong>IV History</strong>
          {displayValue !== null && <span className="font-mono">{formatPercentageValue(displayValue)}</span>}
        </div>
        <div className="d-flex gap-1 flex-wrap flex-shrink-0">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              className={`btn py-2 px-3 ${range === r ? "btn-primary" : "btn-ghost-secondary"}`}
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
          <div className="d-flex align-items-center justify-content-center" style={{ height: chartHeight }}>
            <Spinner size="sm" label="Loading IV history" />
          </div>
        )}
        {isError && (
          <div className="d-flex align-items-center justify-content-center" style={{ height: chartHeight }}>
            <span className="text-muted small">
              {status === "empty" ? "No IV history available for this range." : "Failed to load IV history."}
            </span>
          </div>
        )}
        <div style={{ display: status === "loading" || isError ? "none" : undefined }}>
          <div ref={containerRef} style={{ height: chartHeight }} />
        </div>
      </div>
    </div>
  );
}
