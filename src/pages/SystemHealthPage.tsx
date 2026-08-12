import { PageHeader } from "../components/layout/PageHeader";

export function SystemHealthPage() {
  return (
    <>
      <PageHeader
        title="System Health"
        subtitle="Scheduled job status and modular health checks"
        actions={
          <button type="button" className="btn btn-outline-primary">
            Run Health Check Now
          </button>
        }
      />
      <div className="alert alert-info">
        Not built yet — will show per-module status (IBKR Gateway, prices, option pricing, option chains) and job run
        history.
      </div>
    </>
  );
}
