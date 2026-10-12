import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchBacktestComparison, fetchBacktestSettingsTemplate, type BacktestCompareCurve, type BacktestCompareResponse, type BacktestMetrics, type BacktestSettingRow } from "../../api/backtest";
import { ColumnVisibilityPopover } from "../../components/DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../../components/DataTable/useColumnVisibility";
import { DottedLabelTooltip } from "../../components/HelpTooltip";
import { PageHeader } from "../../components/layout/PageHeader";
import { Spinner } from "../../components/Spinner";
import { BacktestBackLink, BacktestCard } from "../../components/backtest/backtestBits";
import { BacktestCompareChart } from "../../components/backtest/BacktestCharts";
import { usePolledBacktestResource } from "../../components/backtest/useBacktestPolling";
import { useTheme } from "../../contexts/ThemeContext";
import { formatCurrency } from "../../lib/formatters";
import { backtestMetricExplanation, backtestSeriesColorsByTheme, bestValueIndex, buyAndHoldColorByTheme, compareMetricRows, describeOverrideChanges } from "../../lib/backtestPresentation";
import { escapeTooltipHtml } from "../../lib/signalsPresentation";

const pageTitle = "Compare";

interface CompareColumn {
  key: string;
  name: string;
  detail: string;
  metrics: BacktestMetrics | null;
  isBaseline: boolean;
  color: string;
}

function describePeriodAndStart(session: { symbol: string; startDate: string; endDate: string; startingValue: number }): string {
  return `${session.symbol} · ${session.startDate} → ${session.endDate} · ${formatCurrency(session.startingValue, 0)} start`;
}

/** Sessions, then one buy-and-hold column per distinct symbol, period and start (the same baseline for sessions that share them). */
function buildCompareColumns(comparison: BacktestCompareResponse, settingRows: BacktestSettingRow[] | null, theme: "light" | "dark") {
  const palette = backtestSeriesColorsByTheme[theme];
  const sessionColumns: CompareColumn[] = comparison.sessions.map((session, index) => {
    const changes = describeOverrideChanges(session.overrides, null, settingRows);
    return { key: session.id, name: session.name, detail: changes.length === 0 ? "no changes" : changes.join(" · "), metrics: session.metrics, isBaseline: false, color: palette[index % palette.length]! };
  });
  const baselineGroups = new Map<string, (typeof comparison.sessions)[number]>();
  for (const session of comparison.sessions) {
    const groupKey = `${session.symbol}|${session.startDate}|${session.endDate}|${session.startingValue}`;
    if (!baselineGroups.has(groupKey)) baselineGroups.set(groupKey, session);
  }
  const singleGroup = baselineGroups.size === 1;
  const baselineColumns: CompareColumn[] = [...baselineGroups.values()].map((session) => ({
    key: `baseline:${session.id}`,
    name: `Buy and hold ${session.symbol}`,
    detail: singleGroup ? "baseline" : `baseline · ${session.startDate} → ${session.endDate}`,
    metrics: session.baselineMetrics,
    isBaseline: true,
    color: buyAndHoldColorByTheme[theme],
  }));
  const curveByKey = new Map(comparison.curves.map((curve) => [curve.key, curve]));
  const sessionCurves = comparison.sessions.map((session) => curveByKey.get(session.id)).filter((curve): curve is BacktestCompareCurve => curve !== undefined);
  const baselineCurves = baselineColumns
    .map((column) => {
      const curve = curveByKey.get(column.key);
      return curve ? { ...curve, label: column.detail === "baseline" ? column.name : `${column.name} (${column.detail.replace("baseline · ", "")})` } : undefined;
    })
    .filter((curve): curve is BacktestCompareCurve => curve !== undefined);
  return { columns: [...sessionColumns, ...baselineColumns], sessionCurves, baselineCurves, singleGroup };
}

function SeriesSwatch({ color, dashed }: { color: string; dashed: boolean }) {
  return <span aria-hidden="true" className="d-inline-block flex-shrink-0" style={{ width: "1rem", height: 0, borderTop: `3px ${dashed ? "dashed" : "solid"} ${color}` }} />;
}

// Compare (mockup approved 2026-10-12): the headline figures side by side with the best in each row shaded, and the account
// values overlaid. Buy and hold is the only baseline.
export function BacktestComparePage() {
  const [searchParams] = useSearchParams();
  const sessionIds = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const idsKey = sessionIds.join(",");
  const { theme } = useTheme();
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
                  <th key={column.key} className="text-end align-bottom" style={{ minWidth: "8.5rem", textTransform: "none" }}>
                    <div className="d-flex align-items-center justify-content-end gap-1">
                      <SeriesSwatch color={column.color} dashed={column.isBaseline} />
                      <span className="text-body fw-semibold">{column.name}</span>
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
                const values = visibleColumns.map((column) => (column.metrics && !(row.tradesOnly && column.isBaseline) ? row.value(column.metrics) : null));
                const best = bestValueIndex(values, row.better);
                return (
                  <tr key={row.key}>
                    <td className="text-secondary">
                      <DottedLabelTooltip label={row.label} tooltipHtml={escapeTooltipHtml(row.explanation)} />
                    </td>
                    {values.map((value, index) => (
                      <td key={visibleColumns[index]!.key} className={`text-end${index === best ? " backtest-best-cell" : ""}`}>
                        {row.format(value)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-footer text-secondary" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
          {backtestMetricExplanation.buyAndHold}
        </div>
      </div>

      <BacktestCard title="Account value" description="every trading day at 10:00 ET" className="mb-3">
        <div className="card-body pt-2">
          <BacktestCompareChart sessionCurves={built.sessionCurves} baselineCurves={built.baselineCurves} />
        </div>
      </BacktestCard>
    </>
  );
}
