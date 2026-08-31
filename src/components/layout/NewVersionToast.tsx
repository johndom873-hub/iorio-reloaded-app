import { useEffect, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";

// Polls the served index.html for its bundled script's hashed filename and
// compares it against the one this tab loaded with -- a mismatch means a
// new deploy has gone out since this tab opened. SPAs never swap out
// already-loaded JS on their own (see 2026-08-31 support session: several
// PositionCard fixes were live on the server but invisible until a manual
// hard refresh), so this is the only way a long-open tab finds out.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function extractBundleSrc(html: string): string | null {
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  return match ? match[1] : null;
}

export function NewVersionToast() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const loadedBundleSrc = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkForNewVersion() {
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
        // Network hiccup -- the next poll retries, nothing to show for this one.
      }
    }

    checkForNewVersion();
    const interval = setInterval(checkForNewVersion, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!newVersionAvailable) return null;

  return (
    <div className="toast-container position-fixed top-0 end-0 p-3" style={{ zIndex: 1090 }}>
      <div className="toast show iorio-new-version-toast" role="status" aria-live="polite">
        <div className="toast-header iorio-new-version-toast-header">
          <IconRefresh size={18} className="me-2" />
          <strong className="me-auto">Update available</strong>
        </div>
        <div className="toast-body d-flex align-items-center justify-content-between gap-3">
          <span>A new version of Iorio is ready.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
