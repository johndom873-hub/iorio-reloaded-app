import { useState } from "react";
import { todayInEasternIso } from "../../lib/formatters";
import { analysisDaysForPreset, analysisPresetLabels, type AnalysisPeriod, type AnalysisPreset } from "../../lib/pnlAnalysisPresentation";

/** The P&L Analyser's period: MTD, QTD, YTD, since inception, or a custom from–to (Eastern dates). */
export function AnalysisPeriodPicker({ period, onChange }: { period: AnalysisPeriod; onChange: (period: AnalysisPeriod) => void }) {
  const [customOpen, setCustomOpen] = useState(period.preset === "custom");
  const [customFrom, setCustomFrom] = useState(period.days.from ?? "");
  const [customTo, setCustomTo] = useState(period.days.to ?? "");
  const presets = Object.keys(analysisPresetLabels) as Exclude<AnalysisPreset, "custom">[];
  const customValid = customFrom !== "" && (customTo === "" || customFrom <= customTo);

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <div className="btn-group pnl-period-presets" role="group" aria-label="Period">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`btn btn-outline-secondary${period.preset === preset ? " active" : ""}`}
            aria-pressed={period.preset === preset}
            onClick={() => {
              setCustomOpen(false);
              onChange({ preset, days: analysisDaysForPreset(preset, todayInEasternIso()) });
            }}
          >
            {analysisPresetLabels[preset]}
          </button>
        ))}
        <button type="button" className={`btn btn-outline-secondary${period.preset === "custom" || customOpen ? " active" : ""}`} aria-pressed={period.preset === "custom"} aria-expanded={customOpen} onClick={() => setCustomOpen((open) => !open)}>
          Custom
        </button>
      </div>
      {customOpen && (
        <form
          className="d-flex flex-wrap align-items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (customValid) onChange({ preset: "custom", days: { from: customFrom, to: customTo === "" ? null : customTo } });
          }}
        >
          <label className="visually-hidden" htmlFor="analysis-period-from">From</label>
          <input id="analysis-period-from" type="date" className="form-control" style={{ width: "10rem" }} value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} />
          <span className="text-secondary">to</span>
          <label className="visually-hidden" htmlFor="analysis-period-to">To</label>
          <input id="analysis-period-to" type="date" className="form-control" style={{ width: "10rem" }} value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!customValid}>
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
