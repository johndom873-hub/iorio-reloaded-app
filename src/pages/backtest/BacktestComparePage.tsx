import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchBacktestComparison,
  fetchBacktestSettingsTemplate,
  type BacktestCompareCurve,
  type BacktestCompareResponse,
  type BacktestCompareSession,
  type BacktestMetrics,
  type BacktestSettingRow,
  type BacktestWheelCycleSummary,
} from "../../api/backtest";
import { ColumnVisibilityPopover } from "../../components/DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../components/DataTable/useColumnVisibility";
import { DottedLabelTooltip } from "../../components/HelpTooltip";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard, BacktestSeriesSwatch, BacktestValueScaleSwitch } from "../../components/backtest/backtestBits";
import { useBacktestValueScale } from "../../components/backtest/useBacktestValueScale";
import { BacktestCompareChart } from "../../components/backtest/BacktestCharts";
import { usePolledBacktestResource } from "../../components/backtest/useBacktestPolling";
import { useTheme } from "../../hooks/useTheme";
import { formatCurrency } from "../../lib/formatters";
import { backtestMetricExplanation, backtestSeriesColorsByTheme, bestValueIndex, buyAndHoldColorByTheme, buyAndHoldLineStyle, compareMetricRows, describeOverrideChanges, spyBuyAndHoldColorByTheme } from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";

const pageTitle = "Compare";

interface CompareColumn {
  key: string;
  name: string;
  detail: string;
  metrics: BacktestMetrics | null;
  /** A session measured per cycle: its wheel cycles; null for buy and hold and per-option sessions. */
  wheelCycles: BacktestWheelCycleSummary | null;
  kind: "session" | "baseline" | "spy";
  color: string;
  line: "solid" | "dashed" | "dotted";
}

function describePeriodAndStart(session: { symbol: string; startDate: string; endDate: string; startingValue: number }): string {
  return `${session.symbol} · ${session.startDate} → ${session.endDate} · ${formatCurrency(session.startingValue, 0)} start`;
}

/** Sessions grouped by a key, in order of first appearance. */
function groupSessions(sessions: BacktestCompareSession[], keyOf: (session: BacktestCompareSession) => string): BacktestCompareSession[][] {
  const groups = new Map<string, BacktestCompareSession[]>();
  for (const session of sessions) groups.set(keyOf(session), [...(groups.get(keyOf(session)) ?? []), session]);
  return [...groups.values()];
}

/** Sessions, then the buy-and-hold columns, comparison only: one per distinct symbols, period and start for buy and hold of the
 *  symbols, and one per distinct period and start for SPY (left out where no session kept SPY). Each buy-and-hold column takes
 *  the curve the API sent for one session of its group ("baseline:<id>", "spy:<id>"). */
function buildCompareColumns(comparison: BacktestCompareResponse, settingRows: BacktestSettingRow[] | null, theme: "light" | "dark") {
  const palette = backtestSeriesColorsByTheme[theme];
  const curveByKey = new Map(comparison.curves.map((curve) => [curve.key, curve]));
  const sessionColumns: CompareColumn[] = comparison.sessions.map((session, index) => {
    const changes = describeOverrideChanges(session.overrides, null, settingRows);
    return {
      key: session.id,
      name: session.name,
      detail: changes.length === 0 ? "no changes" : changes.join(" · "),
      metrics: session.metrics,
      wheelCycles: session.wheelCycles,
      kind: "session",
      color: palette[index % palette.length]!,
      line: "solid",
    };
  });
  const periodOf = (session: BacktestCompareSession) => `${session.startDate}|${session.endDate}|${session.startingValue}`;
  const symbolsAndPeriodOf = (session: BacktestCompareSession) => `${session.symbol}|${periodOf(session)}`;
  const samePeriod = groupSessions(comparison.sessions, periodOf).length === 1;
  const singleGroup = groupSessions(comparison.sessions, symbolsAndPeriodOf).length === 1;

  const buyAndHoldColumn = (group: BacktestCompareSession[], kind: "baseline" | "spy", index: number) => {
    const session = group.find((candidate) => curveByKey.has(`${kind}:${candidate.id}`)) ?? group[0]!;
    const curve = curveByKey.get(`${kind}:${session.id}`);
    const column: CompareColumn = {
      key: `${kind}:${session.id}`,
      name: curve?.label ?? (kind === "baseline" ? `Buy and hold · ${session.symbol}` : "Buy and hold · SPY"),
      detail: samePeriod ? "comparison only" : `comparison only · ${session.startDate} → ${session.endDate}`,
      metrics: kind === "baseline" ? session.baselineMetrics : session.spyBaselineMetrics,
      wheelCycles: null,
      kind,
      color: kind === "baseline" ? buyAndHoldColorByTheme[theme] : spyBuyAndHoldColorByTheme[theme],
      line: buyAndHoldLineStyle(kind === "baseline" ? "symbols" : "spy", index),
    };
    return { column, curve: curve ? { ...curve, label: samePeriod ? column.name : `${column.name} (${session.startDate} → ${session.endDate})` } : undefined };
  };
  const baselines = groupSessions(comparison.sessions, symbolsAndPeriodOf).map((group, index) => buyAndHoldColumn(group, "baseline", index));
  const spyBaselines = groupSessions(
    comparison.sessions.filter((session) => session.spyBaselineMetrics !== null),
    periodOf,
  ).map((group, index) => buyAndHoldColumn(group, "spy", index));

  const isCurve = (curve: BacktestCompareCurve | undefined): curve is BacktestCompareCurve => curve !== undefined;
  return {
    columns: [...sessionColumns, ...baselines.map((entry) => entry.column), ...spyBaselines.map((entry) => entry.column)],
    sessionCurves: comparison.sessions.map((session) => curveByKey.get(session.id)).filter(isCurve),
    baselineCurves: baselines.map((entry) => entry.curve).filter(isCurve),
    spyBaselineCurves: spyBaselines.map((entry) => entry.curve).filter(isCurve),
    singleGroup,
    hasSpy: spyBaselines.length > 0,
  };
}

// Compare (mockup approved 2026-10-12): the headline figures side by side with the best in each row shaded, and the account
// values overlaid, with buy and hold of the symbols and of SPY beside them (comparison only).
export function BacktestComparePage() {
  const [searchParams] = useSearchParams();
  const sessionIds = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const idsKey = sessionIds.join(",");
  const { theme } = useTheme();
  const [valueScale, setValueScale] = useBacktestValueScale();
  const [settingRows, setSettingRows] = useState<BacktestSettingRow[] | null>(null);

  const fetchComparison = useCallback(() => fetchBacktestComparison(idsKey.split(",")), [idsKey]);
  const neverActive = useCallback(() => null, []);
  const { data: comparison, loadError } = usePolledBacktestResource(fetchComparison, neverActive, "Could not load the comparison.");

  useEffect(() => {
    let cancelled = false;
    fetchBacktestSettingsTemplate()
      .then((template) => !cancelled && setSettingRows(template.rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const built = comparison ? buildCompareColumns(comparison, settingRows, theme) : null;
  const { isColumnVisible, toggleColumn } = useColumnVisibility("backtest-compare", built?.columns.map((column) => column.key) ?? []);

  if (sessionIds.length < 2) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} />
        <div className="alert alert-info mt-3">
          Tick two or more finished sessions on the <Link to="/backtest">Backtesting</Link> page, then Compare selected.
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} />
        <div className="alert alert-danger mt-3">{loadError}</div>
      </>
    );
  }

  if (!comparison || !built) {
    return (
      <>
        <BacktestBackLink />
        <PageHeader title={pageTitle} />
        <div className="d-flex justify-content-center py-5">
          <Spinner label="Loading the comparison" />
        </div>
      </>
    );
  }

  const visibleColumns = built.columns.filter((column) => isColumnVisible(column.key));
  const firstSession = comparison.sessions[0];
  const subtitle = built.singleGroup && firstSession ? `${describePeriodAndStart(firstSession)}. Same symbol, period and start for every column; the best figure in each row is shaded.` : "The best figure in each row is shaded.";

  return (
    <>
      <BacktestBackLink />
      <PageHeader title={pageTitle} subtitle={subtitle} />
      {!built.singleGroup && (
        <div className="iorio-note-amber mb-2" style={{ fontSize: "0.8rem" }}>
          These sessions differ in symbol, period or starting value, so their figures are not like for like.
        </div>
      )}

      <div className="card mb-3">
        <div className="table-responsive">
          <table className="table table-sm table-vcenter card-table mb-0 backtest-compare-table">
            <thead className="table-light">
              <tr>
                <th>
                  <span className="visually-hidden">Figure</span>
                </th>
                {visibleColumns.map((column, index) => (
                  <th key={column.key} className="text-end align-bottom" style={{ minWidth: "8.5rem", maxWidth: "14rem", textTransform: "none" }}>
                    <div className="d-flex align-items-center justify-content-end gap-1">
                      <BacktestSeriesSwatch color={column.color} line={column.line} />
                      <span className="text-body fw-semibold text-wrap">{column.name}</span>
                      {index === visibleColumns.length - 1 && (
                        <ColumnVisibilityPopover columns={built.columns.map((entry) => ({ key: entry.key, header: entry.name }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
                      )}
                    </div>
                    <div className="text-secondary fw-normal text-wrap" style={{ fontSize: "0.72rem", letterSpacing: "normal" }}>
                      {column.detail}
                    </div>
                  </th>
                ))}
                {visibleColumns.length === 0 && (
                  <th className="text-end">
                    <ColumnVisibilityPopover columns={built.columns.map((entry) => ({ key: entry.key, header: entry.name }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {compareMetricRows.map((row) => {
                const values = visibleColumns.map((column) => (column.metrics && !(row.tradesOnly && column.kind !== "session") ? row.value({ metrics: column.metrics, wheelCycles: column.wheelCycles }) : null));
                const best = bestValueIndex(values, row.better);
                return (
                  <tr key={row.key}>
                    <td className="text-secondary">
                      <DottedLabelTooltip label={row.label} tooltipHtml={escapeTooltipHtml(row.explanation)} />
                    </td>
                    {values.map((value, index) => {
                      const column = visibleColumns[index]!;
                      const note = value !== null && column.metrics && row.note ? row.note({ metrics: column.metrics, wheelCycles: column.wheelCycles }) : null;
                      return (
                        <td key={column.key} className={`text-end${index === best ? " backtest-best-cell" : ""}`}>
                          {row.format(value)}
                          {note && (
                            <div className="text-secondary" style={{ fontSize: "0.72rem" }}>
                              {note}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          {backtestMetricExplanation.symbolsBuyAndHold} {built.hasSpy ? backtestMetricExplanation.spyBuyAndHold : "Buy and hold of SPY: none of these sessions kept it (they were run before it was kept)."} A cycle win rate is 100% by construction (a cycle only closes in profit): the open cycles' count and P&L at the last marks show under it.
        </div>
      </div>

      <BacktestCard
        title="Account value"
        description="every trading day at 10:00 ET; buy and hold of the symbols (in the text colour) and of SPY (grey) are for comparison only"
        actions={<BacktestValueScaleSwitch scale={valueScale} onChange={setValueScale} />}
        className="mb-3"
      >
        <div className="card-body pt-2">
          <BacktestCompareChart scale={valueScale} sessionCurves={built.sessionCurves} baselineCurves={built.baselineCurves} spyBaselineCurves={built.spyBaselineCurves} />
        </div>
      </BacktestCard>
    </>
  );
}
