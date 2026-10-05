import { useEffect, useRef, useState } from "react";
import { previewOrderCommission, type CommissionPreviewLeg, type OrderCommissionPreview } from "../api/orderChecks";

const commissionPreviewDebounceMs = 400;

/** The ISO date the Signals API carries (2026-11-20) as IBKR's contract month format (20261120). */
export function toIbkrExpiry(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

export interface OrderCommissionPreviewState {
  preview: OrderCommissionPreview | null;
  loading: boolean;
  failed: boolean;
}

// One what-if per setup form, again only when the order's shape changes (symbol, contracts, strikes, expiries,
// sides) -- deliberately NOT when a leg's price ticks, so a live quote never re-asks IBKR. Pass null while the
// legs are not buildable (no quote, no spot): nothing is requested.
export function useOrderCommissionPreview(legs: CommissionPreviewLeg[] | null): OrderCommissionPreviewState {
  const [state, setState] = useState<OrderCommissionPreviewState>({ preview: null, loading: false, failed: false });
  const latestLegsRef = useRef(legs);
  latestLegsRef.current = legs;
  const shapeKey = legs === null ? null : JSON.stringify(legs.map(({ unitPrice: _unitPrice, ...shape }) => shape));

  useEffect(() => {
    if (shapeKey === null) {
      setState({ preview: null, loading: false, failed: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    const timer = window.setTimeout(() => {
      const legsToPreview = latestLegsRef.current;
      if (legsToPreview === null) return;
      previewOrderCommission(legsToPreview)
        .then((preview) => !cancelled && setState({ preview, loading: false, failed: false }))
        .catch(() => !cancelled && setState({ preview: null, loading: false, failed: true }));
    }, commissionPreviewDebounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shapeKey]);

  return state;
}
