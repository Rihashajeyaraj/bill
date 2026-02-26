import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { THEME_PRESETS, findThemePresetById } from "../components/theme/themePresets";
import { LS_KEYS } from "../services/storage";
import { companyGetProfile, ORGANIZATION_UPDATED_EVENT } from "../services/company.service";
import {
  applyFontToDocument,
  applyThemeOverridesToDocument,
  applyThemeToDocument,
  buildThemeConfig,
  normalizeThemeOverrides,
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

function readStoredThemeOverrides() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEYS.theme_overrides);
    if (!raw) return null;
    return normalizeThemeOverrides(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readProfileThemeOverrides() {
  return normalizeThemeOverrides(companyGetProfile()?.settings?.theme || null);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialThemeId);
  const [fontFamily, setFontFamilyState] = useState(readStoredFontFamily);
  const [themeOverrides, setThemeOverridesState] = useState(
    () => readStoredThemeOverrides() || readProfileThemeOverrides()
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mode = getThemeMode(theme);
    localStorage.setItem(LS_KEYS.theme_preset, theme);
    localStorage.setItem(LS_KEYS.theme_mode, mode);
    applyThemeToDocument(theme);
    applyThemeOverridesToDocument(themeOverrides);
  }, [theme, themeOverrides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_KEYS.app_font_family, fontFamily);
    applyFontToDocument(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!themeOverrides) {
      localStorage.removeItem(LS_KEYS.theme_overrides);
      return;
    }
    localStorage.setItem(LS_KEYS.theme_overrides, JSON.stringify(themeOverrides));
  }, [themeOverrides]);

  const setTheme = useCallback((themeId) => {
    const nextTheme = normalizeThemeId(themeId);
    if (!nextTheme) return;
    setThemeState(nextTheme);
  }, []);

  const setThemeOverrides = useCallback((overrides) => {
    const normalized = normalizeThemeOverrides(overrides);
    setThemeOverridesState(normalized);
  }, []);

  const setFont = useCallback((fontName) => {
    const nextFont = resolveAppFont(fontName);
    setFontFamilyState(nextFont);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prevTheme) => (getThemeMode(prevTheme) === "dark" ? "focus-mint" : "task-ink"));
  }, []);

  useEffect(() => {
    function hydrateFromOrganizationProfile() {
      const profileTheme = readProfileThemeOverrides();
      if (!profileTheme) return;
      setThemeOverridesState(profileTheme);
      setThemeState((prevTheme) => {
        const currentMode = getThemeMode(prevTheme);
        if (currentMode === profileTheme.mode) return prevTheme;
        return profileTheme.mode === "dark" ? "task-ink" : "focus-mint";
      });
    }

    hydrateFromOrganizationProfile();
    window.addEventListener(ORGANIZATION_UPDATED_EVENT, hydrateFromOrganizationProfile);
    return () => window.removeEventListener(ORGANIZATION_UPDATED_EVENT, hydrateFromOrganizationProfile);
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
      themeOverrides,
      setThemeOverrides,
      toggleTheme,
      themePresetId: theme,
      themePreset: findThemePresetById(theme),
      setThemePreset: setTheme
    }),
    [theme, setTheme, themeOverrides, setThemeOverrides, toggleTheme, fontFamily, setFont]
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
