import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "../../services/storage";
import { authGetRole } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
import { triggerLowStockNotifications } from "../items/store";
import { parseFormattedNumber } from "../../lib/formatPreferences";
import { parseDateInputToIso } from "../../lib/dateUtils";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, STATUS_FLOW } from "./countryConfig";
import type { CountryCode, CreditStatus, CreditType } from "./countryConfig";

const CREDIT_NOTE_STORE_KEY = "creditNotesPremiumV1";
const CREDIT_NOTE_SEQUENCE_KEY = "creditNotesPremiumSequenceV1";
const SELECTED_COUNTRY_KEY = "creditNoteSelectedCountryV1";
const PAYMENT_IN_PREMIUM_KEY = "paymentInPremiumV1";

function normalizeStoredDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = parseDateInputToIso(raw);
  if (direct) return direct;
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
  if (dateOnly) return parseDateInputToIso(dateOnly);
  return "";
}

export interface CreditInvoiceLine {
  id: string;
  sourceInvoiceItemId?: string;
  itemId?: string;
  creditedQty?: number;
  availableReturnQty?: number;
  priceTaxMode?: "WITH_TAX" | "WITHOUT_TAX";
  taxInclusive?: boolean;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
  amountAfterTax?: number;
}

export interface CreditInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  remainingBalance: number;
  balanceAmount: number;
  status: string;
  placeOfSupply?: string;
  lines: CreditInvoiceLine[];
}

export interface CustomerOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  state?: string;
  registrationNumber?: string;
  country: CountryCode;
}

export interface CreditLineDraft {
  id: string;
  sourceInvoiceItemId?: string;
  itemId?: string;
  sourceInvoiceQty?: number;
  sourceInvoiceAmountAfterTax?: number;
  priceTaxMode?: "WITH_TAX" | "WITHOUT_TAX";
  taxInclusive?: boolean;
  returnCondition?: "REUSABLE" | "NOT_REUSABLE" | "";
  purchaseRate?: number;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
  creditType: "Percentage" | "Fixed";
  creditValue: number;
}

export interface CreditLineComputed extends CreditLineDraft {
  baseAmount: number;
  taxAmount: number;
  amountAfterTax: number;
  creditApplied: number;
  creditAmount: number;
  validationMessage?: string;
}

export interface CreditTotals {
  subtotal: number;
  taxTotal: number;
  total: number;
  maxRefundTotal: number;
  refundMode: "FULL" | "PARTIAL" | "NONE";
  cgst: number;
  sgst: number;
  igst: number;
  pendingAmount: number;
}

export interface CreditNoteRecord {
  id: string;
  sourceSystem?: "premium" | "legacy";
  country: CountryCode;
  creditNoteNo: string;
  creditNoteDate: string;
  customerId: string;
  customerName: string;
  linkedInvoiceId: string;
  linkedInvoiceNo: string;
  linkedInvoiceDate: string;
  reason: string;
  status: CreditStatus;
  creditType: CreditType;
  currency: string;
  placeOfSupply?: string;
  taxRate: number;
  registrationNumber?: string;
  hmrcReference?: string;
  salesTaxState?: string;
  internalNotes?: string;
  customerNotes?: string;
  returnToStock?: boolean;
  refundMode?: "FULL" | "PARTIAL" | "NONE";
  partialRefundAmount?: number;
  discountPercent?: number;
  partialAmountCap?: number;
  priceAdjustmentAmount?: number;
  invoiceBalanceBefore: number;
  invoiceBalanceAfter: number;
  lines: CreditLineComputed[];
  totals: CreditTotals;
  audit: {
    createdBy: string;
    createdAt: string;
    modifiedBy: string;
    modifiedAt: string;
  };
  history: Array<{ status: CreditStatus; at: string; by: string; note: string }>;
}

export interface SaveCreditNotePayload {
  id?: string;
  country: CountryCode;
  creditNoteDate: string;
  customerId: string;
  customerName: string;
  linkedInvoiceId: string;
  linkedInvoiceNo: string;
  linkedInvoiceDate: string;
  reason: string;
  creditType: CreditType;
  desiredStatus: CreditStatus;
  taxRate: number;
  placeOfSupply?: string;
  registrationNumber?: string;
  hmrcReference?: string;
  salesTaxState?: string;
  internalNotes?: string;
  customerNotes?: string;
  returnToStock?: boolean;
  refundMode?: "FULL" | "PARTIAL" | "NONE";
  partialRefundAmount?: number;
  discountPercent?: number;
  partialAmountCap?: number;
  priceAdjustmentAmount?: number;
  invoiceBalanceBefore: number;
  lines: CreditLineDraft[];
  actor: string;
}

type SequenceStore = Partial<Record<CountryCode, number>>;

function nowIso() {
  return new Date().toISOString();
}

function assertCreditNoteWritePermission({ isEdit = false }: { isEdit?: boolean } = {}) {
  const role = authGetRole();
  if (isEdit) {
    if (!canEditEntries(role)) {
      throw new Error("You do not have permission to edit credit notes.");
    }
    return;
  }
  if (!canCreateEntries(role)) {
    throw new Error("You do not have permission to create credit notes.");
  }
}

function assertCreditNoteDeletePermission() {
  const role = authGetRole();
  if (!canDeleteEntries(role)) {
    throw new Error("You do not have permission to delete credit notes.");
  }
}

function normalizeCountryCode(value: unknown): CountryCode | null {
  if (!value) return null;
  const clean = String(value).trim();
  if (clean in COUNTRY_CONFIG) return clean as CountryCode;
  const upper = clean.toUpperCase();
  if (upper === "LK") return "SL";
  if (upper === "GB") return "UK";
  if (upper in COUNTRY_CONFIG) return upper as CountryCode;
  const compact = clean.toLowerCase().replace(/[^a-z]/g, "");
  if (compact === "srilanka") return "SL";
  if (compact === "unitedkingdom" || compact === "greatbritain" || compact === "britain") return "UK";
  if (compact === "unitedstates" || compact === "usa" || compact === "us") return "US";
  if (compact === "uae" || compact === "unitedarabemirates") return "AE";
  return COUNTRY_NAME_TO_CODE[clean] || null;
}

function normalizeCreditStatus(value: unknown): CreditStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "applied") return "Applied";
  if (normalized === "issued") return "Issued";
  return "Draft";
}

function inferCountryFromCreditNoteNo(value: unknown): CountryCode | null {
  const noteNo = String(value || "").trim().toUpperCase();
  if (!noteNo) return null;
  if (noteNo.startsWith("CN-IN-")) return "IN";
  if (noteNo.startsWith("CN-SL-")) return "SL";
  if (noteNo.startsWith("CN-UAE-")) return "AE";
  if (noteNo.startsWith("CN-SG-")) return "SG";
  if (noteNo.startsWith("CN-UK-")) return "UK";
  if (noteNo.startsWith("CN-IE-")) return "IE";
  if (noteNo.startsWith("CN-US-")) return "US";
  return null;
}

function getAllNotes(): CreditNoteRecord[] {
  return lsGetOrganizationScoped(CREDIT_NOTE_STORE_KEY, []);
}

function resolveLegacyCreditCountry(row: any): CountryCode {
  const directCountry =
    normalizeCountryCode(row?.country) ||
    inferCountryFromCreditNoteNo(row?.creditNoteNo || row?.referenceNo);
  if (directCountry) return directCountry;

  const linkedInvoiceId = String(
    row?.referenceInvoiceId || row?.linkedInvoiceId || row?.related_invoice_id || ""
  ).trim();
  if (linkedInvoiceId) {
    const invoice = (lsGetOrganizationScoped(LS_KEYS.invoices, []) as any[]).find(
      (entry) => String(entry?.id || "").trim() === linkedInvoiceId
    );
    const invoiceCountry = normalizeCountryCode(invoice?.country);
    if (invoiceCountry) return invoiceCountry;
  }

  const selectedCountry = normalizeCountryCode(lsGetOrganizationScoped(SELECTED_COUNTRY_KEY, ""));
  if (selectedCountry) return selectedCountry;

  const companyProfile = lsGetOrganizationScoped(LS_KEYS.company_profile, null) as any;
  const companyCountry =
    normalizeCountryCode(companyProfile?.countryCode) ||
    normalizeCountryCode(companyProfile?.country) ||
    normalizeCountryCode(companyProfile?.address?.country);
  if (companyCountry) return companyCountry;

  return "IN";
}

function buildLegacyCreditLine(line: any, index: number): CreditLineComputed {
  const quantity = Math.max(0, toNumber(line?.quantity ?? line?.qty ?? 0));
  const rate = Math.max(0, toNumber(line?.rate));
  const taxRate = Math.max(0, toNumber(line?.taxRate ?? line?.tax ?? 0));
  const baseAmount = Math.max(0, toNumber(line?.baseAmount ?? line?.taxableAmount ?? line?.net));
  const taxAmount = Math.max(
    0,
    toNumber(
      line?.taxAmount ??
        line?.lineTax ??
        toNumber(line?.cgstAmount) +
          toNumber(line?.sgstAmount) +
          toNumber(line?.igstAmount) +
          toNumber(line?.vatAmount)
    )
  );
  const amountAfterTax = Math.max(
    0,
    toNumber(line?.amountAfterTax ?? line?.amount ?? line?.lineTotal ?? line?.total ?? baseAmount + taxAmount)
  );
  const creditAmount = Math.max(
    0,
    toNumber(line?.creditAmount ?? line?.creditApplied ?? line?.amount ?? amountAfterTax)
  );
  const lineId = String(line?.id || line?.sourceInvoiceItemId || line?.source_invoice_item_id || `legacy_line_${index + 1}`);

  return {
    id: lineId,
    sourceInvoiceItemId: String(line?.sourceInvoiceItemId || line?.source_invoice_item_id || lineId),
    itemId: String(line?.itemId || line?.item_id || ""),
    sourceInvoiceQty: Math.max(0, toNumber(line?.sourceInvoiceQty ?? line?.source_invoice_qty ?? quantity)),
    sourceInvoiceAmountAfterTax: Math.max(
      0,
      toNumber(line?.sourceInvoiceAmountAfterTax ?? line?.source_invoice_amount_after_tax ?? amountAfterTax)
    ),
    priceTaxMode:
      String(line?.priceTaxMode || line?.price_tax_mode || "").trim().toUpperCase() === "WITH_TAX"
        ? "WITH_TAX"
        : "WITHOUT_TAX",
    taxInclusive:
      line?.taxInclusive === true ||
      line?.tax_inclusive === true ||
      String(line?.priceTaxMode || line?.price_tax_mode || "").trim().toUpperCase() === "WITH_TAX",
    returnCondition:
      line?.returnCondition === "REUSABLE" || line?.returnCondition === "NOT_REUSABLE"
        ? line.returnCondition
        : "",
    purchaseRate: Math.max(0, toNumber(line?.purchaseRate ?? line?.purchase_rate)),
    itemName: String(line?.itemName || line?.name || `Item ${index + 1}`),
    quantity,
    rate,
    taxRate,
    hsnSac: String(line?.hsnSac || line?.hsn || line?.sac || ""),
    creditType: line?.creditType === "Fixed" ? "Fixed" : "Percentage",
    creditValue: Math.max(0, toNumber(line?.creditValue)),
    baseAmount,
    taxAmount,
    amountAfterTax,
    creditApplied: Math.max(0, amountAfterTax - creditAmount),
    creditAmount
  };
}

function getLegacyCreditNotes(): CreditNoteRecord[] {
  const rawNotes = lsGetOrganizationScoped(LS_KEYS.creditNotes, []) as any[];
  const invoiceRows = lsGetOrganizationScoped(LS_KEYS.invoices, []) as any[];
  const partyRows = lsGetOrganizationScoped(LS_KEYS.parties, []) as any[];
  const invoicesById = new Map(
    invoiceRows.map((row) => [String(row?.id || "").trim(), row]).filter(([id]) => !!id)
  );
  const partiesById = new Map(
    partyRows.map((row) => [String(row?.id || "").trim(), row]).filter(([id]) => !!id)
  );

  return rawNotes.map((row, index) => {
    const linkedInvoiceId = String(
      row?.referenceInvoiceId || row?.linkedInvoiceId || row?.related_invoice_id || ""
    ).trim();
    const invoice = linkedInvoiceId ? invoicesById.get(linkedInvoiceId) : null;
    const customerId = String(
      row?.partyId || row?.customerId || row?.party_id || invoice?.partyId || invoice?.customerId || ""
    ).trim();
    const party = customerId ? partiesById.get(customerId) : null;
    const country = resolveLegacyCreditCountry(row);
    const lines = (Array.isArray(row?.lines) ? row.lines : []).map((line: any, lineIndex: number) =>
      buildLegacyCreditLine(line, lineIndex)
    );
    const subtotal = Math.max(
      0,
      toNumber(
        row?.totals?.subTotal ??
          row?.totals?.subtotal ??
          row?.totals?.taxable ??
          lines.reduce((sum, line) => sum + Math.max(0, toNumber(line.baseAmount)), 0)
      )
    );
    const taxTotal = Math.max(
      0,
      toNumber(
        row?.totals?.taxTotal ??
          row?.totals?.tax ??
          row?.tax_total ??
          lines.reduce((sum, line) => sum + Math.max(0, toNumber(line.taxAmount)), 0)
      )
    );
    const total = Math.max(
      0,
      toNumber(
        row?.totals?.grandTotal ??
          row?.totals?.total ??
          row?.grand_total ??
          row?.grandTotal ??
          row?.amount ??
          subtotal + taxTotal
      )
    );
    const status = normalizeCreditStatus(row?.status);
    const createdAt = String(row?.created_at || row?.createdAt || nowIso());
    const refundMode =
      row?.refundMode === "PARTIAL" || row?.refundMode === "NONE" ? row.refundMode : "FULL";

    return {
      id: `legacy_${String(row?.id || row?.creditNoteNo || row?.referenceNo || index + 1)}`,
      sourceSystem: "legacy",
      country,
      creditNoteNo: String(row?.creditNoteNo || row?.referenceNo || `LEGACY-CN-${index + 1}`),
      creditNoteDate:
        normalizeStoredDate(row?.creditDate || row?.credit_note_date || row?.created_at) ||
        String(row?.creditDate || row?.credit_note_date || row?.created_at || ""),
      customerId,
      customerName: String(
        row?.customerName ||
          row?.partyName ||
          row?.customer_name ||
          invoice?.partyName ||
          invoice?.customerName ||
          party?.name ||
          "Customer"
      ),
      linkedInvoiceId,
      linkedInvoiceNo: String(
        row?.referenceInvoiceNo || row?.linkedInvoiceNo || invoice?.invoiceNo || ""
      ),
      linkedInvoiceDate:
        normalizeStoredDate(row?.linkedInvoiceDate || invoice?.invoiceDate || invoice?.date) ||
        String(row?.linkedInvoiceDate || invoice?.invoiceDate || invoice?.date || ""),
      reason: String(row?.reason || row?.notes || row?.description || ""),
      status,
      creditType: "Full Credit",
      currency: COUNTRY_CONFIG[country].currency,
      placeOfSupply: String(row?.placeOfSupply || invoice?.placeOfSupply || invoice?.buyer?.state || ""),
      taxRate: Math.max(0, toNumber(row?.taxRate ?? row?.tax_rate ?? lines[0]?.taxRate)),
      registrationNumber: String(row?.registrationNumber || row?.gstin || row?.trn || row?.vatNo || ""),
      hmrcReference: String(row?.hmrcReference || ""),
      salesTaxState: String(row?.salesTaxState || ""),
      internalNotes: String(row?.internalNotes || row?.notes || ""),
      customerNotes: String(row?.customerNotes || ""),
      returnToStock: false,
      refundMode,
      partialRefundAmount: Math.max(0, toNumber(row?.partialRefundAmount)),
      discountPercent: Math.max(0, toNumber(row?.discountPercent)),
      partialAmountCap: Math.max(0, toNumber(row?.partialAmountCap)),
      priceAdjustmentAmount: Math.max(0, toNumber(row?.priceAdjustmentAmount)),
      invoiceBalanceBefore: Math.max(0, toNumber(row?.invoiceBalanceBefore ?? invoice?.remainingBalance)),
      invoiceBalanceAfter: Math.max(0, toNumber(row?.invoiceBalanceAfter ?? row?.pendingAmount ?? 0)),
      lines,
      totals: {
        subtotal,
        taxTotal,
        total,
        maxRefundTotal: Math.max(0, toNumber(row?.totals?.maxRefundTotal ?? total)),
        refundMode,
        cgst: Math.max(0, toNumber(row?.totals?.cgst)),
        sgst: Math.max(0, toNumber(row?.totals?.sgst)),
        igst: Math.max(0, toNumber(row?.totals?.igst)),
        pendingAmount: Math.max(
          0,
          toNumber(
            row?.totals?.pendingAmount ?? row?.pendingAmount ?? row?.invoiceBalanceAfter ?? 0
          )
        )
      },
      audit: {
        createdBy: String(row?.createdBy || "Legacy Import"),
        createdAt,
        modifiedBy: String(row?.modifiedBy || row?.createdBy || "Legacy Import"),
        modifiedAt: String(row?.modifiedAt || createdAt)
      },
      history: Array.isArray(row?.history)
        ? row.history
        : [{ status, at: createdAt, by: "Legacy Import", note: "Imported from legacy credit notes" }]
    } satisfies CreditNoteRecord;
  });
}

function getMergedCreditNotes(): CreditNoteRecord[] {
  const premiumNotes = getAllNotes().map((note) => ({
    ...note,
    sourceSystem: note?.sourceSystem || "premium"
  }));
  return [...premiumNotes, ...getLegacyCreditNotes()].sort((a, b) => {
    const left = String(a?.creditNoteDate || a?.audit?.createdAt || "");
    const right = String(b?.creditNoteDate || b?.audit?.createdAt || "");
    if (left === right) return String(b?.creditNoteNo || "").localeCompare(String(a?.creditNoteNo || ""));
    return left < right ? 1 : -1;
  });
}

function setAllNotes(list: CreditNoteRecord[]) {
  lsSetOrganizationScoped(CREDIT_NOTE_STORE_KEY, list);
}

function getSequenceStore(): SequenceStore {
  return lsGetOrganizationScoped(CREDIT_NOTE_SEQUENCE_KEY, {});
}

function setSequenceStore(value: SequenceStore) {
  lsSetOrganizationScoped(CREDIT_NOTE_SEQUENCE_KEY, value);
}

function inferCurrentCountrySequence(country: CountryCode, notes: CreditNoteRecord[]) {
  const prefix = COUNTRY_CONFIG[country].numberPrefix;
  return notes
    .filter((note) => note.country === country && note.creditNoteNo.startsWith(prefix))
    .reduce((max, note) => {
      const chunk = note.creditNoteNo.replace(prefix, "");
      const n = Number(chunk);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
}

function nextCreditNoteNumber(country: CountryCode): string {
  const notes = getAllNotes();
  const store = getSequenceStore();
  const inferred = inferCurrentCountrySequence(country, notes);
  const current = Math.max(store[country] || 0, inferred);
  const next = current + 1;
  setSequenceStore({ ...store, [country]: next });
  return `${COUNTRY_CONFIG[country].numberPrefix}${String(next).padStart(5, "0")}`;
}

function toNumber(value: unknown) {
  const n = parseFormattedNumber(value);
  return Number.isFinite(n) ? n : 0;
}

function appliedPaymentInForInvoice(invoiceId: string) {
  if (!invoiceId) return 0;
  const legacy = (lsGetOrganizationScoped(LS_KEYS.payments, []) as any[])
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "IN")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PI:"))
    .filter((entry) => String(entry?.invoiceId || entry?.invoice_id || "") === String(invoiceId))
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount)), 0);

  const premium = (lsGetOrganizationScoped(PAYMENT_IN_PREMIUM_KEY, []) as any[])
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        (Array.isArray(entry?.allocations) ? entry.allocations : [])
          .filter((line: any) => String(line?.invoiceId || "") === String(invoiceId))
          .reduce((lineSum: number, line: any) => lineSum + Math.max(0, toNumber(line?.applyAmount)), 0),
      0
    );

  return legacy + premium;
}

function appliedCreditForInvoice(invoiceId: string) {
  if (!invoiceId) return 0;
  const premium = getAllNotes()
    .filter((entry) => entry.status === "Applied")
    .filter((entry) => String(entry.linkedInvoiceId || "") === String(invoiceId))
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.totals?.total)), 0);

  const legacy = (lsGetOrganizationScoped(LS_KEYS.creditNotes, []) as any[])
    .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
    .filter(
      (entry) =>
        String(entry?.referenceInvoiceId || entry?.linkedInvoiceId || entry?.related_invoice_id || "") ===
        String(invoiceId)
    )
    .reduce(
      (sum, entry) =>
        sum +
        Math.max(
          0,
          toNumber(
            entry?.totals?.grandTotal ??
              entry?.totals?.total ??
              entry?.grand_total ??
              entry?.grandTotal ??
              entry?.amount
          )
        ),
      0
    );

  return premium + legacy;
}

function appliedCreditQtyBySourceForInvoice(invoiceId: string) {
  const bySource = new Map<string, number>();
  const byItem = new Map<string, number>();
  if (!invoiceId) return { bySource, byItem };

  const addQty = (line: any) => {
    const qty = Math.max(0, toNumber(line?.quantity ?? line?.qty));
    if (qty <= 0) return;
    const sourceId = String(line?.sourceInvoiceItemId || line?.source_invoice_item_id || line?.id || "").trim();
    if (sourceId) {
      bySource.set(sourceId, (bySource.get(sourceId) || 0) + qty);
    }
    const itemId = String(line?.itemId || line?.item_id || "").trim();
    if (itemId) {
      byItem.set(itemId, (byItem.get(itemId) || 0) + qty);
    }
  };

  getAllNotes()
    .filter((entry) => entry.status === "Applied")
    .filter((entry) => String(entry.linkedInvoiceId || "") === String(invoiceId))
    .forEach((entry) => {
      (Array.isArray(entry?.lines) ? entry.lines : []).forEach((line) => addQty(line));
    });

  (lsGetOrganizationScoped(LS_KEYS.creditNotes, []) as any[])
    .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
    .filter(
      (entry) =>
        String(entry?.referenceInvoiceId || entry?.linkedInvoiceId || entry?.related_invoice_id || "") ===
        String(invoiceId)
    )
    .forEach((entry) => {
      (Array.isArray(entry?.lines) ? entry.lines : []).forEach((line: any) => addQty(line));
    });

  return { bySource, byItem };
}

function computeLines(
  lines: CreditLineDraft[],
  _creditType: CreditType,
  _discountPercent = 0,
  _priceAdjustmentAmount = 0
) {
  const toCents = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
  const fromCents = (value: number) => value / 100;
  return lines.map((line, index) => {
    const quantity = Math.max(0, toNumber(line.quantity));
    const rate = Math.max(0, toNumber(line.rate));
    const taxRate = Math.max(0, toNumber(line.taxRate));
    const priceTaxMode =
      String(line.priceTaxMode || "").toUpperCase() === "WITH_TAX" ||
      line.taxInclusive === true
        ? "WITH_TAX"
        : "WITHOUT_TAX";
    const taxInclusive = priceTaxMode === "WITH_TAX";
    const creditType = line.creditType === "Fixed" ? "Fixed" : "Percentage";
    const creditValue = Math.max(0, toNumber(line.creditValue));
    const grossCents = toCents(quantity * rate);
    let baseCents = grossCents;
    let taxCents = 0;
    let afterTaxCents = grossCents;
    if (taxRate > 0) {
      if (taxInclusive) {
        const divisor = 1 + taxRate / 100;
        baseCents = divisor > 0 ? Math.round(grossCents / divisor) : grossCents;
        taxCents = grossCents - baseCents;
        afterTaxCents = grossCents;
      } else {
        baseCents = grossCents;
        taxCents = Math.round((baseCents * taxRate) / 100);
        afterTaxCents = baseCents + taxCents;
      }
    }
    const requestedCreditCents =
      creditType === "Percentage"
        ? Math.round((afterTaxCents * creditValue) / 100)
        : toCents(creditValue);
    const creditAppliedCents = Math.min(afterTaxCents, Math.max(0, requestedCreditCents));
    const finalCents = afterTaxCents - creditAppliedCents;
    const validationMessage =
      requestedCreditCents > afterTaxCents
        ? "Credit cannot exceed amount after tax."
        : "";

    return {
      ...line,
      id: line.id || `line_${index + 1}`,
      sourceInvoiceItemId: line.sourceInvoiceItemId || line.id || `line_${index + 1}`,
      itemId: line.itemId || "",
      sourceInvoiceQty: Math.max(0, toNumber(line.sourceInvoiceQty)),
      sourceInvoiceAmountAfterTax: Math.max(0, toNumber(line.sourceInvoiceAmountAfterTax)),
      priceTaxMode,
      taxInclusive,
      returnCondition:
        line.returnCondition === "REUSABLE" || line.returnCondition === "NOT_REUSABLE"
          ? line.returnCondition
          : "",
      purchaseRate: Math.max(0, toNumber(line.purchaseRate)),
      quantity,
      rate,
      taxRate,
      creditType,
      creditValue,
      baseAmount: fromCents(baseCents),
      taxAmount: fromCents(taxCents),
      amountAfterTax: fromCents(afterTaxCents),
      creditApplied: fromCents(creditAppliedCents),
      creditAmount: fromCents(finalCents),
      validationMessage
    };
  });
}

function computeTotals(
  country: CountryCode,
  lines: CreditLineComputed[],
  invoiceBalanceBefore: number,
  partialAmountCap?: number,
  refundModeInput: "FULL" | "PARTIAL" | "NONE" = "FULL"
): CreditTotals {
  const returnSubtotal = lines.reduce((sum, line) => sum + line.baseAmount, 0);
  const returnTaxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const refundMode =
    refundModeInput === "PARTIAL" || refundModeInput === "NONE" ? refundModeInput : "FULL";
  let maxRefundTotal = lines.reduce((sum, line) => sum + line.creditAmount, 0);
  const cap = toNumber(partialAmountCap);

  if (cap > 0) {
    maxRefundTotal = Math.min(maxRefundTotal, cap);
  }

  let total = maxRefundTotal;
  if (refundMode === "NONE") {
    total = 0;
  }
  const refundRatio = maxRefundTotal > 0 ? total / maxRefundTotal : 0;
  const subtotal = returnSubtotal * refundRatio;
  const taxTotal = returnTaxTotal * refundRatio;

  const cfg = COUNTRY_CONFIG[country];
  const pendingAmount = Math.max(0, toNumber(invoiceBalanceBefore) - total);

  if (cfg.taxModel !== "GST" || country !== "IN") {
    return {
      subtotal,
      taxTotal,
      total,
      maxRefundTotal,
      refundMode,
      cgst: 0,
      sgst: 0,
      igst: 0,
      pendingAmount
    };
  }

  return {
    subtotal,
    taxTotal,
    total,
    maxRefundTotal,
    refundMode,
    cgst: taxTotal / 2,
    sgst: taxTotal / 2,
    igst: 0,
    pendingAmount
  };
}

function normalizeLineSourceId(line: { sourceInvoiceItemId?: string; id?: string; itemId?: string }) {
  return String(line?.sourceInvoiceItemId || line?.id || "").trim();
}

function buildAppliedCreditQtyIndex(
  notes: CreditNoteRecord[],
  linkedInvoiceId: string,
  excludeNoteId?: string
) {
  const bySource = new Map<string, number>();
  const byItem = new Map<string, number>();

  notes
    .filter((entry) => entry.status === "Applied")
    .filter((entry) => String(entry.linkedInvoiceId || "") === String(linkedInvoiceId || ""))
    .filter((entry) => String(entry.id || "") !== String(excludeNoteId || ""))
    .forEach((entry) => {
      (Array.isArray(entry.lines) ? entry.lines : []).forEach((line) => {
        const qty = Math.max(0, toNumber((line as any)?.quantity));
        if (qty <= 0) return;
        const sourceId = normalizeLineSourceId(line as any);
        if (sourceId) {
          bySource.set(sourceId, (bySource.get(sourceId) || 0) + qty);
        }
        const itemId = String((line as any)?.itemId || "").trim();
        if (itemId) {
          byItem.set(itemId, (byItem.get(itemId) || 0) + qty);
        }
      });
    });

  return { bySource, byItem };
}

function validatePayloadLineLimits(
  payload: SaveCreditNotePayload,
  linkedInvoice: CreditInvoice,
  existingNoteId: string | undefined,
  allNotes: CreditNoteRecord[]
) {
  const invoiceLineBySource = new Map<string, CreditInvoiceLine>();
  const invoiceQtyByItem = new Map<string, number>();
  (Array.isArray(linkedInvoice.lines) ? linkedInvoice.lines : []).forEach((line) => {
    const sourceId = normalizeLineSourceId(line);
    if (sourceId) {
      invoiceLineBySource.set(sourceId, line);
    }
    const itemId = String(line?.itemId || "").trim();
    if (itemId) {
      const qty = Math.max(0, toNumber(line?.quantity));
      invoiceQtyByItem.set(itemId, (invoiceQtyByItem.get(itemId) || 0) + qty);
    }
  });

  const { bySource, byItem } = buildAppliedCreditQtyIndex(
    allNotes,
    payload.linkedInvoiceId,
    existingNoteId
  );

  (Array.isArray(payload.lines) ? payload.lines : []).forEach((line, idx) => {
    const requestedQty = Math.max(0, toNumber(line?.quantity));
    if (requestedQty <= 0) return;

    const sourceId = normalizeLineSourceId(line);
    const sourceLine = sourceId ? invoiceLineBySource.get(sourceId) : null;
    if (sourceLine) {
      const sourceQty = Math.max(0, toNumber(sourceLine.quantity));
      const alreadyCredited = Math.max(0, toNumber(bySource.get(sourceId) || 0));
      const availableQty = Math.max(0, sourceQty - alreadyCredited);
      if (requestedQty > availableQty + 1e-6) {
        throw new Error(
          `Credit line ${idx + 1} quantity ${requestedQty} exceeds available ${availableQty} for invoice line ${idx + 1}.`
        );
      }
      return;
    }

    const itemId = String(line?.itemId || "").trim();
    if (itemId && invoiceQtyByItem.has(itemId)) {
      const sourceQty = Math.max(0, toNumber(invoiceQtyByItem.get(itemId) || 0));
      const alreadyCredited = Math.max(0, toNumber(byItem.get(itemId) || 0));
      const availableQty = Math.max(0, sourceQty - alreadyCredited);
      if (requestedQty > availableQty + 1e-6) {
        throw new Error(
          `Credit line ${idx + 1} quantity ${requestedQty} exceeds available ${availableQty} for this item.`
        );
      }
      return;
    }

    throw new Error(
      `Credit line ${idx + 1} is not linked to the selected invoice. Add lines only from the linked invoice.`
    );
  });
}

function buildItemQtyMap(lines: Array<Partial<CreditLineComputed>> | null | undefined) {
  const map = new Map<string, number>();
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const returnCondition = String((line as any)?.returnCondition || "").trim().toUpperCase();
    if (returnCondition !== "REUSABLE") return;
    const itemId = String((line as any)?.itemId || "").trim();
    if (!itemId) return;
    const qty = Math.max(0, toNumber((line as any)?.quantity));
    if (qty <= 0) return;
    map.set(itemId, (map.get(itemId) || 0) + qty);
  });
  return map;
}

function applyLocalReturnStockDelta(previousNote: CreditNoteRecord | undefined, nextNote: CreditNoteRecord) {
  const prevEligible = !!previousNote && previousNote.status === "Applied";
  const nextEligible = nextNote.status === "Applied";
  const previousQtyByItem = prevEligible ? buildItemQtyMap(previousNote?.lines) : new Map<string, number>();
  const nextQtyByItem = nextEligible ? buildItemQtyMap(nextNote?.lines) : new Map<string, number>();
  const allItemIds = new Set<string>([
    ...Array.from(previousQtyByItem.keys()),
    ...Array.from(nextQtyByItem.keys())
  ]);
  if (!allItemIds.size) return;

  const items = lsGetOrganizationScoped(LS_KEYS.items, []);
  if (!Array.isArray(items) || !items.length) return;

  const nextItems = items.map((item: any) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId || !allItemIds.has(itemId)) return item;
    const previousQty = previousQtyByItem.get(itemId) || 0;
    const nextQty = nextQtyByItem.get(itemId) || 0;
    const delta = nextQty - previousQty;
    if (!delta) return item;
    const nextCurrentStock = Math.max(0, toNumber(item?.currentStock ?? item?.stockQty) + delta);
    const nextStockQty = Math.max(0, toNumber(item?.stockQty ?? item?.currentStock) + delta);
    return {
      ...item,
      currentStock: nextCurrentStock,
      stockQty: nextStockQty,
      metadata: {
        ...(item?.metadata && typeof item.metadata === "object" ? item.metadata : {}),
        currentStock: nextCurrentStock
      }
    };
  });
  lsSetOrganizationScoped(LS_KEYS.items, nextItems);
}

function recalculateLocalInvoiceBalance(invoiceId: string) {
  const normalizedInvoiceId = String(invoiceId || "").trim();
  if (!normalizedInvoiceId) return;
  const invoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  if (!Array.isArray(invoices) || !invoices.length) return;

  const paymentApplied = appliedPaymentInForInvoice(normalizedInvoiceId);
  const creditApplied = appliedCreditForInvoice(normalizedInvoiceId);

  const nextInvoices = invoices.map((invoice: any) => {
    if (String(invoice?.id || "").trim() !== normalizedInvoiceId) return invoice;
    const invoiceTotal = Math.max(
      0,
      toNumber(
        invoice?.totals?.grandTotal ??
          invoice?.totals?.total ??
          invoice?.totals?.subTotal ??
          invoice?.grandTotal
      )
    );
    const nextBalance = Math.max(0, invoiceTotal - paymentApplied - creditApplied);
    const nextTotals =
      invoice?.totals && typeof invoice.totals === "object"
        ? { ...invoice.totals, balance: nextBalance }
        : { balance: nextBalance };
    return {
      ...invoice,
      totals: nextTotals,
      remainingBalance: nextBalance,
      balanceAmount: nextBalance
    };
  });

  lsSetOrganizationScoped(LS_KEYS.invoices, nextInvoices);
}

function buildHistory(
  previous: CreditNoteRecord | undefined,
  status: CreditStatus,
  actor: string,
  now: string
) {
  const existingHistory = previous?.history || [];
  const lastStatus = existingHistory[existingHistory.length - 1]?.status;
  if (lastStatus === status) return existingHistory;
  return [...existingHistory, { status, by: actor, at: now, note: `Status moved to ${status}` }];
}

export function getSelectedCreditCountry(): CountryCode | "" {
  const saved = lsGetOrganizationScoped(SELECTED_COUNTRY_KEY, "");
  return normalizeCountryCode(saved) || "";
}

export function setSelectedCreditCountry(country: CountryCode) {
  lsSetOrganizationScoped(SELECTED_COUNTRY_KEY, country);
}

export function listCreditNotes(country?: CountryCode) {
  const notes = getMergedCreditNotes();
  if (!country) return notes;
  return notes.filter((note) => note.country === country);
}

export function getCreditNote(id: string) {
  return getMergedCreditNotes().find((note) => note.id === id) || null;
}

export function mapInvoicesByCountry(country: CountryCode): CreditInvoice[] {
  const rawInvoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);

  const fromStorage: CreditInvoice[] = rawInvoices
    .map((invoice: any) => {
      const mappedCountry = normalizeCountryCode(invoice?.country) || null;
      if (mappedCountry && mappedCountry !== country) return null;
      const appliedCreditQty = appliedCreditQtyBySourceForInvoice(String(invoice?.id || ""));
      const lines = Array.isArray(invoice?.lines)
        ? invoice.lines.map((line: any, idx: number) => {
            const quantity = Math.max(0, toNumber(line.qty ?? line.quantity ?? 0));
            const rate = Math.max(0, toNumber(line.rate));
            const taxRate = Math.max(0, toNumber(line.tax ?? line.taxRate));
            const sourceInvoiceItemId = line.id || `line_${idx + 1}`;
            const itemId = line.itemId || "";
            const creditedFromSource = Math.max(
              0,
              toNumber(appliedCreditQty.bySource.get(String(sourceInvoiceItemId)) || 0)
            );
            const availableReturnQty = Math.max(0, quantity - creditedFromSource);
            const explicitPriceTaxMode = String(
              line.priceTaxMode ?? line.price_tax_mode ?? ""
            )
              .trim()
              .toUpperCase();
            const explicitTaxInclusive =
              line.taxInclusive === true || line.tax_inclusive === true;
            const inferredTaxInclusiveFromTotal =
              taxRate > 0
                ? Math.abs(
                    toNumber(line.amount ?? line.lineTotal ?? line.total) - quantity * rate
                  ) <= 0.05
                : false;
            const taxInclusive =
              explicitTaxInclusive ||
              explicitPriceTaxMode === "WITH_TAX" ||
              (explicitPriceTaxMode !== "WITHOUT_TAX" && inferredTaxInclusiveFromTotal);
            const priceTaxMode = taxInclusive ? "WITH_TAX" : "WITHOUT_TAX";
            const taxableAmount = toNumber(line.taxableAmount ?? line.net);
            const lineTax = toNumber(
              line.lineTax ??
                toNumber(line.cgstAmount) +
                  toNumber(line.sgstAmount) +
                  toNumber(line.igstAmount) +
                  toNumber(line.vatAmount)
            );
            const amountAfterTax = Math.max(
              0,
              toNumber(
                line.amount ??
                  line.lineTotal ??
                  line.total ??
                  (taxableAmount > 0 || lineTax > 0
                    ? taxableAmount + lineTax
                    : taxInclusive
                      ? quantity * rate
                      : quantity * rate * (1 + taxRate / 100))
              )
            );
            return {
              id: sourceInvoiceItemId,
              sourceInvoiceItemId,
              itemId,
              creditedQty: creditedFromSource,
              availableReturnQty,
              priceTaxMode,
              taxInclusive,
              itemName: line.itemName || line.name || `Item ${idx + 1}`,
              quantity,
              rate,
              taxRate,
              hsnSac: line.hsn || line.sac || line.hsnSac || "",
              amountAfterTax
            };
          })
        : [];

      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo || invoice.id,
        country,
        customerId: invoice.partyId || invoice.customerId || invoice.buyer?.id || invoice.customerName || "unknown_customer",
        customerName: invoice.partyName || invoice.customerName || invoice.buyer?.name || "Customer",
        invoiceDate: invoice.invoiceDate || invoice.date || "",
        remainingBalance: (() => {
          const invoiceTotal = toNumber(
            invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.totals?.subTotal
          );
          const paymentApplied = appliedPaymentInForInvoice(invoice?.id);
          const creditApplied = appliedCreditForInvoice(invoice?.id);
          const storedBalance = toNumber(
            invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoiceTotal
          );
          const hasLinkedActivity = paymentApplied > 0 || creditApplied > 0;
          return Math.max(
            0,
            hasLinkedActivity ? invoiceTotal - paymentApplied - creditApplied : storedBalance
          );
        })(),
        balanceAmount: (() => {
          const invoiceTotal = toNumber(
            invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.totals?.subTotal
          );
          const paymentApplied = appliedPaymentInForInvoice(invoice?.id);
          const creditApplied = appliedCreditForInvoice(invoice?.id);
          const storedBalance = toNumber(
            invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoiceTotal
          );
          const hasLinkedActivity = paymentApplied > 0 || creditApplied > 0;
          return Math.max(
            0,
            hasLinkedActivity ? invoiceTotal - paymentApplied - creditApplied : storedBalance
          );
        })(),
        status: invoice?.status || invoice?.paymentStatus || "Issued",
        placeOfSupply: invoice.placeOfSupply || invoice.buyer?.state || "",
        lines
      } satisfies CreditInvoice;
    })
    .filter(Boolean);

  return fromStorage.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));
}

export function mapCustomersByCountry(country: CountryCode): CustomerOption[] {
  const parties = lsGetOrganizationScoped(LS_KEYS.parties, []);

  const fromParties = parties
    .map((party: any) => {
      if (String(party?.type || "").toLowerCase() !== "customer") return null;
      return {
        id: party.id,
        name: party.name,
        email: party.email || "",
        phone: party.phone || "",
        address: party.address || "",
        state: party.state || "",
        registrationNumber: party.gstin || party.trn || party.vatNo || "",
        country: normalizeCountryCode(party.country) || country
      } satisfies CustomerOption;
    })
    .filter(Boolean) as CustomerOption[];

  const byId = new Map<string, CustomerOption>();
  fromParties.forEach((entry) => {
    if (!entry?.id || !entry.name) return;
    const existing = byId.get(entry.id);
    byId.set(entry.id, { ...(existing || {}), ...entry });
  });

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ensureTransition(previous: CreditStatus, next: CreditStatus) {
  const allowed = STATUS_FLOW[previous] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition: ${previous} -> ${next}`);
  }
}

export function saveCreditNote(payload: SaveCreditNotePayload): CreditNoteRecord {
  assertCreditNoteWritePermission({ isEdit: !!payload?.id });
  const linkedInvoice = mapInvoicesByCountry(payload.country).find(
    (invoice) => String(invoice.id) === String(payload.linkedInvoiceId)
  );
  if (!linkedInvoice) {
    throw new Error("Linked invoice is invalid for the selected country.");
  }
  if (String(linkedInvoice.customerId) !== String(payload.customerId)) {
    throw new Error(`Invoice ${linkedInvoice.invoiceNo} belongs to a different customer.`);
  }

  const list = getAllNotes();
  const existing = payload.id ? list.find((note) => note.id === payload.id) : undefined;
  const now = nowIso();
  const previousStatus: CreditStatus = existing?.status || "Draft";
  const nextStatus = payload.desiredStatus;
  ensureTransition(previousStatus, nextStatus);
  validatePayloadLineLimits(payload, linkedInvoice, existing?.id, list);

  const lines = computeLines(
    payload.lines,
    payload.creditType,
    payload.discountPercent,
    payload.priceAdjustmentAmount
  );
  const authoritativeBalanceBefore = toNumber(
    linkedInvoice.balanceAmount ?? linkedInvoice.remainingBalance ?? payload.invoiceBalanceBefore
  );
  const totals = computeTotals(
    payload.country,
    lines,
    authoritativeBalanceBefore,
    payload.partialAmountCap,
    payload.refundMode || "FULL"
  );
  if (totals.refundMode === "PARTIAL" && totals.total <= 0) {
    throw new Error("Returned item value must be greater than zero for partial refund.");
  }
  if (totals.total > authoritativeBalanceBefore + 0.01) {
    throw new Error(
      `Credit amount ${totals.total.toFixed(2)} exceeds invoice balance ${authoritativeBalanceBefore.toFixed(2)}.`
    );
  }
  const creditNoteNo = existing?.creditNoteNo || nextCreditNoteNumber(payload.country);
  const id = existing?.id || `crn_${Date.now().toString(16)}`;

  const note: CreditNoteRecord = {
    id,
    country: payload.country,
    creditNoteNo,
    creditNoteDate: normalizeStoredDate(payload.creditNoteDate) || payload.creditNoteDate,
    customerId: payload.customerId,
    customerName: payload.customerName,
    linkedInvoiceId: payload.linkedInvoiceId,
    linkedInvoiceNo: payload.linkedInvoiceNo,
    linkedInvoiceDate: normalizeStoredDate(payload.linkedInvoiceDate) || payload.linkedInvoiceDate,
    reason: payload.reason,
    status: nextStatus,
    creditType: payload.creditType,
    currency: COUNTRY_CONFIG[payload.country].currency,
    placeOfSupply: payload.placeOfSupply || "",
    taxRate: toNumber(payload.taxRate),
    registrationNumber: payload.registrationNumber || "",
    hmrcReference: payload.hmrcReference || "",
    salesTaxState: payload.salesTaxState || "",
    internalNotes: payload.internalNotes || "",
    customerNotes: payload.customerNotes || "",
    returnToStock: lines.some(
      (line) => String((line as any)?.returnCondition || "").trim().toUpperCase() === "REUSABLE"
    ),
    refundMode: totals.refundMode,
    partialRefundAmount: totals.refundMode === "PARTIAL" ? totals.total : 0,
    discountPercent: toNumber(payload.discountPercent),
    partialAmountCap: toNumber(payload.partialAmountCap),
    priceAdjustmentAmount: toNumber(payload.priceAdjustmentAmount),
    invoiceBalanceBefore: authoritativeBalanceBefore,
    invoiceBalanceAfter: Math.max(
      0,
      authoritativeBalanceBefore - (nextStatus === "Applied" ? totals.total : 0)
    ),
    lines,
    totals: {
      ...totals,
      pendingAmount: nextStatus === "Applied" ? 0 : totals.pendingAmount
    },
    audit: {
      createdBy: existing?.audit.createdBy || payload.actor,
      createdAt: existing?.audit.createdAt || now,
      modifiedBy: payload.actor,
      modifiedAt: now
    },
    history: buildHistory(existing, nextStatus, payload.actor, now)
  };

  const nextList = existing ? list.map((entry) => (entry.id === existing.id ? note : entry)) : [note, ...list];
  setAllNotes(nextList);
  applyLocalReturnStockDelta(existing, note);
  recalculateLocalInvoiceBalance(note.linkedInvoiceId);
  void triggerLowStockNotifications();
  return note;
}

export function removeCreditNote(noteId: string): CreditNoteRecord {
  assertCreditNoteDeletePermission();
  const normalizedId = String(noteId || "").trim();
  if (!normalizedId) {
    throw new Error("Credit note id is required.");
  }
  const list = getAllNotes();
  const existing = list.find((note) => String(note?.id || "") === normalizedId);
  if (!existing) {
    const legacy = getLegacyCreditNotes().find((note) => String(note?.id || "") === normalizedId);
    if (legacy) {
      throw new Error("Legacy credit notes are read-only on this page.");
    }
    throw new Error("Credit note not found.");
  }
  if (existing.status === "Applied") {
    throw new Error("Applied credit notes cannot be deleted.");
  }
  const nextList = list.filter((note) => String(note?.id || "") !== normalizedId);
  setAllNotes(nextList);

  // Ensure any prior local stock impact is rolled back if status rules evolve.
  applyLocalReturnStockDelta(existing, { ...existing, status: "Draft" });
  recalculateLocalInvoiceBalance(existing.linkedInvoiceId);
  void triggerLowStockNotifications();
  return existing;
}

export function summarizeCreditNotes(country: CountryCode) {
  const notes = listCreditNotes(country);
  const totalAmount = notes.reduce((sum, note) => sum + note.totals.total, 0);
  const appliedAmount = notes
    .filter((note) => note.status === "Applied")
    .reduce((sum, note) => sum + note.totals.total, 0);
  const pendingAmount = notes
    .filter((note) => note.status !== "Applied")
    .reduce((sum, note) => sum + note.totals.total, 0);

  return {
    count: notes.length,
    totalAmount,
    appliedAmount,
    pendingAmount
  };
}
