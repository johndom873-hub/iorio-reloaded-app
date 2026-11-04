import type { PortfolioSimulation } from "../../../api/backtestPortfolio";
import { formatNumber, formatPercentage } from "../../../lib/formatters";
import { tickersInGroupOrder } from "../../../lib/portfolioSimulatorPresentation";
import { useTickerModal } from "../../../hooks/useTickerModal";
import { BacktestCardTitle, BacktestSymbolLink } from "../backtestBits";

const cellSize = 13;
const labelSize = 44;

/** Worst weeks together as a heatmap in group order (each group outlined), how many independent tickers the book moves like, and its groups. */
export function PortfolioFallTogetherCard({ simulation }: { simulation: PortfolioSimulation }) {
  const { open } = useTickerModal();
  const matrix = simulation.worstWeeksTogether;
  const indexOf = new Map(matrix.symbols.map((symbol, index) => [symbol, index]));
  const order = tickersInGroupOrder(
    simulation.book.tickers.map((ticker) => ticker.symbol),
    simulation.groups,
  ).filter((symbol) => indexOf.has(symbol));
  const size = labelSize + cellSize * order.length;
  let groupStart = 0;
  return (
    <div className="card">
      <div className="card-body py-2 border-bottom">
        <BacktestCardTitle title="How they fall together" />
      </div>
      <div className="card-body portfolio-heatmap-wrap">
        <svg className="portfolio-heatmap" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Worst weeks together, by pair of tickers">
          {order.map((rowSymbol, row) => (
            <g key={rowSymbol}>
              <text className="portfolio-chart-axis portfolio-chart-small portfolio-chart-symbol" x={labelSize - 4} y={labelSize + row * cellSize + 10} textAnchor="end" onClick={() => open(rowSymbol)}>
                {rowSymbol}
              </text>
              <text className="portfolio-chart-axis portfolio-chart-small portfolio-chart-symbol" transform={`translate(${labelSize + row * cellSize + 9},${labelSize - 4}) rotate(-90)`} onClick={() => open(rowSymbol)}>
                {rowSymbol}
              </text>
              {order.map((columnSymbol, column) => {
                const x = labelSize + column * cellSize;
                const y = labelSize + row * cellSize;
                if (rowSymbol === columnSymbol) return <rect key={columnSymbol} className="portfolio-heatmap-self" x={x} y={y} width={cellSize - 1} height={cellSize - 1} />;
                const value = matrix.values[indexOf.get(rowSymbol)!]![indexOf.get(columnSymbol)!] ?? null;
                if (value === null)
                  return (
                    <rect key={columnSymbol} className="portfolio-heatmap-none" x={x + 0.5} y={y + 0.5} width={cellSize - 2} height={cellSize - 2}>
                      <title>{`${rowSymbol} · ${columnSymbol}: under 52 shared weeks`}</title>
                    </rect>
                  );
                return (
                  <rect key={columnSymbol} className="portfolio-heatmap-cell" x={x} y={y} width={cellSize - 1} height={cellSize - 1} fillOpacity={Math.max(0.04, Math.min(1, (value - 0.1) / 0.6))}>
                    <title>{`${rowSymbol} · ${columnSymbol}: ${formatPercentage(value, 0)} of worst weeks together`}</title>
                  </rect>
                );
              })}
            </g>
          ))}
          {simulation.groups.map((group) => {
            const start = groupStart;
            groupStart += group.symbols.length;
            return <rect key={group.symbols.join(",")} className="portfolio-heatmap-group" x={labelSize + start * cellSize - 1} y={labelSize + start * cellSize - 1} width={group.symbols.length * cellSize + 1} height={group.symbols.length * cellSize + 1} />;
          })}
        </svg>
        <div>
          <div className="portfolio-tile-label">Moves like</div>
          <div className="portfolio-figure mb-3">
            {simulation.independentTickers === null ? "—" : formatNumber(simulation.independentTickers, 1, 1)} independent tickers <span className="text-secondary fw-normal">of {formatNumber(order.length)}</span>
          </div>
          <div className="portfolio-subhead">Groups · 50% or more of their worst weeks together</div>
          {simulation.groups.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
              No two tickers share half their worst weeks.
            </div>
          ) : (
            <ul className="portfolio-groups">
              {simulation.groups.map((group, index) => (
                <li key={group.symbols.join(",")}>
                  <span className="portfolio-group-chip">G{index + 1}</span>{" "}
                  {group.symbols.map((symbol, position) => (
                    <span key={symbol}>
                      {position > 0 && ", "}
                      <BacktestSymbolLink symbol={symbol} />
                    </span>
                  ))}{" "}
                  <span className="text-secondary">· {formatPercentage(group.share)} of the book</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-secondary mt-3 mb-0" style={{ fontSize: "0.8rem" }}>
            Worst weeks together: of one ticker's worst 10% of weeks, the share that were also among the other's worst 10%. Unrelated tickers score about 10%. Darker: more. Hover a cell for its figure.
          </p>
        </div>
      </div>
    </div>
  );
}
