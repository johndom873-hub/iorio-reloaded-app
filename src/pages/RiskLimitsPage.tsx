import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Spinner } from "../components/Spinner";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { HelpTooltip } from "../components/HelpTooltip";
import { TooltipSpan } from "../components/TooltipSpan";
import { ApiError } from "../api/client";
import {
  fetchTradingHalt,
  fetchTradingSettings,
  updateTradingHalt,
  updateTradingSettings,
  type ConcentrationRow,
  type TradingHalt,
  type TradingSettings,
  type TradingSettingsInput,
} from "../api/riskLimits";
import { ConfirmModal } from "../components/ConfirmModal";
import { openNotificationStream } from "../api/notifications";
import { formatCurrency, formatDateTime, formatInputNumber, formatPercentage, formatRelativeTime } from "../lib/formatters";
import { useExposureStream } from "../hooks/useExposureStream";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";

// Every field is kept as the text of its input; percentages and deltas keep up to two decimals
// (rounding them to whole numbers on load used to turn a stored 2.5 into 3 on the next save).
interface SettingsFormState {
  maxPositionPctOfPortfolio: string;
  maxConcentrationPerTickerPct: string;
  minCashReservePct: string;
  deltaTargetMin: string;
  deltaTargetMax: string;
  recoveryDteMin: string;
  recoveryDteMax: string;
  minAnnualizedYieldPct: string;
  commissionWarnSharePctOfPremium: string;
  priceCheckMaxDeviationPct: string;
  priceCheckMinToleranceDollars: string;
  spreadCostChargedPct: string;
}

function toFormState(settings: TradingSettings): SettingsFormState {
  return {
    maxPositionPctOfPortfolio: formatInputNumber(settings.maxPositionPctOfPortfolio),
    maxConcentrationPerTickerPct: formatInputNumber(settings.maxConcentrationPerTickerPct),
    minCashReservePct: formatInputNumber(settings.minCashReservePct),
    deltaTargetMin: formatInputNumber(settings.deltaTargetMin),
    deltaTargetMax: formatInputNumber(settings.deltaTargetMax),
    recoveryDteMin: formatInputNumber(settings.recoveryDteMin, 0),
    recoveryDteMax: formatInputNumber(settings.recoveryDteMax, 0),
    minAnnualizedYieldPct: formatInputNumber(settings.minAnnualizedYieldPct),
    commissionWarnSharePctOfPremium: formatInputNumber(settings.commissionWarnSharePctOfPremium),
    priceCheckMaxDeviationPct: formatInputNumber(settings.priceCheckMaxDeviationPct),
    priceCheckMinToleranceDollars: formatInputNumber(settings.priceCheckMinToleranceDollars),
    spreadCostChargedPct: formatInputNumber(settings.spreadCostChargedPct),
  };
}

const fieldLabels: Record<keyof SettingsFormState, string> = {
  maxPositionPctOfPortfolio: "Max position size %",
  maxConcentrationPerTickerPct: "Max exposure per ticker %",
  minCashReservePct: "Min cash reserve %",
  deltaTargetMin: "Delta min",
  deltaTargetMax: "Delta max",
  recoveryDteMin: "Expiry window min",
  recoveryDteMax: "Expiry window max",
  minAnnualizedYieldPct: "Min annualised yield %",
  commissionWarnSharePctOfPremium: "Commission warning %",
  priceCheckMaxDeviationPct: "Max distance from the live mid %",
  priceCheckMinToleranceDollars: "Minimum allowance $",
  spreadCostChargedPct: "Spread cost %",
};

// A blank input used to become 0 silently (Number("") === 0) and save as a real limit.
function firstBlankField(form: SettingsFormState): string | null {
  const blankKey = (Object.keys(fieldLabels) as (keyof SettingsFormState)[]).find((key) => form[key].trim() === "");
  return blankKey ? fieldLabels[blankKey] : null;
}

function toUpdateInput(form: SettingsFormState): TradingSettingsInput {
  return {
    maxPositionPctOfPortfolio: Number(form.maxPositionPctOfPortfolio),
    maxConcentrationPerTickerPct: Number(form.maxConcentrationPerTickerPct),
    minCashReservePct: Number(form.minCashReservePct),
    deltaTargetMin: Number(form.deltaTargetMin),
    deltaTargetMax: Number(form.deltaTargetMax),
    recoveryDteMin: Number(form.recoveryDteMin),
    recoveryDteMax: Number(form.recoveryDteMax),
    minAnnualizedYieldPct: Number(form.minAnnualizedYieldPct),
    commissionWarnSharePctOfPremium: Number(form.commissionWarnSharePctOfPremium),
    priceCheckMaxDeviationPct: Number(form.priceCheckMaxDeviationPct),
    priceCheckMinToleranceDollars: Number(form.priceCheckMinToleranceDollars),
    spreadCostChargedPct: Number(form.spreadCostChargedPct),
  };
}

// The kill switch (gap fix 1 for Pluto, 2026-09-28). One button: red "Halt all trading" while trading
// is allowed, green "Resume trading" while halted. Both go through a confirm modal (an action modal:
// no backdrop/ESC dismiss); halting requires a reason, which the server also enforces. The card
// refreshes itself when another user flips the switch, via the trading_halt_changed notification.
function TradingHaltCard() {
  const [halt, setHalt] = useState<TradingHalt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<"halt" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHalt(await fetchTradingHalt());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load the trading halt state.");
    }
  }, []);

  useEffect(() => {
    void load();
    return openNotificationStream((notification) => {
      if (notification.type === "trading_halt_changed") void load();
    });
  }, [load]);

  function openModal(kind: "halt" | "resume") {
    setReason("");
    setSubmitError(null);
    setPending(kind);
  }

  async function submit() {
    if (!pending) return;
    const enabled = pending === "halt";
    if (enabled && reason.trim() === "") {
      setSubmitError("A reason is required to halt trading.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      setHalt(await updateTradingHalt({ enabled, reason: reason.trim() === "" ? null : reason.trim() }));
      setPending(null);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Failed to update the trading halt.");
    } finally {
      setSubmitting(false);
    }
  }

  const halted = halt?.enabled === true;
  return (
    // A red border, not bg-danger-lt: the tinted background made the card's text unreadable in dark mode
    // (text-dark on a dark red), and the state is already carried by the badge and the button.
    <div className={`card mb-3${halted ? " border-danger" : ""}`}>
      <div className="card-body">
        <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
          <div>
            <h3 className="card-title mb-1">
              Trading halt
              {halt && (
                <span className={`badge ms-2 ${halted ? "bg-danger text-white" : "bg-success text-white"}`} style={{ fontSize: "0.72rem" }}>
                  {halted ? "HALTED" : "Trading allowed"}
                </span>
              )}
            </h3>
            {loadError ? (
              <div className="text-danger" style={{ fontSize: "0.8rem" }}>{loadError}</div>
            ) : halt === null ? (
              <Spinner size="sm" label="Loading trading halt state" />
            ) : halted ? (
              <div className="text-danger" style={{ fontSize: "0.8rem" }}>
                Halted by <strong>{halt.setByDisplayName ?? "an operator"}</strong>
                {halt.setAt ? ` ${formatRelativeTime(halt.setAt) ?? formatDateTime(halt.setAt)}` : ""}
                {halt.reason ? ` — ${halt.reason}` : ""}. No order from any origin (screens, Genosuke, bots) reaches IBKR until it is lifted; cancels still work.
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                The kill switch. Halting stops every order from every origin at confirm and again inside the trading worker, immediately.
                {halt.setAt && ` Last lifted by ${halt.setByDisplayName ?? "an operator"} ${formatRelativeTime(halt.setAt) ?? formatDateTime(halt.setAt)}.`}
              </div>
            )}
          </div>
          {halt && (
            <button type="button" className={`btn ${halted ? "btn-success" : "btn-danger"} flex-shrink-0`} onClick={() => openModal(halted ? "resume" : "halt")}>
              {halted ? "Resume trading" : "Halt all trading"}
            </button>
          )}
        </div>
      </div>
      {pending && (
        <ConfirmModal
          title={pending === "halt" ? "Halt all trading?" : "Resume trading?"}
          confirmLabel={pending === "halt" ? "Halt trading" : "Resume trading"}
          danger={pending === "halt"}
          confirming={submitting}
          onCancel={() => setPending(null)}
          onConfirm={() => void submit()}
          message={
            <div>
              <p className="mb-2">
                {pending === "halt"
                  ? "Every order from every origin will be refused at confirm and stopped inside the trading worker until someone resumes trading. Orders already working at IBKR are not cancelled."
                  : "Orders will reach IBKR again from every origin."}
              </p>
              <label className="form-label" htmlFor="trading-halt-reason">
                Reason{pending === "halt" ? "" : " (optional)"}
              </label>
              <textarea
                id="trading-halt-reason"
                className="form-control"
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={submitting}
              />
              {submitError && <div className="text-danger mt-2" style={{ fontSize: "0.8rem" }}>{submitError}</div>}
            </div>
          }
        />
      )}
    </div>
  );
}

interface ConcentrationListProps {
  title: string;
  rows: ConcentrationRow[];
  labelKey: "symbol" | "sector";
  totalAccountValue: number | null;
  /** The saved ceiling as a 0-100 percentage; rows above it get an "over limit" badge. Omitted for a plain breakdown. */
  limitPct?: number;
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
            const isOverLimit = !isUnallocated && fraction !== null && limitPct !== undefined && fraction * 100 > limitPct;
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
                    <TooltipSpan className="badge bg-danger-lt text-nowrap" text={`Over the ${formatInputNumber(limitPct)}% max exposure per ticker limit`}>
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
  onChange: (value: string) => void;
}

function NumberField({ label, value, step = "1", help, onChange }: NumberFieldProps) {
  return (
    <div className="col">
      <label className="form-label d-inline-flex align-items-center" style={{ fontSize: "0.8rem" }}>
        {label}
        <HelpTooltip text={help} />
      </label>
      <input type="number" className="form-control" style={{ maxWidth: "9rem" }} step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="mb-4">
      <h4 className="mb-0" style={{ fontSize: "0.9rem" }}>
        {title}
      </h4>
      <p className="text-secondary mb-2" style={{ fontSize: "0.8rem" }}>
        {description}
      </p>
      <div className="row g-3 row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-5">{children}</div>
    </section>
  );
}

export function RiskLimitsPage() {
  const { exposure, loading: exposureLoading, error: exposureError } = useExposureStream("Failed to load account exposure.");

  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [formState, setFormState] = useState<SettingsFormState | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { open: openTickerModal } = useSignalsTickerModal();

  const loadSettings = useCallback(async () => {
    try {
      setSettingsError(null);
      const loaded = await fetchTradingSettings();
      setSettings(loaded);
      setFormState(toFormState(loaded));
      setSaveError(null);
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : "Failed to load trading limits.");
    }
  }, []);

  useEffect(() => {
    setSettingsLoading(true);
    loadSettings().finally(() => setSettingsLoading(false));
  }, [loadSettings]);

  function updateField(field: keyof SettingsFormState, value: string) {
    setFormState((previous) => (previous ? { ...previous, [field]: value } : previous));
  }

  async function handleSave() {
    if (!formState) return;
    const blank = firstBlankField(formState);
    if (blank) {
      setSaveError(`${blank} is empty — every field needs a value.`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateTradingSettings(toUpdateInput(formState));
      setSettings(updated);
      setFormState(toFormState(updated));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save trading limits.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Risk & Limits" subtitle="Current exposure and trading limits" />

      <TradingHaltCard />

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
                limitPct={settings?.maxConcentrationPerTickerPct}
                unallocatedLabel="Unallocated"
                onSymbolClick={openTickerModal}
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
                unallocatedLabel="Unallocated"
              />
            </div>
            <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>
              % of total account value (net liquidation value, including cash). "over limit" compares against the Max exposure per ticker % limit below.
            </div>
          </>
        )}
      </CollapsibleCard>

      <div className="card">
        <div className="card-body">
          {settingsLoading ? (
            <Spinner size="sm" label="Loading settings" />
          ) : settingsError ? (
            <div className="alert alert-danger">{settingsError}</div>
          ) : !formState ? (
            <div className="text-muted">No settings found.</div>
          ) : (
            <>
              {saveError && <div className="alert alert-danger">{saveError}</div>}

              <p className="text-secondary mb-1" style={{ fontSize: "0.85rem" }}>
                One set of limits for every strategy. Hover the help icon next to a field for details.
              </p>
              {settings?.updatedByDisplayName && (
                <p className="text-secondary mb-3" style={{ fontSize: "0.72rem" }}>
                  Last updated by {settings.updatedByDisplayName}, {formatRelativeTime(settings.updatedAt) ?? formatDateTime(settings.updatedAt)}
                </p>
              )}

              <SettingsSection title="Order limits — these block an order" description="An order that would break one of these cannot be confirmed.">
                <NumberField
                  label={fieldLabels.maxPositionPctOfPortfolio}
                  value={formState.maxPositionPctOfPortfolio}
                  step="0.5"
                  help="The most a single new position may be worth, as a % of total portfolio value. A larger order is blocked."
                  onChange={(value) => updateField("maxPositionPctOfPortfolio", value)}
                />
                <NumberField
                  label={fieldLabels.maxConcentrationPerTickerPct}
                  value={formState.maxConcentrationPerTickerPct}
                  step="0.5"
                  help="The most of the portfolio that may sit in one ticker, as a % of total portfolio value, counting the order. Also drives the 'over limit' badge in Concentration by Ticker above."
                  onChange={(value) => updateField("maxConcentrationPerTickerPct", value)}
                />
                <NumberField
                  label={fieldLabels.minCashReservePct}
                  value={formState.minCashReservePct}
                  step="0.5"
                  help="How much of the portfolio must stay as free cash after the order. An order that would eat into this reserve is blocked."
                  onChange={(value) => updateField("minCashReservePct", value)}
                />
              </SettingsSection>

              <SettingsSection
                title="Limit-price check — this blocks an order"
                description="Every leg's limit price is compared with its live mid (the middle of the bid and ask), when the order is confirmed and again right before it is sent. A sell priced below the mid, or a buy priced above it, by more than the larger of the two figures below is refused."
              >
                <NumberField
                  label={fieldLabels.priceCheckMaxDeviationPct}
                  value={formState.priceCheckMaxDeviationPct}
                  step="0.5"
                  help="How far a limit price may be on the wrong side of the live mid, as a % of the mid. A sell below the mid or a buy above it by more than this is blocked. Prices on the right side of the mid are never blocked. 0 means no tolerance beyond the minimum allowance."
                  onChange={(value) => updateField("priceCheckMaxDeviationPct", value)}
                />
                <NumberField
                  label={fieldLabels.priceCheckMinToleranceDollars}
                  value={formState.priceCheckMinToleranceDollars}
                  step="0.01"
                  help="A floor on the allowance, in dollars per share, so a cheap option is not blocked over a few cents. The allowance is whichever is larger: the % above or this amount."
                  onChange={(value) => updateField("priceCheckMinToleranceDollars", value)}
                />
              </SettingsSection>

              <SettingsSection
                title="Delta band"
                description="Applies to Signals suggestions, to new orders (an order outside the band cannot be confirmed) and to the Recovery Path scan."
              >
                <NumberField
                  label={fieldLabels.deltaTargetMin}
                  value={formState.deltaTargetMin}
                  step="0.01"
                  help="Lowest option delta (absolute value, 0 to 1) allowed. Lower delta means further from the current price: less likely to be assigned, smaller premium."
                  onChange={(value) => updateField("deltaTargetMin", value)}
                />
                <NumberField
                  label={fieldLabels.deltaTargetMax}
                  value={formState.deltaTargetMax}
                  step="0.01"
                  help="Highest option delta (absolute value, 0 to 1) allowed. Higher delta means closer to the current price: more premium, more assignment risk."
                  onChange={(value) => updateField("deltaTargetMax", value)}
                />
              </SettingsSection>

              <SettingsSection title="Recovery Path" description="How far out Recovery Path looks for a covered call to sell against shares held at a loss.">
                <NumberField
                  label={fieldLabels.recoveryDteMin}
                  value={formState.recoveryDteMin}
                  help="Fewest days until expiry that Recovery Path will consider."
                  onChange={(value) => updateField("recoveryDteMin", value)}
                />
                <NumberField
                  label={fieldLabels.recoveryDteMax}
                  value={formState.recoveryDteMax}
                  help="Most days until expiry that Recovery Path will consider."
                  onChange={(value) => updateField("recoveryDteMax", value)}
                />
              </SettingsSection>

              <SettingsSection title="Signals" description="Signals only suggests trades that pay at least this much per year, and counts part of each contract's bid/ask spread as a trading cost.">
                <NumberField
                  label={fieldLabels.minAnnualizedYieldPct}
                  value={formState.minAnnualizedYieldPct}
                  step="0.5"
                  help="Floor on annualised yield (premium as a % of the capital at risk, scaled to a year by days to expiry). Candidates below it are filtered out."
                  onChange={(value) => updateField("minAnnualizedYieldPct", value)}
                />
                <NumberField
                  label={fieldLabels.spreadCostChargedPct}
                  value={formState.spreadCostChargedPct}
                  step="5"
                  help="How much of the half-spread (the distance from the mid to the bid) Signals counts as a trading cost. Orders go out as limits at the mid, but a fill can come up to half a spread below the fair price at that moment. 0 assumes every fill is worth the full mid, 100 assumes every fill is at the bid. Changes Net Edge, Edge $, grades and roll scores."
                  onChange={(value) => updateField("spreadCostChargedPct", value)}
                />
              </SettingsSection>

              <SettingsSection title="Commission warning" description="Order setup warns when the commission is a large share of the premium. A warning only, it never blocks an order.">
                <NumberField
                  label={fieldLabels.commissionWarnSharePctOfPremium}
                  value={formState.commissionWarnSharePctOfPremium}
                  step="0.5"
                  help="The warning appears when the order's commission is above this % of its premium."
                  onChange={(value) => updateField("commissionWarnSharePctOfPremium", value)}
                />
              </SettingsSection>

              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={saving} onClick={handleSave}>
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
