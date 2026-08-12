import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, type CandlestickData, type UTCTimestamp } from "lightweight-charts";

export interface PriceBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceMarkerLine {
  price: number;
  label: string;
  color: string;
}

interface CandlestickChartProps {
  bars: PriceBar[];
  /** Horizontal reference lines — e.g. entry price, strike price. This is
   * the whole reason we build our own chart instead of embedding
   * TradingView's widget: we need to draw our own position data on it. */
  markerLines?: PriceMarkerLine[];
  height?: number;
}

function toChartData(bars: PriceBar[]): CandlestickData[] {
  return bars.map((bar) => ({
    time: (new Date(bar.date).getTime() / 1000) as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

export function CandlestickChart({ bars, markerLines = [], height = 320 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      height,
      autoSize: true,
      layout: { fontFamily: "inherit" },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(0,0,0,0.06)" },
      },
      timeScale: { borderVisible: false },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#2fb344",
      downColor: "#d63939",
      borderVisible: false,
      wickUpColor: "#2fb344",
      wickDownColor: "#d63939",
    });
    candlestickSeries.setData(toChartData(bars));

    for (const markerLine of markerLines) {
      candlestickSeries.createPriceLine({
        price: markerLine.price,
        color: markerLine.color,
        lineWidth: 2,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: markerLine.label,
      });
    }

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [bars, markerLines, height]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
