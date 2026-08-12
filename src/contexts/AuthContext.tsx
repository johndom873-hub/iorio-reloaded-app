import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { type AuthenticatedUser, fetchCurrentSession, login as loginRequest, logout as logoutRequest } from "../api/auth";

interface AuthContextValue {
  currentUser: AuthenticatedUser | null;
  isCheckingSession: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    const user = await loginRequest(email, password);
    setCurrentUser(user);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setCurrentUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, isCheckingSession, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
