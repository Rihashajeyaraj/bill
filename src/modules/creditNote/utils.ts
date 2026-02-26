import { COUNTRY_CONFIG, type CountryCode } from "./countryConfig";
import type { CreditLineDraft, CreditNoteRecord, CreditInvoice } from "./store";
import type { CreditNoteFormState } from "./types";

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
  if (country === "SL" || country === "UK" || country === "IE") return tax.vatNumber || "";
  if (country === "SG") return tax.gstRegNo || tax.gstin || "";
  if (country === "US") return tax.salesTaxPermit || "";
  return "";
}

export function defaultForm(country: CountryCode, company: any): CreditNoteFormState {
  return {
    country,
    creditNoteDate: new Date().toISOString().slice(0, 10),
    customerId: "",
    customerInput: "",
    linkedInvoiceId: "",
    reason: "",
    creditType: "Full Credit",
    taxRate: COUNTRY_CONFIG[country].defaultTaxRate,
    placeOfSupply: "",
    registrationNumber: companyRegistration(company, country),
    hmrcReference: "",
    salesTaxState: "",
    internalNotes: "",
    customerNotes: "",
    returnToStock: false,
    discountPercent: "",
    partialAmountCap: "",
    priceAdjustmentAmount: "",
    lines: []
  };
}

export function draftLinesFromInvoice(invoice: CreditInvoice): CreditLineDraft[] {
  return invoice.lines.map((line) => ({
    id: line.id,
    itemName: line.itemName,
    quantity: Math.max(0, line.quantity),
    rate: Math.max(0, line.rate),
    taxRate: Math.max(0, line.taxRate),
    hsnSac: line.hsnSac || "",
    creditType: "Percentage",
    creditValue: 0
  }));
}

export function formFromNote(note: CreditNoteRecord): CreditNoteFormState {
  return {
    id: note.id,
    country: note.country,
    creditNoteDate: note.creditNoteDate,
    customerId: note.customerId,
    customerInput: note.customerName,
    linkedInvoiceId: note.linkedInvoiceId,
    reason: note.reason,
    creditType: note.creditType,
    taxRate: note.taxRate,
    placeOfSupply: note.placeOfSupply || "",
    registrationNumber: note.registrationNumber || "",
    hmrcReference: note.hmrcReference || "",
    salesTaxState: note.salesTaxState || "",
    internalNotes: note.internalNotes || "",
    customerNotes: note.customerNotes || "",
    returnToStock: !!note.returnToStock,
    discountPercent: String(note.discountPercent || ""),
    partialAmountCap: String(note.partialAmountCap || ""),
    priceAdjustmentAmount: String(note.priceAdjustmentAmount || ""),
    lines: note.lines.map((line) => ({
      id: line.id,
      itemName: line.itemName,
      quantity: line.quantity,
      rate: line.rate,
      taxRate: line.taxRate,
      hsnSac: line.hsnSac || "",
      creditType: line.creditType === "Fixed" ? "Fixed" : "Percentage",
      creditValue: parseNumber(line.creditValue)
    }))
  };
}

export function computeEditorTotals(
  form: CreditNoteFormState,
  country: CountryCode,
  invoiceBalance: number,
  companyState = ""
) {
  const toCents = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
  const fromCents = (value: number) => value / 100;
  const sameState =
    country === "IN" &&
    companyState.trim().toLowerCase() &&
    form.placeOfSupply.trim().toLowerCase() &&
    companyState.trim().toLowerCase() === form.placeOfSupply.trim().toLowerCase();

  const detailed = form.lines.map((line, index) => {
    const quantity = Math.max(0, parseNumber(line.quantity));
    const rate = Math.max(0, parseNumber(line.rate));
    const taxRate = Math.max(0, parseNumber(line.taxRate));
    const creditType = line.creditType === "Fixed" ? "Fixed" : "Percentage";
    const creditValue = Math.max(0, parseNumber(line.creditValue));
    const baseCents = toCents(quantity * rate);
    const taxCents = Math.round((baseCents * taxRate) / 100);
    const amountAfterTaxCents = baseCents + taxCents;
    const requestedCreditCents =
      creditType === "Percentage"
        ? Math.round((amountAfterTaxCents * creditValue) / 100)
        : toCents(creditValue);
    const creditAppliedCents = Math.min(amountAfterTaxCents, Math.max(0, requestedCreditCents));
    const finalCents = amountAfterTaxCents - creditAppliedCents;
    const validationMessage =
      requestedCreditCents > amountAfterTaxCents ? "Credit cannot exceed amount after tax." : "";

    return {
      ...line,
      id: line.id || `line_${index + 1}`,
      quantity,
      rate,
      taxRate,
      creditType,
      creditValue,
      baseAmount: fromCents(baseCents),
      taxAmount: fromCents(taxCents),
      amountAfterTax: fromCents(amountAfterTaxCents),
      creditApplied: fromCents(creditAppliedCents),
      creditAmount: fromCents(finalCents),
      validationMessage
    };
  });

  const subtotal = detailed.reduce((sum, line) => sum + line.baseAmount, 0);
  const taxTotal = detailed.reduce((sum, line) => sum + line.taxAmount, 0);
  let total = detailed.reduce((sum, line) => sum + line.creditAmount, 0);
  const partialCap = parseNumber(form.partialAmountCap);
  if (form.creditType === "Partial Credit" && partialCap > 0) {
    total = Math.min(total, partialCap);
  }

  return {
    detailed,
    subtotal,
    taxTotal,
    total,
    remaining: Math.max(0, invoiceBalance - total),
    cgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    sgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    igst: country === "IN" && !sameState ? taxTotal : 0
  };
}
