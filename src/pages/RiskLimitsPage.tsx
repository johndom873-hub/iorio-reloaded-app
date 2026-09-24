import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { HelpTooltip } from "../components/HelpTooltip";
import { TooltipSpan } from "../components/TooltipSpan";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import {
  fetchStrategySettings,
  updateStrategySettings,
  type ConcentrationRow,
  type StrategySettings,
  type StrategySettingsInput,
} from "../api/riskLimits";
import { fetchSignalSettings, updateSignalSettings, type SignalSettings, type SignalSettingsInput } from "../api/signalSettings";
import type { StrategyKey } from "../api/strategy";
import { formatCurrency, formatDateTime, formatPercentage, formatPercentageValue, formatRelativeTime } from "../lib/formatters";
import { useExposureStream } from "../hooks/useExposureStream";
import { useTickerDetailSymbol } from "../hooks/useTickerDetailSymbol";

const strategyKeys: StrategyKey[] = ["covered_call", "cash_secured_put"];

const pageTabs: { key: "trade-alerts" | "signals"; label: string }[] = [
  { key: "trade-alerts", label: "Trade Alerts" },
  { key: "signals", label: "Signals" },
];

// Covered calls and cash-secured puts share one set of thresholds (decided with
// Marcelo 2026-09-24 — a single form now writes the same values to both
// strategy_settings rows) — the only per-strategy difference left is the
// covered-call "existing position" delta override below.
const tradeAlertsDescription =
  "Trade alerts scan for covered calls (selling a call against shares you already own) and cash-secured puts (selling a put backed by cash to buy the shares if assigned), using the same delta and DTE targets below for both. A lower delta targets strikes further from the current price (less likely to be assigned, smaller premium), and the DTE range sets how many days out those expirations can be.";

interface SettingsFormState {
  deltaTargetMin: string;
  deltaTargetMax: string;
  // covered_call only — "" for cash_secured_put, which has no fields for these.
  deltaTargetMinExistingPosition: string;
  deltaTargetMaxExistingPosition: string;
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
    deltaTargetMinExistingPosition: settings.deltaTargetMinExistingPosition ?? "",
    deltaTargetMaxExistingPosition: settings.deltaTargetMaxExistingPosition ?? "",
    dteTargetMin: String(settings.dteTargetMin),
    dteTargetMax: String(settings.dteTargetMax),
    maxPositionPctOfPortfolio: String(Math.round(Number(settings.maxPositionPctOfPortfolio))),
    maxAggregateCollateralPct: String(Math.round(Number(settings.maxAggregateCollateralPct))),
    maxConcentrationPerTickerPct: String(Math.round(Number(settings.maxConcentrationPerTickerPct))),
    maxConcentrationPerSectorPct: String(Math.round(Number(settings.maxConcentrationPerSectorPct))),
    minCashReservePct: String(Math.round(Number(settings.minCashReservePct))),
  };
}

function toUpdateInput(form: SettingsFormState, strategy: StrategyKey): StrategySettingsInput {
  return {
    deltaTargetMin: Number(form.deltaTargetMin),
    deltaTargetMax: Number(form.deltaTargetMax),
    ...(strategy === "covered_call" && {
      deltaTargetMinExistingPosition: Number(form.deltaTargetMinExistingPosition),
      deltaTargetMaxExistingPosition: Number(form.deltaTargetMaxExistingPosition),
    }),
    dteTargetMin: Number(form.dteTargetMin),
    dteTargetMax: Number(form.dteTargetMax),
    maxPositionPctOfPortfolio: Number(form.maxPositionPctOfPortfolio),
    maxAggregateCollateralPct: Number(form.maxAggregateCollateralPct),
    maxConcentrationPerTickerPct: Number(form.maxConcentrationPerTickerPct),
    maxConcentrationPerSectorPct: Number(form.maxConcentrationPerSectorPct),
    minCashReservePct: Number(form.minCashReservePct),
  };
}

interface SignalSettingsFormState {
  maxDeltaDriftPct: string;
  minAnnualizedYieldPct: string;
  maxNetDelta: string;
  maxPositionPctOfPortfolio: string;
  maxConcentrationPerTickerPct: string;
  minCashReservePct: string;
}

function toSignalFormState(settings: SignalSettings): SignalSettingsFormState {
  return {
    maxDeltaDriftPct: String(Math.round(Number(settings.maxDeltaDriftPct))),
    minAnnualizedYieldPct: String(Math.round(Number(settings.minAnnualizedYieldPct))),
    maxNetDelta: settings.maxNetDelta,
    maxPositionPctOfPortfolio: String(Math.round(Number(settings.maxPositionPctOfPortfolio))),
    maxConcentrationPerTickerPct: String(Math.round(Number(settings.maxConcentrationPerTickerPct))),
    minCashReservePct: String(Math.round(Number(settings.minCashReservePct))),
  };
}

function toSignalUpdateInput(form: SignalSettingsFormState): SignalSettingsInput {
  return {
    maxDeltaDriftPct: Number(form.maxDeltaDriftPct),
    minAnnualizedYieldPct: Number(form.minAnnualizedYieldPct),
    maxNetDelta: Number(form.maxNetDelta),
    maxPositionPctOfPortfolio: Number(form.maxPositionPctOfPortfolio),
    maxConcentrationPerTickerPct: Number(form.maxConcentrationPerTickerPct),
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
                    <TooltipSpan className="badge bg-danger-lt text-nowrap" text={`Over the ${formatPercentageValue(limitPct)} limit for the selected strategy`}>
                      over limit
                    </TooltipSpan>
                  )}
                  <span className={isOverLimit ? "text-danger" : ""} style={{ fontSize: "0.8rem" }}>
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
  /** Shown under the input, for a setting that is stored but not yet enforced. */
  note?: string;
  onChange: (value: string) => void;
}

function NumberField({ label, value, step = "1", help, note, onChange }: NumberFieldProps) {
  return (
    <div className="col">
      <label className="form-label d-inline-flex align-items-center" style={{ fontSize: "0.8rem" }}>
        {label}
        <HelpTooltip text={help} />
      </label>
      <input
        type="number"
        className="form-control"
        style={{ maxWidth: "9rem" }}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {note && (
        <div className="mt-1 iorio-note-amber" style={{ fontSize: "0.75rem" }}>
          {note}
        </div>
      )}
    </div>
  );
}

export function RiskLimitsPage() {
  const { exposure, loading: exposureLoading, error: exposureError } = useExposureStream("Failed to load account exposure.");

  const [pageTab, setPageTab] = useState<"trade-alerts" | "signals">("trade-alerts");
  const [allSettings, setAllSettings] = useState<StrategySettings[]>([]);
  const [formState, setFormState] = useState<SettingsFormState | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailSymbol, setDetailSymbol] = useTickerDetailSymbol();

  const [signalSettings, setSignalSettings] = useState<SignalSettings | null>(null);
  const [signalFormState, setSignalFormState] = useState<SignalSettingsFormState | null>(null);
  const [signalSettingsLoading, setSignalSettingsLoading] = useState(true);
  const [signalSettingsError, setSignalSettingsError] = useState<string | null>(null);
  const [signalSaveError, setSignalSaveError] = useState<string | null>(null);
  const [signalSaving, setSignalSaving] = useState(false);

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
    // covered_call carries the superset of fields (it's the one with the existing-position
    // override), so it's the seed for the shared form; cash_secured_put is a fallback only
    // for a brand-new account where covered_call's row hasn't been created yet.
    const current = allSettings.find((row) => row.strategyKey === "covered_call") ?? allSettings.find((row) => row.strategyKey === "cash_secured_put");
    setFormState(current ? toFormState(current) : null);
    setSaveError(null);
  }, [allSettings]);

  function updateField(field: keyof SettingsFormState, value: string) {
    setFormState((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  const loadSignalSettings = useCallback(async () => {
    try {
      setSignalSettingsError(null);
      const settings = await fetchSignalSettings();
      setSignalSettings(settings);
      setSignalFormState(settings ? toSignalFormState(settings) : null);
    } catch (err) {
      setSignalSettingsError(err instanceof ApiError ? err.message : "Failed to load signal settings.");
    }
  }, []);

  useEffect(() => {
    setSignalSettingsLoading(true);
    loadSignalSettings().finally(() => setSignalSettingsLoading(false));
  }, [loadSignalSettings]);

  function updateSignalField(field: keyof SignalSettingsFormState, value: string) {
    setSignalFormState((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSignalSave() {
    if (!signalFormState) return;
    setSignalSaving(true);
    setSignalSaveError(null);
    try {
      const updated = await updateSignalSettings(toSignalUpdateInput(signalFormState));
      setSignalSettings(updated);
    } catch (err) {
      setSignalSaveError(err instanceof ApiError ? err.message : "Failed to save signal settings.");
    } finally {
      setSignalSaving(false);
    }
  }

  async function handleSave() {
    if (!formState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await Promise.all(strategyKeys.map((key) => updateStrategySettings(key, toUpdateInput(formState, key))));
      setAllSettings((prev) => prev.map((row) => updated.find((updatedRow) => updatedRow.strategyKey === row.strategyKey) ?? row));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Risk & Limits" subtitle="Current exposure and per-strategy trade thresholds" />

      <CollapsibleCard title="Account Exposure" storageKey="risk-limits-account-exposure" className="mb-3">
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
                <div className="fw-bold">{formatCurrency(exposure?.account?.netLiquidationValue ?? null, 0)}</div>
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                  Total Cash
                </div>
                <div className="fw-bold">{formatCurrency(exposure?.account?.totalCashValue ?? null, 0)}</div>
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                  Available Cash
                </div>
                <div className="fw-bold">{formatCurrency(exposure?.availableCash ?? null, 0)}</div>
              </div>
              <div className="col-12 col-sm-6 col-md-3">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                  Gross Position Value
                </div>
                <div className="fw-bold">{formatCurrency(exposure?.account?.grossPositionValue ?? null, 0)}</div>
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
              % of total account value (net liquidation value, including cash). "over limit" compares against the Trade Alerts tab's configured limit below.
            </div>
          </>
        )}
      </CollapsibleCard>

      <ul className="nav nav-tabs mb-3">
        {pageTabs.map((tabOption) => (
          <li className="nav-item" key={tabOption.key}>
            <button
              type="button"
              className={`nav-link ${pageTab === tabOption.key ? "active" : ""}`}
              onClick={() => setPageTab(tabOption.key)}
            >
              {tabOption.label}
            </button>
          </li>
        ))}
      </ul>

      {pageTab === "trade-alerts" && (
      <div className="card">
        <div className="card-body">
          {settingsLoading ? (
            <Spinner size="sm" label="Loading settings" />
          ) : settingsError ? (
            <div className="alert alert-danger">{settingsError}</div>
          ) : !formState ? (
            <div className="text-muted">No settings row found.</div>
          ) : (
            <>
              {saveError && <div className="alert alert-danger">{saveError}</div>}

              <p className="text-muted mb-1" style={{ fontSize: "0.85rem" }}>
                {tradeAlertsDescription}
              </p>
              {(() => {
                // Both strategy rows are always written together (see handleSave), so they
                // should carry the same timestamp/author -- the max() here is just a safety
                // net against the rare case where they've drifted (e.g. a direct DB edit).
                const mostRecent = allSettings.reduce<StrategySettings | null>(
                  (latest, row) => (!latest || row.updatedAt > latest.updatedAt ? row : latest),
                  null,
                );
                if (!mostRecent?.updatedByDisplayName) return null;
                const relative = formatRelativeTime(mostRecent.updatedAt);
                return (
                  <p className="text-secondary mb-3" style={{ fontSize: "0.72rem" }}>
                    Last updated by {mostRecent.updatedByDisplayName}, {relative ?? formatDateTime(mostRecent.updatedAt)}
                  </p>
                );
              })()}

              <div className="row g-3 row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-5">
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
                <div className="col-12" style={{ flex: "0 0 100%", maxWidth: "100%" }}>
                  <h4 className="mb-0" style={{ fontSize: "0.85rem" }}>
                    Delta target (existing pos.) — covered calls only
                  </h4>
                  <p className="text-muted mb-0" style={{ fontSize: "0.75rem" }}>
                    Applies instead of the generic delta target above, and only for covered calls, when you already
                    own enough shares of the ticker (100+, uncommitted to another covered call) to write a real
                    covered call against — otherwise the generic range above is used, as a buy-write/hypothetical
                    scan. Cash-secured puts always use the generic range.
                  </p>
                </div>
                <NumberField
                  label="Delta target min (existing pos.)"
                  value={formState.deltaTargetMinExistingPosition}
                  step="0.01"
                  help="Lowest option delta (absolute value) the screener will consider when selling calls against shares you already own."
                  onChange={(value) => updateField("deltaTargetMinExistingPosition", value)}
                />
                <NumberField
                  label="Delta target max (existing pos.)"
                  value={formState.deltaTargetMaxExistingPosition}
                  step="0.01"
                  help="Highest option delta (absolute value) the screener will consider when selling calls against shares you already own."
                  onChange={(value) => updateField("deltaTargetMaxExistingPosition", value)}
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
                  step="1"
                  help="Target ceiling on how large a single position can be, as % of total portfolio value. Not yet auto-enforced — reference only."
                  onChange={(value) => updateField("maxPositionPctOfPortfolio", value)}
                />
                <NumberField
                  label="Max aggregate collateral %"
                  value={formState.maxAggregateCollateralPct}
                  step="1"
                  help="Target ceiling on total collateral tied up across all open positions in this strategy, as % of portfolio. Not yet auto-enforced."
                  onChange={(value) => updateField("maxAggregateCollateralPct", value)}
                />
                <NumberField
                  label="Max concentration per ticker %"
                  value={formState.maxConcentrationPerTickerPct}
                  step="1"
                  help="Target ceiling on how much of the portfolio (by notional value) can sit in one ticker. Shown for reference against the Concentration by Ticker table above; not yet auto-enforced."
                  onChange={(value) => updateField("maxConcentrationPerTickerPct", value)}
                />
                <NumberField
                  label="Max concentration per sector %"
                  value={formState.maxConcentrationPerSectorPct}
                  step="1"
                  help="Target ceiling on how much of the portfolio (by notional value) can sit in one sector. Shown for reference against the Concentration by Sector table above; not yet auto-enforced."
                  onChange={(value) => updateField("maxConcentrationPerSectorPct", value)}
                />
                <NumberField
                  label="Min cash reserve %"
                  value={formState.minCashReservePct}
                  step="1"
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
      )}

      {pageTab === "signals" && (
        <div className="card">
          <div className="card-body">
            {signalSettingsLoading ? (
              <Spinner size="sm" label="Loading settings" />
            ) : signalSettingsError ? (
              <div className="alert alert-danger">{signalSettingsError}</div>
            ) : !signalFormState ? (
              <div className="text-muted">No settings row found.</div>
            ) : (
              <>
                {signalSaveError && <div className="alert alert-danger">{signalSaveError}</div>}

                <p className="text-muted mb-1" style={{ fontSize: "0.85rem" }}>
                  Thresholds the Signals screen scores and filters opportunities against, independent from the Trade
                  Alerts tab's own settings above.
                </p>
                {signalSettings?.updatedByDisplayName && (
                  <p className="text-secondary mb-3" style={{ fontSize: "0.72rem" }}>
                    Last updated by {signalSettings.updatedByDisplayName},{" "}
                    {formatRelativeTime(signalSettings.updatedAt) ?? formatDateTime(signalSettings.updatedAt)}
                  </p>
                )}

                <div className="row g-3 row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-5">
                  <NumberField
                    label="Max Delta drift %"
                    value={signalFormState.maxDeltaDriftPct}
                    step="1"
                    help="Ceiling on Delta drift risk (share of expected P&L variance coming from unhedged delta drift rather than the option's edge). Stored for later; not applied to any opportunity yet."
                    note="Not applied yet — no opportunity is filtered by this value."
                    onChange={(value) => updateSignalField("maxDeltaDriftPct", value)}
                  />
                  <NumberField
                    label="Min Annualised Yield %"
                    value={signalFormState.minAnnualizedYieldPct}
                    step="1"
                    help="Floor on annualised yield (premium as a % of capital at risk, annualised by DTE). Candidates below this are filtered out."
                    onChange={(value) => updateSignalField("minAnnualizedYieldPct", value)}
                  />
                  <NumberField
                    label="Max Net Delta"
                    value={signalFormState.maxNetDelta}
                    step="0.01"
                    help="Ceiling on the position's net delta (absolute value). Candidates above this are filtered out."
                    onChange={(value) => updateSignalField("maxNetDelta", value)}
                  />
                  <NumberField
                    label="Max position % of portfolio"
                    value={signalFormState.maxPositionPctOfPortfolio}
                    step="1"
                    help="Target ceiling on how large a single position can be, as % of total portfolio value. Independent from the Trade Alerts tab's own setting of the same name."
                    onChange={(value) => updateSignalField("maxPositionPctOfPortfolio", value)}
                  />
                  <NumberField
                    label="Max concentration per ticker %"
                    value={signalFormState.maxConcentrationPerTickerPct}
                    step="1"
                    help="Target ceiling on how much of the portfolio (by notional value) can sit in one ticker. Independent from the Trade Alerts tab's own setting of the same name."
                    onChange={(value) => updateSignalField("maxConcentrationPerTickerPct", value)}
                  />
                  <NumberField
                    label="Min cash reserve %"
                    value={signalFormState.minCashReservePct}
                    step="1"
                    help="Target floor on how much of the portfolio should stay as uncommitted cash. Independent from the Trade Alerts tab's own setting of the same name."
                    onChange={(value) => updateSignalField("minCashReservePct", value)}
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary mt-3 d-inline-flex align-items-center gap-1"
                  disabled={signalSaving}
                  onClick={handleSignalSave}
                >
                  {signalSaving && <Spinner size="sm" />}
                  Save
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
