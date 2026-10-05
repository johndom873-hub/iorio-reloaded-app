import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { type AuthenticatedUser, fetchCurrentSession, login as loginRequest, logout as logoutRequest } from "../api/auth";
import { signInWithPasskey } from "../api/passkeys";

interface AuthContextValue {
  currentUser: AuthenticatedUser | null;
  isCheckingSession: boolean;
  /** "passkey_enrollment_required" when passkeys are required: the password signed nobody in and only opens enrolment. */
  login: (username: string, password: string) => Promise<"signed_in" | "passkey_enrollment_required">;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    fetchCurrentSession()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null))
      .finally(() => setIsCheckingSession(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest(username, password);
    if (result.outcome === "signed_in") setCurrentUser(result.user);
    return result.outcome;
  }, []);

  const loginWithPasskey = useCallback(async () => {
    setCurrentUser(await signInWithPasskey());
  }, []);

  const logout = useCallback(async () => {
    // Whatever the server says, this browser is logged out (2026-09-24):
    // a failed request used to leave the user "logged in" with no message.
    try {
      await logoutRequest();
    } catch (error) {
      console.warn(`logout request failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setCurrentUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, isCheckingSession, login, loginWithPasskey, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
