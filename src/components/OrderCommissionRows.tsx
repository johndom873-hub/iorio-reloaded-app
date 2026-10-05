import type { ReactNode } from "react";
import { formatCurrency, formatPercentage } from "../lib/formatters";
import type { OrderCommissionPreviewState } from "../hooks/useOrderCommissionPreview";
import { Spinner } from "./Spinner";

// The commission lines of an order setup form (approved 2026-10-02): IBKR's worst-case commission for the order
// with its min-max range beside it (or the labelled estimate), what is left of the premium after it, and a warning when it takes more than the configured
// share. The share is computed here from the form's live expected premium, so it follows the quote while
// the commission itself comes from the one what-if.

interface OrderCommissionRowsProps extends OrderCommissionPreviewState {
  /** Net option premium the form expects to receive, in dollars (negative for a net debit). */
  expectedPremiumDollars: number;
}

function Row({ label, value, tone, title }: { label: ReactNode; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div className="d-flex justify-content-between gap-3 py-1" style={{ fontSize: "0.85rem" }} title={title}>
      <span className="text-secondary">{label}</span>
      <span className={`font-mono text-end text-nowrap ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

export function OrderCommissionRows({ preview, loading, failed, expectedPremiumDollars }: OrderCommissionRowsProps) {
  if (!preview) {
    return <Row label="Commission" value={loading ? <Spinner size="sm" /> : failed ? "unavailable" : "—"} />;
  }
  const commission = preview.commissionDollars;
  const netAfterCommission = expectedPremiumDollars - commission;
  const share = expectedPremiumDollars === 0 ? null : (commission / Math.abs(expectedPremiumDollars)) * 100;
  const warn = expectedPremiumDollars <= 0 || (share !== null && share > preview.warnThresholdPct);
  const isEstimate = preview.source === "estimate";
  return (
    <>
      <Row
        label={
          <>
            Commission{" "}
            {isEstimate ? (
              <span className="badge bg-secondary-lt" style={{ fontSize: "0.72rem" }}>
                est.
              </span>
            ) : (
              <span className="text-secondary">· worst case</span>
            )}
          </>
        }
        value={formatCurrency(commission, 2)}
        title={isEstimate ? `IBKR did not return a figure (${preview.estimateReason ?? "no reason given"}). Estimated from your recent fills${preview.estimateExcludesStockLeg ? ", option legs only" : ""}.` : "IBKR's maximum commission for this order. The net premium and the warning use it."}
      />
      {!isEstimate && preview.commissionMinDollars !== null && (
        <Row label="IBKR range" value={`${formatCurrency(preview.commissionMinDollars, 2)} – ${formatCurrency(commission, 2)}`} />
      )}
      <Row label="Net premium after commission" value={formatCurrency(netAfterCommission, 2)} tone={netAfterCommission > 0 ? undefined : "text-danger"} />
      <Row label="Commission vs premium" value={share === null ? "—" : formatPercentage(share / 100, 1)} />
      {warn && (
        <div className="alert alert-warning mb-0 py-2 mt-1" style={{ fontSize: "0.85rem" }}>
          {expectedPremiumDollars <= 0
            ? "This order has no net premium to cover the commission."
            : `Commission is ${formatPercentage(share! / 100, 1)} of the premium, above your ${preview.warnThresholdPct}% warning level.`}
        </div>
      )}
    </>
  );
}
