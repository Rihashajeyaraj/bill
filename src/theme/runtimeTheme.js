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
const LEGACY_FONT_SIZE_MAP = {
  compact: 14,
  default: 16,
  large: 18
};
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 22;
export const FONT_SIZE_DEFAULT = 16;
export const RADIUS_STYLE_OPTIONS = ["rounded", "soft-rounded", "square"];
export const UI_DENSITY_OPTIONS = ["compact", "comfortable", "spacious"];
export const SIDEBAR_STYLE_OPTIONS = ["solid", "glass", "gradient"];

export const THEME_APPEARANCE_PRESETS = [
  {
    id: "emerald-business",
    label: "Emerald Business",
    themePresetId: "focus-mint",
    mode: "light",
    primaryColor: "#0F766E",
    accentColor: "#14B8A6",
    fontFamily: "Inter",
    fontSize: 16,
    radiusStyle: "soft-rounded",
    density: "comfortable",
    sidebarStyle: "solid"
  },
  {
    id: "royal-blue",
    label: "Royal Blue",
    themePresetId: "task-ink",
    mode: "dark",
    primaryColor: "#1D4ED8",
    accentColor: "#38BDF8",
    fontFamily: "Montserrat",
    fontSize: 16,
    radiusStyle: "rounded",
    density: "comfortable",
    sidebarStyle: "gradient"
  },
  {
    id: "modern-minimal",
    label: "Modern Minimal",
    themePresetId: "focus-mint",
    mode: "light",
    primaryColor: "#334155",
    accentColor: "#64748B",
    fontFamily: "DM Sans",
    fontSize: 14,
    radiusStyle: "square",
    density: "compact",
    sidebarStyle: "glass"
  },
  {
    id: "dark-professional",
    label: "Dark Professional",
    themePresetId: "task-ink",
    mode: "dark",
    primaryColor: "#0F172A",
    accentColor: "#2563EB",
    fontFamily: "Poppins",
    fontSize: 16,
    radiusStyle: "soft-rounded",
    density: "comfortable",
    sidebarStyle: "solid"
  }
];

const RADIUS_STYLE_MAP = {
  rounded: "18px",
  "soft-rounded": "12px",
  square: "4px"
};

const DENSITY_MAP = {
  compact: {
    controlY: "0.45rem",
    controlX: "0.65rem",
    tableY: "0.5rem",
    tableX: "0.75rem",
    sidebarY: "0.5rem",
    sidebarX: "0.65rem"
  },
  comfortable: {
    controlY: "0.6rem",
    controlX: "0.8rem",
    tableY: "0.75rem",
    tableX: "1rem",
    sidebarY: "0.625rem",
    sidebarX: "0.75rem"
  },
  spacious: {
    controlY: "0.78rem",
    controlX: "1rem",
    tableY: "0.95rem",
    tableX: "1.1rem",
    sidebarY: "0.8rem",
    sidebarX: "0.95rem"
  }
};

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

function normalizeThemeMode(value) {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

function normalizeFontSize(value) {
  const legacyKey = String(value || "").trim().toLowerCase();
  if (legacyKey && Object.prototype.hasOwnProperty.call(LEGACY_FONT_SIZE_MAP, legacyKey)) {
    return LEGACY_FONT_SIZE_MAP[legacyKey];
  }
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return FONT_SIZE_DEFAULT;
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parsed));
  return Math.round(clamped);
}

function normalizeRadiusStyle(value) {
  const key = String(value || "").trim().toLowerCase();
  return RADIUS_STYLE_OPTIONS.includes(key) ? key : "soft-rounded";
}

function normalizeDensity(value) {
  const key = String(value || "").trim().toLowerCase();
  return UI_DENSITY_OPTIONS.includes(key) ? key : "comfortable";
}

function normalizeSidebarStyle(value) {
  const key = String(value || "").trim().toLowerCase();
  return SIDEBAR_STYLE_OPTIONS.includes(key) ? key : "solid";
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

function setPrimaryAccentVars(root, primary, accent) {
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--primary-color", primary);
  root.style.setProperty("--accent-color", accent);
}

export function applyThemeToDocument(themeId) {
  if (typeof document === "undefined") return null;
  const config = buildThemeConfig(themeId);
  const root = document.documentElement;
  const vars = {
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

  setPrimaryAccentVars(root, config.primary, config.accent);
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.colorScheme = config.mode;
  root.setAttribute("data-theme", config.id);
  return config;
}

export function normalizeThemeOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object") return null;
  const rawPrimary = String(overrides.primaryColor || "").trim();
  const rawAccent = String(overrides.accentColor || "").trim();
  if (!rawPrimary && !rawAccent && !overrides.mode) return null;
  const primaryColor = normalizeHex(rawPrimary || rawAccent || "#0F766E");
  const accentColor = normalizeHex(rawAccent || rawPrimary || "#14B8A6");
  const mode = normalizeThemeMode(overrides.mode);
  return {
    mode,
    primaryColor,
    accentColor
  };
}

export function applyThemeOverridesToDocument(overrides = null) {
  if (typeof document === "undefined") return null;
  const normalized = normalizeThemeOverrides(overrides);
  if (!normalized) return null;

  const root = document.documentElement;
  const isDark = normalized.mode === "dark";
  const primary = normalized.primaryColor;
  const accent = normalized.accentColor;
  const ring = alpha(primary, isDark ? 0.36 : 0.24);
  const cream = isDark ? mix("#1E293B", primary, 0.22) : mix("#ECF7F1", primary, 0.14);
  const sidebar = isDark ? mix("#0B1220", primary, 0.34) : mix("#102A20", primary, 0.58);
  const sidebarActiveBg = alpha(primary, isDark ? 0.34 : 0.22);

  setPrimaryAccentVars(root, primary, accent);
  root.style.setProperty("--ring", ring);
  root.style.setProperty("--cream", cream);
  root.style.setProperty("--sidebar", sidebar);
  root.style.setProperty("--sidebar-active-bg", sidebarActiveBg);
  root.style.colorScheme = normalized.mode;

  return normalized;
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

export function normalizeThemeAppearance(config = {}) {
  const safeInput = config && typeof config === "object" ? config : {};
  let preset = resolveThemePreset(safeInput.themePresetId || safeInput.themeId || readStoredThemeId());
  const mode = normalizeThemeMode(safeInput.mode || themeModeFromPreset(preset));
  if (themeModeFromPreset(preset) !== mode) {
    preset = resolveThemePreset(mode === "dark" ? "task-ink" : "focus-mint");
  }
  return {
    themePresetId: preset?.id || DEFAULT_THEME_PRESET_ID,
    mode,
    primaryColor: normalizeHex(safeInput.primaryColor || preset?.primaryColor || "#0F766E"),
    accentColor: normalizeHex(safeInput.accentColor || preset?.accentColor || "#14B8A6"),
    fontFamily: resolveAppFont(safeInput.fontFamily || readStoredFontFamily()),
    fontSize: normalizeFontSize(safeInput.fontSize),
    radiusStyle: normalizeRadiusStyle(safeInput.radiusStyle),
    density: normalizeDensity(safeInput.density),
    sidebarStyle: normalizeSidebarStyle(safeInput.sidebarStyle)
  };
}

export function readStoredThemeAppearance() {
  if (typeof window === "undefined") return normalizeThemeAppearance({});
  try {
    const raw = localStorage.getItem(LS_KEYS.theme_config);
    if (raw) {
      return normalizeThemeAppearance(JSON.parse(raw));
    }
  } catch {
    // Fallback to legacy storage below.
  }

  const fallbackThemeId = readStoredThemeId();
  const fallbackFont = readStoredFontFamily();
  let fallbackOverrides = null;
  try {
    fallbackOverrides = normalizeThemeOverrides(JSON.parse(localStorage.getItem(LS_KEYS.theme_overrides) || "null"));
  } catch {
    fallbackOverrides = null;
  }

  return normalizeThemeAppearance({
    themePresetId: fallbackThemeId,
    fontFamily: fallbackFont,
    mode: fallbackOverrides?.mode,
    primaryColor: fallbackOverrides?.primaryColor,
    accentColor: fallbackOverrides?.accentColor
  });
}

export function applyThemeAppearanceToDocument(config = {}) {
  if (typeof document === "undefined") return null;
  const normalized = normalizeThemeAppearance(config);
  const root = document.documentElement;
  const density = DENSITY_MAP[normalized.density] || DENSITY_MAP.comfortable;
  const fontSize = `${normalizeFontSize(normalized.fontSize)}px`;
  const radius = RADIUS_STYLE_MAP[normalized.radiusStyle] || RADIUS_STYLE_MAP["soft-rounded"];

  applyThemeToDocument(normalized.themePresetId);
  applyThemeOverridesToDocument({
    mode: normalized.mode,
    primaryColor: normalized.primaryColor,
    accentColor: normalized.accentColor
  });
  applyFontToDocument(normalized.fontFamily);

  root.style.setProperty("--font-size-base", fontSize);
  root.style.setProperty("--radius-style", radius);
  root.style.setProperty("--control-padding-y", density.controlY);
  root.style.setProperty("--control-padding-x", density.controlX);
  root.style.setProperty("--table-cell-padding-y", density.tableY);
  root.style.setProperty("--table-cell-padding-x", density.tableX);
  root.style.setProperty("--sidebar-item-padding-y", density.sidebarY);
  root.style.setProperty("--sidebar-item-padding-x", density.sidebarX);
  root.style.setProperty("--primary-color", normalized.primaryColor);
  root.style.setProperty("--accent-color", normalized.accentColor);

  root.setAttribute("data-theme-mode", normalized.mode);
  root.setAttribute("data-font-size", String(normalizeFontSize(normalized.fontSize)));
  root.setAttribute("data-radius-style", normalized.radiusStyle);
  root.setAttribute("data-density", normalized.density);
  root.setAttribute("data-sidebar-style", normalized.sidebarStyle);
  root.style.colorScheme = normalized.mode;

  return normalized;
}

export function hydrateThemeFromStorage() {
  const appearance = readStoredThemeAppearance();
  applyThemeAppearanceToDocument(appearance);
  return { appearance };
}
