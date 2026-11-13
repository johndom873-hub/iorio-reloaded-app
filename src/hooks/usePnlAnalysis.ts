import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { fetchPnlAnalysis, type AnalysisDays, type PnlAnalysis } from "../api/pnlAnalysis";

// The P&L Analyser's figures for a range. The figures change once a night, so a range already asked for in the last five
// minutes is served from the same request: the Dashboard's four cards share one, and switching tabs or books asks nothing.
const reuseForMs = 5 * 60_000;
const requests = new Map<string, { at: number; promise: Promise<PnlAnalysis> }>();

function requestFor(days: AnalysisDays): Promise<PnlAnalysis> {
  const key = `${days.from ?? ""}|${days.to ?? ""}`;
  const kept = requests.get(key);
  if (kept && Date.now() - kept.at < reuseForMs) return kept.promise;
  const promise = fetchPnlAnalysis(days);
  requests.set(key, { at: Date.now(), promise });
  promise.catch(() => requests.delete(key));
  return promise;
}

export function usePnlAnalysis(days: AnalysisDays): { analysis: PnlAnalysis | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ key: string; analysis: PnlAnalysis | null; error: string | null }>({ key: "", analysis: null, error: null });
  const key = `${days.from ?? ""}|${days.to ?? ""}`;
  useEffect(() => {
    let current = true;
    requestFor({ from: days.from, to: days.to })
      .then((analysis) => current && setState({ key, analysis, error: null }))
      .catch((error: unknown) => current && setState({ key, analysis: null, error: errorMessage(error, "Couldn't load the P&L figures.") }));
    return () => {
      current = false;
    };
  }, [key, days.from, days.to]);
  const settled = state.key === key;
  return { analysis: settled ? state.analysis : null, loading: !settled, error: settled ? state.error : null };
}
