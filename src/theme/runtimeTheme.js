import {
  DEFAULT_THEME_PRESET_ID,
  findThemePresetById
} from "../components/theme/themePresets";
import {
  DEFAULT_APP_FONT,
  buildGoogleFontHref,
  resolveAppFont,
  toAppFontStack
} from "./fontPresets";
import { LS_KEYS } from "../services/storage";

const LEGACY_MODE_TO_THEME = {
  dark: "task-ink",
  light: "focus-mint"
};
const APP_FONT_LINK_ID = "app-font-google-font";

function normalizeHex(hex) {
  const value = String(hex || "").trim();
  if (!value) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return "#000000";
}

function hexToRgb(hex) {
  const safe = normalizeHex(hex);
  return {
    r: Number.parseInt(safe.slice(1, 3), 16),
    g: Number.parseInt(safe.slice(3, 5), 16),
    b: Number.parseInt(safe.slice(5, 7), 16)
  };
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n) => clamp(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function mix(hexA, hexB, weight = 0.5) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, Number(weight)));
  return rgbToHex(
    a.r * (1 - w) + b.r * w,
    a.g * (1 - w) + b.g * w,
    a.b * (1 - w) + b.b * w
  );
}

function alpha(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const o = Math.max(0, Math.min(1, Number(opacity)));
  return `rgba(${r}, ${g}, ${b}, ${o.toFixed(3)})`;
}

export function resolveThemePreset(themeId) {
  return findThemePresetById(themeId) || findThemePresetById(DEFAULT_THEME_PRESET_ID);
}

export function themeModeFromPreset(preset) {
  return preset?.mode === "Dark" ? "dark" : "light";
}

export function readStoredThemeId() {
  if (typeof window === "undefined") return DEFAULT_THEME_PRESET_ID;
  try {
    const storedTheme = String(localStorage.getItem(LS_KEYS.theme_preset) || "").trim();
    if (resolveThemePreset(storedTheme)) return storedTheme || DEFAULT_THEME_PRESET_ID;

    const legacyMode = String(localStorage.getItem(LS_KEYS.theme_mode) || "").trim().toLowerCase();
    if (legacyMode && LEGACY_MODE_TO_THEME[legacyMode]) return LEGACY_MODE_TO_THEME[legacyMode];
  } catch {
    return DEFAULT_THEME_PRESET_ID;
  }
  return DEFAULT_THEME_PRESET_ID;
}

export function readStoredFontFamily() {
  if (typeof window === "undefined") return DEFAULT_APP_FONT;
  try {
    const rawValue = localStorage.getItem(LS_KEYS.app_font_family);
    const safeValue = String(rawValue || "")
      .trim()
      .replace(/^"+|"+$/g, "");
    return resolveAppFont(safeValue);
  } catch {
    return DEFAULT_APP_FONT;
  }
}

function ensureGoogleFontLink(fontFamily) {
  if (typeof document === "undefined") return;
  const href = buildGoogleFontHref(fontFamily);
  let link = document.getElementById(APP_FONT_LINK_ID);
  if (!link || String(link.tagName || "").toLowerCase() !== "link") {
    link = document.createElement("link");
    link.id = APP_FONT_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
}

export function buildThemeConfig(themeId) {
  const preset = resolveThemePreset(themeId);
  const mode = themeModeFromPreset(preset);
  const isDark = mode === "dark";
  const primary = normalizeHex(preset?.primaryColor || "#0F766E");
  const accent = normalizeHex(preset?.accentColor || mix(primary, "#FFFFFF", 0.2));
  const bg = isDark ? mix("#0B1020", primary, 0.14) : mix("#FFFFFF", primary, 0.06);
  const card = isDark ? mix("#111827", primary, 0.14) : "#FFFFFF";
  const text = isDark ? "#E6EDF6" : "#14221D";
  const muted = isDark ? "#A8B4C6" : "#61726D";
  const border = isDark ? mix("#334155", primary, 0.28) : mix("#D8E4DF", primary, 0.24);
  const hover = isDark ? alpha("#FFFFFF", 0.08) : alpha(primary, 0.08);
  const inputBg = isDark ? mix("#111827", primary, 0.1) : mix("#FFFFFF", primary, 0.1);
  const inputBorder = isDark ? mix("#334155", primary, 0.3) : mix("#D8E4DF", primary, 0.36);
  const topbar = isDark ? alpha("#0F172A", 0.88) : alpha("#FFFFFF", 0.88);
  const sidebar = isDark ? mix("#0B1220", primary, 0.34) : mix("#102A20", primary, 0.58);
  const sidebarText = isDark ? "#EEF3FF" : "#ECF8F2";
  const sidebarMuted = isDark ? alpha("#EEF3FF", 0.74) : alpha("#ECF8F2", 0.74);
  const sidebarHover = alpha("#FFFFFF", isDark ? 0.09 : 0.12);
  const sidebarActiveBg = alpha(primary, isDark ? 0.34 : 0.22);
  const cream = isDark ? mix("#1E293B", primary, 0.22) : mix("#ECF7F1", primary, 0.14);
  const ring = alpha(primary, isDark ? 0.36 : 0.24);
  const surfaceSoft = isDark ? mix(card, "#FFFFFF", 0.06) : mix(bg, "#FFFFFF", 0.55);
  const surfaceSubtle = isDark ? mix(card, "#FFFFFF", 0.03) : mix(bg, "#FFFFFF", 0.72);

  return {
    id: preset?.id || DEFAULT_THEME_PRESET_ID,
    mode,
    primary,
    accent,
    bg,
    card,
    text,
    muted,
    border,
    hover,
    inputBg,
    inputBorder,
    topbar,
    sidebar,
    sidebarText,
    sidebarMuted,
    sidebarHover,
    sidebarActiveBg,
    cream,
    ring,
    onPrimary: "#FFFFFF",
    surfaceSoft,
    surfaceSubtle
  };
}

export function applyThemeToDocument(themeId) {
  if (typeof document === "undefined") return null;
  const config = buildThemeConfig(themeId);
  const root = document.documentElement;
  const vars = {
    "--primary": config.primary,
    "--accent": config.accent,
    "--bg": config.bg,
    "--card": config.card,
    "--text": config.text,
    "--muted": config.muted,
    "--border": config.border,
    "--hover": config.hover,
    "--input-bg": config.inputBg,
    "--input-border": config.inputBorder,
    "--topbar": config.topbar,
    "--sidebar": config.sidebar,
    "--sidebar-text": config.sidebarText,
    "--sidebar-muted": config.sidebarMuted,
    "--sidebar-hover": config.sidebarHover,
    "--sidebar-active-bg": config.sidebarActiveBg,
    "--sidebar-active-text": "#FFFFFF",
    "--cream": config.cream,
    "--ring": config.ring,
    "--on-primary": config.onPrimary,
    "--surface-soft": config.surfaceSoft,
    "--surface-subtle": config.surfaceSubtle
  };

  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.colorScheme = config.mode;
  root.setAttribute("data-theme", config.id);
  return config;
}

export function applyFontToDocument(fontFamily) {
  if (typeof document === "undefined") return DEFAULT_APP_FONT;
  const safeFont = resolveAppFont(fontFamily);
  const root = document.documentElement;
  root.style.setProperty("--app-font-family", toAppFontStack(safeFont));
  root.setAttribute("data-font-family", safeFont);
  ensureGoogleFontLink(safeFont);
  return safeFont;
}

export function hydrateThemeFromStorage() {
  const themeId = readStoredThemeId();
  const fontFamily = readStoredFontFamily();
  const theme = applyThemeToDocument(themeId);
  const font = applyFontToDocument(fontFamily);
  return { theme, font };
}
