import { formatCurrencyByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

const VAT_DEFAULTS = {
  "Sri Lanka": 18,
  "United Kingdom": 20,
  UK: 20,
  Ireland: 23,
  UAE: 5
};

export function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeText(value) {
  return (value || "").trim().toLowerCase();
}

export function formatMoney(value, currency) {
  const amount = parseNumber(value);
  if (currency) {
    return formatCurrencyByPreference(amount, currency, { maximumFractionDigits: 2 });
  }
  return formatNumberByPreference(amount, { maximumFractionDigits: 2 });
}

export function taxContext(country, type) {
  const clean = (country || "").trim();
  const lowered = clean.toLowerCase();
  const isIndia = lowered === "india";
  const isUsa = lowered === "usa" || lowered === "united states";
  const vatRate = VAT_DEFAULTS[clean] ?? VAT_DEFAULTS[clean.replace("United", "").trim()] ?? 0;

  if (isIndia) {
    return {
      label: "GST %",
      codeLabel: type === "Service" ? "SAC" : "HSN",
      rates: [0, 5, 12, 18, 28]
    };
  }

  if (isUsa) {
    return {
      label: "Sales Tax % (optional)",
      codeLabel: type === "Service" ? "SAC" : "HSN",
      rates: [0, 4, 7.5, 10]
    };
  }

  return {
    label: "VAT %",
    codeLabel: type === "Service" ? "SAC" : "HSN",
    rates: vatRate ? [0, vatRate] : [0, 5, 10, 20]
  };
}

export function buildTaxLabel(country, rate) {
  const clean = (country || "").trim();
  if (!rate) return "None";
  const lowered = clean.toLowerCase();
  if (lowered === "india") return `GST@${rate}%`;
  if (lowered === "usa" || lowered === "united states") return `SalesTax@${rate}%`;
  return `VAT@${rate}%`;
}

export function normalizeItemType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("service")) return "Service";
  return "Product";
}
