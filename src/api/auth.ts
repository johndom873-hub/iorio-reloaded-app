import { apiRequest } from "./client";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export function login(email: string, password: string): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function fetchCurrentSession(): Promise<AuthenticatedUser> {
  return apiRequest<AuthenticatedUser>("/auth/session");
}
