import {
  CheckSquare,
  Focus,
  Leaf,
  MoonStar
} from "lucide-react";

export const THEME_PRESETS = [
  {
    id: "focus-mint",
    name: "Focus Mint",
    category: "Productivity",
    mode: "Light",
    icon: Focus,
    gradient: ["#0f766e", "#2dd4bf"],
    primaryColor: "#0f766e",
    accentColor: "#14b8a6",
    invoiceTheme: "Modern"
  },
  {
    id: "task-ink",
    name: "Task Ink",
    category: "Productivity",
    mode: "Dark",
    icon: CheckSquare,
    gradient: ["#1e293b", "#334155"],
    primaryColor: "#1e293b",
    accentColor: "#0ea5e9",
    invoiceTheme: "Classic"
  },
  {
    id: "forest-balance",
    name: "Forest Balance",
    category: "Calm & Wellness",
    mode: "Light",
    icon: Leaf,
    gradient: ["#166534", "#4ade80"],
    primaryColor: "#166534",
    accentColor: "#22c55e",
    invoiceTheme: "Minimal"
  },
  {
    id: "moon-breath",
    name: "Moon Breath",
    category: "Calm & Wellness",
    mode: "Dark",
    icon: MoonStar,
    gradient: ["#312e81", "#818cf8"],
    primaryColor: "#312e81",
    accentColor: "#6366f1",
    invoiceTheme: "Modern"
  },
];

export const THEME_CATEGORIES = [
  "Productivity",
  "Calm & Wellness"
];

export const DEFAULT_THEME_PRESET_ID = "focus-mint";

export function findThemePresetBySettings(themeSettings) {
  if (!themeSettings) return null;
  const exact =
    THEME_PRESETS.find(
      (preset) =>
        preset.mode === themeSettings.mode &&
        preset.invoiceTheme === themeSettings.invoiceTheme &&
        preset.primaryColor === themeSettings.primaryColor &&
        preset.accentColor === themeSettings.accentColor
    ) || null;
  if (exact) return exact;

  return THEME_PRESETS.find((preset) => preset.mode === themeSettings.mode) || null;
}

export function findThemePresetById(id) {
  return THEME_PRESETS.find((preset) => preset.id === id) || null;
}
