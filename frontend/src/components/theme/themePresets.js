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
  {
    id: "emerald-flow",
    name: "Emerald Flow",
    category: "Productivity",
    mode: "Light",
    icon: Leaf,
    gradient: ["#059669", "#10B981"],
    primaryColor: "#10B981",
    accentColor: "#34D399",
    invoiceTheme: "Modern"
  },
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    category: "Productivity",
    mode: "Light",
    icon: Focus,
    gradient: ["#0284c7", "#0EA5E9"],
    primaryColor: "#0EA5E9",
    accentColor: "#38BDF8",
    invoiceTheme: "Modern"
  },
  {
    id: "royal-indigo",
    name: "Royal Indigo",
    category: "Productivity",
    mode: "Dark",
    icon: MoonStar,
    gradient: ["#4338ca", "#6366F1"],
    primaryColor: "#6366F1",
    accentColor: "#818CF8",
    invoiceTheme: "Classic"
  },
  {
    id: "sunset-orange",
    name: "Sunset Orange",
    category: "Calm & Wellness",
    mode: "Light",
    icon: Focus,
    gradient: ["#ea580c", "#F97316"],
    primaryColor: "#F97316",
    accentColor: "#FB923C",
    invoiceTheme: "Minimal"
  },
  {
    id: "rose-calm",
    name: "Rose Calm",
    category: "Calm & Wellness",
    mode: "Light",
    icon: Leaf,
    gradient: ["#e11d48", "#F43F5E"],
    primaryColor: "#F43F5E",
    accentColor: "#FB7185",
    invoiceTheme: "Modern"
  },
  {
    id: "lavender-soft",
    name: "Lavender Soft",
    category: "Calm & Wellness",
    mode: "Light",
    icon: MoonStar,
    gradient: ["#8b5cf6", "#A78BFA"],
    primaryColor: "#A78BFA",
    accentColor: "#C4B5FD",
    invoiceTheme: "Minimal"
  },
  {
    id: "golden-sand",
    name: "Golden Sand",
    category: "Productivity",
    mode: "Light",
    icon: CheckSquare,
    gradient: ["#d97706", "#F59E0B"],
    primaryColor: "#F59E0B",
    accentColor: "#FBBF24",
    invoiceTheme: "Classic"
  },
  {
    id: "teal-wave",
    name: "Teal Wave",
    category: "Productivity",
    mode: "Light",
    icon: Leaf,
    gradient: ["#0f766e", "#14B8A6"],
    primaryColor: "#14B8A6",
    accentColor: "#2DD4BF",
    invoiceTheme: "Modern"
  },
  {
    id: "crimson-focus",
    name: "Crimson Focus",
    category: "Productivity",
    mode: "Dark",
    icon: CheckSquare,
    gradient: ["#b91c1c", "#DC2626"],
    primaryColor: "#DC2626",
    accentColor: "#EF4444",
    invoiceTheme: "Classic"
  },
  {
    id: "sky-mint",
    name: "Sky Mint",
    category: "Calm & Wellness",
    mode: "Light",
    icon: Focus,
    gradient: ["#06b6d4", "#22D3EE"],
    primaryColor: "#22D3EE",
    accentColor: "#67E8F9",
    invoiceTheme: "Modern"
  },
  {
    id: "slate-pro",
    name: "Slate Pro",
    category: "Productivity",
    mode: "Dark",
    icon: CheckSquare,
    gradient: ["#1e293b", "#334155"],
    primaryColor: "#334155",
    accentColor: "#475569",
    invoiceTheme: "Classic"
  },
  {
    id: "peach-light",
    name: "Peach Light",
    category: "Calm & Wellness",
    mode: "Light",
    icon: Leaf,
    gradient: ["#f43f5e", "#FB7185"],
    primaryColor: "#FB7185",
    accentColor: "#FDA4AF",
    invoiceTheme: "Minimal"
  },
  {
    id: "neon-lime",
    name: "Neon Lime",
    category: "Productivity",
    mode: "Light",
    icon: Focus,
    gradient: ["#65a30d", "#84CC16"],
    primaryColor: "#84CC16",
    accentColor: "#A3E635",
    invoiceTheme: "Modern"
  },
  {
    id: "deep-violet",
    name: "Deep Violet",
    category: "Calm & Wellness",
    mode: "Dark",
    icon: MoonStar,
    gradient: ["#6d28d9", "#7C3AED"],
    primaryColor: "#7C3AED",
    accentColor: "#8B5CF6",
    invoiceTheme: "Classic"
  },
  {
    id: "arctic-grey",
    name: "Arctic Grey",
    category: "Productivity",
    mode: "Light",
    icon: CheckSquare,
    gradient: ["#6b7280", "#9CA3AF"],
    primaryColor: "#9CA3AF",
    accentColor: "#CBD5E1",
    invoiceTheme: "Minimal"
  }
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
