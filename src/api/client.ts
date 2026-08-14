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
    throw new ApiError(body.error ?? "Request failed", response.status);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}
