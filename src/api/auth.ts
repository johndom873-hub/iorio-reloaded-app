import { apiRequest } from "./client";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthConfig {
  passkeyLoginRequired: boolean;
}

// With passkeys required a correct password signs nobody in: it only opens enrolment of a first passkey.
export type PasswordLoginResult = { outcome: "signed_in"; user: AuthenticatedUser } | { outcome: "passkey_enrollment_required" };

export function fetchAuthConfig(): Promise<AuthConfig> {
  return apiRequest<AuthConfig>("/auth/config");
}

export async function login(username: string, password: string): Promise<PasswordLoginResult> {
  const response = await apiRequest<AuthenticatedUser | { status: "passkey_enrollment_required" }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return "status" in response ? { outcome: "passkey_enrollment_required" } : { outcome: "signed_in", user: response };
}

export function logout(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function fetchCurrentSession(): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/session");
}
