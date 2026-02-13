import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LS_KEYS } from "../services/storage";
import { companyGetProfile } from "../services/company.service";

const ThemeContext = createContext(null);

function readInitialTheme() {
  const stored = localStorage.getItem(LS_KEYS.theme_mode);
  if (stored === "light" || stored === "dark") return stored;

  const companyTheme = companyGetProfile()?.settings?.theme?.mode;
  if (companyTheme === "Dark") return "dark";
  if (companyTheme === "Light") return "light";

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readInitialTheme());

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(LS_KEYS.theme_mode, theme);
  }, [theme]);

  const setTheme = (mode) => {
    if (mode !== "light" && mode !== "dark") return;
    setThemeState(mode);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  };

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === "dark",
      setTheme,
      toggleTheme
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
