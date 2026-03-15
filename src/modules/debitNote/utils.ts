import { COUNTRY_CONFIG, type CountryCode } from "./countryConfig";
import type { DebitLineDraft, DebitNoteRecord, PurchaseInvoice } from "./store";
import type { DebitNoteFormState } from "./types";
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

export function defaultForm(country: CountryCode, company: any): DebitNoteFormState {
  return {
    country,
    debitNoteDate: "",
    supplierId: "",
    supplierInput: "",
    linkedPurchaseInvoiceId: "",
    reason: "",
    debitType: "Full Debit",
    taxRate: COUNTRY_CONFIG[country].defaultTaxRate,
    placeOfSupply: "",
    registrationNumber: companyRegistration(company, country),
    hmrcReference: "",
    salesTaxState: "",
    internalNotes: "",
    supplierNotes: "",
    partialAmountCap: "",
    priceAdjustmentAmount: "",
    additionalChargesAmount: "",
    taxAdjustmentAmount: "",
    lines: []
  };
}

export function draftLinesFromInvoice(invoice: PurchaseInvoice): DebitLineDraft[] {
  return invoice.lines.map((line) => ({
    id: line.id,
    sourcePurchaseItemId: line.sourcePurchaseItemId || line.id,
    itemId: line.itemId || "",
    sourcePurchaseOriginalQty: Math.max(0, parseNumber(line.quantity)),
    sourcePurchaseQty: Math.max(
      0,
      parseNumber(
        line.availableDebitQty !== undefined && line.availableDebitQty !== null
          ? line.availableDebitQty
          : line.quantity
      )
    ),
    sourcePurchaseAmountAfterTax: Math.max(0, parseNumber(line.amountAfterTax)),
    debitedQty: Math.max(0, parseNumber(line.debitedQty)),
    priceTaxMode:
      String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX"
        ? "WITH_TAX"
        : "WITHOUT_TAX",
    taxInclusive:
      line.taxInclusive === true ||
      String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX",
    itemName: line.itemName,
    quantity: 0,
    rate: Math.max(0, line.rate),
    taxRate: Math.max(0, line.taxRate),
    hsnSac: line.hsnSac || "",
    debitValueType: "Percentage",
    debitValue: 0
  }));
}

export function formFromNote(note: DebitNoteRecord): DebitNoteFormState {
  return {
    id: note.id,
    country: note.country,
    debitNoteDate: note.debitNoteDate,
    supplierId: note.supplierId,
    supplierInput: note.supplierName,
    linkedPurchaseInvoiceId: note.linkedPurchaseInvoiceId,
    reason: note.reason,
    debitType: note.debitType,
    taxRate: note.taxRate,
    placeOfSupply: note.placeOfSupply || "",
    registrationNumber: note.registrationNumber || "",
    hmrcReference: note.hmrcReference || "",
    salesTaxState: note.salesTaxState || "",
    internalNotes: note.internalNotes || "",
    supplierNotes: note.supplierNotes || "",
    partialAmountCap: String(note.partialAmountCap || ""),
    priceAdjustmentAmount: String(note.priceAdjustmentAmount || ""),
    additionalChargesAmount: String(note.additionalChargesAmount || ""),
    taxAdjustmentAmount: String(note.taxAdjustmentAmount || ""),
    lines: note.lines.map((line) => ({
      id: line.id,
      sourcePurchaseItemId: (line as any).sourcePurchaseItemId || line.id,
      itemId: (line as any).itemId || "",
      sourcePurchaseOriginalQty: parseNumber(
        (line as any).sourcePurchaseOriginalQty ?? (line as any).sourcePurchaseQty ?? line.quantity
      ),
      sourcePurchaseQty: parseNumber((line as any).sourcePurchaseQty ?? line.quantity),
      sourcePurchaseAmountAfterTax: parseNumber(
        (line as any).sourcePurchaseAmountAfterTax ?? (line as any).amountAfterTax
      ),
      debitedQty: parseNumber((line as any).debitedQty),
      priceTaxMode:
        String((line as any).priceTaxMode || "").toUpperCase() === "WITH_TAX"
          ? "WITH_TAX"
          : "WITHOUT_TAX",
      taxInclusive:
        (line as any).taxInclusive === true ||
        String((line as any).priceTaxMode || "").toUpperCase() === "WITH_TAX",
      itemName: line.itemName,
      quantity: line.quantity,
      rate: line.rate,
      taxRate: line.taxRate,
      hsnSac: line.hsnSac || "",
      debitValueType: line.debitValueType === "Fixed" ? "Fixed" : "Percentage",
      debitValue: parseNumber((line as any).debitValue)
    }))
  };
}

export function computeEditorTotals(
  form: DebitNoteFormState,
  country: CountryCode,
  payableBalance: number,
  companyState = ""
) {
  const toCents = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
  const fromCents = (value: number) => value / 100;
  const sameState =
    country === "IN" &&
    companyState.trim().toLowerCase() &&
    form.placeOfSupply.trim().toLowerCase() &&
    companyState.trim().toLowerCase() === form.placeOfSupply.trim().toLowerCase();

  const taxAdjustment = Math.max(0, parseNumber(form.taxAdjustmentAmount));
  const detailed = form.lines.map((line, index) => {
    const quantity = Math.max(0, parseNumber(line.quantity));
    const rate = Math.max(0, parseNumber(line.rate));
    const taxRate = Math.max(0, parseNumber(line.taxRate));
    const taxInclusive =
      line.taxInclusive === true ||
      String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX";
    const priceTaxMode = taxInclusive ? "WITH_TAX" : "WITHOUT_TAX";
    const valueType = line.debitValueType === "Fixed" ? "Fixed" : "Percentage";
    const rawDebitValue = parseNumber(line.debitValue);
    const debitValue = Math.max(0, rawDebitValue);
    const grossCents = toCents(quantity * rate);
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
    const debitChargeCents =
      valueType === "Percentage"
        ? Math.round((amountAfterTaxCents * debitValue) / 100)
        : toCents(debitValue);
    const finalTotalCents = amountAfterTaxCents + debitChargeCents;
    const validationMessage = rawDebitValue < 0 ? "Debit amount cannot be negative." : "";

    return {
      ...line,
      id: line.id || `line_${index + 1}`,
      quantity,
      rate,
      taxRate,
      priceTaxMode,
      taxInclusive,
      debitValueType: valueType,
      debitValue,
      baseAmount: fromCents(baseCents),
      taxAmount: fromCents(taxCents),
      amountAfterTax: fromCents(amountAfterTaxCents),
      debitCharge: fromCents(debitChargeCents),
      debitAmount: fromCents(finalTotalCents),
      validationMessage
    };
  });

  const subtotal = detailed.reduce((sum, line) => sum + line.baseAmount, 0);
  let taxTotal = detailed.reduce((sum, line) => sum + line.taxAmount, 0);
  if (form.debitType === "Tax Adjustment") {
    taxTotal += taxAdjustment;
  }
  let total = detailed.reduce((sum, line) => sum + line.debitAmount, 0);
  if (form.debitType === "Tax Adjustment") {
    total += taxAdjustment;
  }
  const partialCap = parseNumber(form.partialAmountCap);
  if (form.debitType === "Partial Debit" && partialCap > 0) {
    total = Math.min(total, partialCap);
  }

  return {
    detailed,
    subtotal,
    taxTotal,
    total,
    updatedPayable: Math.max(0, payableBalance - total),
    cgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    sgst: country === "IN" && sameState ? taxTotal / 2 : 0,
    igst: country === "IN" && !sameState ? taxTotal : 0
  };
}
