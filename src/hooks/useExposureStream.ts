import { useEffect, useState } from "react";
import { openExposureStream, type ExposureData } from "../api/riskLimits";

/**
 * Shared by Dashboard, Pulse and Risk & Limits (2026-09-19, replacing their
 * one-shot fetchExposure). `loading` stays true until the first reading
 * arrives. A stream error only becomes an `error` while nothing has arrived
 * yet: the server also ends the stream on its own (e.g. when there are no
 * open positions it sends one empty reading and closes), and that must not
 * replace a good reading with an error.
 */
export function useExposureStream(errorMessage: string): { exposure: ExposureData | null; loading: boolean; error: string | null } {
  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let receivedAny = false;
    const close = openExposureStream(
      (reading) => {
        receivedAny = true;
        setExposure(reading);
        setLoading(false);
        setError(null);
      },
      () => {
        setLoading(false);
        if (!receivedAny) setError(errorMessage);
      },
    );
    return close;
  }, [errorMessage]);

  return { exposure, loading, error };
}
