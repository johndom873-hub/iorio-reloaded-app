import { PageHeader } from "../components/layout/PageHeader";

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Aggregate P&L across all strategies" />
      <div className="alert alert-info">
        Not built yet — will show grand-total and per-strategy P&L (day/week/month/year), realized vs. unrealized.
      </div>
    </>
  );
}
