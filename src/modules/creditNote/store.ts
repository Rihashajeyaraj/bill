import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "../../services/storage";
import { authGetRole } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
import { triggerLowStockNotifications } from "../items/store";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, STATUS_FLOW } from "./countryConfig";
import type { CountryCode, CreditStatus, CreditType } from "./countryConfig";

const CREDIT_NOTE_STORE_KEY = "creditNotesPremiumV1";
const CREDIT_NOTE_SEQUENCE_KEY = "creditNotesPremiumSequenceV1";
const SELECTED_COUNTRY_KEY = "creditNoteSelectedCountryV1";
const PAYMENT_IN_PREMIUM_KEY = "paymentInPremiumV1";

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
  return COUNTRY_NAME_TO_CODE[clean] || null;
}

function getAllNotes(): CreditNoteRecord[] {
  return lsGetOrganizationScoped(CREDIT_NOTE_STORE_KEY, []);
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
  const n = Number(value || 0);
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
  refundModeInput: "FULL" | "PARTIAL" | "NONE" = "FULL",
  partialRefundAmount?: number
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
  } else if (refundMode === "PARTIAL") {
    total = Math.min(maxRefundTotal, Math.max(0, toNumber(partialRefundAmount)));
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
  const notes = getAllNotes();
  if (!country) return notes;
  return notes.filter((note) => note.country === country);
}

export function getCreditNote(id: string) {
  return getAllNotes().find((note) => note.id === id) || null;
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
    payload.refundMode || "FULL",
    payload.partialRefundAmount
  );
  if (totals.refundMode === "PARTIAL" && totals.total <= 0) {
    throw new Error("Partial refund amount must be greater than zero.");
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
    creditNoteDate: payload.creditNoteDate,
    customerId: payload.customerId,
    customerName: payload.customerName,
    linkedInvoiceId: payload.linkedInvoiceId,
    linkedInvoiceNo: payload.linkedInvoiceNo,
    linkedInvoiceDate: payload.linkedInvoiceDate,
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
    partialRefundAmount: totals.refundMode === "PARTIAL" ? toNumber(payload.partialRefundAmount) : 0,
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
    throw new Error("Credit note not found.");
  }
  if (existing.status === "Applied") {
    throw new Error("Applied credit notes cannot be deleted.");
  }
  const nextList = list.filter((note) => String(note?.id || "") !== normalizedId);
  setAllNotes(nextList);

  // Ensure any prior local stock impact is rolled back if status rules evolve.
  applyLocalReturnStockDelta(existing, { ...existing, status: "Draft" });
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
