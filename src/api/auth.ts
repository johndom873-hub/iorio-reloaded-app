import { apiRequest } from "./client";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
}

export function login(username: string, password: string): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function fetchCurrentSession(): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/session");
}
