import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { THEME_PRESETS, findThemePresetById } from "../components/theme/themePresets";
import { LS_KEYS } from "../services/storage";
import { companyGetProfile, ORGANIZATION_UPDATED_EVENT } from "../services/company.service";
import { APP_FONT_OPTIONS, resolveAppFont } from "../theme/fontPresets";
import {
  THEME_APPEARANCE_PRESETS,
  applyThemeAppearanceToDocument,
  buildThemeConfig,
  normalizeThemeAppearance,
  normalizeThemeOverrides,
  readStoredThemeAppearance,
  resolveThemePreset
} from "../theme/runtimeTheme";

const ThemeContext = createContext(null);

const SUPPORTED_THEME_IDS = THEME_PRESETS.map((preset) => preset.id);

function normalizeThemeId(themeId) {
  if (!themeId || typeof themeId !== "string") return null;
  return SUPPORTED_THEME_IDS.includes(themeId) ? themeId : null;
}

function extractProfileThemeAppearance() {
  const settings = companyGetProfile()?.settings || {};
  const themeConfig =
    settings.theme_config && typeof settings.theme_config === "object" ? settings.theme_config : null;
  const legacyTheme = settings.theme && typeof settings.theme === "object" ? settings.theme : null;

  if (!themeConfig && !legacyTheme) return null;

  const legacyMode = String(legacyTheme?.mode || "").trim().toLowerCase() === "dark" ? "dark" : "light";
  return normalizeThemeAppearance({
    ...(themeConfig || {}),
    mode: themeConfig?.mode || legacyMode,
    primaryColor: themeConfig?.primaryColor || legacyTheme?.primaryColor,
    accentColor: themeConfig?.accentColor || legacyTheme?.accentColor,
    fontFamily: themeConfig?.fontFamily || APP_FONT_OPTIONS[0]
  });
}

function mergeAndNormalize(prevState, patch) {
  const nextPatch = typeof patch === "function" ? patch(prevState) : patch;
  return normalizeThemeAppearance({ ...(prevState || {}), ...(nextPatch || {}) });
}

export function ThemeProvider({ children }) {
  const [themeAppearance, setThemeAppearanceState] = useState(() => readStoredThemeAppearance());

  const setThemeConfig = useCallback((patch) => {
    setThemeAppearanceState((prev) => mergeAndNormalize(prev, patch));
  }, []);

  const setTheme = useCallback((themeId) => {
    const nextTheme = normalizeThemeId(themeId);
    if (!nextTheme) return;
    const preset = resolveThemePreset(nextTheme);
    setThemeConfig((prev) => ({
      ...prev,
      themePresetId: preset.id,
      mode: preset.mode === "Dark" ? "dark" : "light",
      primaryColor: preset.primaryColor,
      accentColor: preset.accentColor
    }));
  }, [setThemeConfig]);

  const setThemeOverrides = useCallback((overrides) => {
    const normalized = normalizeThemeOverrides(overrides);
    if (!normalized) return;
    setThemeConfig(normalized);
  }, [setThemeConfig]);

  const setFont = useCallback((fontName) => {
    setThemeConfig({ fontFamily: resolveAppFont(fontName) });
  }, [setThemeConfig]);

  const toggleTheme = useCallback(() => {
    setThemeConfig((prev) => ({ mode: prev.mode === "dark" ? "light" : "dark" }));
  }, [setThemeConfig]);

  const applyAppearancePreset = useCallback((presetId) => {
    const preset = THEME_APPEARANCE_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    setThemeConfig(preset);
  }, [setThemeConfig]);

  useEffect(() => {
    const normalized = normalizeThemeAppearance(themeAppearance);
    applyThemeAppearanceToDocument(normalized);

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LS_KEYS.theme_config, JSON.stringify(normalized));
        localStorage.setItem(LS_KEYS.theme_preset, normalized.themePresetId);
        localStorage.setItem(LS_KEYS.theme_mode, normalized.mode);
        localStorage.setItem(LS_KEYS.theme_overrides, JSON.stringify({
          mode: normalized.mode,
          primaryColor: normalized.primaryColor,
          accentColor: normalized.accentColor
        }));
        localStorage.setItem(LS_KEYS.app_font_family, normalized.fontFamily);
      } catch (error) {
        console.warn("Failed to persist theme config", error);
      }
    }
  }, [themeAppearance]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function hydrateFromOrganizationProfile() {
      const profileTheme = extractProfileThemeAppearance();
      if (!profileTheme) return;
      setThemeAppearanceState(profileTheme);
    }

    hydrateFromOrganizationProfile();
    window.addEventListener(ORGANIZATION_UPDATED_EVENT, hydrateFromOrganizationProfile);
    return () => window.removeEventListener(ORGANIZATION_UPDATED_EVENT, hydrateFromOrganizationProfile);
  }, []);

  const value = useMemo(() => {
    const themePresetId = themeAppearance.themePresetId;
    const themeMode = themeAppearance.mode;
    const currentTheme = themePresetId;
    const themePreset = findThemePresetById(themePresetId);
    return {
      theme: themePresetId,
      currentTheme,
      themePresetId,
      themePreset,
      themeMode,
      isDark: themeMode === "dark",
      themeConfig: buildThemeConfig(themePresetId),
      themeAppearance,
      themes: THEME_PRESETS.filter((preset) => SUPPORTED_THEME_IDS.includes(preset.id)),
      fontFamily: themeAppearance.fontFamily,
      font: themeAppearance.fontFamily,
      fontOptions: APP_FONT_OPTIONS,
      themeOverrides: {
        mode: themeAppearance.mode,
        primaryColor: themeAppearance.primaryColor,
        accentColor: themeAppearance.accentColor
      },
      appearancePresets: THEME_APPEARANCE_PRESETS,
      setTheme,
      setThemePreset: setTheme,
      setThemeOverrides,
      setThemeConfig,
      setFont,
      toggleTheme,
      applyAppearancePreset
    };
  }, [themeAppearance, setTheme, setThemeOverrides, setThemeConfig, setFont, toggleTheme, applyAppearancePreset]);

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
