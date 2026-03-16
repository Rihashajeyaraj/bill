import { COUNTRY_CONFIG, type CountryCode } from "./countryConfig";
import type { PaymentInRecord } from "./store";
import type { PaymentInFormState } from "./types";
import { formatCurrencyByPreference } from "../../lib/formatPreferences";

export function parseNumber(value: string | number | null | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
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

export function defaultForm(country: CountryCode, company: any): PaymentInFormState {
  return {
    country,
    paymentDate: "",
    customerId: "",
    customerInput: "",
    allocationMode: "normal",
    selectedDocumentId: "",
    currency: COUNTRY_CONFIG[country].currency,
    amountReceived: "",
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
    paymentMode: note.paymentMode,
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
  const amountApplied = Math.max(
    0,
    form.allocations.reduce((sum, line) => sum + Math.max(0, parseNumber(line.applyAmount)), 0)
  );
  const unappliedAmount = Math.max(0, amountReceived - amountApplied);
  const outstandingAfter = Math.max(0, customerOutstandingBefore - amountApplied);

  return {
    amountReceived,
    amountApplied,
    unappliedAmount,
    outstandingAfter
  };
}
