import { companyGetProfile } from "../services/company.service";
import { formatIsoDateToDisplay } from "./dateUtils";

const DATE_FORMATS = new Set(["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]);
const NUMBER_FORMATS = new Set(["1,23,456.78", "123,456.78", "123.456,78"]);

const NUMBER_LOCALE_BY_FORMAT = {
  "1,23,456.78": "en-IN",
  "123,456.78": "en-US",
  "123.456,78": "de-DE"
};

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad2(value) {
  return String(Math.trunc(Math.abs(Number(value) || 0))).padStart(2, "0");
}

function resolveLocalizationSettings() {
  const profile = companyGetProfile() || {};
  const localization =
    profile?.settings && typeof profile.settings === "object"
      ? profile.settings.localization
      : null;
  return localization && typeof localization === "object" ? localization : {};
}

export function getPreferredDateFormat() {
  const dateFormat = String(resolveLocalizationSettings()?.dateFormat || "").trim();
  if (dateFormat === "DD/MM/YYYY") return dateFormat;
  return "DD/MM/YYYY";
}

export function getPreferredNumberFormat() {
  const numberFormat = String(resolveLocalizationSettings()?.numberFormat || "").trim();
  return NUMBER_FORMATS.has(numberFormat) ? numberFormat : "1,23,456.78";
}

export function getPreferredNumberLocale() {
  const numberFormat = getPreferredNumberFormat();
  return NUMBER_LOCALE_BY_FORMAT[numberFormat] || "en-IN";
}

export function formatNumberByPreference(value, options = {}) {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(getPreferredNumberLocale(), options).format(safeAmount);
  } catch {
    return safeAmount.toLocaleString(undefined, options);
  }
}

export function formatDecimalByPreference(value, options = {}) {
  return formatNumberByPreference(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options
  });
}

export function formatCurrencyByPreference(value, currency, options = {}) {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const currencyCode = String(currency || "")
    .trim()
    .toUpperCase();

  if (!currencyCode) {
    return formatNumberByPreference(safeAmount, options);
  }

  try {
    return new Intl.NumberFormat(getPreferredNumberLocale(), {
      style: "currency",
      currency: currencyCode,
      ...options
    }).format(safeAmount);
  } catch {
    return `${currencyCode} ${formatNumberByPreference(safeAmount, options)}`;
  }
}

export function formatDateByPreference(value, fallback = "-") {
  const date = toDate(value);
  if (!date) return fallback;
  return formatIsoDateToDisplay(date.toISOString().slice(0, 10), fallback);
}

export function formatTimeByPreference(value, { includeSeconds = true } = {}) {
  const date = toDate(value);
  if (!date) return "-";
  try {
    return new Intl.DateTimeFormat(getPreferredNumberLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {}),
      hour12: true
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

export function formatDateTimeByPreference(value, { includeSeconds = true } = {}) {
  const date = toDate(value);
  if (!date) return "-";
  return `${formatDateByPreference(date)} ${formatTimeByPreference(date, { includeSeconds })}`;
}
