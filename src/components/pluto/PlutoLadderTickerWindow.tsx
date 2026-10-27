import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { useIsAdmin } from "../../hooks/useAuth";
import { fetchPlutoTickerSettingsAudit, savePlutoTickerSettings, type PlutoLadderTickerSettings, type PlutoSettings, type PlutoTickerSettingsAuditRow, type PlutoTickerSettingsField } from "../../api/pluto";
import { formatBrowserClockTime, formatBrowserDayMonth, formatCurrency, formatDayMonth, formatInputNumber, formatNumber } from "../../lib/formatters";
import { effectiveAllocationPct, ladderFit, ladderPriceCeilings, tickerFieldLabel, type LadderFit } from "../../lib/plutoLadderPresentation";
import { HelpTooltip } from "../HelpTooltip";
import { ReadOnlySetting } from "../ReadOnlySetting";
import { Spinner } from "../Spinner";
import { ViewOnlyNote } from "../ViewOnlyNote";
import { CheckIcon, CrossIcon, InfoIcon, ResetIcon, WarningIcon } from "./plutoBits";

// A ticker's CC + Put Ladder settings window (Pluto Ladder Settings mockup, approved 2026-10-15): one row per value the
// ticker may override, with the strategy value, its own value (empty = the strategy's), the effective value and Reset;
// the configuration checks recomputed at every keystroke from the last close; Save asks first and allows "Save anyway"
// when a check fails (Marcelo 2026-10-15). It holds unsaved input, so neither Esc nor a click outside closes it.
// A trader sees the values printed, without inputs or Save (only an admin may change them): that view closes on both.

interface FieldSpec {
  field: PlutoTickerSettingsField;
  unit: string;
  max: number;
  integer?: boolean;
  /** What an empty input stands for. */
  placeholder: string;
}

const fieldSpecs: FieldSpec[] = [
  { field: "allocationPct", unit: "%", max: 100, placeholder: "Equal share" },
  { field: "ladderSharesPct", unit: "%", max: 99, placeholder: "Strategy" },
  { field: "ladderShockOverridePct", unit: "%", max: 99, placeholder: "Recommended" },
  { field: "ladderRungs", unit: "rungs", max: 20, integer: true, placeholder: "Strategy" },
  { field: "ladderMinAbsDelta", unit: "", max: 1, placeholder: "Strategy" },
  { field: "ladderMaxAbsDelta", unit: "", max: 1, placeholder: "Strategy" },
];

const savedOverride = (ticker: PlutoLadderTickerSettings, field: PlutoTickerSettingsField): number | null => {
  switch (field) {
    case "allocationPct":
      return ticker.allocationPct;
    case "ladderSharesPct":
      return ticker.tickerOverrides.ladderSharesPct;
    case "ladderShockOverridePct":
      return ticker.overrideShockPct;
    case "ladderRungs":
      return ticker.tickerOverrides.ladderRungs;
    case "ladderMinAbsDelta":
      return ticker.tickerOverrides.minAbsDelta;
    case "ladderMaxAbsDelta":
      return ticker.tickerOverrides.maxAbsDelta;
  }
};

const inputText = (value: number | null) => (value === null ? "" : formatInputNumber(value, 6));
const percent = (value: number, digits = 2) => `${formatInputNumber(+value.toFixed(digits), digits)}%`;

/** A typed value: null for empty (the default), NaN when not a number. */
function parsed(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function fieldProblem(spec: FieldSpec, text: string): string | null {
  const value = parsed(text);
  if (value === null) return null;
  if (!Number.isFinite(value)) return `${tickerFieldLabel[spec.field]} needs a number.`;
  if (!(value > 0)) return `${tickerFieldLabel[spec.field]} must be above 0.`;
  if (value > spec.max) return `${tickerFieldLabel[spec.field]} can be at most ${spec.max}.`;
  if (spec.integer && !Number.isInteger(value)) return `${tickerFieldLabel[spec.field]} needs a whole number.`;
  return null;
}

/** "14.1× the last price", "13.6% above the last price", "23.8% below the last price". */
function ceilingRelation(ceiling: number, price: number): { text: string; below: boolean } {
  if (ceiling >= 2 * price) return { text: `${(ceiling / price).toFixed(1)}× the last price`, below: false };
  if (ceiling >= price) return { text: `${((ceiling / price - 1) * 100).toFixed(1)}% above the last price`, below: false };
  return { text: `${((1 - ceiling / price) * 100).toFixed(1)}% below the last price`, below: true };
}

function RangeBar({ from, to, at, max }: { from: number; to: number; at: number; max: number }) {
  const position = (value: number) => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  return (
    <span className="ts-bar" aria-hidden="true">
      {to > from && <span className="band" style={{ left: position(from), width: `calc(${position(to)} - ${position(from)})` }} />}
      <span className="dot" style={{ left: position(at) }} />
    </span>
  );
}

interface PlutoLadderTickerWindowProps {
  ticker: PlutoLadderTickerSettings;
  companyName: string | null;
  /** Enabled in Pluto (the Tickers tab's switch). */
  enabledInPluto: boolean;
  /** Every shortlisted ticker's ladder settings and whether Pluto may trade it: the equal share depends on the others. */
  allTickers: { settings: PlutoLadderTickerSettings; enabled: boolean }[];
  settings: PlutoSettings;
  onClose: () => void;
  onSaved: (changeCount: number) => void;
  onEditStrategyValues: () => void;
}

export function PlutoLadderTickerWindow({ ticker, companyName, enabledInPluto, allTickers, settings, onClose, onSaved, onEditStrategyValues }: PlutoLadderTickerWindowProps) {
  const symbol = ticker.symbol;
  const [drafts, setDrafts] = useState<Record<PlutoTickerSettingsField, string>>(() => Object.fromEntries(fieldSpecs.map((spec) => [spec.field, inputText(savedOverride(ticker, spec.field))])) as Record<PlutoTickerSettingsField, string>);
  const [audit, setAudit] = useState<PlutoTickerSettingsAuditRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    if (isAdmin) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isAdmin, onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchPlutoTickerSettingsAudit(symbol)
      .then((rows) => !cancelled && setAudit(rows))
      .catch(() => !cancelled && setAudit([]));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const value = (field: PlutoTickerSettingsField) => {
    const typed = parsed(drafts[field]);
    return typed !== null && Number.isFinite(typed) ? typed : null;
  };
  const problems = fieldSpecs.map((spec) => fieldProblem(spec, drafts[spec.field])).filter((problem): problem is string => problem !== null);
  const changes = fieldSpecs.filter((spec) => {
    const before = savedOverride(ticker, spec.field);
    const after = parsed(drafts[spec.field]);
    return after === null ? before !== null : before === null || after !== before;
  });

  // Allocations: the others' set values as saved; this ticker's as typed.
  const enabledOthers = allTickers.filter((entry) => entry.enabled && entry.settings.symbol !== symbol);
  const allocationsWith = (own: number | null) => effectiveAllocationPct([...enabledOthers.map((entry) => ({ symbol: entry.settings.symbol, setPct: entry.settings.allocationPct })), ...(enabledInPluto ? [{ symbol, setPct: own }] : [])]);
  const allocationsNow = allocationsWith(value("allocationPct"));
  const allocationsSaved = allocationsWith(ticker.allocationPct);
  const setTotal = enabledOthers.reduce((sum, entry) => sum + (entry.settings.allocationPct ?? 0), 0) + (value("allocationPct") ?? 0);
  if (setTotal > 100 + 1e-9) problems.push(`The set allocations come to ${percent(setTotal)}: at most 100% in all.`);
  const strategy = {
    allocationPct: enabledInPluto ? (allocationsWith(null).get(symbol) ?? 0) : null,
    ladderSharesPct: settings.ladderSharesPct,
    ladderShockOverridePct: ticker.recommendedShockPct,
    ladderRungs: settings.ladderRungs,
    ladderMinAbsDelta: settings.ladderMinAbsDelta,
    ladderMaxAbsDelta: settings.ladderMaxAbsDelta,
  } satisfies Record<PlutoTickerSettingsField, number | null>;
  const effective = (field: PlutoTickerSettingsField) => (field === "allocationPct" ? (enabledInPluto ? (allocationsNow.get(symbol) ?? 0) : null) : (value(field) ?? strategy[field]));
  const lo = effective("ladderMinAbsDelta")!;
  const hi = effective("ladderMaxAbsDelta")!;
  if (lo > hi) problems.push(`The Calls' |delta| lower limit (${lo.toFixed(2)}) is above the upper limit (${hi.toFixed(2)}).`);

  const budget = ticker.capitalBudgetDollars;
  const allocationNow = effective("allocationPct");
  const pot = budget !== null && allocationNow !== null ? (budget * allocationNow) / 100 : null;
  const price = ticker.lastClose?.price ?? null;
  const sharesPct = effective("ladderSharesPct")!;
  const rungs = effective("ladderRungs")!;
  const shockPct = effective("ladderShockOverridePct");
  const fit: LadderFit | null = pot !== null && price !== null && shockPct !== null && problems.length === 0 ? ladderFit({ price, pot, sharesPct, rungs, shockPct }) : null;
  const fits = fit !== null && fit.lotFits && fit.putFits;
  const ceilings = pot !== null && shockPct !== null ? ladderPriceCeilings({ pot, sharesPct, rungs, shockPct }) : null;

  /** The fit messages under the fields that can fix a failing check. */
  const fieldMessages = (field: PlutoTickerSettingsField): { tone: "warn" | "info"; text: string }[] => {
    if (!fit || budget === null || ceilings === null || price === null) return [];
    const failing = !fit.lotFits || !fit.putFits;
    const messages: { tone: "warn" | "info"; text: string }[] = [];
    if (field === "allocationPct" && failing) {
      if (!fit.lotFits) messages.push({ tone: "warn", text: `The shares' budget buys a lot only while ${symbol} is under ${formatCurrency(ceilings.lot)}.` });
      if (!fit.putFits) messages.push({ tone: "warn", text: `A Put at the first cap fits a rung only while ${symbol} is under ${formatCurrency(ceilings.put)}.` });
      messages.push({ tone: "warn", text: `Smallest pot at ${percent(sharesPct)} shares: ${formatCurrency(fit.smallestPot, 0)}, an allocation of ${percent((fit.smallestPot / budget) * 100)}.` });
    }
    if (field === "ladderSharesPct" && failing) messages.push({ tone: "warn", text: fit.sharesRangePct ? `Share levels that work at this pot: ${percent(fit.sharesRangePct[0], 1)}–${percent(fit.sharesRangePct[1], 1)}.` : "No share level works at this pot." });
    if (field === "ladderRungs" && !fit.putFits) messages.push({ tone: "warn", text: fit.mostRungs >= 1 ? `At most ${fit.mostRungs} rung${fit.mostRungs === 1 ? "" : "s"} fit this pot.` : "No rung fits this pot." });
    // The shock hint (approved 2026-10-15): the smallest shock at which a Put fits a rung; none at or below 0%.
    if (field === "ladderShockOverridePct" && fit.smallestShockPct > 0)
      messages.push(fit.smallestShockPct > 100 ? { tone: "warn", text: `No shock makes a Put fit a rung: fewer rungs (at most ${fit.mostRungs}) or a larger pot.` } : { tone: fit.putFits ? "info" : "warn", text: `A Put fits a rung with a shock of at least ${percent(fit.smallestShockPct, 1)}.` });
    return messages;
  };

  const strategyText = (field: PlutoTickerSettingsField): { value: string; note: string } => {
    const raw = strategy[field];
    if (raw === null) return { value: "—", note: field === "allocationPct" ? "not enabled" : "unknown" };
    const shown = field === "ladderMinAbsDelta" || field === "ladderMaxAbsDelta" ? raw.toFixed(2) : field === "ladderRungs" ? String(raw) : percent(raw);
    return { value: shown, note: field === "allocationPct" ? "equal share" : field === "ladderShockOverridePct" ? "recommended" : "strategy" };
  };
  const effectiveText = (field: PlutoTickerSettingsField): { value: string; note: string | null; own: boolean } => {
    const raw = effective(field);
    const own = value(field) !== null;
    if (raw === null) return { value: "—", note: null, own };
    const shown = field === "ladderMinAbsDelta" || field === "ladderMaxAbsDelta" ? raw.toFixed(2) : field === "ladderRungs" ? String(raw) : percent(raw);
    if (field === "allocationPct") return { value: shown, note: pot === null ? null : `${formatCurrency(pot, 0)} pot`, own };
    return { value: shown, note: own ? null : field === "ladderShockOverridePct" ? "recommended" : "strategy", own };
  };

  const shockHelp = (() => {
    const source = ticker.recommendedShockSource;
    if (!source) return "How far below the price the ladder reaches.";
    if (source.maxDrawdownPct === null) return `How far below the price the ladder reaches. Recommended: under 250 daily closes, so the new-listing value, ${percent(settings.ladderShockNoHistoryPct, 0)}.`;
    const held = ticker.recommendedShockPct !== null && Math.abs(ticker.recommendedShockPct - source.maxDrawdownPct) > 0.005;
    return `How far below the price the ladder reaches. Recommended: ${symbol}'s Max drawdown over ${settings.ladderShockLookbackYears} years, −${percent(source.maxDrawdownPct, 1)}${held ? `, held to the ${ticker.recommendedShockPct! > source.maxDrawdownPct ? "floor" : "ceiling"} of ${percent(ticker.recommendedShockPct!, 0)}` : ""}.`;
  })();
  const help: Record<PlutoTickerSettingsField, string> = {
    allocationPct: `% of Pluto's budget${budget !== null ? ` (${formatCurrency(budget, 0)})` : ""}. Empty = an equal share of what the set allocations leave.`,
    ladderSharesPct: "Part of the pot that buys shares; the rest is the Put reserve, split across the rungs.",
    ladderShockOverridePct: shockHelp,
    ladderRungs: "Ladder Puts, each capped below the price.",
    ladderMinAbsDelta: "Calls and ladder Puts the ladder may sell on this ticker, by absolute delta.",
    ladderMaxAbsDelta: "",
  };

  const describeValue = (field: PlutoTickerSettingsField, raw: number | null) => (raw === null ? (field === "allocationPct" ? "equal share" : field === "ladderShockOverridePct" ? "recommended" : "strategy") : field === "ladderMinAbsDelta" || field === "ladderMaxAbsDelta" ? raw.toFixed(2) : field === "ladderRungs" ? String(raw) : percent(raw));
  const describeAuditValue = (field: PlutoTickerSettingsField, raw: string | null) => describeValue(field, raw === null ? null : Number(raw));
  // Who else moves when this ticker's allocation changes: the other enabled tickers on an equal share.
  const knockOn = changes.some((spec) => spec.field === "allocationPct")
    ? enabledOthers
        .filter((entry) => entry.settings.allocationPct === null)
        .map((entry) => {
          const before = allocationsSaved.get(entry.settings.symbol) ?? 0;
          const after = allocationsNow.get(entry.settings.symbol) ?? 0;
          return { symbol: entry.settings.symbol, before, after };
        })
        .filter((entry) => Math.abs(entry.before - entry.after) > 1e-9)
    : [];

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await savePlutoTickerSettings(symbol, Object.fromEntries(changes.map((spec) => [spec.field, value(spec.field)])));
      onSaved(changes.length);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : `Could not save ${symbol}'s settings.`);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const checksCard = (
    <section className="pm-card ts-checks">
      <div className="pm-card-h">
        <h2 className="pm-card-t">Configuration checks</h2>
        {fit && (
          <span className={`pm-b ${fits ? "ok" : "bad"}`}>
            {fits ? <CheckIcon /> : <CrossIcon />}
            {fits ? "Works" : "Doesn't work"}
          </span>
        )}
      </div>
      {!enabledInPluto ? (
        <div className="pm-empty">{symbol} is not enabled in Pluto, so it has no pot to check.</div>
      ) : price === null ? (
        <div className="pm-empty">No daily close for {symbol} yet: the checks need its last price.</div>
      ) : pot === null ? (
        <div className="pm-empty">No account value recorded yet: the pot, and so the checks, cannot be worked out.</div>
      ) : problems.length > 0 ? (
        <div className="pm-empty">Fix the values marked in red to see the checks.</div>
      ) : fit && ceilings ? (
        <>
          <div className="pm-card-meta ts-intro">
            With {symbol}'s last price, {formatCurrency(price)} ({formatDayMonth(ticker.lastClose!.date)} close), its {formatCurrency(pot, 0)} pot.
          </div>
          <div className={`chk ${fit.lotFits ? "ok" : "bad"}`}>
            {fit.lotFits ? <CheckIcon className="ic" /> : <CrossIcon className="ic" />}
            <div>
              <b>The share budget buys one lot</b>
              <div className="detail">
                {formatCurrency((pot * sharesPct) / 100, 0)} for shares ({percent(sharesPct)} of the pot); one lot = 100 × {formatCurrency(price)} = {formatCurrency(100 * price, 0)}, so {formatNumber(Math.floor((pot * sharesPct) / 100 / (100 * price)))} lots.
              </div>
            </div>
          </div>
          <div className={`chk ${fit.putFits ? "ok" : "bad"}`}>
            {fit.putFits ? <CheckIcon className="ic" /> : <CrossIcon className="ic" />}
            <div>
              <b>One ladder Put fits a rung</b>
              <div className="detail">
                Each rung holds {formatCurrency((pot * (1 - sharesPct / 100)) / rungs, 0)} (the {formatCurrency(pot * (1 - sharesPct / 100), 0)} reserve ÷ {rungs}). First rung's cap = {formatCurrency(price)} × (1 − {percent(shockPct!, 0)} ÷ {rungs}) = {formatCurrency(fit.firstCap)}, so a Put at the cap needs {formatCurrency(fit.firstCap * 100, 0)}
                {fit.putFits ? "." : <>: <span className="t-bad">{formatCurrency(fit.firstCap * 100 - (pot * (1 - sharesPct / 100)) / rungs, 0)} more than a rung holds</span>.</>}
              </div>
            </div>
          </div>
          <div className="ts-sec">
            <h4>Ranges that work</h4>
            <p>Each with the other values as they are. The dot is the value now.</p>
          </div>
          <div className="ts-ranges">
            <div className="ts-range">
              <span className="k">Share level</span>
              <span className="v">{fit.sharesRangePct ? `${percent(fit.sharesRangePct[0], 1)}–${percent(fit.sharesRangePct[1], 1)}` : "none"}</span>
              <RangeBar from={fit.sharesRangePct?.[0] ?? 0} to={fit.sharesRangePct?.[1] ?? 0} at={sharesPct} max={100} />
            </div>
            <div className="ts-range">
              <span className="k">Most rungs</span>
              <span className="v">{fit.mostRungs}</span>
              <RangeBar from={0} to={Math.min(fit.mostRungs, 20)} at={rungs} max={Math.max(20, rungs)} />
            </div>
            <div className="ts-range">
              <span className="k">Smallest pot at {percent(sharesPct)} shares</span>
              <span className="v">{formatCurrency(fit.smallestPot, 0)}</span>
              {budget !== null && (
                <span className="sub">
                  An allocation of {percent((fit.smallestPot / budget) * 100)}; the pot is {formatCurrency(pot, 0)}.
                </span>
              )}
            </div>
            {(
              [
                ["Price ceiling, lot", ceilings.lot],
                ["Price ceiling, ladder Put", ceilings.put],
              ] as const
            ).map(([label, ceiling]) => {
              const relation = ceilingRelation(ceiling, price);
              return (
                <div key={label} className="ts-range">
                  <span className="k">{label}</span>
                  <span className={`v${relation.below ? " t-bad" : ""}`}>{formatCurrency(ceiling)}</span>
                  <span className="sub">{relation.text}</span>
                </div>
              );
            })}
          </div>
          <details className="ts-formulas">
            <summary>How these are worked out</summary>
            <ul>
              <li>
                <code>lot: pot × share level ≥ 100 × last price</code>
              </li>
              <li>
                <code>first rung's cap = price × (1 − shock ÷ rungs); a rung holds pot × (1 − share level) ÷ rungs ≥ cap × 100</code>
              </li>
              <li>
                <code>smallest pot = max(100 × P ÷ share level, 100 × P × (rungs − shock) ÷ (1 − share level))</code>
              </li>
              <li>
                <code>smallest shock = rungs − pot × (1 − share level) ÷ (100 × P)</code>
              </li>
              <li>
                <code>price ceilings: lot = pot × share level ÷ 100; ladder Put = pot × (1 − share level) ÷ (100 × (rungs − shock))</code>
              </li>
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );

  // A trader's values: the one in use, whose it is, and for a ticker's own value the strategy's it replaces.
  const readOnlyCard = (
    <section className="pm-card ts-form">
      <div className="pm-ro-grid">
        {fieldSpecs.map((spec) => {
          const effectiveShown = effectiveText(spec.field);
          const strategyShown = strategyText(spec.field);
          const details = [effectiveShown.own && strategyShown.value !== "—" ? `${strategyShown.note} ${strategyShown.value}` : strategyShown.note];
          if (spec.field === "allocationPct" && effectiveShown.note) details.push(effectiveShown.note);
          return (
            <ReadOnlySetting
              key={spec.field}
              label={tickerFieldLabel[spec.field]}
              help={help[spec.field] ? <HelpTooltip text={help[spec.field]} /> : undefined}
              value={
                <>
                  <span className="d-inline-flex align-items-center gap-2">
                    {effectiveShown.value}
                    {effectiveShown.own && <span className="pm-b info">This ticker</span>}
                  </span>
                  <span className="pm-ro-sub">{details.join(" · ")}</span>
                </>
              }
            />
          );
        })}
      </div>
      <div className="pm-card-foot">
        <button type="button" className="pm-link ts-edit-strategy" onClick={onEditStrategyValues}>
          Open the strategy values on the Settings tab
        </button>
      </div>
    </section>
  );

  const historyCard = (
    <section className="pm-card ts-history">
      <div className="pm-card-h">
        <h2 className="pm-card-t">
          Change history {audit && <span className="pm-b neutral">{audit.length}</span>}
        </h2>
      </div>
      {audit === null ? (
        <div className="pm-empty">
          <Spinner size="sm" label={`Loading ${symbol}'s changes`} />
        </div>
      ) : audit.length === 0 ? (
        <div className="pm-empty">No changes yet: {symbol} uses the strategy values.</div>
      ) : (
        <ul className="pm-audit">
          {audit.map((row) => (
            <li key={row.id}>
              {tickerFieldLabel[row.field] ?? row.field}{" "}
              <b className="strong">
                {describeAuditValue(row.field, row.oldValue)} → {describeAuditValue(row.field, row.newValue)}
              </b>
              <div className="who">
                {row.userDisplayName ?? "—"} · {formatBrowserDayMonth(row.changedAt)} {formatBrowserClockTime(row.changedAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const titleId = `pluto-ladder-${symbol}-title`;
  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
      <div
        className="modal show d-block ts-modal"
        style={{ zIndex: 1050 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={
          isAdmin
            ? undefined
            : (event) => {
                if (event.target === event.currentTarget) onClose();
              }
        }
      >
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down ts-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <div className="mh-title">
                <span className="modal-eyebrow">Pluto · CC + Put Ladder</span>
                <h3 className="modal-title" id={titleId}>
                  {symbol} settings {companyName && <span className="co">{companyName}</span>}
                </h3>
                <div className="status-line">
                  {enabledInPluto ? <span className="pm-b ok">Allowed</span> : <span className="pm-b neutral">Off</span>}
                  {ticker.lastClose ? (
                    <span>
                      Last price <b>{formatCurrency(ticker.lastClose.price)}</b> · {formatDayMonth(ticker.lastClose.date)} close
                    </span>
                  ) : (
                    <span>No daily close yet</span>
                  )}
                  <span>{enabledInPluto ? (ticker.potDollars !== null ? <>Pot <b>{formatCurrency(ticker.potDollars, 0)}</b></> : "No pot yet") : "Not enabled in Pluto"}</span>
                </div>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              {!isAdmin && <ViewOnlyNote className="mb-3">Only an admin can change {symbol}'s settings.</ViewOnlyNote>}
              <div className="ts-grid">
                {isAdmin ? (
                  <section className="pm-card ts-form">
                    <div className="ts-head-row">
                      <span>Setting</span>
                      <span className="r">Strategy</span>
                      <span className="r">This ticker</span>
                      <span className="r">Effective</span>
                      <span />
                    </div>
                    {fieldSpecs.map((spec) => {
                      const changed = changes.includes(spec);
                      const problem = fieldProblem(spec, drafts[spec.field]);
                      const strategyShown = strategyText(spec.field);
                      const effectiveShown = effectiveText(spec.field);
                      const id = `pluto-ladder-${symbol}-${spec.field}`;
                      const messages = fieldMessages(spec.field);
                      return (
                        <div key={spec.field} className={`ts-row${changed ? " changed" : ""}`}>
                          <div className="ts-label">
                            <label className="lbl" htmlFor={id}>
                              {tickerFieldLabel[spec.field]}
                            </label>
                            {help[spec.field] && <div className="pm-help">{help[spec.field]}</div>}
                          </div>
                          <div className="ts-strategy">
                            <span className="ts-cell-k">Strategy</span>
                            <span className="v">{strategyShown.value}</span>
                            <span className="s">{strategyShown.note}</span>
                          </div>
                          <div className="ts-input">
                            <span className="ts-cell-k">This ticker</span>
                            <div className={`pm-input${problem ? " invalid" : ""}`}>
                              <input id={id} type="text" inputMode="decimal" placeholder={spec.placeholder} value={drafts[spec.field]} aria-invalid={problem ? true : undefined} onChange={(event) => setDrafts((current) => ({ ...current, [spec.field]: event.target.value }))} />
                              {spec.unit && <span className="unit">{spec.unit}</span>}
                            </div>
                            {changed && !problem && <div className="ts-was">was {describeValue(spec.field, savedOverride(ticker, spec.field))}</div>}
                          </div>
                          <div className="ts-eff">
                            <span className="ts-cell-k">Effective</span>
                            <span className="v">{effectiveShown.value}</span>
                            {effectiveShown.own ? <span className="pm-b info">This ticker</span> : effectiveShown.note && <span className="s">{effectiveShown.note}</span>}
                          </div>
                          <div className="ts-reset">
                            {drafts[spec.field].trim() !== "" && (
                              <button type="button" className="pm-link" onClick={() => setDrafts((current) => ({ ...current, [spec.field]: "" }))}>
                                <ResetIcon /> Reset
                              </button>
                            )}
                          </div>
                          <div className="ts-msgs">
                            {problem && (
                              <div className="ts-msg err">
                                <WarningIcon className="ic" />
                                <span>{problem}</span>
                              </div>
                            )}
                            {!problem &&
                              messages.map((message) => (
                                <div key={message.text} className={`ts-msg ${message.tone}`}>
                                  {message.tone === "warn" ? <WarningIcon className="ic" /> : <InfoIcon className="ic" />}
                                  <span>{message.text}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                    {problems.filter((problem) => !fieldSpecs.some((spec) => fieldProblem(spec, drafts[spec.field]) === problem)).map((problem) => (
                      <div key={problem} className="ts-msg err ts-form-msg">
                        <WarningIcon className="ic" />
                        <span>{problem}</span>
                      </div>
                    ))}
                    <div className="pm-card-foot">
                      <span>Empty = the strategy value.</span>
                      <button type="button" className="pm-link ts-edit-strategy" onClick={onEditStrategyValues}>
                        Edit the strategy values on the Settings tab
                      </button>
                    </div>
                  </section>
                ) : (
                  readOnlyCard
                )}
                {checksCard}
                {historyCard}
              </div>
            </div>
            {isAdmin ? (
              <div className="modal-footer ts-foot">
                <button type="button" className="pm-btn" onClick={() => setDrafts(Object.fromEntries(fieldSpecs.map((spec) => [spec.field, ""])) as Record<PlutoTickerSettingsField, string>)} disabled={saving || fieldSpecs.every((spec) => drafts[spec.field].trim() === "")}>
                  <ResetIcon /> Reset all to strategy values
                </button>
                <span className="ts-foot-status">{changes.length === 0 ? "No changes" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}</span>
                {saveError && <span className="t-bad ts-foot-status">{saveError}</span>}
                <span className="pm-spacer" />
                <button type="button" className="pm-btn" onClick={onClose} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="pm-btn primary" onClick={() => setConfirming(true)} disabled={saving || changes.length === 0 || problems.length > 0}>
                  Save
                </button>
              </div>
            ) : (
              <div className="modal-footer ts-foot">
                <button type="button" className="pm-btn" onClick={onClose}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {isAdmin && confirming && (
        <>
          <div className="modal-backdrop show" style={{ zIndex: 1100, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }} />
          <div className="modal show d-block ts-confirm" style={{ zIndex: 1100 }} role="dialog" aria-modal="true" aria-labelledby={`${titleId}-confirm`}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title" id={`${titleId}-confirm`}>
                    Save {changes.length} {changes.length === 1 ? "change" : "changes"} to {symbol}?
                  </h5>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setConfirming(false)} disabled={saving} />
                </div>
                <div className="modal-body">
                  Pluto uses the new values from its next look. Every change is logged with your name.
                  <ul className="pm-changes">
                    {changes.map((spec) => (
                      <li key={spec.field}>
                        {tickerFieldLabel[spec.field]}: {describeValue(spec.field, savedOverride(ticker, spec.field))} → {describeValue(spec.field, value(spec.field))}
                      </li>
                    ))}
                  </ul>
                  {knockOn.length > 0 && budget !== null && (
                    <>
                      <div className="confirm-sub">Other tickers on an equal share</div>
                      <ul className="pm-changes">
                        {knockOn.map((entry) => (
                          <li key={entry.symbol}>
                            {entry.symbol}: {percent(entry.before)} → {percent(entry.after)} ({formatCurrency((budget * entry.before) / 100, 0)} → {formatCurrency((budget * entry.after) / 100, 0)} pot)
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {fit && !fits && (
                    <div className="pm-alert warn">
                      <WarningIcon />
                      <div className="pm-alert-body">
                        <div className="pm-alert-text">{!fit.lotFits ? "The share budget doesn't buy a lot" : "A ladder Put doesn't fit a rung"} at {symbol}'s last price with these values. It can still be saved: a price move can change that either way.</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="pm-btn" onClick={() => setConfirming(false)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className="pm-btn primary" onClick={() => void save()} disabled={saving}>
                    {saving && <Spinner size="sm" />}
                    {fit && !fits ? "Save anyway" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** The window's allocation hint for a list row: "28.5% equal share" or "40% set". */
export function describeAllocation(setPct: number | null, effectivePct: number | null): { value: string; note: string } {
  if (effectivePct === null) return { value: "—", note: "" };
  return { value: percent(effectivePct), note: setPct === null ? "equal share" : "set" };
}

export function useLadderTickerEntries(tickers: PlutoLadderTickerSettings[] | null, enabledSymbols: ReadonlySet<string>) {
  return useMemo(() => (tickers ?? []).map((settings) => ({ settings, enabled: enabledSymbols.has(settings.symbol) })), [tickers, enabledSymbols]);
}
