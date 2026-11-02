import { useEffect, useMemo, useState } from "react";
import { IconAlertCircle } from "@tabler/icons-react";
import { tickerOwnValueFields, type TickerFieldValues, type TickerOwnValueField, type TickerOwnValues } from "../../../api/backtestAnalysis";
import {
  describeTickerValueLabHint,
  describeTickerValues,
  describeTickerValuesDifferingFromLab,
  parseTickerOwnValueText,
  tickerOwnValueInputText,
  tickerOwnValueProblem,
  tickerValueGroups,
  tickerValueGroupsDiffering,
  type TickerValueGroup,
} from "../../../lib/analysisPresentation";
import { formatCurrency } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";
import { AnalysisCard, AnalysisNote } from "./analysisBits";

// The Analyse window's "AMD's values" card (mockup approved 2026-11-02): the five Vol Farmer v4 values a ticker can hold
// of its own, for its analysis and a backtest of it alone. Save and Analyse keeps them and re-runs the analysis; Analyse
// Only runs a trial with them and saves nothing.

type DraftText = Record<TickerOwnValueField, string>;

const draftTextOf = (values: TickerFieldValues): DraftText => Object.fromEntries(tickerOwnValueFields.map((field) => [field, tickerOwnValueInputText(field, values[field])])) as DraftText;

/** A trial with values of its own, shown below: its five and its starting account. */
export interface AnalysisShownValuesTrial {
  values: TickerFieldValues;
  accountDollars: number;
  /** Its account is the lab's default (the trial changed the values only). */
  atLabAccount: boolean;
}

interface AnalysisTickerValuesCardProps {
  symbol: string;
  /** The lab's five now. */
  labValues: TickerFieldValues;
  /** The ticker's own values saved (null: the lab's); null when it has none. */
  ownValues: TickerOwnValues | null;
  /** The values trial the cards below show; null when they show the stored analysis or a trial at another account only. */
  shownTrial: AnalysisShownValuesTrial | null;
  /** The cards below show a trial (of any kind). */
  showingTrial: boolean;
  savedAnalysisRunning: boolean;
  trialRunning: boolean;
  busy: boolean;
  saving: boolean;
  tryingValues: boolean;
  onSave: (values: TickerFieldValues) => void;
  onAnalyseOnly: (values: TickerFieldValues) => void;
  onBackToStored: () => void;
}

export function AnalysisTickerValuesCard({ symbol, labValues, ownValues, shownTrial, showingTrial, savedAnalysisRunning, trialRunning, busy, saving, tryingValues, onSave, onAnalyseOnly, onBackToStored }: AnalysisTickerValuesCardProps) {
  const savedValues = useMemo<TickerFieldValues>(() => Object.fromEntries(tickerOwnValueFields.map((field) => [field, ownValues?.[field] ?? labValues[field]])) as TickerFieldValues, [ownValues, labValues]);
  const savedKey = JSON.stringify(savedValues);
  const [draft, setDraft] = useState<DraftText>(() => draftTextOf(savedValues));
  // The boxes start again from the saved values whenever those change (a save, the lab's value of a null).
  useEffect(() => {
    setDraft(draftTextOf(JSON.parse(savedKey) as TickerFieldValues));
  }, [savedKey]);

  const problemByField = Object.fromEntries(tickerOwnValueFields.map((field) => [field, tickerOwnValueProblem(field, draft[field])])) as Record<TickerOwnValueField, string | null>;
  const parsed = Object.fromEntries(tickerOwnValueFields.map((field) => [field, parseTickerOwnValueText(draft[field])])) as Record<TickerOwnValueField, number | null>;
  const callsCrossed = problemByField.callMinAbsDelta === null && problemByField.callMaxAbsDelta === null && parsed.callMinAbsDelta! > parsed.callMaxAbsDelta!;
  const groupProblem = (group: TickerValueGroup): string | null => {
    const fields = tickerValueGroups.find((entry) => entry.group === group)!.fields;
    const fieldProblem = fields.map((field) => problemByField[field]).find((problem) => problem !== null) ?? null;
    if (fieldProblem) return fieldProblem;
    return group === "calls" && callsCrossed ? "The from must not be above the to" : null;
  };
  const valid = tickerOwnValueFields.every((field) => problemByField[field] === null) && !callsCrossed;
  const draftValues: TickerFieldValues | null = valid ? (parsed as TickerFieldValues) : null;
  // A box is changed when its text no longer reads the saved value.
  const changedGroups = tickerValueGroups.filter(({ fields }) => fields.some((field) => parsed[field] !== savedValues[field])).map(({ group }) => group);
  const ownGroups = tickerValueGroupsDiffering(savedValues, labValues);
  const atLab = draftValues !== null && tickerValueGroupsDiffering(draftValues, labValues).length === 0;
  const trialMatches = shownTrial !== null && draftValues !== null && tickerValueGroupsDiffering(draftValues, shownTrial.values).length === 0;
  const describedChanges = draftValues ? (atLab ? "back to the lab's values" : describeTickerValues(draftValues, changedGroups)) : null;

  // Back to the stored analysis: the boxes read the saved values again.
  const backToStored = () => {
    setDraft(draftTextOf(savedValues));
    onBackToStored();
  };

  const saveButton = (
    <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={!draftValues || busy || savedAnalysisRunning} title={savedAnalysisRunning ? `${symbol}'s analysis is re-running: save once it finishes` : undefined} onClick={() => draftValues && onSave(draftValues)}>
      {saving && <Spinner size="sm" />}
      Save and Analyse
    </button>
  );

  let note = null;
  if (trialMatches && shownTrial) {
    const described = describeTickerValuesDifferingFromLab(shownTrial.values, labValues) || "the lab's values";
    note = (
      <AnalysisNote
        tone="info"
        icon="done"
        actions={
          <>
            {saveButton}
            <button type="button" className="btn btn-outline-primary" onClick={backToStored}>
              Back to the stored analysis
            </button>
          </>
        }
      >
        <p>
          <b>
            A trial with {described}
            {shownTrial.atLabAccount ? "" : ` at ${formatCurrency(shownTrial.accountDollars, 0)}`}:
          </b>{" "}
          the cards below show it. Nothing is saved for {symbol}.
        </p>
      </AnalysisNote>
    );
  } else if (changedGroups.length > 0) {
    note = (
      <AnalysisNote
        tone="warn"
        actions={
          <>
            {saveButton}
            <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1" disabled={!draftValues || busy || trialRunning} title={trialRunning ? "A trial is running: try these once it finishes, or stop it" : undefined} onClick={() => draftValues && onAnalyseOnly(draftValues)}>
              {tryingValues && <Spinner size="sm" />}
              Analyse Only
            </button>
            {shownTrial && (
              <button type="button" className="btn btn-outline-secondary" onClick={backToStored}>
                Back to the stored analysis
              </button>
            )}
          </>
        }
      >
        <p>
          <b>{describedChanges ? `Changed: ${describedChanges}.` : "Changed."}</b> The cards below still show {showingTrial ? "the last trial" : "the stored analysis"}. Save and Analyse keeps the values for {symbol} and re-runs its analysis; Analyse Only runs a trial with them and saves nothing.
          {!draftValues && " Correct the box marked first."}
        </p>
      </AnalysisNote>
    );
  }

  const tag = (group: TickerValueGroup) => (ownGroups.includes(group) ? <span className="analysis-src-tag is-override">{symbol}</span> : <span className="analysis-src-tag">Lab</span>);
  const fieldClass = (group: TickerValueGroup) => `analysis-field${changedGroups.includes(group) ? " is-changed" : ""}${groupProblem(group) ? " is-invalid" : ""}`;
  const errorOf = (group: TickerValueGroup) => {
    const problem = groupProblem(group);
    return (
      problem && (
        <div className="analysis-field-error" id={`ticker-values-${group}-error`}>
          <IconAlertCircle size={14} aria-hidden="true" />
          {problem}
        </div>
      )
    );
  };
  const describedBy = (group: TickerValueGroup) => `ticker-values-${group}-hint${groupProblem(group) ? ` ticker-values-${group}-error` : ""}`;
  const input = (field: TickerOwnValueField, group: TickerValueGroup, extra: { id?: string; ariaLabel?: string } = {}) => (
    <input
      id={extra.id}
      type="text"
      className="form-control"
      inputMode="decimal"
      aria-label={extra.ariaLabel}
      aria-invalid={problemByField[field] !== null || (group === "calls" && callsCrossed) ? true : undefined}
      aria-describedby={describedBy(group)}
      value={draft[field]}
      onChange={(event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }))}
    />
  );
  const hint = (group: TickerValueGroup) => (
    <div className="analysis-field-hint" id={`ticker-values-${group}-hint`}>
      {describeTickerValueLabHint(group, labValues)}
    </div>
  );

  return (
    <AnalysisCard
      title={`${symbol}'s values`}
      description={`Vol Farmer v4, backtesting only: ${symbol}'s analysis and a backtest of ${symbol} alone. Every other value is the lab's.`}
      actions={
        <button type="button" className="btn btn-outline-secondary" disabled={atLab} onClick={() => setDraft(draftTextOf(labValues))}>
          Use the lab's values
        </button>
      }
    >
      <div className="card-body">
        <div className="analysis-fields" style={{ gridTemplateColumns: "minmax(0, 2fr) repeat(3, minmax(0, 1fr))" }}>
          <div className={fieldClass("calls")}>
            <span className="analysis-field-label" id="ticker-values-calls-label">
              Calls' |delta| {tag("calls")}
            </span>
            <div className="input-group" role="group" aria-labelledby="ticker-values-calls-label">
              {input("callMinAbsDelta", "calls", { ariaLabel: "Calls' |delta|, from" })}
              <span className="input-group-text">to</span>
              {input("callMaxAbsDelta", "calls", { ariaLabel: "Calls' |delta|, to" })}
            </div>
            {errorOf("calls")}
            {hint("calls")}
          </div>
          <div className={fieldClass("firstPosition")}>
            <label className="analysis-field-label" htmlFor="ticker-values-first-position">
              First position {tag("firstPosition")}
            </label>
            <div className="input-group">
              {input("firstPositionPct", "firstPosition", { id: "ticker-values-first-position" })}
              <span className="input-group-text">% of the pot</span>
            </div>
            {errorOf("firstPosition")}
            {hint("firstPosition")}
          </div>
          <div className={fieldClass("put")}>
            <label className="analysis-field-label" htmlFor="ticker-values-put">
              Put |delta| {tag("put")}
            </label>
            {input("putMaxAbsDelta", "put", { id: "ticker-values-put" })}
            {errorOf("put")}
            {hint("put")}
          </div>
          <div className={fieldClass("leaps")}>
            <label className="analysis-field-label" htmlFor="ticker-values-leaps">
              LEAPS cap {tag("leaps")}
            </label>
            <div className="input-group">
              {input("leapsMaxAccountPct", "leaps", { id: "ticker-values-leaps" })}
              <span className="input-group-text">% of the account</span>
            </div>
            {errorOf("leaps")}
            {hint("leaps")}
          </div>
        </div>
        {note && <div className="mt-3">{note}</div>}
      </div>
    </AnalysisCard>
  );
}
