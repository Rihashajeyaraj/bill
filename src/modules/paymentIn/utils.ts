import { COUNTRY_CONFIG, type CountryCode } from "./countryConfig";
import type { CustomerOpenInvoice, PaymentInRecord } from "./store";
import type { PaymentInFormState } from "./types";

export function parseNumber(value: string | number | null | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(amount: number, country: CountryCode) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: COUNTRY_CONFIG[country].currency,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

export function companyRegistration(company: any, country: CountryCode) {
  const tax = company?.tax || {};
  if (country === "IN") return tax.gstin || "";
  if (country === "AE") return tax.trn || tax.vatNumber || "";
  if (country === "SL" || country === "UK") return tax.vatNumber || "";
  if (country === "SG") return tax.gstRegNo || tax.gstin || "";
  if (country === "US") return tax.salesTaxPermit || "";
  return "";
}

export function allocationsFromInvoices(invoices: CustomerOpenInvoice[]) {
  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    invoiceDate: invoice.invoiceDate,
    invoiceAmount: invoice.invoiceAmount,
    balanceDue: invoice.balanceDue,
    applyAmount: 0
  }));
}

export function defaultForm(country: CountryCode, company: any): PaymentInFormState {
  return {
    country,
    paymentDate: new Date().toISOString().slice(0, 10),
    customerId: "",
    customerInput: "",
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
  return {
    id: note.id,
    country: note.country,
    paymentDate: note.paymentDate,
    customerId: note.customerId,
    customerInput: note.customerName,
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
      applyAmount: line.applyAmount
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
