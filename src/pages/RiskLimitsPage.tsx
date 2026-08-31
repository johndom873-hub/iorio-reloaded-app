import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { HelpTooltip } from "../components/HelpTooltip";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import {
  fetchExposure,
  fetchStrategySettings,
  updateStrategySettings,
  type ConcentrationRow,
  type ExposureData,
  type StrategySettings,
  type StrategySettingsInput,
} from "../api/riskLimits";
import type { StrategyKey } from "../api/screener";
import { formatCurrency, formatDateTime, formatPercentage, formatPercentageValue, formatRelativeTime } from "../lib/formatters";

const strategyTabs: { key: StrategyKey; label: string }[] = [
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

const strategyDescriptions: Record<StrategyKey, string> = {
  covered_call:
    "A covered call sells a call option against shares you already own. If the option is assigned, those shares are sold at the strike price and you keep the premium collected; if not, the option expires and you keep both the shares and the premium. The delta and DTE settings below control which call strikes and expirations the screener looks for: a lower delta targets strikes further above the current price (less likely to be assigned, smaller premium), and the DTE range sets how many days out those expirations can be.",
  cash_secured_put:
    "A cash-secured put sells a put option while holding enough cash to buy the shares if assigned. If the option is assigned, those shares are bought at the strike price using the reserved cash; if not, the option expires and you keep the premium. The delta and DTE settings below control which put strikes and expirations the screener looks for: a lower delta targets strikes further below the current price (less likely to be assigned, smaller premium), and the DTE range sets how many days out those expirations can be.",
};

interface SettingsFormState {
  deltaTargetMin: string;
  deltaTargetMax: string;
  dteTargetMin: string;
  dteTargetMax: string;
  maxPositionPctOfPortfolio: string;
  maxAggregateCollateralPct: string;
  maxConcentrationPerTickerPct: string;
  maxConcentrationPerSectorPct: string;
  minCashReservePct: string;
}

function toFormState(settings: StrategySettings): SettingsFormState {
  return {
    deltaTargetMin: settings.deltaTargetMin,
    deltaTargetMax: settings.deltaTargetMax,
    dteTargetMin: String(settings.dteTargetMin),
    dteTargetMax: String(settings.dteTargetMax),
    maxPositionPctOfPortfolio: settings.maxPositionPctOfPortfolio,
    maxAggregateCollateralPct: settings.maxAggregateCollateralPct,
    maxConcentrationPerTickerPct: settings.maxConcentrationPerTickerPct,
    maxConcentrationPerSectorPct: settings.maxConcentrationPerSectorPct,
    minCashReservePct: settings.minCashReservePct,
  };
}

function toUpdateInput(form: SettingsFormState): StrategySettingsInput {
  return {
    deltaTargetMin: Number(form.deltaTargetMin),
    deltaTargetMax: Number(form.deltaTargetMax),
    dteTargetMin: Number(form.dteTargetMin),
    dteTargetMax: Number(form.dteTargetMax),
    maxPositionPctOfPortfolio: Number(form.maxPositionPctOfPortfolio),
    maxAggregateCollateralPct: Number(form.maxAggregateCollateralPct),
    maxConcentrationPerTickerPct: Number(form.maxConcentrationPerTickerPct),
    maxConcentrationPerSectorPct: Number(form.maxConcentrationPerSectorPct),
    minCashReservePct: Number(form.minCashReservePct),
  };
}

interface ConcentrationListProps {
  title: string;
  rows: ConcentrationRow[];
  labelKey: "symbol" | "sector";
  totalAccountValue: number | null;
  // Currently-selected strategy tab's configured ceiling, as a 0-100
  // percentage — the concentration figures themselves are account-wide
  // (not per-strategy), but the limit setting is stored per-strategy, so
  // the warning compares against whichever tab is active below.
  limitPct: number | null;
  unallocatedLabel: string;
  /** Only meaningful for labelKey="symbol" — a sector name isn't a tradable ticker. */
  onSymbolClick?: (symbol: string) => void;
}

function ConcentrationList({ title, rows, labelKey, totalAccountValue, limitPct, unallocatedLabel, onSymbolClick }: ConcentrationListProps) {
  return (
    <div className="col-12 col-md-6">
      <h4 style={{ fontSize: "0.9rem" }}>{title}</h4>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
          No open positions yet.
        </div>
      ) : (
        <ul className="list-group list-group-flush">
          {rows.map((row) => {
            const label = row[labelKey] ?? "";
            const isUnallocated = label === unallocatedLabel;
            const fraction = totalAccountValue ? Number(row.notionalValue) / totalAccountValue : null;
            const isOverLimit = !isUnallocated && fraction !== null && limitPct !== null && fraction * 100 > limitPct;
            return (
              <li key={label} className="list-group-item d-flex justify-content-between align-items-center px-0">
                {labelKey === "symbol" && !isUnallocated && onSymbolClick ? (
                  <button type="button" className="btn btn-link p-0 text-decoration-none fw-bold" onClick={() => onSymbolClick(label)}>
                    {label}
                  </button>
                ) : (
                  <span className={isUnallocated ? "text-muted" : ""}>{label}</span>
                )}
                <span className="d-flex align-items-center gap-2">
                  {isOverLimit && (
                    <span className="badge bg-danger-lt text-nowrap" title={`Over the ${formatPercentageValue(limitPct)} limit for the selected strategy`}>
                      over limit
                    </span>
                  )}
                  <span className={isOverLimit ? "text-danger" : "text-muted"} style={{ fontSize: "0.8rem" }}>
                    {formatCurrency(Number(row.notionalValue), 0)}
                    {fraction !== null && ` (${formatPercentage(fraction)})`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  step?: string;
  help: string;
  onChange: (value: string) => void;
}

function NumberField({ label, value, step = "1", help, onChange }: NumberFieldProps) {
  return (
    <div className="col-12 col-sm-6 col-md-3">
      <label className="form-label d-inline-flex align-items-center" style={{ fontSize: "0.8rem" }}>
        {label}
        <HelpTooltip text={help} />
      </label>
      <input
        type="number"
        className="form-control"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function RiskLimitsPage() {
  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  const [exposureError, setExposureError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<StrategyKey>("covered_call");
  const [allSettings, setAllSettings] = useState<StrategySettings[]>([]);
  const [formState, setFormState] = useState<SettingsFormState | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  useEffect(() => {
    fetchExposure()
      .then(setExposure)
      .catch((err) => setExposureError(err instanceof ApiError ? err.message : "Failed to load account exposure."))
      .finally(() => setExposureLoading(false));
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettingsError(null);
      const rows = await fetchStrategySettings();
      setAllSettings(rows);
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : "Failed to load strategy settings.");
    }
  }, []);

  useEffect(() => {
    setSettingsLoading(true);
    loadSettings().finally(() => setSettingsLoading(false));
  }, [loadSettings]);

  useEffect(() => {
    const current = allSettings.find((row) => row.strategyKey === strategy);
    setFormState(current ? toFormState(current) : null);
    setSaveError(null);
  }, [allSettings, strategy]);

  function updateField(field: keyof SettingsFormState, value: string) {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSave() {
    if (!formState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateStrategySettings(strategy, toUpdateInput(formState));
      setAllSettings((prev) => prev.map((row) => (row.strategyKey === strategy ? updated : row)));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Risk & Limits" subtitle="Current exposure and per-strategy trade thresholds" />

      <div className="card mb-3">
        <div className="card-body">
          <h3 className="card-title" style={{ fontSize: "1rem" }}>
            Account Exposure
          </h3>

          {exposureLoading ? (
            <Spinner size="sm" label="Loading exposure" />
          ) : (
            <>
              {exposureError && <div className="alert alert-danger">{exposureError}</div>}
              {exposure?.accountDataError && (
                <div className="alert alert-warning">
                  Live account data unavailable: {exposure.accountDataError}
                </div>
              )}

              <div className="row mb-3">
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                    Net Liquidation Value
                  </div>
                  <div className="fw-bold">{formatCurrency(exposure?.account?.netLiquidationValue ?? null)}</div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                    Buying Power
                  </div>
                  <div className="fw-bold">{formatCurrency(exposure?.account?.buyingPower ?? null)}</div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                    Total Cash Value
                  </div>
                  <div className="fw-bold">{formatCurrency(exposure?.account?.totalCashValue ?? null)}</div>
                </div>
                <div className="col-12 col-sm-6 col-md-3">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                    Gross Position Value
                  </div>
                  <div className="fw-bold">{formatCurrency(exposure?.account?.grossPositionValue ?? null)}</div>
                </div>
              </div>

              <div className="row g-3">
                <ConcentrationList
                  title="Concentration by Ticker"
                  rows={exposure?.concentrationByTicker ?? []}
                  labelKey="symbol"
                  totalAccountValue={exposure?.totalAccountValue ?? null}
                  limitPct={formState ? Number(formState.maxConcentrationPerTickerPct) : null}
                  unallocatedLabel="Unallocated"
                  onSymbolClick={setDetailSymbol}
                />
                <ConcentrationList
                  title="Concentration by Sector"
                  // Unallocated (cash) dropped from this list per request —
                  // every other row's % stays computed against
                  // totalAccountValue regardless (see ConcentrationList's
                  // fraction calc below), so removing it doesn't inflate
                  // the remaining sectors' percentages.
                  rows={(exposure?.concentrationBySector ?? []).filter((row) => row.sector !== "Unallocated")}
                  labelKey="sector"
                  totalAccountValue={exposure?.totalAccountValue ?? null}
                  limitPct={formState ? Number(formState.maxConcentrationPerSectorPct) : null}
                  unallocatedLabel="Unallocated"
                />
              </div>
              <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>
                % of total account value (net liquidation value, including cash). "over limit" compares against the {strategyTabs.find((t) => t.key === strategy)?.label} tab's configured limit below.
              </div>
            </>
          )}
        </div>
      </div>

      <ul className="nav nav-tabs mb-3">
        {strategyTabs.map((tabOption) => (
          <li className="nav-item" key={tabOption.key}>
            <button
              type="button"
              className={`nav-link ${strategy === tabOption.key ? "active" : ""}`}
              onClick={() => setStrategy(tabOption.key)}
            >
              {tabOption.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="card">
        <div className="card-body">
          {settingsLoading ? (
            <Spinner size="sm" label="Loading settings" />
          ) : settingsError ? (
            <div className="alert alert-danger">{settingsError}</div>
          ) : !formState ? (
            <div className="text-muted">No settings row found for this strategy.</div>
          ) : (
            <>
              {saveError && <div className="alert alert-danger">{saveError}</div>}

              <p className="text-muted mb-1" style={{ fontSize: "0.85rem" }}>
                {strategyDescriptions[strategy]}
              </p>
              {(() => {
                const current = allSettings.find((row) => row.strategyKey === strategy);
                if (!current?.updatedByDisplayName) return null;
                const relative = formatRelativeTime(current.updatedAt);
                return (
                  <p className="text-secondary mb-3" style={{ fontSize: "0.72rem" }}>
                    Last updated by {current.updatedByDisplayName}, {relative ?? formatDateTime(current.updatedAt)}
                  </p>
                );
              })()}

              <div className="row g-3">
                <NumberField
                  label="Delta target min"
                  value={formState.deltaTargetMin}
                  step="0.01"
                  help="Lowest option delta (absolute value) the screener will consider when picking strikes. Lower = further out-of-the-money, lower assignment risk."
                  onChange={(value) => updateField("deltaTargetMin", value)}
                />
                <NumberField
                  label="Delta target max"
                  value={formState.deltaTargetMax}
                  step="0.01"
                  help="Highest option delta (absolute value) the screener will consider. Higher = closer to the money, more premium, more assignment risk."
                  onChange={(value) => updateField("deltaTargetMax", value)}
                />
                <NumberField
                  label="DTE target min"
                  value={formState.dteTargetMin}
                  help="Fewest days to expiration the screener will look at when generating trade alerts."
                  onChange={(value) => updateField("dteTargetMin", value)}
                />
                <NumberField
                  label="DTE target max"
                  value={formState.dteTargetMax}
                  help="Most days to expiration the screener will look at when generating trade alerts."
                  onChange={(value) => updateField("dteTargetMax", value)}
                />
                <NumberField
                  label="Max position % of portfolio"
                  value={formState.maxPositionPctOfPortfolio}
                  step="0.1"
                  help="Target ceiling on how large a single position can be, as % of total portfolio value. Not yet auto-enforced — reference only."
                  onChange={(value) => updateField("maxPositionPctOfPortfolio", value)}
                />
                <NumberField
                  label="Max aggregate collateral %"
                  value={formState.maxAggregateCollateralPct}
                  step="0.1"
                  help="Target ceiling on total collateral tied up across all open positions in this strategy, as % of portfolio. Not yet auto-enforced."
                  onChange={(value) => updateField("maxAggregateCollateralPct", value)}
                />
                <NumberField
                  label="Max concentration per ticker %"
                  value={formState.maxConcentrationPerTickerPct}
                  step="0.1"
                  help="Target ceiling on how much of the portfolio (by notional value) can sit in one ticker. Shown for reference against the Concentration by Ticker table above; not yet auto-enforced."
                  onChange={(value) => updateField("maxConcentrationPerTickerPct", value)}
                />
                <NumberField
                  label="Max concentration per sector %"
                  value={formState.maxConcentrationPerSectorPct}
                  step="0.1"
                  help="Target ceiling on how much of the portfolio (by notional value) can sit in one sector. Shown for reference against the Concentration by Sector table above; not yet auto-enforced."
                  onChange={(value) => updateField("maxConcentrationPerSectorPct", value)}
                />
                <NumberField
                  label="Min cash reserve %"
                  value={formState.minCashReservePct}
                  step="0.1"
                  help="Target floor on how much of the portfolio should stay as uncommitted cash. Not yet auto-enforced."
                  onChange={(value) => updateField("minCashReservePct", value)}
                />
              </div>

              <button
                type="button"
                className="btn btn-primary mt-3 d-inline-flex align-items-center gap-1"
                disabled={saving}
                onClick={handleSave}
              >
                {saving && <Spinner size="sm" />}
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
