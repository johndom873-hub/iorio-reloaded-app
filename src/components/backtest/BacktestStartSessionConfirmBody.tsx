import type { BacktestSettingsSource, BacktestSymbolResolution, BacktestSymbolSettingSource, BacktestTablesMode, BacktestTickerValueKey } from "../../api/backtest";
import { formatCurrency, formatPercentage, pluralize } from "../../lib/formatters";
import {
  backtestValueSourceBadgeClass,
  backtestValueSourceLabel,
  backtestValueSourceTitle,
  describeTickerValueGroup,
  mostSpecificValueSource,
  tablesModeLabel,
  tickerValueGroupKeys,
  type BacktestTickerValueGroup,
} from "../../lib/backtestPresentation";
import type { BacktestCapitalMode, BacktestTickerResolution } from "../../lib/backtestTickerValueEdits";
import { Spinner } from "../Spinner";

const groups: { group: BacktestTickerValueGroup; header: string }[] = [
  { group: "share", header: "Share level" },
  { group: "rungs", header: "Rungs" },
  { group: "shock", header: "Shock" },
  { group: "delta", header: "|delta| range" },
];

const settingsSourceFact: Record<BacktestSettingsSource, { label: string; note: string }> = {
  per_ticker: { label: "Per ticker", note: "each ticker's lab values where it has them" },
  global: { label: "Global", note: "the lab's global values for every ticker" },
};

export interface BacktestStartSessionConfirmBodyProps {
  name: string;
  startDate: string;
  endDate: string;
  /** "whole years 2021 to 2026", or "custom dates". */
  periodNote: string;
  decisionMakerLabel: string;
  /** The Baseline deciding: per-ticker pots, the Ticker values choice and the Each ticker table. */
  perTickerPots: boolean;
  capitalMode: BacktestCapitalMode;
  /** The one starting value (the rules, the AI model, or split equally). */
  startingValue: number;
  symbolCount: number;
  settingsSource: BacktestSettingsSource;
  tablesMode: BacktestTablesMode;
  /** The estimate of exactly this request; null while it is being worked out. */
  resolution: BacktestTickerResolution | null;
  estimatePending: boolean;
  estimateError: string | null;
  /** The settings changed for the whole session, as sentences. */
  changes: string[];
  warnings: string[];
  /** What stops the session from starting (each ticker's problems); Start session is off while there are any. */
  problems: string[];
}

function SourceBadge({ source }: { source: BacktestSymbolSettingSource | null }) {
  if (!source) return null;
  return (
    <span className={`badge ${backtestValueSourceBadgeClass[source]}`} title={backtestValueSourceTitle[source]}>
      {backtestValueSourceLabel[source]}
    </span>
  );
}

function valuesOf(resolution: BacktestSymbolResolution): Partial<Record<BacktestTickerValueKey, number | string | null>> {
  return { potDollars: resolution.potDollars, ...resolution.baseline };
}

function groupSource(resolution: BacktestSymbolResolution, group: BacktestTickerValueGroup): BacktestSymbolSettingSource | null {
  return mostSpecificValueSource(tickerValueGroupKeys(group, resolution.baseline.ladderShock).map((key) => resolution.source[key]));
}

/** The Start session confirmation (mockup approved 2026-10-15, D11/D12): the session's facts, each ticker's values with the
 *  Baseline deciding, what changed for the whole session, and the estimate's warnings. */
export function BacktestStartSessionConfirmBody(props: BacktestStartSessionConfirmBodyProps) {
  const { name, startDate, endDate, periodNote, decisionMakerLabel, perTickerPots, capitalMode, startingValue, symbolCount, settingsSource, tablesMode, resolution, estimatePending, estimateError, changes, warnings, problems } = props;
  const capital = perTickerPots ? (resolution?.capital ?? null) : startingValue;
  const capitalNote = !perTickerPots
    ? "one starting value"
    : capitalMode === "split"
      ? `split equally, ${formatCurrency(capital === null ? null : capital / Math.max(1, symbolCount), 0)} each`
      : `the sum of ${pluralize(symbolCount, "pot")}`;
  const symbols = resolution ? Object.keys(resolution.bySymbol).sort() : [];
  const tablesText = tablesModeLabel[tablesMode];

  return (
    <div>
      <dl className="backtest-confirm-facts">
        <dt>Name</dt>
        <dd>{name}</dd>
        <dt>Period</dt>
        <dd>
          <span className="font-mono">
            {startDate} → {endDate}
          </span>{" "}
          <span className="text-secondary">· {periodNote}</span>
        </dd>
        <dt>Decision maker</dt>
        <dd>{decisionMakerLabel}</dd>
        <dt>Capital</dt>
        <dd>
          {capital === null && estimatePending ? (
            <Spinner size="sm" label="Working out the capital" />
          ) : (
            <>
              <span className="font-mono">{formatCurrency(capital, 0)}</span>
              <span className="text-secondary"> · {capitalNote}</span>
            </>
          )}
        </dd>
        {perTickerPots && (
          <>
            <dt>Ticker values</dt>
            <dd>
              {settingsSourceFact[settingsSource].label} <span className="text-secondary">· {settingsSourceFact[settingsSource].note}</span>
            </dd>
          </>
        )}
        <dt>History tables</dt>
        <dd>{tablesText.charAt(0).toUpperCase() + tablesText.slice(1)}</dd>
      </dl>

      {perTickerPots && (
        <>
          <h4 className="subheader mb-2">Each ticker</h4>
          {resolution ? (
            <div className="table-responsive mb-3">
              <table className="table table-sm table-vcenter mb-0 backtest-confirm-table">
                <thead className="table-light">
                  <tr>
                    <th>Ticker</th>
                    <th>Pot $</th>
                    <th className="text-end">Weight</th>
                    {groups.map(({ group, header }) => (
                      <th key={group}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((symbol) => {
                    const ticker = resolution.bySymbol[symbol]!;
                    const cell = (group: BacktestTickerValueGroup) => (
                      <td key={group}>
                        <div className="backtest-confirm-value">
                          <span className="font-mono text-nowrap">{describeTickerValueGroup(group, valuesOf(ticker))}</span>
                          <SourceBadge source={groupSource(ticker, group)} />
                        </div>
                      </td>
                    );
                    return (
                      <tr key={symbol}>
                        <td className="fw-semibold">{symbol}</td>
                        {cell("pot")}
                        <td className="text-end">{formatPercentage(ticker.weight, 1)}</td>
                        {groups.map(({ group }) => cell(group))}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="table-totals-row">
                  <tr>
                    <td>Capital</td>
                    <td className="font-mono">{formatCurrency(resolution.capital, 0)}</td>
                    <td className="text-end">{resolution.capital !== null ? "100%" : "—"}</td>
                    <td colSpan={groups.length} className="text-secondary backtest-ticker-totals-note">
                      turn order {symbols.join(", ")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : estimatePending ? (
            <div className="mb-3">
              <Spinner size="sm" label="Working out each ticker's values" />
            </div>
          ) : null}
        </>
      )}

      <h4 className="subheader mb-2">Changed for the whole session</h4>
      {changes.length > 0 ? (
        <ul className="mb-3 ps-3" style={{ fontSize: "0.85rem" }}>
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : (
        <p className="text-secondary mb-3" style={{ fontSize: "0.85rem" }}>
          Nothing: the lab's settings as they are now.
        </p>
      )}

      {problems.length > 0 && (
        <div className="alert alert-danger" role="alert">
          <ul className="mb-0 ps-3">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {estimateError && (
        <div className="backtest-ticker-problem mb-2" style={{ fontSize: "0.8rem" }}>
          {estimateError}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mb-0 ps-3 iorio-note-amber" style={{ fontSize: "0.8rem" }}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
