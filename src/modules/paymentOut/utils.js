import { formatCurrencyByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

export const TDS_CATEGORY_OPTIONS = [
  { value: "contractor", label: "Contractor", rate: 1 },
  { value: "professional", label: "Professional", rate: 10 },
  { value: "commission", label: "Commission", rate: 5 },
  { value: "rent", label: "Rent", rate: 10 },
  { value: "other", label: "Other", rate: 2 },
  { value: "custom", label: "Custom (Manual)", rate: 0 }
];

export function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getTdsRateForCategory(category) {
  return (
    TDS_CATEGORY_OPTIONS.find((entry) => entry.value === String(category || "").trim().toLowerCase())?.rate || 0
  );
}

export function calculateTdsAmount(amountPaid, tdsRate) {
  const amount = Math.max(0, parseNumber(amountPaid));
  const rate = Math.max(0, parseNumber(tdsRate));
  return Number(((amount * rate) / 100).toFixed(2));
}

export function isCustomTdsCategory(category) {
  return String(category || "").trim().toLowerCase() === "custom";
}

export function formatMoney(value, currency) {
  const amount = parseNumber(value);
  if (currency) {
    return formatCurrencyByPreference(amount, currency, { maximumFractionDigits: 2 });
  }
  return formatNumberByPreference(amount, { maximumFractionDigits: 2 });
}

export function normalizeText(value) {
  return (value || "").trim().toLowerCase();
}

export function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value);
  if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function countryCodeFromName(country) {
  if (!country) return "XX";
  const trimmed = String(country).trim();
  if (!trimmed) return "XX";
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const map = {
    India: "IN",
    "Sri Lanka": "LK",
    UAE: "AE",
    "United Arab Emirates": "AE",
    USA: "US",
    "United States": "US",
    "United Kingdom": "UK",
    Ireland: "IE"
  };
  if (map[trimmed]) return map[trimmed];
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
