import { IconAlertCircle, IconCheck, IconRefresh } from "@tabler/icons-react";
import type { AnalysisRunView } from "../../../api/backtestAnalysis";
import { analysisStepLabels } from "../../../api/backtestAnalysis";
import {
  analysisFixedRulesText,
  analysisTickerKeys,
  describeAllAnalysisValues,
  describeAnalysisValues,
  lotPriceCeiling,
  rungPriceCeiling,
  shockFor,
  type AnalysisPanelKey,
  type AnalysisPanelValues,
} from "../../../lib/analysisPresentation";
import { formatCurrency, formatDayMonthYear, formatNumber } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";
import { AnalysisCard, AnalysisNote, AnalysisProgressBar } from "./analysisBits";

// The settings panel (mockup approved 2026-10-15): the ticker's backtesting (lab) values, editable here to try them,
// save them for the ticker, or backtest them. Pot, shares, rungs, shock and |delta| can be saved for the ticker; days
// to expiry and the spread limit are the lab's global values only; the minimum bid and volume share are fixed rules.

export type AnalysisDraft = Record<AnalysisPanelKey, string>;

const decimals: Partial<Record<AnalysisPanelKey, number>> = { minAbsDelta: 2, maxAbsDelta: 2 };

export function draftFromValues(values: AnalysisPanelValues): AnalysisDraft {
  const text = (key: AnalysisPanelKey) => {
    const value = values[key];
    if (value === null) return "";
    return decimals[key] === undefined ? String(value) : value.toFixed(decimals[key]);
  };
  return { potDollars: text("potDollars"), ladderSharesPct: text("ladderSharesPct"), ladderRungs: text("ladderRungs"), ladderShockPct: text("ladderShockPct"), minAbsDelta: text("minAbsDelta"), maxAbsDelta: text("maxAbsDelta"), minDte: text("minDte"), maxDte: text("maxDte"), maxSpreadPctOfMid: text("maxSpreadPctOfMid") };
}

/** The draft as values, or the first field that is not a valid value and why. */
export function parseDraft(draft: AnalysisDraft): { values: AnalysisPanelValues; problems: Partial<Record<AnalysisPanelKey, string>> } | { values: null; problems: Partial<Record<AnalysisPanelKey, string>> } {
  const problems: Partial<Record<AnalysisPanelKey, string>> = {};
  const number = (key: AnalysisPanelKey) => (draft[key].trim() === "" ? Number.NaN : Number(draft[key]));
  const values: AnalysisPanelValues = {
    potDollars: number("potDollars"),
    ladderSharesPct: number("ladderSharesPct"),
    ladderRungs: number("ladderRungs"),
    ladderShockPct: draft.ladderShockPct.trim() === "" ? null : number("ladderShockPct"),
    minAbsDelta: number("minAbsDelta"),
    maxAbsDelta: number("maxAbsDelta"),
    minDte: number("minDte"),
    maxDte: number("maxDte"),
    maxSpreadPctOfMid: number("maxSpreadPctOfMid"),
  };
  if (!(values.potDollars > 0)) problems.potDollars = "Enter a pot above $0.";
  if (!(values.ladderSharesPct >= 1 && values.ladderSharesPct <= 99)) problems.ladderSharesPct = "Shares must be 1–99%.";
  if (!(Number.isInteger(values.ladderRungs) && values.ladderRungs >= 1 && values.ladderRungs <= 20)) problems.ladderRungs = "Rungs must be a whole number from 1 to 20.";
  if (values.ladderShockPct !== null && !(values.ladderShockPct >= 1 && values.ladderShockPct <= 99)) problems.ladderShockPct = "The shock must be 1–99%, or empty for the rule's.";
  if (!(values.minAbsDelta > 0 && values.minAbsDelta <= 1) || !(values.maxAbsDelta > 0 && values.maxAbsDelta <= 1)) problems.minAbsDelta = "|Delta| must be above 0 and at most 1.";
  else if (values.minAbsDelta > values.maxAbsDelta) problems.minAbsDelta = "The first |delta| must not be above the second.";
  if (!(Number.isInteger(values.minDte) && values.minDte >= 0) || !(Number.isInteger(values.maxDte) && values.maxDte >= 0)) problems.minDte = "Days to expiry must be whole numbers.";
  else if (values.minDte > values.maxDte) problems.minDte = "The first day must not be after the second.";
  if (!(values.maxSpreadPctOfMid > 0)) problems.maxSpreadPctOfMid = "Enter a spread limit above 0%.";
  return Object.keys(problems).length > 0 ? { values: null, problems } : { values, problems };
}

interface AnalysisSettingsCardProps {
  symbol: string;
  draft: AnalysisDraft;
  onDraftChange: (draft: AnalysisDraft) => void;
  /** The ticker's saved lab values (global with its overrides), the lab's global values, and which are the ticker's own. */
  configured: AnalysisPanelValues;
  global: AnalysisPanelValues;
  overriddenKeys: readonly AnalysisPanelKey[];
  /** The values the cards show (the stored analysis's, or a trial's). */
  displayed: AnalysisPanelValues;
  showingTrial: boolean;
  ruleShock: number;
  lastPrice: number | null;
  lastDate: string | null;
  open: boolean;
  onToggleOpen: () => void;
  /** A saved update running (the panel's actions wait), and a trial running. */
  updateRunning: boolean;
  trialRun: AnalysisRunView | null;
  busy: "save" | "run" | null;
  actionError: string | null;
  onSave: (values: AnalysisPanelValues) => void;
  onRun: (values: AnalysisPanelValues) => void;
  onBacktest: (values: AnalysisPanelValues) => void;
  onBackToStored: () => void;
  onEditGlobal: () => void;
}

const sameValue = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);

export function AnalysisSettingsCard(props: AnalysisSettingsCardProps) {
  const { symbol, draft, configured, global, displayed, ruleShock, lastPrice, lastDate } = props;
  const parsed = parseDraft(draft);
  const values = parsed.values;
  const changedFrom = (base: AnalysisPanelValues) => (values ? (Object.keys(base) as AnalysisPanelKey[]).filter((key) => !sameValue(values[key], base[key])) : []);
  const changed = changedFrom(configured);
  const pending = changedFrom(displayed);
  const savable = changed.filter((key) => analysisTickerKeys.includes(key));
  const globalOnly = changed.filter((key) => !analysisTickerKeys.includes(key));
  const awayFromGlobal = changedFrom(global);

  // The two checks at the last stored price, live as you type.
  const shock = values ? shockFor(values, ruleShock) : null;
  const lotMessage = values && lastPrice !== null && lastPrice > lotPriceCeiling(values) ? `A lot fits only while ${symbol} is under ${formatCurrency(lotPriceCeiling(values))}; it was ${formatCurrency(lastPrice)} at 10:00 on ${lastDate ? formatDayMonthYear(lastDate) : "the last day"}.` : null;
  const rungMessage = values && shock !== null && lastPrice !== null && lastPrice > rungPriceCeiling(values, shock) ? `A Put at the first cap fits a rung only while ${symbol} is under ${formatCurrency(rungPriceCeiling(values, shock))}; it was ${formatCurrency(lastPrice)}.` : null;

  const sourceTag = (key: AnalysisPanelKey) =>
    props.overriddenKeys.includes(key) ? (
      <span className="analysis-src-tag is-override" title={`Saved for ${symbol} in backtesting`}>
        {symbol} override
      </span>
    ) : (
      <span className="analysis-src-tag" title={analysisTickerKeys.includes(key) ? `Backtesting global value; ${symbol} can override it` : "Backtesting global value; no per-ticker override"}>
        Global
      </span>
    );
  const setField = (key: AnalysisPanelKey, value: string) => props.onDraftChange({ ...draft, [key]: value });
  const fieldClass = (keys: AnalysisPanelKey[], error: boolean) => `analysis-field${keys.length > 1 ? " is-wide" : ""}${keys.some((key) => changed.includes(key)) ? " is-changed" : ""}${error ? " is-invalid" : ""}`;
  const changedFlag = (keys: AnalysisPanelKey[]) =>
    keys.some((key) => changed.includes(key)) ? (
      <span className="analysis-ink-fair d-inline-flex align-items-center gap-1" style={{ fontSize: "0.7rem", fontWeight: 600 }}>
        <IconRefresh size={12} aria-hidden="true" />
        Changed: run to see its effect
      </span>
    ) : null;
  const input = (key: AnalysisPanelKey, label: string, attributes: { min?: number; max?: number; step: number; placeholder?: string }, invalid: boolean, describedBy?: string) => (
    <input
      id={`analysis-${key}`}
      className="form-control"
      type="number"
      inputMode="decimal"
      value={draft[key]}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(event) => setField(key, event.target.value)}
      {...attributes}
    />
  );
  const problem = (keys: AnalysisPanelKey[]) => keys.map((key) => parsed.problems[key]).find((message) => message !== undefined) ?? null;
  const errorLine = (id: string, message: string | null) =>
    message ? (
      <div className="analysis-field-error" id={id} role="alert">
        <IconAlertCircle size={14} aria-hidden="true" />
        <span>{message}</span>
      </div>
    ) : null;
  const single = (key: AnalysisPanelKey, label: string, unit: { text: string; before?: boolean } | null, attributes: { min?: number; max?: number; step: number; placeholder?: string }, extra: { hint?: string; message?: string | null } = {}) => {
    const message = extra.message ?? problem([key]);
    return (
      <div className={fieldClass([key], message !== null)}>
        <label className="analysis-field-label" htmlFor={`analysis-${key}`}>
          {label} {sourceTag(key)}
        </label>
        <div className="input-group">
          {unit?.before && <span className="input-group-text">{unit.text}</span>}
          {input(key, label, attributes, message !== null, message ? `analysis-error-${key}` : undefined)}
          {unit && !unit.before && <span className="input-group-text">{unit.text}</span>}
        </div>
        {changedFlag([key])}
        {extra.hint && <div className="analysis-field-hint">{extra.hint}</div>}
        {errorLine(`analysis-error-${key}`, message)}
      </div>
    );
  };
  const pair = (first: AnalysisPanelKey, second: AnalysisPanelKey, label: string, attributes: { min: number; max: number; step: number }) => {
    const message = problem([first, second]);
    return (
      <div className={fieldClass([first, second], message !== null)}>
        <span className="analysis-field-label" id={`analysis-label-${first}`}>
          {label} {sourceTag(first)}
        </span>
        <div className="input-group" role="group" aria-labelledby={`analysis-label-${first}`}>
          {input(first, `${label}, from`, attributes, message !== null)}
          <span className="input-group-text">to</span>
          {input(second, `${label}, to`, attributes, message !== null)}
        </div>
        {changedFlag([first, second])}
        {errorLine(`analysis-error-${first}`, message)}
      </div>
    );
  };

  const resetTicker = () => props.onDraftChange(draftFromValues(configured));
  const resetGlobal = () => props.onDraftChange(draftFromValues({ ...global }));
  const head = (
    <>
      <button type="button" className="btn btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={changed.length === 0 || props.updateRunning} onClick={resetTicker}>
        <IconRefresh size={16} aria-hidden="true" />
        Reset to {symbol}'s settings
      </button>
      <button type="button" className="btn btn-outline-secondary" disabled={awayFromGlobal.length === 0 || props.updateRunning} onClick={resetGlobal}>
        Reset to global
      </button>
      <button type="button" className="btn btn-outline-secondary" aria-expanded={props.open} aria-controls="analysis-settings-body" onClick={props.onToggleOpen}>
        {props.open ? "Hide" : "Edit"}
      </button>
    </>
  );

  const parts = values ? describeAllAnalysisValues(values, changed, ruleShock) : [];
  const summary = (
    <p className="mb-0" style={{ fontSize: "0.8125rem" }}>
      {changed.length > 0 ? <span className="analysis-ink-fair fw-semibold">Your values (changed in bold): </span> : <span className="text-secondary">{symbol}'s backtesting settings ({props.overriddenKeys.length > 0 ? `global with ${symbol}'s overrides` : `the global values; no ${symbol} overrides`}): </span>}
      {parts.map((part, index) => (
        <span key={part.text}>
          {index > 0 && " · "}
          {part.changed ? <b>{part.text}</b> : part.text}
        </span>
      ))}
      {values === null && <span className="analysis-ink-poor">Some values are not valid.</span>}. <span className="text-secondary">Fixed rules: {analysisFixedRulesText}.</span>
    </p>
  );

  const trial = props.trialRun;
  let runBar = null;
  if (trial) {
    const fraction = trial.step === "chains" && trial.progressTotal > 0 ? trial.progressDone / trial.progressTotal : null;
    runBar = (
      <AnalysisNote tone="info" icon="progress" live>
        <p className="d-inline-flex align-items-center gap-2">
          <Spinner size="sm" />
          Running the analysis with your values: {trial.step ? analysisStepLabels[trial.step].toLowerCase() : "starting"}
          {trial.step === "chains" && trial.progressTotal > 0 ? `, day ${formatNumber(trial.progressDone)} of ${formatNumber(trial.progressTotal)}` : ""}. A background job: closing the window does not stop it.
        </p>
        <AnalysisProgressBar fraction={fraction} label="Analysis with your values" />
      </AnalysisNote>
    );
  } else if (!props.updateRunning && values && pending.length > 0) {
    runBar = (
      <AnalysisNote
        tone="warn"
        live
        actions={
          <>
            {savable.length > 0 && (
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={props.busy !== null || lotMessage !== null || rungMessage !== null} onClick={() => props.onSave(values)}>
                {props.busy === "save" ? <Spinner size="sm" /> : <IconCheck size={16} aria-hidden="true" />}
                Save for {symbol}
              </button>
            )}
            <button type="button" className={`btn ${savable.length > 0 ? "btn-outline-primary" : "btn-primary"} d-inline-flex align-items-center gap-1`} disabled={props.busy !== null} onClick={() => props.onRun(values)}>
              {props.busy === "run" ? <Spinner size="sm" /> : <IconRefresh size={16} aria-hidden="true" />}
              Run with these values
            </button>
            <button type="button" className="btn btn-outline-primary" disabled={props.busy !== null} onClick={() => props.onBacktest(values)}>
              Backtest these values
            </button>
          </>
        }
      >
        <p>
          <b>Changed: {describeAnalysisValues(values, pending, ruleShock)}.</b> The cards below still show {props.showingTrial ? "your last run" : "the stored analysis"}. <b>Save for {symbol}</b> keeps them as {symbol}'s backtesting settings and updates the stored analysis at once. <b>Run with these values</b> recomputes the analysis without saving.
        </p>
        {globalOnly.length > 0 && (
          <p style={{ fontSize: "0.75rem" }}>
            {describeAnalysisValues(values, globalOnly, ruleShock)}: global only, so Save for {symbol} leaves {globalOnly.length === 1 ? "it" : "them"} at the global value; Run with these values and Backtest these values use {globalOnly.length === 1 ? "it" : "them"}.
          </p>
        )}
      </AnalysisNote>
    );
  } else if (props.showingTrial && values) {
    runBar = (
      <AnalysisNote
        tone="info"
        icon="done"
        live
        actions={
          <>
            <button type="button" className="btn btn-outline-primary" onClick={props.onBackToStored}>
              Back to the stored analysis
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={() => props.onBacktest(values)}>
              Backtest these values
            </button>
          </>
        }
      >
        <p>
          <b>The cards below show your values: not saved.</b>
        </p>
      </AnalysisNote>
    );
  }

  return (
    <AnalysisCard title="Settings for this analysis" description={`Backtesting only. Try values, or save them for ${symbol}.`} actions={head}>
      <div className="card-body" id="analysis-settings-body">
        {props.open ? (
          <>
            <p className="analysis-settings-source">
              <span>
                <b>{symbol}'s backtesting ladder settings:</b> the backtesting global values
                {props.overriddenKeys.length > 0 ? `, with ${symbol}'s overrides for ${describeAnalysisValues(configured, props.overriddenKeys, ruleShock)}` : `; ${symbol} has no overrides saved`}. Each box says where its value comes from. Pot, shares, rungs, shock and |delta| can be saved for {symbol}; days to expiry and the spread limit are global only; the fixed rules are the engine's. Global values are changed on the Backtesting screen:{" "}
                <button type="button" className="analysis-link" onClick={props.onEditGlobal}>
                  Edit the global lab settings
                </button>
                .
              </span>
            </p>
            <div className="analysis-settings-groups">
              <fieldset className="analysis-settings-group">
                <legend>Ladder</legend>
                <div className="analysis-fields">
                  {single("potDollars", "Pot", { text: "$", before: true }, { min: 1000, step: 1000 }, { hint: `The dollars ${symbol} starts with in a backtest`, message: problem(["potDollars"]) ?? (lotMessage || rungMessage ? "Too small at the last price: see below." : null) })}
                  {single("ladderSharesPct", "Shares", { text: "% of the pot" }, { min: 1, max: 99, step: 5 }, { message: problem(["ladderSharesPct"]) ?? lotMessage })}
                  {single("ladderRungs", "Rungs", null, { min: 1, max: 20, step: 1 }, { message: problem(["ladderRungs"]) ?? rungMessage })}
                  {single("ladderShockPct", "Shock", { text: "%" }, { min: 1, max: 99, step: 1, placeholder: String(Math.round(ruleShock * 100)) }, { hint: `The rule gives ${Math.round(ruleShock * 100)}%; empty uses it` })}
                </div>
              </fieldset>
              <fieldset className="analysis-settings-group">
                <legend>Contracts the strategy may sell</legend>
                <div className="analysis-fields">
                  {pair("minAbsDelta", "maxAbsDelta", "|Delta|", { min: 0, max: 1, step: 0.05 })}
                  {pair("minDte", "maxDte", "Days to expiry", { min: 0, max: 365, step: 1 })}
                  {single("maxSpreadPctOfMid", "Spread limit", { text: "% of the mid" }, { min: 1, max: 200, step: 5 })}
                  <p className="analysis-field-hint mb-0" style={{ gridColumn: "1 / -1" }}>
                    <span className="analysis-src-tag">Fixed</span> Fixed rules: {analysisFixedRulesText}
                  </p>
                </div>
              </fieldset>
            </div>
          </>
        ) : (
          summary
        )}
        {props.actionError && <div className="alert alert-danger mt-3 mb-0">{props.actionError}</div>}
        {runBar && <div className="mt-3">{runBar}</div>}
      </div>
    </AnalysisCard>
  );
}
