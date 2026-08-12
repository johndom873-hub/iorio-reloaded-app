import { PageHeader } from "../components/layout/PageHeader";

export function TradeAlertsPage() {
  return (
    <>
      <PageHeader title="Trade Alerts" subtitle="Suggested trades and rolls awaiting your review" />
      <div className="alert alert-info">
        Not built yet — will show ranked candidate trades (new positions and rolls) with inline approve/reject/modify,
        payoff diagrams, and live Greeks.
      </div>
    </>
  );
}
