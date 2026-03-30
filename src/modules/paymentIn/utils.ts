import { COUNTRY_CONFIG, normalizePaymentMode, type CountryCode } from "./countryConfig";
import type { PaymentInRecord } from "./store";
import type { PaymentInFormState } from "./types";
import { formatCurrencyByPreference, parseFormattedNumber } from "../../lib/formatPreferences";

export const TDS_CATEGORY_OPTIONS = [
  { value: "contractor", label: "Contractor", rate: 1 },
  { value: "professional", label: "Professional", rate: 10 },
  { value: "commission", label: "Commission", rate: 5 },
  { value: "rent", label: "Rent", rate: 10 },
  { value: "other", label: "Other", rate: 2 },
  { value: "custom", label: "Custom (Manual)", rate: 0 }
];

export function parseNumber(value: string | number | null | undefined) {
  const n = parseFormattedNumber(value);
  return Number.isFinite(n) ? n : 0;
}

export function getTdsRateForCategory(category: unknown) {
  return (
    TDS_CATEGORY_OPTIONS.find((entry) => entry.value === String(category || "").trim().toLowerCase())?.rate || 0
  );
}

export function isCustomTdsCategory(category: unknown) {
  return String(category || "").trim().toLowerCase() === "custom";
}

export function calculateTdsAmount(amountReceived: unknown, tdsRate: unknown) {
  const amount = Math.max(0, parseNumber(amountReceived as any));
  const rate = Math.max(0, parseNumber(tdsRate as any));
  return Number(((amount * rate) / 100).toFixed(2));
}

export function formatMoney(amount: number, country: CountryCode) {
  return formatCurrencyByPreference(Number(amount || 0), COUNTRY_CONFIG[country].currency, {
    maximumFractionDigits: 2
  });
}

export function companyRegistration(company: any, country: CountryCode) {
  const tax = company?.tax || {};
  if (country === "IN") return tax.gstin || "";
  if (country === "AE") return tax.trn || tax.vatNumber || "";
  if (country === "SL" || country === "UK" || country === "IE") return tax.vatNumber || "";
  if (country === "SG") return tax.gstRegNo || tax.gstin || "";
  if (country === "US") return tax.salesTaxPermit || "";
  return "";
}

function extractPanLikeValue(value: unknown) {
  const clean = String(value || "").trim().toUpperCase();
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) return clean;
  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(clean)) {
    return clean.slice(2, 12);
  }
  return "";
}

export function hasPanForTds(customer: any) {
  return !!(
    extractPanLikeValue(customer?.pan) ||
    extractPanLikeValue(customer?.taxId) ||
    extractPanLikeValue(customer?.registrationNumber)
  );
}

export function suggestTdsAmount(invoiceAmount: unknown, category: unknown, customer: any) {
  const total = Math.max(0, parseNumber(invoiceAmount as any));
  if (total <= 30000) return 0;

  const hasPan = hasPanForTds(customer);
  const configuredRate = getTdsRateForCategory(category) || 1;
  const rate = hasPan ? configuredRate : 20;
  return Number(((total * rate) / 100).toFixed(2));
}

export function defaultForm(country: CountryCode, company: any): PaymentInFormState {
  const defaultTdsCategory = TDS_CATEGORY_OPTIONS[0].value;
  return {
    country,
    paymentDate: "",
    customerId: "",
    customerInput: "",
    allocationMode: "normal",
    selectedDocumentId: "",
    currency: COUNTRY_CONFIG[country].currency,
    amountReceived: "",
    tdsAmount: "",
    tdsCategory: defaultTdsCategory,
    tdsRate: String(getTdsRateForCategory(defaultTdsCategory)),
    isManual: false,
    paymentMode: COUNTRY_CONFIG[country].paymentModes[0],
    referenceNo: "",
    chequeNo: "",
    bankName: "",
    bankAccount: "",
    transactionId: "",
    paymentReference: "",
    registrationNumber: companyRegistration(company, country),
    internalNotes: "",
    customerNotes: "",
    attachment: null,
    allocations: []
  };
}

export function formFromRecord(note: PaymentInRecord): PaymentInFormState {
  const firstAllocation = note.allocations[0] || null;
  const storedCategory = note.tdsCategory || TDS_CATEGORY_OPTIONS[0].value;
  const storedTdsRate = Math.max(0, parseNumber(note.tdsRate ?? getTdsRateForCategory(storedCategory)));
  const storedTdsAmount = Math.max(0, parseNumber(note.totals.tdsAmount || 0));
  const inferredManual =
    typeof note.isManual === "boolean"
      ? note.isManual
      : Math.abs(storedTdsAmount - calculateTdsAmount(note.totals.amountReceived || 0, storedTdsRate)) > 0.009;
  const tdsCategory = inferredManual ? "custom" : storedCategory;
  const tdsRate = inferredManual ? 0 : storedTdsRate;
  return {
    id: note.id,
    country: note.country,
    paymentDate: note.paymentDate,
    customerId: note.customerId,
    customerInput: note.customerName,
    allocationMode: firstAllocation ? "linked" : "normal",
    selectedDocumentId: firstAllocation?.invoiceId || "",
    currency: note.currency,
    amountReceived: String(note.totals.amountReceived || ""),
    tdsAmount: String(note.totals.tdsAmount || ""),
    tdsCategory,
    tdsRate: String(tdsRate),
    isManual: inferredManual,
    paymentMode: normalizePaymentMode(note.paymentMode),
    referenceNo: note.referenceNo || "",
    chequeNo: note.chequeNo || "",
    bankName: note.bankName || "",
    bankAccount: note.bankAccount || "",
    transactionId: note.transactionId || "",
    paymentReference: note.paymentReference || "",
    registrationNumber: note.registrationNumber || "",
    internalNotes: note.internalNotes || "",
    customerNotes: note.customerNotes || "",
    attachment: note.attachment || null,
    allocations: note.allocations.map((line) => ({
      invoiceId: line.invoiceId,
      invoiceNo: line.invoiceNo,
      invoiceDate: line.invoiceDate,
      invoiceAmount: line.invoiceAmount,
      balanceDue: line.balanceDue,
      applyAmount: line.applyAmount,
      documentType: line.documentType || "invoice"
    }))
  };
}

export function computeEditorTotals(form: PaymentInFormState, customerOutstandingBefore: number) {
  const amountReceived = Math.max(0, parseNumber(form.amountReceived));
  const tdsAmount = Math.max(0, parseNumber(form.tdsAmount));
  const amountApplied = Math.max(
    0,
    form.allocations.reduce((sum, line) => sum + Math.max(0, parseNumber(line.applyAmount)), 0)
  );
  const unappliedAmount = Math.max(0, amountReceived - amountApplied);
  const totalSettled = amountReceived + tdsAmount;
  const outstandingAfter = Math.max(0, customerOutstandingBefore - totalSettled);

  return {
    amountReceived,
    tdsAmount,
    totalSettled,
    amountApplied,
    unappliedAmount,
    outstandingAfter
  };
}
