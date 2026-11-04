import type { PortfolioProjectionSummary } from "../../../api/backtestPortfolio";
import { formatCompactDollarsTrimmed, formatNumber, formatPercentage, formatSignedNumber } from "../../../lib/formatters";
import { signedPercentDisplay } from "../../../lib/backtestPresentation";
import { comparisonInk, formatSignedPoints, yearSourceLabels, yearSourceOrder } from "../../../lib/portfolioSimulatorPresentation";
import { BacktestCardTitle } from "../backtestBits";

interface PortfolioOutcomeCardProps {
  summary: PortfolioProjectionSummary;
  horizonYears: number;
  accountDollars: number;
  /** The compared portfolio's figures and name, when one is chosen and projected. */
  compare: { name: string; summary: PortfolioProjectionSummary } | null;
}

function Difference({ value, other, kind, name }: { value: number; other: number; kind: "points" | "ratio"; name: string | null }) {
  const difference = value - other;
  const text = kind === "points" ? formatSignedPoints(difference) : formatSignedNumber(difference, 2);
  return (
    <div className="portfolio-difference">
      <span className={comparisonInk(difference, kind)}>{text}</span>
      {name && <span className="text-secondary"> against {name}</span>}
    </div>
  );
}

/** The account at each year's end: the 10th to 90th percentile band and the median, from the starting account. */
function YearEndChart({ summary, accountDollars }: { summary: PortfolioProjectionSummary; accountDollars: number }) {
  const points = [{ year: 0, p10: accountDollars, p50: accountDollars, p90: accountDollars }, ...summary.yearEnds.map((entry) => ({ year: entry.year, ...entry.value }))];
  const width = 640;
  const height = 250;
  const left = 64;
  const right = 92;
  const top = 12;
  const bottom = 28;
  const highest = Math.max(...points.map((point) => point.p90));
  const lowest = Math.min(...points.map((point) => point.p10));
  const step = highest - lowest > 4_000_000 ? 1_000_000 : highest - lowest > 1_500_000 ? 500_000 : 250_000;
  const low = Math.floor(lowest / step) * step;
  const high = Math.max(low + step, Math.ceil(highest / step) * step);
  const years = points.length - 1;
  const x = (year: number) => left + ((width - left - right) * year) / years;
  const y = (value: number) => top + (height - top - bottom) * (1 - (value - low) / (high - low));
  const ticks: number[] = [];
  for (let value = low; value <= high + 1; value += step) ticks.push(value);
  const band = [...points.map((point) => `${x(point.year)},${y(point.p90)}`), ...[...points].reverse().map((point) => `${x(point.year)},${y(point.p10)}`)].join(" ");
  const last = points[points.length - 1]!;
  // End labels kept apart when the band is narrow.
  const labelYs = [y(last.p90), y(last.p50), y(last.p10)];
  for (let index = 1; index < labelYs.length; index++) labelYs[index] = Math.max(labelYs[index]!, labelYs[index - 1]! + 13);
  return (
    <svg className="portfolio-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="The account at each year's end: 10th to 90th percentile and median">
      {ticks.map((value) => (
        <g key={value}>
          <line className="portfolio-chart-grid" x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
          <text className="portfolio-chart-axis" x={left - 8} y={y(value) + 4} textAnchor="end">
            {formatCompactDollarsTrimmed(value)}
          </text>
        </g>
      ))}
      {points.map((point) => (
        <text key={point.year} className="portfolio-chart-axis" x={x(point.year)} y={height - 8} textAnchor="middle">
          {point.year === 0 ? "Today" : `Year ${point.year}`}
        </text>
      ))}
      <polygon className="portfolio-chart-band" points={band} />
      <polyline className="portfolio-chart-line" points={points.map((point) => `${x(point.year)},${y(point.p50)}`).join(" ")} />
      {points.map((point) => (
        <circle key={point.year} className="portfolio-chart-dot" cx={x(point.year)} cy={y(point.p50)} r={point.year === years ? 4 : 2.5}>
          <title>{`${point.year === 0 ? "Today" : `Year ${point.year}`}: median ${formatCompactDollarsTrimmed(point.p50)}, 10th–90th ${formatCompactDollarsTrimmed(point.p10)} to ${formatCompactDollarsTrimmed(point.p90)}`}</title>
        </circle>
      ))}
      <text className="portfolio-chart-axis" x={x(years) + 8} y={labelYs[0]! + 4}>
        90th {formatCompactDollarsTrimmed(last.p90)}
      </text>
      <text className="portfolio-chart-axis portfolio-chart-strong" x={x(years) + 8} y={labelYs[1]! + 4}>
        {formatCompactDollarsTrimmed(last.p50)}
      </text>
      <text className="portfolio-chart-axis" x={x(years) + 8} y={labelYs[2]! + 4}>
        10th {formatCompactDollarsTrimmed(last.p10)}
      </text>
    </svg>
  );
}

/** The projection's outcome: CAGR, Max drawdown and Excess Calmar, the drawdown odds, the betas, the year ends and the average year. */
export function PortfolioOutcomeCard({ summary, horizonYears, accountDollars, compare }: PortfolioOutcomeCardProps) {
  const other = compare?.summary ?? null;
  const name = compare?.name ?? null;
  const largestShare = Math.max(...yearSourceOrder.map((source) => Math.abs(summary.averageYear[source].share)), 0.0001);
  const totalShare = yearSourceOrder.reduce((sum, source) => sum + summary.averageYear[source].share, 0);
  const totalDollars = yearSourceOrder.reduce((sum, source) => sum + summary.averageYear[source].dollars, 0);
  const tiles = [
    { label: "CAGR · median", value: formatPercentage(summary.cagr.p50), range: `${formatPercentage(summary.cagr.p10)} to ${formatPercentage(summary.cagr.p90)}`, current: summary.cagr.p50, compared: other?.cagr.p50, kind: "points" as const },
    { label: "Max drawdown · median", value: formatPercentage(summary.maxDrawdown.p50), range: `${formatPercentage(summary.maxDrawdown.p10)} to ${formatPercentage(summary.maxDrawdown.p90)}`, current: summary.maxDrawdown.p50, compared: other?.maxDrawdown.p50, kind: "points" as const },
    { label: "Excess Calmar · median", value: summary.excessCalmar.p50.toFixed(2), range: `${summary.excessCalmar.p10.toFixed(2)} to ${summary.excessCalmar.p90.toFixed(2)}`, current: summary.excessCalmar.p50, compared: other?.excessCalmar.p50, kind: "ratio" as const },
  ];
  return (
    <div className="card">
      <div className="card-body py-2 border-bottom">
        <BacktestCardTitle title={`Outcome over ${horizonYears} years · ${formatNumber(summary.pathCount)} paths`} />
      </div>
      <div className="card-body">
        <div className="portfolio-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="portfolio-tile">
              <div className="portfolio-tile-label">{tile.label}</div>
              <div className="portfolio-tile-value">{tile.value}</div>
              <div className="portfolio-tile-range">10th–90th: {tile.range}</div>
              {tile.compared !== undefined && <Difference value={tile.current} other={tile.compared} kind={tile.kind} name={name} />}
            </div>
          ))}
        </div>
        <div className="portfolio-outcome-row">
          <div>
            <div className="portfolio-subhead">Max drawdown reached in</div>
            <div className="portfolio-odds">
              {summary.drawdownAtOdds.map((entry, index) => (
                <div key={entry.oneIn} className="portfolio-odds-tile">
                  <div className="portfolio-tile-label-plain">1 path in {entry.oneIn}</div>
                  <div className="portfolio-odds-value">{formatPercentage(entry.maxDrawdown)}</div>
                  {other?.drawdownAtOdds[index] ? <Difference value={entry.maxDrawdown} other={other.drawdownAtOdds[index]!.maxDrawdown} kind="points" name={null} /> : <div className="portfolio-tile-range">or worse</div>}
                </div>
              ))}
            </div>
            {summary.bookBeta && (
              <div className="portfolio-betas">
                <div>
                  <div className="portfolio-tile-label">Beta to SPY</div>
                  <div className="portfolio-figure">{summary.bookBeta.all.toFixed(2)}</div>
                  {other?.bookBeta && <div className="portfolio-tile-range">{other.bookBeta.all.toFixed(2)} in {name}</div>}
                </div>
                <div>
                  <div className="portfolio-tile-label">Downside beta</div>
                  <div className="portfolio-figure">{summary.bookBeta.down.toFixed(2)}</div>
                  <div className="portfolio-tile-range">on the days SPY fell{other?.bookBeta ? ` · ${other.bookBeta.down.toFixed(2)} in ${name}` : ""}</div>
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="portfolio-subhead">The account at each year's end</div>
            <YearEndChart summary={summary} accountDollars={accountDollars} />
          </div>
        </div>
        <div className="portfolio-subhead">Where the return comes from · the average year, all paths</div>
        <div className="portfolio-parts">
          {yearSourceOrder.map((source) => {
            const { share, dollars } = summary.averageYear[source];
            const barWidth = (Math.abs(share) / largestShare) * 50;
            const display = signedPercentDisplay(share);
            return (
              <div key={source} className="portfolio-part">
                <span>{yearSourceLabels[source]}</span>
                <span className="portfolio-part-track" aria-hidden="true">
                  <span className="portfolio-part-zero" />
                  <span className={`portfolio-part-bar ${share >= 0 ? "portfolio-part-bar-gain" : "portfolio-part-bar-loss"}`} style={{ left: `${share >= 0 ? 50 : 50 - barWidth}%`, width: `${barWidth}%` }} />
                </span>
                <span className={`text-end ${display.className}`}>{display.text}</span>
                <span className="text-end text-secondary">{formatCompactDollarsTrimmed(dollars)}</span>
              </div>
            );
          })}
          <div className="portfolio-part portfolio-part-total">
            <span>Average year</span>
            <span />
            <span className="text-end">{signedPercentDisplay(totalShare).text}</span>
            <span className="text-end">{formatCompactDollarsTrimmed(totalDollars)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
