import {
  Briefcase,
  CheckSquare,
  Focus,
  Gem,
  Leaf,
  MoonStar,
  Rocket,
  Sparkles,
  Sunrise,
  Zap
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
  {
    id: "sunburst-drive",
    name: "Sunburst Drive",
    category: "High Energy",
    mode: "Light",
    icon: Rocket,
    gradient: ["#c2410c", "#fb923c"],
    primaryColor: "#c2410c",
    accentColor: "#f97316",
    invoiceTheme: "Classic"
  },
  {
    id: "voltage-navy",
    name: "Voltage Navy",
    category: "High Energy",
    mode: "Dark",
    icon: Zap,
    gradient: ["#1d4ed8", "#22d3ee"],
    primaryColor: "#1d4ed8",
    accentColor: "#06b6d4",
    invoiceTheme: "Modern"
  },
  {
    id: "executive-stone",
    name: "Executive Stone",
    category: "Professional",
    mode: "Light",
    icon: Briefcase,
    gradient: ["#334155", "#94a3b8"],
    primaryColor: "#334155",
    accentColor: "#64748b",
    invoiceTheme: "Classic"
  },
  {
    id: "signature-gold",
    name: "Signature Gold",
    category: "Professional",
    mode: "Dark",
    icon: Gem,
    gradient: ["#3f3f46", "#d4a72c"],
    primaryColor: "#3f3f46",
    accentColor: "#d4a72c",
    invoiceTheme: "Modern"
  },
  {
    id: "paper-air",
    name: "Paper Air",
    category: "Minimal",
    mode: "Light",
    icon: Sparkles,
    gradient: ["#94a3b8", "#e2e8f0"],
    primaryColor: "#475569",
    accentColor: "#94a3b8",
    invoiceTheme: "Minimal"
  },
  {
    id: "dawn-line",
    name: "Dawn Line",
    category: "Minimal",
    mode: "Dark",
    icon: Sunrise,
    gradient: ["#0f172a", "#64748b"],
    primaryColor: "#0f172a",
    accentColor: "#64748b",
    invoiceTheme: "Minimal"
  }
];

export const THEME_CATEGORIES = [
  "Productivity",
  "Calm & Wellness",
  "High Energy",
  "Professional",
  "Minimal"
];

export const DEFAULT_THEME_PRESET_ID = THEME_PRESETS[0]?.id || "focus-mint";

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
