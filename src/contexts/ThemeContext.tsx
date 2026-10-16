import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type Theme } from "../hooks/useTheme";

const STORAGE_KEY = "iorio-theme";

function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute("data-bs-theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light",
  );

  useEffect(() => {
    applyThemeToDocument(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
