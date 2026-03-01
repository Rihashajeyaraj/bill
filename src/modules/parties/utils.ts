import type { OpeningBalanceType, PartyRecord, PartyType } from "./types";
import { formatCurrencyByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

export function parseNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: unknown, currency?: string) {
  const amount = parseNumber(value);
  if (currency) {
    return formatCurrencyByPreference(amount, currency, { maximumFractionDigits: 2 });
  }
  return formatNumberByPreference(amount, { maximumFractionDigits: 2 });
}

export function normalizeText(value?: string) {
  return (value || "").trim().toLowerCase();
}

export function toIsoDate(value?: string) {
  if (!value) return "";
  const raw = String(value);
  if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function taxIdMeta(country?: string) {
  const normalized = normalizeText(country);
  if (normalized.includes("india")) return { label: "GSTIN", placeholder: "15 character GSTIN" };
  if (normalized.includes("united kingdom") || normalized === "uk" || normalized.includes("ireland")) {
    return { label: "VAT", placeholder: "VAT registration number" };
  }
  if (normalized.includes("uae") || normalized.includes("united arab emirates")) {
    return { label: "TRN", placeholder: "Tax Registration Number" };
  }
  if (normalized.includes("sri lanka")) return { label: "VAT", placeholder: "VAT registration number" };
  return { label: "Tax ID", placeholder: "GSTIN / VAT / TRN" };
}

export function defaultOpeningBalanceType(type: PartyType): OpeningBalanceType {
  return type === "Supplier" ? "Payable" : "Receivable";
}

export function openingBalanceSigned(party: PartyRecord) {
  const amount = Math.abs(parseNumber(party.openingBalance));
  if (party.type === "Supplier") {
    return party.openingBalanceType === "Payable" ? amount : -amount;
  }
  return party.openingBalanceType === "Receivable" ? amount : -amount;
}

export function outstandingMeta(party: PartyRecord, outstanding: number) {
  const absolute = Math.abs(outstanding);
  const isReceivable =
    party.type === "Customer" ? outstanding >= 0 : outstanding < 0;
  return {
    absolute,
    label: isReceivable ? "Receivable" : "Payable",
    tone: isReceivable ? "success" : "danger",
    color: isReceivable ? "text-emerald-700" : "text-rose-600",
    badge: isReceivable
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-rose-50 text-rose-700 border-rose-200"
  };
}
