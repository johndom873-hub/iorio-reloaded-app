// Tells the API this frontend release has started, so the API can send the Telegram notice (deployed / config
// change / restart) the same way it does for itself: the app has no database or Telegram credentials of its own.
// It calls the API app's Heroku address (DEPLOY_NOTICE_API_URL), not the public domain: Cloudflare in front of the
// public domain answers 403 to requests from Heroku's network, and this server-to-server call must not depend on it.
// Never throws and never delays serving: it runs in the background after the server is listening. The API may be
// restarting at this very moment (both apps promoted together), so a failed attempt is retried for a few minutes.

const retryDelaysMs = [5_000, 15_000, 30_000, 60_000, 120_000];
const requestTimeoutMs = 10_000;
// Retrying cannot fix these: the secret is wrong, or the request itself is malformed.
const permanentFailureStatuses = new Set([400, 401, 404]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function announceStartToApi({ environment = process.env, fetchImplementation = fetch, sleepImplementation = sleep, log = console } = {}) {
  const secret = environment.DEPLOY_NOTICE_SECRET;
  if (!secret) {
    log.warn("DEPLOY_NOTICE_SECRET is not set: this start is not announced on Telegram.");
    return false;
  }
  const apiBaseUrl = environment.DEPLOY_NOTICE_API_URL;
  if (!apiBaseUrl) {
    log.warn("DEPLOY_NOTICE_API_URL is not set: this start is not announced on Telegram.");
    return false;
  }
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/deploy-notices`;
  const body = JSON.stringify({ releaseVersion: environment.HEROKU_RELEASE_VERSION, commitSha: environment.HEROKU_SLUG_COMMIT });

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const response = await fetchImplementation(url, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Deploy-Notice-Secret": secret },
        body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        log.log("Start announced to the API.");
        return true;
      }
      const rejectionBody = (await response.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
      log.warn(`Start notice rejected (HTTP ${response.status}, server: ${response.headers.get("server") ?? "unknown"}): ${rejectionBody}`);
      if (permanentFailureStatuses.has(response.status)) return false;
    } catch (error) {
      log.warn(`Start notice could not reach the API: ${error instanceof Error ? error.message : error}`);
    }
    if (attempt < retryDelaysMs.length) await sleepImplementation(retryDelaysMs[attempt]);
  }
  log.warn("Giving up announcing this start.");
  return false;
}
