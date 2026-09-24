export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("Missing required environment variable: VITE_API_BASE_URL");
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<TResponse>(path: string, options: RequestInit = {}): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    redirectToLoginOnExpiredSession(response.status, path);
    throw new ApiError(body.error ?? "Request failed", response.status);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

// An expired session used to show "Not logged in." inside every widget and
// never leave the page (2026-09-24). Any 401 outside the auth endpoints
// themselves sends the browser to the login page once.
let redirectingToLogin = false;
function redirectToLoginOnExpiredSession(status: number, path: string): void {
  if (status !== 401 || path.startsWith("/auth/") || redirectingToLogin) return;
  if (window.location.pathname === "/login") return;
  redirectingToLogin = true;
  window.location.assign("/login");
}

/**
 * Same contract as apiRequest for the routes the backend answers as a
 * streamed result (src/lib/streamedResponse.ts): operations that can outlast
 * Heroku's 30s router timeout (chain quotes, a Gateway restart) stream
 * heartbeats and then one final `data:` frame carrying the status + body a
 * plain JSON route would have sent. Resolves with the body or throws the
 * same ApiError, so callers don't know the difference.
 */
export async function apiStreamedRequest<TResponse>(path: string, options: RequestInit = {}): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    redirectToLoginOnExpiredSession(response.status, path);
    throw new ApiError(body.error ?? "Request failed", response.status);
  }

  // The whole stream is small (heartbeat comments + one JSON frame), so
  // waiting for it to end is simpler and just as fast as incremental parsing.
  const text = await response.text();
  const finalFrame = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .at(-1);
  if (!finalFrame) throw new ApiError("The server closed the stream without a result.", 502);

  const result = JSON.parse(finalFrame.slice("data: ".length)) as { status: number; body: { error?: string } | null };
  if (result.status >= 400) throw new ApiError(result.body?.error ?? "Request failed", result.status);
  if (result.status === 204) return undefined as TResponse;
  return result.body as TResponse;
}
