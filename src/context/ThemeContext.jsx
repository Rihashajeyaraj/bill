import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { THEME_PRESETS, findThemePresetById } from "../components/theme/themePresets";
import { LS_KEYS } from "../services/storage";
import {
  applyFontToDocument,
  applyThemeToDocument,
  buildThemeConfig,
  readStoredFontFamily,
  readStoredThemeId,
  resolveThemePreset,
  themeModeFromPreset
} from "../theme/runtimeTheme";
import { APP_FONT_OPTIONS, resolveAppFont } from "../theme/fontPresets";

const ThemeContext = createContext(null);

const SUPPORTED_THEME_IDS = THEME_PRESETS.map((preset) => preset.id);
const DEFAULT_THEME_ID = "focus-mint";

function isSupportedTheme(themeId) {
  return SUPPORTED_THEME_IDS.includes(themeId);
}

function normalizeThemeId(themeId) {
  if (!themeId || typeof themeId !== "string") return null;
  return isSupportedTheme(themeId) ? themeId : null;
}

function getThemeMode(themeId) {
  return themeModeFromPreset(resolveThemePreset(themeId));
}

function readInitialThemeId() {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  const stored = normalizeThemeId(readStoredThemeId());
  return stored || DEFAULT_THEME_ID;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialThemeId);
  const [fontFamily, setFontFamilyState] = useState(readStoredFontFamily);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mode = getThemeMode(theme);
    localStorage.setItem(LS_KEYS.theme_preset, theme);
    localStorage.setItem(LS_KEYS.theme_mode, mode);
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_KEYS.app_font_family, fontFamily);
    applyFontToDocument(fontFamily);
  }, [fontFamily]);

  const setTheme = useCallback((themeId) => {
    const nextTheme = normalizeThemeId(themeId);
    if (!nextTheme) return;
    setThemeState(nextTheme);
  }, []);

  const setFont = useCallback((fontName) => {
    const nextFont = resolveAppFont(fontName);
    setFontFamilyState(nextFont);
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
      themeConfig: buildThemeConfig(theme),
      themes: THEME_PRESETS.filter((preset) => SUPPORTED_THEME_IDS.includes(preset.id)),
      fontFamily,
      font: fontFamily,
      setFont,
      fontOptions: APP_FONT_OPTIONS,
      setTheme,
      toggleTheme,
      themePresetId: theme,
      themePreset: findThemePresetById(theme),
      setThemePreset: setTheme
    }),
    [theme, setTheme, toggleTheme, fontFamily, setFont]
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className="theme-root">
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
