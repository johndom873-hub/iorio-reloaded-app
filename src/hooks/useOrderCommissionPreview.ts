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

// One what-if per leg, each leg priced as an order of its own (approved 2026-11-13): IBKR answers one commission per
// order, so a combo's figure can't be split between its legs. Asked once per set of legs (an order under review
// doesn't change). Pass null for nothing to ask.
export function useCommissionPreviewPerLeg(legs: CommissionPreviewLeg[] | null): OrderCommissionPreviewState[] {
  const [states, setStates] = useState<OrderCommissionPreviewState[]>([]);
  const latestLegsRef = useRef(legs);
  latestLegsRef.current = legs;
  const legsKey = legs === null ? null : JSON.stringify(legs);

  useEffect(() => {
    const legsToPreview = latestLegsRef.current;
    if (legsToPreview === null) {
      setStates([]);
      return;
    }
    let cancelled = false;
    setStates(legsToPreview.map(() => ({ preview: null, loading: true, failed: false })));
    legsToPreview.forEach((leg, index) => {
      const settle = (state: OrderCommissionPreviewState) => {
        if (!cancelled) setStates((previous) => previous.map((existing, existingIndex) => (existingIndex === index ? state : existing)));
      };
      previewOrderCommission([leg])
        .then((preview) => settle({ preview, loading: false, failed: false }))
        .catch(() => settle({ preview: null, loading: false, failed: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [legsKey]);

  return states;
}
