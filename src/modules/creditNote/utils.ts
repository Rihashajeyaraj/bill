import { COUNTRY_CONFIG, type CountryCode } from "./countryConfig";
import type { CreditLineDraft, CreditNoteRecord, CreditInvoice } from "./store";
import type { CreditNoteFormState } from "./types";
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

export function defaultForm(country: CountryCode, company: any): CreditNoteFormState {
  return {
    country,
    creditNoteDate: "",
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
    refundMode: "FULL",
    partialRefundAmount: "",
    discountPercent: "",
    partialAmountCap: "",
    priceAdjustmentAmount: "",
    lines: []
  };
}

export function draftLinesFromInvoice(invoice: CreditInvoice): CreditLineDraft[] {
  return invoice.lines.map((line, index) => {
    const stableLineId = String(line.id || line.sourceInvoiceItemId || `line_${index + 1}`);
    const sourceInvoiceQty = Math.max(
      0,
      parseNumber(
        line.availableReturnQty !== undefined && line.availableReturnQty !== null
          ? line.availableReturnQty
          : line.quantity
      )
    );
    return {
      id: stableLineId,
      sourceInvoiceItemId: String(line.sourceInvoiceItemId || line.id || stableLineId),
      itemId: line.itemId || "",
      sourceInvoiceQty,
      sourceInvoiceAmountAfterTax: Math.max(0, parseNumber(line.amountAfterTax)),
      priceTaxMode:
        String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX"
          ? "WITH_TAX"
          : "WITHOUT_TAX",
      taxInclusive:
        line.taxInclusive === true ||
        String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX",
      returnCondition: "",
      purchaseRate: 0,
      itemName: line.itemName,
      quantity: sourceInvoiceQty,
      rate: Math.max(0, line.rate),
      taxRate: Math.max(0, line.taxRate),
      hsnSac: line.hsnSac || "",
      creditType: "Percentage",
      creditValue: 0
    };
  });
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
    refundMode:
      note.refundMode === "PARTIAL" || note.refundMode === "NONE" ? note.refundMode : "FULL",
    partialRefundAmount: String(note.partialRefundAmount || ""),
    discountPercent: String(note.discountPercent || ""),
    partialAmountCap: String(note.partialAmountCap || ""),
    priceAdjustmentAmount: String(note.priceAdjustmentAmount || ""),
    lines: note.lines.map((line, index) => {
      const stableLineId = String(line.id || (line as any).sourceInvoiceItemId || `line_${index + 1}`);
      return {
        id: stableLineId,
        sourceInvoiceItemId: String((line as any).sourceInvoiceItemId || line.id || stableLineId),
        itemId: (line as any).itemId || "",
        sourceInvoiceQty: parseNumber((line as any).sourceInvoiceQty ?? line.quantity),
        sourceInvoiceAmountAfterTax: parseNumber(
          (line as any).sourceInvoiceAmountAfterTax ?? (line as any).amountAfterTax
        ),
        priceTaxMode:
          String((line as any).priceTaxMode || "").toUpperCase() === "WITH_TAX"
            ? "WITH_TAX"
            : "WITHOUT_TAX",
        taxInclusive:
          (line as any).taxInclusive === true ||
          String((line as any).priceTaxMode || "").toUpperCase() === "WITH_TAX",
        returnCondition:
          (line as any).returnCondition === "REUSABLE" ||
          (line as any).returnCondition === "NOT_REUSABLE"
            ? (line as any).returnCondition
            : "",
        purchaseRate: parseNumber((line as any).purchaseRate),
        itemName: line.itemName,
        quantity: line.quantity,
        rate: line.rate,
        taxRate: line.taxRate,
        hsnSac: line.hsnSac || "",
        creditType: line.creditType === "Fixed" ? "Fixed" : "Percentage",
        creditValue: parseNumber(line.creditValue)
      };
    })
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
    const stableLineId = String(line.id || (line as any).sourceInvoiceItemId || `line_${index + 1}`);
    const quantity = Math.max(0, parseNumber(line.quantity));
    const rate = Math.max(0, parseNumber(line.rate));
    const taxRate = Math.max(0, parseNumber(line.taxRate));
    const lineDiscount = Math.max(
      0,
      parseNumber((line as any).discountAmount ?? (line as any).discount ?? 0)
    );
    const taxInclusive =
      line.taxInclusive === true ||
      String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX";
    const priceTaxMode = taxInclusive ? "WITH_TAX" : "WITHOUT_TAX";
    const creditType = line.creditType === "Fixed" ? "Fixed" : "Percentage";
    const creditValue = Math.max(0, parseNumber(line.creditValue));
    const grossCents = Math.max(0, toCents(quantity * rate) - toCents(lineDiscount));
    let baseCents = grossCents;
    let taxCents = 0;
    let amountAfterTaxCents = grossCents;
    if (taxRate > 0) {
      if (taxInclusive) {
        const divisor = 1 + taxRate / 100;
        baseCents = divisor > 0 ? Math.round(grossCents / divisor) : grossCents;
        taxCents = grossCents - baseCents;
        amountAfterTaxCents = grossCents;
      } else {
        baseCents = grossCents;
        taxCents = Math.round((baseCents * taxRate) / 100);
        amountAfterTaxCents = baseCents + taxCents;
      }
    }
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
      id: stableLineId,
      sourceInvoiceItemId: String((line as any).sourceInvoiceItemId || stableLineId),
      returnCondition:
        line.returnCondition === "REUSABLE" || line.returnCondition === "NOT_REUSABLE"
          ? line.returnCondition
          : "",
      purchaseRate: Math.max(0, parseNumber(line.purchaseRate)),
      quantity,
      rate,
      taxRate,
      priceTaxMode,
      taxInclusive,
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

  const returnSubtotal = detailed.reduce((sum, line) => sum + line.baseAmount, 0);
  const returnTaxTotal = detailed.reduce((sum, line) => sum + line.taxAmount, 0);
  let maxRefundTotal = detailed.reduce((sum, line) => sum + line.creditAmount, 0);
  const partialCap = parseNumber(form.partialAmountCap);
  if (form.creditType === "Partial Credit" && partialCap > 0) {
    maxRefundTotal = Math.min(maxRefundTotal, partialCap);
  }
  const refundMode =
    form.refundMode === "PARTIAL" || form.refundMode === "NONE" ? form.refundMode : "FULL";
  let total = maxRefundTotal;
  if (refundMode === "NONE") {
    total = 0;
  }
  const refundRatio = maxRefundTotal > 0 ? total / maxRefundTotal : 0;
  const subtotal = returnSubtotal * refundRatio;
  const taxTotal = returnTaxTotal * refundRatio;

  return {
    detailed,
    subtotal,
    taxTotal,
    total,
    maxRefundTotal,
    refundMode,
    remaining: Math.max(0, invoiceBalance - total),
    cgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    sgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    igst: country === "IN" && !sameState ? taxTotal : 0
  };
}
