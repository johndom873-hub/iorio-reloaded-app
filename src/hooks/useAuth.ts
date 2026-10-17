import { createContext, useContext } from "react";
import type { AuthenticatedUser } from "../api/auth";

// The context and its hook live apart from AuthProvider so that file exports components only (Vite hot-swaps it in place).

export interface AuthContextValue {
  currentUser: AuthenticatedUser | null;
  isCheckingSession: boolean;
  /** "passkey_enrollment_required" when passkeys are required: the password signed nobody in and only opens enrolment. */
  login: (username: string, password: string) => Promise<"signed_in" | "passkey_enrollment_required">;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** Whether the signed-in user is an admin. A trader sees risk limits and Pluto settings as printed values, never as inputs. */
export function useIsAdmin(): boolean {
  return useAuth().currentUser?.accessLevel === "admin";
}
