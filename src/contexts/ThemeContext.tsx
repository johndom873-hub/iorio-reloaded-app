import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type Theme } from "../hooks/useTheme";

const STORAGE_KEY = "iorio-theme";

function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute("data-bs-theme", theme);
}

// The document's theme is set BEFORE React renders with the new value: charts read their colours from CSS variables while
// rendering (cssVariableColor), so an effect that set it after the render left them in the previous theme's colours.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light";
    applyThemeToDocument(stored);
    return stored;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
    applyThemeToDocument(next);
    setTheme(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
