import { useEffect, useState } from "react";
import { IconPlugConnected, IconWifiOff } from "@tabler/icons-react";
import { Spinner } from "../Spinner";
import {
  retryMultiplexerConnectionNow,
  subscribeToMultiplexerConnectionStatus,
  type MultiplexerConnectionStatus,
} from "../../api/streamMultiplexer";

// The multiplexer (api/streamMultiplexer.ts) reconnects on its own with
// backoff and re-sends every subscription, so a dyno restart of a couple of
// minutes needs no action from the user — this toast only says the numbers on
// screen are not live right now and offers "Retry now" to skip the wait. It
// stays out of the way for short blips and routine deploys: nothing is shown
// until the outage has lasted a few seconds.
const SHOW_AFTER_OUTAGE_MS = 10_000;
const RECONNECTED_MESSAGE_MS = 3_000;
const RETRY_BUTTON_LOCK_MS = 1_500;

export function StreamConnectionToast() {
  const [status, setStatus] = useState<MultiplexerConnectionStatus>({ isReconnecting: false, reconnectingSinceMs: null });
  const [isVisible, setIsVisible] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => subscribeToMultiplexerConnectionStatus(setStatus), []);

  useEffect(() => {
    if (status.isReconnecting && status.reconnectingSinceMs !== null) {
      const remainingMs = Math.max(0, SHOW_AFTER_OUTAGE_MS - (Date.now() - status.reconnectingSinceMs));
      const timer = setTimeout(() => {
        setShowReconnected(false);
        setIsVisible(true);
      }, remainingMs);
      return () => clearTimeout(timer);
    }
    // Back online: if the outage toast was showing, confirm briefly, then go away.
    if (isVisible) {
      setIsVisible(false);
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_MESSAGE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isVisible is only read to decide the recovery message, not a trigger.
  }, [status.isReconnecting, status.reconnectingSinceMs]);

  if (!isVisible && !showReconnected) return null;

  return (
    <div className="toast-container position-fixed end-0 p-3" style={{ top: "var(--iorio-topbar-height)", zIndex: 1091 }}>
      <div className="toast show iorio-stream-connection-toast" role="status" aria-live="polite">
        <div className="toast-header">
          {showReconnected ? <IconPlugConnected size={18} className="me-2 text-success" /> : <IconWifiOff size={18} className="me-2 text-warning" />}
          <strong className="me-auto">{showReconnected ? "Reconnected" : "Live data disconnected"}</strong>
        </div>
        <div className="toast-body d-flex align-items-center justify-content-between gap-3">
          <span>{showReconnected ? "Live prices are updating again." : "Reconnecting… the values shown are not live."}</span>
          {!showReconnected && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={isRetrying}
              onClick={() => {
                setIsRetrying(true);
                retryMultiplexerConnectionNow();
                setTimeout(() => setIsRetrying(false), RETRY_BUTTON_LOCK_MS);
              }}
            >
              {isRetrying ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Retrying…
                </>
              ) : (
                "Retry now"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
