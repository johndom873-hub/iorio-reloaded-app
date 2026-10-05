import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { ApiError, apiRequest } from "./client";
import type { AuthenticatedUser } from "./auth";

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

// Creates a passkey for the user whose password was just accepted. Does not sign them in: the login page then asks for a
// sign-in with the new passkey, which proves it works before the password stops being usable.
export async function registerPasskey(): Promise<void> {
  const optionsJSON = await apiRequest<PublicKeyCredentialCreationOptionsJSON>("/auth/passkey/register/options", { method: "POST" });
  const registration = await startRegistration({ optionsJSON });
  await apiRequest<{ status: "registered" }>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify(registration) });
}

export async function signInWithPasskey(): Promise<AuthenticatedUser> {
  const optionsJSON = await apiRequest<PublicKeyCredentialRequestOptionsJSON>("/auth/passkey/login/options", { method: "POST" });
  const assertion = await startAuthentication({ optionsJSON });
  return apiRequest<AuthenticatedUser>("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify(assertion) });
}

// Browser errors (cancelled prompt, no passkey available, ...) carry names meant for developers; this turns them into
// something the person at the login page can act on.
export function describePasskeyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") return "The passkey prompt was cancelled or timed out. Try again.";
    if (error.name === "InvalidStateError" || (error as { code?: string }).code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return "A passkey for this account is already saved in that place. Choose a different place, or sign in with the existing one.";
    }
    if (error.name === "SecurityError") return "This page's address does not match the passkey's site, so the browser refused. Open the app from its normal address.";
  }
  return "Something went wrong with the passkey. Please try again.";
}
