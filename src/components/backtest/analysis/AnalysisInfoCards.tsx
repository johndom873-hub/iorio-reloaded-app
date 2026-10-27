import { useState, type ReactNode } from "react";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import type { AnalysisCorrelationRow, AnalysisFigures, AnalysisFileFigures, AnalysisProfile } from "../../../api/backtestAnalysis";
import { analysisSignedClass } from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonth, formatDayMonthYear, formatExpiryDayMonthWithDte, formatFileSize, formatNumber, formatPercentage, formatSignedPercentage, formatStrike } from "../../../lib/formatters";
import { useTickerModal } from "../../../hooks/useTickerModal";
import { ColumnVisibilityPopover } from "../../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../DataTable/useColumnVisibility";
import { TooltipSpan } from "../../TooltipSpan";
import { AnalysisCard, AnalysisNote } from "./analysisBits";

// Earnings and dividends (the two-session move, the implied move with its formula), correlation (daily log returns),
// the stock profile (information only) and data quality. Mockup approved 2026-10-15.

const dayMilliseconds = 86_400_000;
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / dayMilliseconds);
const weekdayOf = (dateIso: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${dateIso}T00:00:00Z`));

const earningsColumns = [
  { key: "date", header: "Report" },
  { key: "move", header: "Move, two sessions" },
  { key: "implied", header: "Implied move" },
  { key: "beyond", header: "Beyond implied" },
];

interface AnalysisEarningsCardProps {
  symbol: string;
  /** Before the first analysis there is no chain map: the first expiry after the next report is left out. */
  figures: AnalysisFileFigures & Partial<Pick<AnalysisFigures, "chains">>;
  /** Fetching the earnings history (API Ninjas) then updating the analysis; null when there is nothing to fetch with. */
  onFetchEarnings: (() => void) | null;
  fetching: boolean;
  fetchMessage: string | null;
}

export function AnalysisEarningsCard({ symbol, figures, onFetchEarnings, fetching, fetchMessage }: AnalysisEarningsCardProps) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-earnings", earningsColumns.map((column) => column.key));
  const [showAll, setShowAll] = useState(false);
  const earnings = figures.earnings;
  const dividends =
    earnings.exDividendDates.length > 0 ? (
      <>
        {earnings.exDividendDates.length} ex-dividend date{earnings.exDividendDates.length === 1 ? "" : "s"}
        <span className="analysis-sub">{earnings.exDividendDates.slice(-3).map(formatDayMonthYear).join(", ")} (TradingView)</span>
      </>
    ) : (
      <span className="analysis-sans">None in the system</span>
    );
  if (earnings.reports.length === 0) {
    return (
      <AnalysisCard title="Earnings and dividends">
        <div className="card-body d-flex flex-column gap-3">
          {!earnings.hasTickerRow ? (
            <AnalysisNote tone="plain">
              <p>
                <b>{symbol} has no ticker row,</b> so there is no earnings history to fetch. Its download creates the row.
              </p>
            </AnalysisNote>
          ) : (
            <AnalysisNote
              tone="warn"
              actions={
                onFetchEarnings && (
                  <button type="button" className="btn btn-primary" disabled={fetching} onClick={onFetchEarnings}>
                    {fetching ? "Fetching…" : "Fetch earnings"}
                  </button>
                )
              }
            >
              <p>
                <b>No earnings reports since the first option day.</b> API Ninjas has the history; fetching it updates this analysis in the background.
              </p>
              {fetchMessage && <p>{fetchMessage}</p>}
            </AnalysisNote>
          )}
          <dl className="analysis-kv">
            <dt>Dividends</dt>
            <dd>{dividends}</dd>
          </dl>
          {earnings.exDividendDates.length === 0 && (
            <AnalysisNote tone="plain">
              <p>
                <b>No source for a dividend history.</b> The system holds only TradingView's last and next ex-dates for Shortlist tickers; nothing to fetch.
              </p>
            </AnalysisNote>
          )}
        </div>
      </AnalysisCard>
    );
  }
  const reports = [...earnings.reports].reverse();
  const shown = showAll ? reports : reports.slice(0, 8);
  const next = earnings.next;
  const firstExpiryAfterNext = next && figures.chains ? ([...new Set(figures.chains.chainMap.map((contract) => contract.expiry))].sort().find((expiry) => expiry > next.date) ?? null) : null;
  const worked = earnings.reports.filter((report) => report.straddle !== null && report.impliedMove !== null).at(-1) ?? null;
  return (
    <AnalysisCard
      title="Earnings and dividends"
      actions={<ColumnVisibilityPopover columns={earningsColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
      footer={
        <>
          <p className="mb-1">
            <button type="button" className="analysis-link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show the last 8" : `Show all ${earnings.reports.length} reports since ${figures.dataQuality.firstDate ? formatDayMonthYear(figures.dataQuality.firstDate) : "the first option day"}`}
            </button>
          </p>
          <p className="mb-1">
            <span className="analysis-formula">move = ln(close of the session after the report ÷ close of the session before it)</span>
          </p>
          <p className="mb-1">
            <span className="analysis-formula">implied move = (at-the-money Call mid + Put mid) ÷ stock price</span> on the first expiry after the report, at the 10:00 quote of the session before it; stock price = close of IBKR's 09:30 30-minute bar, as traded; at the money = the strike whose Call and Put mids are closest.
            {worked?.straddle &&
              ` ${formatDayMonthYear(worked.date)}: quote ${formatDayMonth(worked.straddle.quoteDate)}, expiry ${formatDayMonth(worked.straddle.expiry)}, ${formatStrike(worked.straddle.strike)} straddle ${worked.straddle.callMid.toFixed(3)} + ${worked.straddle.putMid.toFixed(3)} = ${formatCurrency(worked.straddle.callMid + worked.straddle.putMid)} ÷ ${formatCurrency(worked.straddle.price)} = ±${(worked.impliedMove! * 100).toFixed(1)}%.`}
          </p>
          <p className="mb-0">Report dates from API Ninjas and TradingView, only from the first option day. A report's time of day is not always known, so the move spans two sessions.</p>
        </>
      }
    >
      <div className="card-body pb-2">
        <dl className="analysis-kv">
          <dt>Next report</dt>
          <dd>
            <span className="analysis-sans">{next ? `${weekdayOf(next.date)} ${formatDayMonthYear(next.date)}${next.afterClose === true ? ", after the close" : next.afterClose === false ? ", before the open" : ""}` : "Not known"}</span>
          </dd>
          {firstExpiryAfterNext && (
            <>
              <dt>First expiry after it</dt>
              <dd>
                <span className="analysis-sans">{formatExpiryDayMonthWithDte(firstExpiryAfterNext, daysBetween(figures.optionLastDate, firstExpiryAfterNext))}</span>
              </dd>
            </>
          )}
          <dt>Move around a report</dt>
          <dd>
            {formatPercentage(earnings.medianAbsMove)}
            <span className="analysis-sub">
              median size of {earnings.reports.length} reports{earnings.largest ? ` · largest ${formatSignedPercentage(earnings.largest.move)} (${formatDayMonthYear(earnings.largest.date)})` : ""}
            </span>
          </dd>
          <dt>Implied move</dt>
          <dd>
            {earnings.medianImpliedMove === null ? "—" : `±${(earnings.medianImpliedMove * 100).toFixed(1)}%`}
            <span className="analysis-sub">
              median · moved beyond it on {earnings.beyondImplied} of {earnings.withImplied}
            </span>
          </dd>
          <dt>Dividends</dt>
          <dd>{dividends}</dd>
        </dl>
      </div>
      <div className="table-responsive">
        <table className="table table-sm card-table mb-0">
          <thead className="table-light">
            <tr>
              {earningsColumns
                .filter((column) => isColumnVisible(column.key))
                .map((column) => (
                  <th key={column.key} className={column.key === "move" || column.key === "implied" ? "text-end" : undefined}>
                    {column.header}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((report) => {
              const beyond = report.move === null || report.impliedMove === null ? null : Math.abs(report.move) > report.impliedMove;
              const straddle = report.straddle;
              return (
                <tr key={report.date}>
                  {isColumnVisible("date") && <td className="font-mono text-nowrap">{formatDayMonthYear(report.date)}</td>}
                  {isColumnVisible("move") && (
                    <td className="text-end">
                      <span className={analysisSignedClass(report.move)}>{formatSignedPercentage(report.move)}</span>
                    </td>
                  )}
                  {isColumnVisible("implied") && (
                    <TooltipSpan
                      as="td"
                      className="text-end"
                      text={straddle && report.impliedMove !== null ? `Quote ${formatDayMonth(straddle.quoteDate)} 10:00, expiry ${formatDayMonth(straddle.expiry)} · ${formatStrike(straddle.strike)} Call ${straddle.callMid.toFixed(3)} + Put ${straddle.putMid.toFixed(3)} = ${(straddle.callMid + straddle.putMid).toFixed(2)} ÷ ${formatCurrency(straddle.price)} = ±${(report.impliedMove * 100).toFixed(1)}%` : "No quote the session before"}
                    >
                      {report.impliedMove === null ? "—" : `±${(report.impliedMove * 100).toFixed(1)}%`}
                    </TooltipSpan>
                  )}
                  {isColumnVisible("beyond") && (
                    <td>
                      {beyond === null ? (
                        "—"
                      ) : beyond ? (
                        <span className="analysis-ink-fair d-inline-flex align-items-center gap-1">
                          <IconAlertTriangle size={14} aria-hidden="true" />
                          Yes
                        </span>
                      ) : (
                        "No"
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AnalysisCard>
  );
}

const correlationColumns = [
  { key: "ticker", header: "Ticker" },
  { key: "oneYear", header: "1 year" },
  { key: "twoYears", header: "2 years" },
  { key: "betaOneYear", header: "Beta, 1 year" },
  { key: "betaTwoYears", header: "Beta, 2 years" },
];

export function AnalysisCorrelationCard({ symbol, figures }: { symbol: string; figures: AnalysisFileFigures }) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-correlation", correlationColumns.map((column) => column.key));
  const { open: openTicker } = useTickerModal();
  const rows = figures.correlation.rows;
  const rowOf = (other: string, window: 252 | 504): AnalysisCorrelationRow | undefined => rows.find((row) => row.symbol === other && row.window === window);
  const candidates = [...new Set(rows.map((row) => row.symbol))].filter((other) => other !== "SPY");
  const defaults = candidates
    .filter((other) => rowOf(other, 252)?.correlation !== null && rowOf(other, 252)?.correlation !== undefined)
    .sort((a, b) => rowOf(b, 252)!.correlation! - rowOf(a, 252)!.correlation!)
    .slice(0, 5);
  const [picked, setPicked] = useState<string[]>(defaults);
  const spyOneYear = rowOf("SPY", 252);
  const shownTickers = [...(rows.some((row) => row.symbol === "SPY") ? ["SPY"] : []), ...picked];
  const addable = candidates.filter((other) => !picked.includes(other)).sort();
  const skipped = Object.entries(figures.correlation.skipped);
  const correlationCell = (other: string, window: 252 | 504) => {
    const row = rowOf(other, window);
    return row?.correlation === null || row?.correlation === undefined ? "—" : row.correlation.toFixed(2);
  };
  return (
    <AnalysisCard
      title="Correlation"
      description="Daily log returns on the days both traded"
      actions={<ColumnVisibilityPopover columns={correlationColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}
      footer={
        <>
          <p className="mb-1">
            The last {spyOneYear?.n ?? 252} (1 year) and {rowOf("SPY", 504)?.n ?? 504} (2 years) common days. Beta against SPY only{spyOneYear?.beta !== null && spyOneYear?.beta !== undefined ? `: a 1% SPY day has gone with about ${spyOneYear.beta.toFixed(1)}% in ${symbol} over the last year` : ""}. Default picks: the top 5 by 1-year correlation.
          </p>
          <p className="mb-0">
            {figures.correlation.spySource === "database" ? "SPY's prices come from the app database until its file holds them. " : ""}
            {skipped.length > 0 ? `Left out: ${skipped.map(([other, reason]) => `${other} (${reason})`).join(", ")}.` : ""}
          </p>
        </>
      }
    >
      <div className="card-body pb-1">
        <div className="analysis-chips">
          <span className="text-secondary" style={{ fontSize: "0.75rem" }}>
            Compared with
          </span>
          {shownTickers.map((other) => (
            <span key={other} className="analysis-chip">
              {other}
              {other !== "SPY" && (
                <button type="button" className="btn btn-icon btn-ghost-secondary p-0" style={{ width: "1.25rem", height: "1.25rem" }} aria-label={`Remove ${other}`} onClick={() => setPicked(picked.filter((entry) => entry !== other))}>
                  <IconX size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          {addable.length > 0 && (
            <select
              className="form-select form-select-sm"
              style={{ width: "auto" }}
              aria-label="Add a ticker"
              value=""
              onChange={(event) => {
                if (event.target.value) setPicked([...picked, event.target.value]);
              }}
            >
              <option value="">Add</option>
              {addable.map((other) => (
                <option key={other} value={other}>
                  {other}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="table-responsive">
        <table className={`table table-sm card-table mb-0${isColumnVisible("ticker") ? " table-freeze-first-column-on-phone" : ""}`}>
          <thead className="table-light">
            <tr>
              {correlationColumns
                .filter((column) => isColumnVisible(column.key))
                .map((column) => (
                  <th key={column.key} className={column.key === "ticker" ? undefined : "text-end"}>
                    {column.header}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {shownTickers.map((other) => {
              const oneYear = rowOf(other, 252);
              return (
                <tr key={other}>
                  {isColumnVisible("ticker") && (
                    <td>
                      <button type="button" className="analysis-link font-mono fw-semibold" style={{ textDecoration: "none" }} onClick={() => openTicker(other)}>
                        {other}
                      </button>
                    </td>
                  )}
                  {isColumnVisible("oneYear") && (
                    <td className="text-end">
                      {correlationCell(other, 252)}
                      <span className="analysis-corr-bar" aria-hidden="true">
                        <i style={{ width: `${Math.max(0, oneYear?.correlation ?? 0) * 100}%` }} />
                      </span>
                    </td>
                  )}
                  {isColumnVisible("twoYears") && <td className="text-end">{correlationCell(other, 504)}</td>}
                  {isColumnVisible("betaOneYear") && <td className="text-end">{other === "SPY" && oneYear?.beta !== null && oneYear?.beta !== undefined ? oneYear.beta.toFixed(2) : "—"}</td>}
                  {isColumnVisible("betaTwoYears") && <td className="text-end">{other === "SPY" && rowOf(other, 504)?.beta !== null && rowOf(other, 504)?.beta !== undefined ? rowOf(other, 504)!.beta!.toFixed(2) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AnalysisCard>
  );
}

const profileColumns = [
  { key: "all", header: "All history" },
  { key: "twoYear", header: "Last 2 years" },
];

export function AnalysisProfileCard({ figures }: { figures: AnalysisFileFigures }) {
  const { isColumnVisible, toggleColumn } = useColumnVisibility("analysis-profile", profileColumns.map((column) => column.key));
  const { all, twoYear } = figures.profile;
  const label = (value: AnalysisProfile["label"]) => (value === null ? "—" : value.charAt(0).toUpperCase() + value.slice(1));
  const measures: [string, string, (profile: AnalysisProfile) => ReactNode][] = [
    [
      "Trend",
      "CAGR, and how straight the path is (R² of a straight line through the log price: near 1 a steady climb, near 0 no direction)",
      (profile) => (
        <>
          <span className="font-mono">{formatSignedPercentage(profile.cagr)} a year</span>
          <span className="analysis-sub">R² {profile.r2.toFixed(2)}</span>
        </>
      ),
    ],
    [
      "Swings",
      "Moves of 20% or more from a turning point that then reverse by 20%",
      (profile) => (
        <>
          <span className="font-mono">{profile.swingsPerYear.toFixed(1)} a year</span>
          <span className="analysis-sub">
            {profile.swings} in all · median size {formatPercentage(profile.medianSwing, 0)}
          </span>
        </>
      ),
    ],
    [
      "Jumps",
      "Days moving more than 3 times the daily volatility known the day before (63-day Yang-Zhang)",
      (profile) => (
        <>
          <span className="font-mono">{profile.jumpsPerYear.toFixed(1)} a year</span>
          <span className="analysis-sub">
            {profile.jumps} in all{profile.largestJump ? ` · largest ${formatSignedPercentage(profile.largestJump.move)} (${formatDayMonthYear(profile.largestJump.date)})` : ""} · {profile.jumpsOnReports} on a report's two sessions
          </span>
        </>
      ),
    ],
    [
      "Trending or range-bound",
      "Variance ratio of 21-session returns: above the band trending, below range-bound, inside close to a random walk",
      (profile) => (
        <>
          <span className="font-mono">{label(profile.label)}</span>
          <span className="analysis-sub">{profile.varianceRatio === null || profile.standardError === null ? "—" : `VR ${profile.varianceRatio.toFixed(2)}, band ${(1 - 2 * profile.standardError).toFixed(2)}–${(1 + 2 * profile.standardError).toFixed(2)}`}</span>
        </>
      ),
    ],
  ];
  return (
    <AnalysisCard title="Stock profile" description="Information only: the strategy does not use these" actions={<ColumnVisibilityPopover columns={profileColumns} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} variant="toolbar" />}>
      <div className="table-responsive">
        <table className="table table-sm card-table analysis-profile-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Measure</th>
              {isColumnVisible("all") && <th>All history{all && <span className="d-block fw-normal text-none" style={{ textTransform: "none", fontSize: "0.7rem" }}>from {formatDayMonthYear(all.from)}</span>}</th>}
              {isColumnVisible("twoYear") && <th>Last 2 years</th>}
            </tr>
          </thead>
          <tbody>
            {measures.map(([name, meaning, render]) => (
              <tr key={name}>
                <th scope="row">
                  {name}
                  <small>{meaning}</small>
                </th>
                {isColumnVisible("all") && <td>{all ? render(all) : "—"}</td>}
                {isColumnVisible("twoYear") && <td>{twoYear ? render(twoYear) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalysisCard>
  );
}

export function AnalysisDataQualityCard({ figures }: { figures: AnalysisFileFigures | AnalysisFigures }) {
  const quality = figures.dataQuality;
  const optionYears = quality.firstDate && quality.lastDate ? daysBetween(quality.firstDate, quality.lastDate) / 365.25 : 0;
  const historyYears = quality.bars.firstDate && quality.bars.lastDate ? daysBetween(quality.bars.firstDate, quality.bars.lastDate) / 365.25 : 0;
  const splits = (quality.splits ?? []).filter((segment) => segment.factor !== 1);
  const bigMoves = quality.barChecks.bigMoves;
  return (
    <AnalysisCard title="Data quality and history depth">
      <div className="card-body">
        <dl className="analysis-kv">
          <dt>Option days stored</dt>
          <dd>
            {formatNumber(quality.completeDays)}
            <span className="analysis-sub">
              {quality.firstDate ? formatDayMonthYear(quality.firstDate) : "—"} → {quality.lastDate ? formatDayMonthYear(quality.lastDate) : "—"} · {optionYears.toFixed(1)} years
            </span>
          </dd>
          <dt>Weekdays in that span</dt>
          <dd>
            {formatNumber(quality.weekdays)}
            <span className="analysis-sub">
              {quality.holidays} market holidays · {quality.missingWeekdays} missing
            </span>
          </dd>
          <dt>Days with issues · unavailable</dt>
          <dd>
            {quality.daysWithIssues} · {quality.unavailableDays}
          </dd>
          <dt>Days with intraday quotes</dt>
          <dd>{quality.intradayDays === null ? "—" : `${formatNumber(quality.intradayDays)} of ${formatNumber(quality.completeDays)}`}</dd>
          <dt>File</dt>
          <dd>
            <span className="analysis-sans">
              schema {quality.schemaVersion ?? "—"}
              {quality.maxDte === "all" ? ", every expiry stored" : quality.maxDte ? `, expiries to ${quality.maxDte} days` : ""}
            </span>
            <span className="analysis-sub">
              {quality.quoteRowsPerDay.min === null ? "—" : `${formatNumber(quality.quoteRowsPerDay.min)} to ${formatNumber(quality.quoteRowsPerDay.max)} quotes a day`} · {formatFileSize(quality.sizeBytes)}
            </span>
          </dd>
          <dt>IBKR daily bars</dt>
          <dd>
            {formatNumber(quality.bars.count)}
            <span className="analysis-sub">
              {quality.bars.firstDate ? `${formatDayMonthYear(quality.bars.firstDate)} → ${formatDayMonthYear(quality.bars.lastDate!)}` : "none"}
              {quality.barsFetchedAt ? ` · fetched ${formatDayMonthYear(quality.barsFetchedAt.slice(0, 10))}` : ""}
              {quality.bars.source === "database" ? " · from the app database" : ""}
            </span>
          </dd>
          <dt>Implied volatility</dt>
          <dd>
            {formatNumber(quality.impliedVolatility.count)} days
            {quality.impliedVolatility.firstDate && <span className="analysis-sub">from {formatDayMonthYear(quality.impliedVolatility.firstDate)}</span>}
          </dd>
          <dt>Splits</dt>
          <dd>
            <span className="analysis-sans">{quality.splits === null ? "not analysed" : splits.length === 0 ? "none" : splits.map((segment) => `×${segment.factor} from ${formatDayMonthYear(segment.fromDateIso)}`).join(", ")}</span>
          </dd>
          <dt>One-day moves over 35%</dt>
          <dd>
            <span className="analysis-sans">{bigMoves.length}</span>
            {bigMoves.length > 0 && <span className="analysis-sub">{bigMoves.map(([date, move]) => `${formatSignedPercentage(move)} on ${formatDayMonthYear(date)}`).join(", ")}</span>}
          </dd>
          <dt>Gaps over 10 days</dt>
          <dd>
            <span className="analysis-sans">{quality.barChecks.gaps.length === 0 ? "none" : quality.barChecks.gaps.map(([from, to]) => `${formatDayMonthYear(from)} → ${formatDayMonthYear(to)}`).join(", ")}</span>
          </dd>
          <dt>Runs of 5+ identical closes</dt>
          <dd>
            <span className="analysis-sans">{quality.barChecks.flatRuns.length === 0 ? "none" : quality.barChecks.flatRuns.length}</span>
            <span className="analysis-sub">catches placeholder prices</span>
          </dd>
          <dt>Closes for the shock rule</dt>
          <dd>
            {formatNumber(figures.shock.closes)}
            <span className="analysis-sub">250 needed</span>
          </dd>
          {"scannedDays" in quality && (
            <>
              <dt>Chain scan</dt>
              <dd>
                {formatNumber(quality.scannedDays)} days
                <span className="analysis-sub">
                  {quality.daysWithoutPrice > 0 ? `${quality.daysWithoutPrice} without a 10:00 price · ` : ""}
                  {quality.daysWithNothingPassing.length} with nothing passing{quality.daysWithNothingPassing.length > 0 && quality.daysWithNothingPassing.length <= 3 ? `: ${quality.daysWithNothingPassing.map(formatDayMonthYear).join(", ")}` : ""}
                </span>
              </dd>
            </>
          )}
        </dl>
        {historyYears > 0 && historyYears < 10 && (
          <div className="mt-3">
            <AnalysisNote tone="plain">
              <p>
                {historyYears.toFixed(1)} years of prices: less than the 10 years the shock rule reads{figures.shock.closes >= 250 ? ", but over the 250 closes it needs" : ", and under the 250 closes it needs"}.
              </p>
            </AnalysisNote>
          </div>
        )}
      </div>
    </AnalysisCard>
  );
}
