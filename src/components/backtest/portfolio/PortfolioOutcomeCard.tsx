import type { PortfolioDrift, PortfolioHeldSummary, PortfolioPercentiles, PortfolioProjectionSummary } from "../../../api/backtestPortfolio";
import { formatCompactDollarsTrimmed, formatNumber, formatPercentage, formatSignedNumber } from "../../../lib/formatters";
import { signedPercentDisplay } from "../../../lib/backtestPresentation";
import { comparisonInk, driftLabels, driftOrder, formatSignedPoints, yearSourceLabels, yearSourceOrder } from "../../../lib/portfolioSimulatorPresentation";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { BacktestCardTitle, BacktestSegmentedSwitch, SignedPercent } from "../backtestBits";

type DriftSummaries = Record<PortfolioDrift, PortfolioProjectionSummary>;

interface PortfolioOutcomeCardProps {
  /** The book's projection at each drift, on the same paths. */
  summaries: DriftSummaries;
  horizonYears: number;
  accountDollars: number;
  /** The compared portfolio's figures and name, when one is chosen and projected. */
  compare: { name: string; summaries: DriftSummaries } | null;
  /** The drift the chart and the average year are shown at. */
  chartDrift: PortfolioDrift;
  onChartDrift: (drift: PortfolioDrift) => void;
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

/** One line of the chart: its year-end medians from the starting account. */
const mediansOf = (summary: { yearEnds: { value: PortfolioPercentiles }[] }, accountDollars: number) => [accountDollars, ...summary.yearEnds.map((entry) => entry.value.p50)];

/** The account at each year's end: v4's 10th to 90th percentile band and median, and the medians of holding the book and SPY. */
function YearEndChart({ summary, accountDollars }: { summary: PortfolioProjectionSummary; accountDollars: number }) {
  const points = [{ year: 0, p10: accountDollars, p50: accountDollars, p90: accountDollars }, ...summary.yearEnds.map((entry) => ({ year: entry.year, ...entry.value }))];
  const heldBook = mediansOf(summary.heldBook, accountDollars);
  const heldSpy = summary.heldSpy ? mediansOf(summary.heldSpy, accountDollars) : null;
  const width = 640;
  const height = 250;
  const left = 64;
  const right = 118;
  const top = 12;
  const bottom = 28;
  const highest = Math.max(...points.map((point) => point.p90), ...heldBook, ...(heldSpy ?? []));
  const lowest = Math.min(...points.map((point) => point.p10), ...heldBook, ...(heldSpy ?? []));
  const step = highest - lowest > 4_000_000 ? 1_000_000 : highest - lowest > 1_500_000 ? 500_000 : 250_000;
  const low = Math.floor(lowest / step) * step;
  const high = Math.max(low + step, Math.ceil(highest / step) * step);
  const years = points.length - 1;
  const x = (year: number) => left + ((width - left - right) * year) / years;
  const y = (value: number) => top + (height - top - bottom) * (1 - (value - low) / (high - low));
  const ticks: number[] = [];
  for (let value = low; value <= high + 1; value += step) ticks.push(value);
  const band = [...points.map((point) => `${x(point.year)},${y(point.p90)}`), ...[...points].reverse().map((point) => `${x(point.year)},${y(point.p10)}`)].join(" ");
  const linePoints = (values: readonly number[]) => values.map((value, year) => `${x(year)},${y(value)}`).join(" ");
  const last = points[points.length - 1]!;
  // End labels, top to bottom, kept 13 apart when lines end close together.
  const labels = [
    { key: "p90", value: last.p90, text: `90th ${formatCompactDollarsTrimmed(last.p90)}`, className: "portfolio-chart-axis" },
    { key: "p50", value: last.p50, text: `v4 ${formatCompactDollarsTrimmed(last.p50)}`, className: "portfolio-chart-axis portfolio-chart-strong" },
    { key: "p10", value: last.p10, text: `10th ${formatCompactDollarsTrimmed(last.p10)}`, className: "portfolio-chart-axis" },
    { key: "book", value: heldBook[years]!, text: `Book held ${formatCompactDollarsTrimmed(heldBook[years]!)}`, className: "portfolio-chart-axis portfolio-chart-strong" },
    ...(heldSpy ? [{ key: "spy", value: heldSpy[years]!, text: `SPY held ${formatCompactDollarsTrimmed(heldSpy[years]!)}`, className: "portfolio-chart-axis" }] : []),
  ]
    .map((label) => ({ ...label, at: y(label.value) }))
    .sort((a, b) => a.at - b.at);
  for (let index = 1; index < labels.length; index++) labels[index]!.at = Math.max(labels[index]!.at, labels[index - 1]!.at + 13);
  return (
    <svg className="portfolio-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="The account at each year's end: v4's 10th to 90th percentile and median, and the medians of holding the book and SPY">
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
      <polyline className="portfolio-chart-held-book" points={linePoints(heldBook)} />
      {heldSpy && <polyline className="portfolio-chart-held-spy" points={linePoints(heldSpy)} />}
      <polyline className="portfolio-chart-line" points={points.map((point) => `${x(point.year)},${y(point.p50)}`).join(" ")} />
      {points.map((point) => (
        <circle key={point.year} className="portfolio-chart-dot" cx={x(point.year)} cy={y(point.p50)} r={point.year === years ? 4 : 2.5}>
          <title>
            {`${point.year === 0 ? "Today" : `Year ${point.year}`}: v4 median ${formatCompactDollarsTrimmed(point.p50)}, 10th–90th ${formatCompactDollarsTrimmed(point.p10)} to ${formatCompactDollarsTrimmed(point.p90)}; book held ${formatCompactDollarsTrimmed(heldBook[point.year]!)}${heldSpy ? `, SPY held ${formatCompactDollarsTrimmed(heldSpy[point.year]!)}` : ""}`}
          </title>
        </circle>
      ))}
      {labels.map((label) => (
        <text key={label.key} className={label.className} x={x(years) + 8} y={label.at + 4}>
          {label.text}
        </text>
      ))}
    </svg>
  );
}

interface ComparisonRow {
  key: string;
  drift: PortfolioDrift;
  label: string;
  figures: PortfolioHeldSummary;
  isV4: boolean;
}

const lowestAtOneInTen = (figures: PortfolioHeldSummary) => figures.lowestAgainstStartAtOdds.find((entry) => entry.oneIn === 10)?.lowestAgainstStart ?? null;

const comparisonColumns: DataTableColumn<ComparisonRow>[] = [
  { key: "label", header: "Book", cellClassName: "text-nowrap", render: (row) => <span className={row.isV4 ? "fw-semibold" : ""}>{row.label}</span> },
  { key: "cagr", header: "CAGR median", headerClassName: "portfolio-header-wrap", align: "right", render: (row) => <SignedPercent fraction={row.figures.cagr.p50} /> },
  { key: "cagrRange", header: "CAGR 10th–90th", headerClassName: "portfolio-header-wrap", align: "right", cellClassName: "text-nowrap", render: (row) => `${formatPercentage(row.figures.cagr.p10)} to ${formatPercentage(row.figures.cagr.p90)}` },
  { key: "maxDrawdown", header: "Max drawdown median", headerClassName: "portfolio-header-wrap", cellClassName: "text-nowrap", align: "right", render: (row) => formatPercentage(row.figures.maxDrawdown.p50) },
  { key: "lowestOneInTen", header: "Lowest · 1 in 10", headerClassName: "portfolio-header-wrap", headerTitle: "Lowest against today: the account's lowest value ÷ the starting account − 1, reached in 1 path in 10", align: "right", render: (row) => formatPercentage(lowestAtOneInTen(row.figures)) },
  { key: "lowestMedian", header: "Lowest · median", headerClassName: "portfolio-header-wrap", headerTitle: "Lowest against today: the account's lowest value ÷ the starting account − 1, the median path", align: "right", render: (row) => formatPercentage(row.figures.lowestAgainstStart.p50) },
];

/** v4 and the two buy and holds at each drift, on the same paths. */
function ComparisonTable({ summaries }: { summaries: DriftSummaries }) {
  const rows: ComparisonRow[] = driftOrder.flatMap((drift) => {
    const summary = summaries[drift];
    return [
      { key: `${drift}-v4`, drift, label: "v4 on the book", figures: summary.v4, isV4: true },
      { key: `${drift}-book`, drift, label: "Holding the book's tickers", figures: summary.heldBook, isV4: false },
      ...(summary.heldSpy ? [{ key: `${drift}-spy`, drift, label: "Holding SPY", figures: summary.heldSpy, isV4: false }] : []),
    ];
  });
  return (
    <DataTable
      tableId="portfolio-simulator-held-comparison"
      columns={comparisonColumns}
      rows={rows}
      rowKey={(row) => row.key}
      dense
      toolbar={<BacktestCardTitle title="v4 against buy and hold" description="the same paths; holding: each ticker's allocation in shares at today's price, never traded, dividends kept as cash" />}
      extraRows={(row) => (row.isV4 ? { before: [{ key: `${row.drift}-group`, className: "portfolio-table-group-row", content: `${driftLabels[row.drift]} drift` }] } : null)}
      afterTable={
        <div className="text-secondary px-3 py-2" style={{ fontSize: "0.8rem" }}>
          Lowest: the account's lowest value against today, ÷ the starting account − 1 (Max drawdown is from any peak instead).
        </div>
      }
    />
  );
}

/** Three odds tiles, each with both drifts' values. */
function OddsTiles({ valueAt, compareAt }: { valueAt: (drift: PortfolioDrift, oneIn: number) => number | null; compareAt: ((drift: PortfolioDrift, oneIn: number) => number | null) | null }) {
  return (
    <div className="portfolio-odds">
      {[10, 20, 100].map((oneIn) => (
        <div key={oneIn} className="portfolio-odds-tile">
          <div className="portfolio-tile-label-plain">1 path in {oneIn}</div>
          {driftOrder.map((drift) => {
            const value = valueAt(drift, oneIn);
            const other = compareAt?.(drift, oneIn) ?? null;
            return (
              <div key={drift}>
                <div className="portfolio-odds-line">
                  <span className="text-secondary">{driftLabels[drift]}</span>
                  <span className="portfolio-odds-line-value">{formatPercentage(value)}</span>
                </div>
                {value !== null && other !== null && <Difference value={value} other={other} kind="points" name={null} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The projection's outcome at both drifts: CAGR, Max drawdown and Excess Calmar, v4 against buy and hold, the odds, the betas, the year ends and the average year. */
export function PortfolioOutcomeCard({ summaries, horizonYears, accountDollars, compare, chartDrift, onChartDrift }: PortfolioOutcomeCardProps) {
  const name = compare?.name ?? null;
  const shown = summaries[chartDrift];
  const largestShare = Math.max(...yearSourceOrder.map((source) => Math.abs(shown.averageYear[source].share)), 0.0001);
  const totalShare = yearSourceOrder.reduce((sum, source) => sum + shown.averageYear[source].share, 0);
  const totalDollars = yearSourceOrder.reduce((sum, source) => sum + shown.averageYear[source].dollars, 0);
  const tiles: { label: string; pick: (summary: PortfolioProjectionSummary) => PortfolioPercentiles; format: (value: number) => string; kind: "points" | "ratio" }[] = [
    { label: "CAGR · median", pick: (summary) => summary.cagr, format: (value) => formatPercentage(value), kind: "points" },
    { label: "Max drawdown · median", pick: (summary) => summary.maxDrawdown, format: (value) => formatPercentage(value), kind: "points" },
    { label: "Excess Calmar · median", pick: (summary) => summary.excessCalmar, format: (value) => value.toFixed(2), kind: "ratio" },
  ];
  return (
    <div className="card">
      <div className="card-body py-2 border-bottom">
        <BacktestCardTitle title={`Outcome over ${horizonYears} years · ${formatNumber(shown.pathCount)} paths`} />
      </div>
      <div className="card-body">
        <div className="portfolio-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="portfolio-tile">
              <div className="portfolio-tile-label">{tile.label}</div>
              <div className="portfolio-tile-pair">
                {driftOrder.map((drift, index) => {
                  const figures = tile.pick(summaries[drift]);
                  const other = compare ? tile.pick(compare.summaries[drift]) : null;
                  return (
                    <div key={drift}>
                      <div className="portfolio-tile-drift">{driftLabels[drift]}</div>
                      <div className="portfolio-tile-value portfolio-tile-value-pair">{tile.format(figures.p50)}</div>
                      <div className="portfolio-tile-range">
                        {index === 0 ? "10th–90th: " : ""}
                        {tile.format(figures.p10)} to {tile.format(figures.p90)}
                      </div>
                      {other && <Difference value={figures.p50} other={other.p50} kind={tile.kind} name={index === 0 ? name : null} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <ComparisonTable summaries={summaries} />
        </div>
        <div className="portfolio-outcome-row">
          <div>
            <div className="portfolio-subhead">v4: Max drawdown reached in</div>
            <OddsTiles
              valueAt={(drift, oneIn) => summaries[drift].drawdownAtOdds.find((entry) => entry.oneIn === oneIn)?.maxDrawdown ?? null}
              compareAt={compare ? (drift, oneIn) => compare.summaries[drift].drawdownAtOdds.find((entry) => entry.oneIn === oneIn)?.maxDrawdown ?? null : null}
            />
            <div className="portfolio-subhead portfolio-subhead-spaced">v4: lowest point against today in</div>
            <OddsTiles
              valueAt={(drift, oneIn) => summaries[drift].v4.lowestAgainstStartAtOdds.find((entry) => entry.oneIn === oneIn)?.lowestAgainstStart ?? null}
              compareAt={compare ? (drift, oneIn) => compare.summaries[drift].v4.lowestAgainstStartAtOdds.find((entry) => entry.oneIn === oneIn)?.lowestAgainstStart ?? null : null}
            />
            {driftOrder.every((drift) => summaries[drift].bookBeta) && (
              <div className="portfolio-betas">
                {(["all", "down"] as const).map((which) => (
                  <div key={which}>
                    <div className="portfolio-tile-label">{which === "all" ? "Beta to SPY" : "Downside beta"}</div>
                    {driftOrder.map((drift) => (
                      <div key={drift} className="portfolio-odds-line">
                        <span className="text-secondary">{driftLabels[drift]}</span>
                        <span className="portfolio-odds-line-value">{summaries[drift].bookBeta![which].toFixed(2)}</span>
                      </div>
                    ))}
                    {which === "down" && <div className="portfolio-tile-range">on the days SPY fell</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="portfolio-chart-head">
              <div className="portfolio-subhead">The account at each year's end</div>
              <BacktestSegmentedSwitch<PortfolioDrift> ariaLabel="Chart drift" options={driftOrder.map((drift) => ({ value: drift, label: driftLabels[drift] }))} value={chartDrift} onChange={onChartDrift} />
            </div>
            <YearEndChart summary={shown} accountDollars={accountDollars} />
            <div className="portfolio-chart-legend">
              <span>
                <span className="portfolio-legend-band" aria-hidden="true" /> v4 10th–90th
              </span>
              <span>
                <span className="portfolio-legend-line portfolio-legend-v4" aria-hidden="true" /> v4 median
              </span>
              <span>
                <span className="portfolio-legend-line portfolio-legend-held-book" aria-hidden="true" /> holding the book, median
              </span>
              {shown.heldSpy && (
                <span>
                  <span className="portfolio-legend-line portfolio-legend-held-spy" aria-hidden="true" /> holding SPY, median
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="portfolio-subhead">Where the return comes from · the average year, all paths, {driftLabels[chartDrift].toLowerCase()} drift</div>
        <div className="portfolio-parts">
          {yearSourceOrder.map((source) => {
            const { share, dollars } = shown.averageYear[source];
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
