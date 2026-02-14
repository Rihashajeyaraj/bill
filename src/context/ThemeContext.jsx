import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LS_KEYS } from "../services/storage";
import { companyGetProfile } from "../services/company.service";
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  findThemePresetById,
  findThemePresetBySettings
} from "../components/theme/themePresets";

const ThemeContext = createContext(null);

function isThemeMode(mode) {
  return mode === "light" || mode === "dark";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(hex, fallback) {
  const value = String(hex || "").trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(value)) return fallback;
  return value.toUpperCase();
}

function hexToRgb(hex, fallback = "#1F6B45") {
  const safe = normalizeHex(hex, fallback).slice(1);
  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16)
  };
}

function mixHex(source, target, amount) {
  const ratio = clamp(amount, 0, 1);
  const src = hexToRgb(source);
  const dst = hexToRgb(target);
  const r = Math.round(src.r * (1 - ratio) + dst.r * ratio);
  const g = Math.round(src.g * (1 - ratio) + dst.g * ratio);
  const b = Math.round(src.b * (1 - ratio) + dst.b * ratio);
  return `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function toRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
}

function getPresetFromCompany() {
  const companyTheme = companyGetProfile()?.settings?.theme;
  if (!companyTheme) return null;
  return findThemePresetBySettings(companyTheme);
}

function readInitialTheme() {
  const stored = localStorage.getItem(LS_KEYS.theme_mode);
  if (isThemeMode(stored)) return stored;

  const companyTheme = companyGetProfile()?.settings?.theme?.mode;
  if (companyTheme === "Dark") return "dark";
  if (companyTheme === "Light") return "light";

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function readInitialPresetId(themeMode) {
  const stored = localStorage.getItem(LS_KEYS.theme_preset);
  if (stored && findThemePresetById(stored)) return stored;

  const fromCompany = getPresetFromCompany();
  if (fromCompany) return fromCompany.id;

  return (
    THEME_PRESETS.find((preset) => preset.mode.toLowerCase() === themeMode)?.id ||
    DEFAULT_THEME_PRESET_ID
  );
}

function applyTheme(mode, presetId) {
  const preset = findThemePresetById(presetId) || findThemePresetById(DEFAULT_THEME_PRESET_ID);
  const primary = normalizeHex(preset?.primaryColor, "#1F6B45");
  const accent = normalizeHex(preset?.accentColor, "#2E8D5A");
  const isDark = mode === "dark";
  const root = document.documentElement;

  document.documentElement.setAttribute("data-theme", mode);
  root.style.setProperty("--app-gradient", `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`);
  root.style.setProperty("--bg-warm", isDark ? mixHex(primary, "#E8EEF1", 0.86) : mixHex(primary, "#F4F8F6", 0.9));
  root.style.setProperty("--text-main", "#1F2B24");
  root.style.setProperty("--app-card-bg", "#FFFFFF");
  root.style.setProperty("--app-card-border", mixHex(primary, "#DDE7E1", 0.82));
  root.style.setProperty("--app-muted", mixHex(primary, "#6C7D73", 0.9));
  root.style.setProperty("--app-cream", mixHex(accent, "#ECF8F2", 0.82));
  root.style.setProperty("--app-ring", toRgba(accent, 0.24));
  root.style.setProperty(
    "--app-topbar-bg",
    isDark ? "rgba(247, 250, 252, 0.92)" : "rgba(255, 255, 255, 0.85)"
  );
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readInitialTheme());
  const [themePresetId, setThemePresetIdState] = useState(() => readInitialPresetId(readInitialTheme()));

  useEffect(() => {
    applyTheme(theme, themePresetId);
    localStorage.setItem(LS_KEYS.theme_mode, theme);
    localStorage.setItem(LS_KEYS.theme_preset, themePresetId);
  }, [theme, themePresetId]);

  const setTheme = (mode) => {
    if (!isThemeMode(mode)) return;
    setThemeState(mode);
  };

  const setThemePreset = (presetId) => {
    if (!findThemePresetById(presetId)) return;
    setThemePresetIdState(presetId);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  };

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === "dark",
      themePresetId,
      themePreset: findThemePresetById(themePresetId) || findThemePresetById(DEFAULT_THEME_PRESET_ID),
      setTheme,
      setThemePreset,
      toggleTheme
    }),
    [theme, themePresetId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
