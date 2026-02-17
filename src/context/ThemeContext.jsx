import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { THEME_PRESETS, findThemePresetById } from "../components/theme/themePresets";
import { LS_KEYS } from "../services/storage";

const ThemeContext = createContext(null);

const SUPPORTED_THEME_IDS = ["task-ink", "focus-mint", "forest-balance", "moon-breath"];
const DEFAULT_THEME_ID = "focus-mint";
const LEGACY_MODE_TO_THEME = {
  dark: "task-ink",
  light: "focus-mint"
};

function isSupportedTheme(themeId) {
  return SUPPORTED_THEME_IDS.includes(themeId);
}

function normalizeThemeId(themeId) {
  if (!themeId || typeof themeId !== "string") return null;
  return isSupportedTheme(themeId) ? themeId : null;
}

function getThemeMode(themeId) {
  return themeId === "task-ink" || themeId === "moon-breath" ? "dark" : "light";
}

function readInitialThemeId() {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;

  const storedThemeId = normalizeThemeId(localStorage.getItem(LS_KEYS.theme_preset));
  if (storedThemeId) return storedThemeId;

  const legacyMode = localStorage.getItem(LS_KEYS.theme_mode);
  if (legacyMode && LEGACY_MODE_TO_THEME[legacyMode]) {
    return LEGACY_MODE_TO_THEME[legacyMode];
  }

  return DEFAULT_THEME_ID;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialThemeId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mode = getThemeMode(theme);
    localStorage.setItem(LS_KEYS.theme_preset, theme);
    localStorage.setItem(LS_KEYS.theme_mode, mode);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((themeId) => {
    const nextTheme = normalizeThemeId(themeId);
    if (!nextTheme) return;
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prevTheme) => (getThemeMode(prevTheme) === "dark" ? "focus-mint" : "task-ink"));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      currentTheme: theme,
      themeMode: getThemeMode(theme),
      isDark: getThemeMode(theme) === "dark",
      themes: THEME_PRESETS.filter((preset) => SUPPORTED_THEME_IDS.includes(preset.id)),
      setTheme,
      toggleTheme,
      themePresetId: theme,
      themePreset: findThemePresetById(theme),
      setThemePreset: setTheme
    }),
    [theme, setTheme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <div data-theme={theme} className="theme-root">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
