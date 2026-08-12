import { PageHeader } from "../components/layout/PageHeader";

export function RiskLimitsPage() {
  return (
    <>
      <PageHeader title="Risk & Limits" subtitle="Current exposure and per-strategy trade thresholds" />
      <div className="alert alert-info">
        Not built yet — will show buying power used, concentration by ticker/sector, and configurable per-strategy
        settings (delta/DTE targets, position sizing limits).
      </div>
    </>
  );
}
