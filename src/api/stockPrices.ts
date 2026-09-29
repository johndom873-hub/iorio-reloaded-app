import { apiBaseUrl } from "./client";
import { openMultiplexedStream } from "./streamMultiplexer";

// Live last price for an explicit set of symbols (the Dashboard's Needs Attention
// rows), from the shared pooled stock-price lines. Same SSE mechanics as
// openPricePerformanceStream, scoped to the symbols on screen.
export function openStockPricesStream(
  symbols: string[],
  onUpdate: (result: Record<string, number | null>) => void,
  onError?: () => void,
): () => void {
  const openLegacy = () => openLegacyStockPricesStream(symbols, onUpdate, onError);
  if (symbols.length === 0) return openLegacy();
  return openMultiplexedStream<Record<string, number | null>>({
    kind: "stockPrices",
    parameters: { symbols },
    onData: onUpdate,
    onError: () => onError?.(),
    openLegacy,
  });
}

function openLegacyStockPricesStream(
  symbols: string[],
  onUpdate: (result: Record<string, number | null>) => void,
  onError?: () => void,
): () => void {
  const query = encodeURIComponent(symbols.join(","));
  const source = new EventSource(`${apiBaseUrl}/tickers/current-prices/stream?symbols=${query}`, { withCredentials: true });

  source.onmessage = (message) => {
    try {
      onUpdate(JSON.parse(message.data));
    } catch {
      // Malformed/heartbeat frame — ignore.
    }
  };

  source.onerror = () => {
    source.close();
    onError?.();
  };

  return () => source.close();
}
