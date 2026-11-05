import type { PortfolioDrift, PortfolioProjection, PortfolioTickerPot } from "../../../api/backtestPortfolio";
import { formatCurrency, formatDayMonthYear, formatNumber, formatPercentage } from "../../../lib/formatters";
import { DataTable, type DataTableColumn } from "../../DataTable/DataTable";
import { driftLabels } from "../../../lib/portfolioSimulatorPresentation";
import { BacktestCardTitle, BacktestSymbolLink } from "../backtestBits";

export interface PortfolioTickerRow {
  symbol: string;
  allocationPct: number;
  pot: PortfolioTickerPot;
  /** From the projection; null until one ran for this book. */
  projected: PortfolioProjection["tickers"][number] | null;
  year: { premiumYear: number; callsSoldYear: number; callAwaysYear: number } | null;
  warningCodes: string[];
}

const ownDrawdownAt = (row: PortfolioTickerRow, oneIn: number) => row.projected?.ownDrawdownAtOdds?.find((entry) => entry.oneIn === oneIn)?.maxDrawdown ?? null;

const columns: DataTableColumn<PortfolioTickerRow>[] = [
  { key: "ticker", header: "Ticker", render: (row) => <BacktestSymbolLink symbol={row.symbol} />, sortValue: (row) => row.symbol },
  { key: "allocation", header: "Allocation", align: "right", render: (row) => formatPercentage(row.allocationPct / 100, 2), sortValue: (row) => row.allocationPct },
  { key: "pot", header: "Pot", align: "right", render: (row) => formatCurrency(row.pot.potDollars, 0), sortValue: (row) => row.pot.potDollars },
  { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.pot.price), sortValue: (row) => row.pot.price },
  { key: "lots", header: "Lots", headerTitle: "100-share lots the first position holds at today's price", align: "right", render: (row) => formatNumber(row.pot.lotsAtTarget), sortValue: (row) => row.pot.lotsAtTarget },
  {
    key: "targetReached",
    header: "Target reached",
    headerTitle: "The share of the first position's target those whole lots reach",
    align: "right",
    render: (row) => <span className={row.pot.targetReached < 0.8 ? "analysis-ink-poor" : ""}>{formatPercentage(row.pot.targetReached, 0)}</span>,
    sortValue: (row) => row.pot.targetReached,
  },
  { key: "beta", header: "β", headerTitle: "Beta to SPY, daily, over its own history", align: "right", render: (row) => (row.projected ? row.projected.beta.toFixed(2) : "—"), sortValue: (row) => row.projected?.beta ?? null },
  {
    key: "dividendYield",
    header: "Dividend yield",
    headerTitle: "The last 12 months' dividends ÷ the price before each ex-date",
    align: "right",
    render: (row) =>
      row.projected === null ? "—" : row.projected.dividendYield === null ? <span className="badge bg-warning-lt" title="Its dividends are not fetched yet: 0% assumed">not fetched</span> : formatPercentage(row.projected.dividendYield, 2),
    sortValue: (row) => row.projected?.dividendYield ?? null,
  },
  { key: "premium", header: "Premium a year", align: "right", render: (row) => (row.year ? formatCurrency(row.year.premiumYear, 0) : "—"), sortValue: (row) => row.year?.premiumYear ?? null },
  { key: "callsSold", header: "Calls sold a year", align: "right", render: (row) => (row.year ? formatNumber(row.year.callsSoldYear) : "—"), sortValue: (row) => row.year?.callsSoldYear ?? null },
  { key: "callAways", header: "Call-aways a year", align: "right", render: (row) => (row.year ? formatNumber(row.year.callAwaysYear, 1, 1) : "—"), sortValue: (row) => row.year?.callAwaysYear ?? null },
  ...[10, 20, 100].map(
    (oneIn): DataTableColumn<PortfolioTickerRow> => ({
      key: `ownDrawdown${oneIn}`,
      header: oneIn === 10 ? "Own Max DD 1 in 10" : `1 in ${oneIn}`,
      headerTitle: `The ticker alone at its pot (the suggestions' library): the Max drawdown reached in 1 path in ${oneIn}`,
      align: "right",
      render: (row) => {
        const value = ownDrawdownAt(row, oneIn);
        if (value !== null) return formatPercentage(value);
        return row.projected ? (
          <span className="text-secondary" title="Not in the suggestions' library yet: it appears after the next rebuild">
            —
          </span>
        ) : (
          <span className="text-secondary">—</span>
        );
      },
      sortValue: (row) => ownDrawdownAt(row, oneIn),
    }),
  ),
  {
    key: "ownHistory",
    header: "Own history from",
    render: (row) =>
      row.projected?.ownHistoryFrom ? (
        <span className="d-inline-flex flex-wrap align-items-center gap-1">
          {formatDayMonthYear(row.projected.ownHistoryFrom)}
          {row.projected.businessChange && (
            <span className="badge bg-azure-lt" title={`A new company from this date (before: ${row.projected.businessChange.before}): earlier prices are not read`}>
              new business
            </span>
          )}
        </span>
      ) : (
        "—"
      ),
    sortValue: (row) => row.projected?.ownHistoryFrom ?? null,
  },
  {
    key: "beforeListing",
    header: "Before its listing",
    headerTitle: "The stand-in whose real moves fill the years before the ticker's own, × the two's volatility ratio over the days both traded; without one, β × SPY's moves",
    render: (row) =>
      row.projected?.standIn ? (
        <span title={`${row.projected.standIn.symbol}'s moves × ${row.projected.standIn.volatilityRatio.toFixed(2)} before ${row.symbol}'s own`}>
          from {row.projected.standIn.symbol} · moves × {row.projected.standIn.volatilityRatio.toFixed(2)}
        </span>
      ) : (
        <span className="text-secondary">—</span>
      ),
    sortValue: (row) => row.projected?.standIn?.symbol ?? null,
  },
  {
    key: "ivNow",
    header: "IV30 now ÷ normal",
    headerTitle: "Today's 30-day IV ÷ its 4-year median: every path starts from it and fades back over the ticker's measured half-life",
    align: "right",
    render: (row) =>
      row.projected?.ivNowAgainstNormal != null ? (
        <span title={`Half-life ${formatNumber(row.projected.ivHalfLifeSessions)} sessions`}>×{row.projected.ivNowAgainstNormal.toFixed(2)}</span>
      ) : (
        <span className="text-secondary">—</span>
      ),
    sortValue: (row) => row.projected?.ivNowAgainstNormal ?? null,
  },
  {
    key: "warnings",
    header: "Warnings",
    render: (row) =>
      row.warningCodes.length === 0 ? (
        <span className="text-secondary">—</span>
      ) : (
        <span className="d-inline-flex gap-1">
          {row.warningCodes.map((code) => (
            <span key={code} className="badge bg-warning-lt">
              {code}
            </span>
          ))}
        </span>
      ),
  },
];

/** Each ticker of the book: its pot in whole lots, and from the projection its β, dividend yield, average year, own drawdown odds, stand-in and IV now. */
export function PortfolioTickersTable({ rows, yearDrift }: { rows: PortfolioTickerRow[]; yearDrift: PortfolioDrift | null }) {
  return (
    <DataTable
      tableId="portfolio-simulator-tickers"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.symbol}
      dense
      maxVisibleRows={20}
      defaultSort={{ key: "ticker", direction: "asc" }}
      toolbar={
        <BacktestCardTitle
          title="Each ticker"
          description={`pot = allocation × (1 + allowance) × account, in whole 100-share lots; premium, Calls sold and call-aways: the average year over the paths${yearDrift ? ` (${driftLabels[yearDrift].toLowerCase()} drift, the chart's)` : ""}; own Max drawdown: the ticker alone at its pot, from the library`}
        />
      }
    />
  );
}
