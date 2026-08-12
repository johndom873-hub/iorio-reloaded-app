import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";

type StrategyKey = "covered_call" | "cash_secured_put";

export function ScreenerShortlistPage() {
  const [strategy, setStrategy] = useState<StrategyKey>("covered_call");
  const [tab, setTab] = useState<"screener" | "shortlist">("screener");

  return (
    <>
      <PageHeader
        title="Screener & Shortlist"
        subtitle="Find and monitor candidate tickers"
        actions={
          <select
            className="form-select"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as StrategyKey)}
          >
            <option value="covered_call">Covered Calls</option>
            <option value="cash_secured_put">Cash-Secured Puts</option>
          </select>
        }
      />
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button type="button" className={`nav-link ${tab === "screener" ? "active" : ""}`} onClick={() => setTab("screener")}>
            Screener
          </button>
        </li>
        <li className="nav-item">
          <button type="button" className={`nav-link ${tab === "shortlist" ? "active" : ""}`} onClick={() => setTab("shortlist")}>
            Shortlist
          </button>
        </li>
      </ul>
      <div className="alert alert-info">Not built yet — {tab} tab for {strategy.replace("_", " ")}.</div>
    </>
  );
}
