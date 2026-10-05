import { useEffect, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { useUserActivity } from "../../hooks/useUserActivity";
import { Spinner } from "../Spinner";

// Polls the served index.html for its bundled script's hashed filename and
// compares it against the one this tab loaded with -- a mismatch means a
// new deploy has gone out since this tab opened. SPAs never swap out
// already-loaded JS on their own (see 2026-08-31 support session: several
// PositionCard fixes were live on the server but invisible until a manual
// hard refresh), so this is the only way a long-open tab finds out.
//
// This is the only recurring request a tab makes to the frontend dyno (every API call goes to the API app),
// and the frontend runs on an Eco dyno that sleeps after 30 minutes without traffic. So a check runs only
// while the tab is visible AND the user has given input within inactivityLimitMs; otherwise the dyno is left
// to sleep. Returning to the tab, or the first input after an idle spell, checks right away.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

function extractBundleSrc(html: string): string | null {
  // Only the hashed Vite entry under /assets/ -- the un-hashed /config.js script ahead of it never changes between deploys.
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/);
  return match ? match[1] : null;
}

// The bundle this tab actually loaded, read from its own DOM so a check that is delayed (tab opened in the
// background, user away) still compares against the right build. Null under the Vite dev server, which has no hashed bundle.
function readLoadedBundleSrc(): string | null {
  return document.querySelector('script[src^="/assets/"]')?.getAttribute("src") ?? null;
}

export function NewVersionToast() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const loadedBundleSrc = useRef<string | null>(readLoadedBundleSrc());
  const checkIfDueRef = useRef<() => void>(() => {});
  const isUserActive = useUserActivity(INACTIVITY_LIMIT_MS, () => checkIfDueRef.current());

  useEffect(() => {
    let cancelled = false;
    let lastCheckStartedAtMs = 0;

    async function checkForNewVersion() {
      lastCheckStartedAtMs = Date.now();
      try {
        const response = await fetch("/", { cache: "no-store" });
        const html = await response.text();
        const bundleSrc = extractBundleSrc(html);
        if (!bundleSrc || cancelled) return;

        if (loadedBundleSrc.current === null) {
          loadedBundleSrc.current = bundleSrc;
          return;
        }
        if (bundleSrc !== loadedBundleSrc.current) {
          setNewVersionAvailable(true);
        }
      } catch {
        // Network hiccup -- the next check retries, nothing to show for this one.
      }
    }

    function shouldCheck(): boolean {
      return document.visibilityState === "visible" && isUserActive();
    }

    // Resume path (tab shown again, input after idle): skipped when a check ran within the last interval.
    function checkIfDue() {
      if (!shouldCheck() || Date.now() - lastCheckStartedAtMs < POLL_INTERVAL_MS) return;
      void checkForNewVersion();
    }
    checkIfDueRef.current = checkIfDue;

    if (loadedBundleSrc.current === null) checkIfDue();
    const interval = setInterval(() => {
      if (shouldCheck()) void checkForNewVersion();
    }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", checkIfDue);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkIfDue);
      checkIfDueRef.current = () => {};
    };
  }, [isUserActive]);

  if (!newVersionAvailable) return null;

  return (
    <div
      className="toast-container position-fixed end-0 p-3"
      style={{ top: "var(--iorio-topbar-height)", zIndex: 1090 }}
    >
      <div className="toast show iorio-new-version-toast" role="status" aria-live="polite">
        <div className="toast-header">
          <IconRefresh size={18} className="me-2" />
          <strong className="me-auto">Update available</strong>
        </div>
        <div className="toast-body d-flex align-items-center justify-content-between gap-3">
          <span>A new version of Iorio is ready.</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isReloading}
            onClick={() => {
              setIsReloading(true);
              window.location.reload();
            }}
          >
            {isReloading ? (
              <>
                <Spinner size="sm" className="me-2" />
                Reloading…
              </>
            ) : (
              "Reload"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
