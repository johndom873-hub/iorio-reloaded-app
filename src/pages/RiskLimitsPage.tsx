import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
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
import { formatCurrency, formatPercentage } from "../lib/formatters";

const strategyTabs: { key: StrategyKey; label: string }[] = [
  { key: "covered_call", label: "Covered Calls" },
  { key: "cash_secured_put", label: "Cash-Secured Puts" },
];

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
}

function ConcentrationList({ title, rows, labelKey }: ConcentrationListProps) {
  const total = rows.reduce((sum, row) => sum + Number(row.notionalValue), 0);

  return (
    <div className="col-12 col-md-6">
      <h4 style={{ fontSize: "0.9rem" }}>{title}</h4>
      {rows.length === 0 ? (
        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
          No open positions yet.
        </div>
      ) : (
        <ul className="list-group list-group-flush">
          {rows.map((row) => (
            <li
              key={row[labelKey]}
              className="list-group-item d-flex justify-content-between align-items-center px-0"
            >
              <span>{row[labelKey]}</span>
              <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                {formatCurrency(Number(row.notionalValue))}
                {total > 0 && ` (${formatPercentage(Number(row.notionalValue) / total)})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  step?: string;
  onChange: (value: string) => void;
}

function NumberField({ label, value, step = "1", onChange }: NumberFieldProps) {
  return (
    <div className="col-12 col-sm-6 col-md-3">
      <label className="form-label" style={{ fontSize: "0.8rem" }}>
        {label}
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

              <div className="row">
                <ConcentrationList
                  title="Concentration by Ticker"
                  rows={exposure?.concentrationByTicker ?? []}
                  labelKey="symbol"
                />
                <ConcentrationList
                  title="Concentration by Sector"
                  rows={exposure?.concentrationBySector ?? []}
                  labelKey="sector"
                />
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

              <div className="row g-3">
                <NumberField
                  label="Delta target min"
                  value={formState.deltaTargetMin}
                  step="0.01"
                  onChange={(value) => updateField("deltaTargetMin", value)}
                />
                <NumberField
                  label="Delta target max"
                  value={formState.deltaTargetMax}
                  step="0.01"
                  onChange={(value) => updateField("deltaTargetMax", value)}
                />
                <NumberField
                  label="DTE target min"
                  value={formState.dteTargetMin}
                  onChange={(value) => updateField("dteTargetMin", value)}
                />
                <NumberField
                  label="DTE target max"
                  value={formState.dteTargetMax}
                  onChange={(value) => updateField("dteTargetMax", value)}
                />
                <NumberField
                  label="Max position % of portfolio"
                  value={formState.maxPositionPctOfPortfolio}
                  step="0.1"
                  onChange={(value) => updateField("maxPositionPctOfPortfolio", value)}
                />
                <NumberField
                  label="Max aggregate collateral %"
                  value={formState.maxAggregateCollateralPct}
                  step="0.1"
                  onChange={(value) => updateField("maxAggregateCollateralPct", value)}
                />
                <NumberField
                  label="Max concentration per ticker %"
                  value={formState.maxConcentrationPerTickerPct}
                  step="0.1"
                  onChange={(value) => updateField("maxConcentrationPerTickerPct", value)}
                />
                <NumberField
                  label="Max concentration per sector %"
                  value={formState.maxConcentrationPerSectorPct}
                  step="0.1"
                  onChange={(value) => updateField("maxConcentrationPerSectorPct", value)}
                />
                <NumberField
                  label="Min cash reserve %"
                  value={formState.minCashReservePct}
                  step="0.1"
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
    </>
  );
}
