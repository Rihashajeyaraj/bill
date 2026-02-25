import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "../../services/storage";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, STATUS_FLOW } from "./countryConfig";
import type { CountryCode, DebitStatus, DebitType } from "./countryConfig";
import { MOCK_PURCHASE_INVOICES, MOCK_SUPPLIERS } from "./mockData";

const DEBIT_NOTE_STORE_KEY = "debitNotesPremiumV1";
const DEBIT_NOTE_SEQUENCE_KEY = "debitNotesPremiumSequenceV1";
const DEBIT_NOTE_LEDGER_KEY = "debitNotesPremiumLedgerV1";
const SELECTED_COUNTRY_KEY = "debitNoteSelectedCountryV1";
const PAYMENT_OUT_PREMIUM_KEY = "paymentOutPremiumV1";

export interface PurchaseInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
}

export interface PurchaseInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  supplierId: string;
  supplierName: string;
  invoiceDate: string;
  remainingBalance: number;
  placeOfSupply?: string;
  lines: PurchaseInvoiceLine[];
}

export interface SupplierOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  state?: string;
  registrationNumber?: string;
  country: CountryCode;
}

export interface DebitLineDraft {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
  debitValueType: "Percentage" | "Fixed";
  debitValue: number;
}

export interface DebitLineComputed extends DebitLineDraft {
  baseAmount: number;
  taxAmount: number;
  amountAfterTax: number;
  debitCharge: number;
  debitAmount: number;
  validationMessage?: string;
}

export interface DebitTotals {
  subtotal: number;
  taxTotal: number;
  total: number;
  cgst: number;
  sgst: number;
  igst: number;
  pendingAmount: number;
  updatedPayable: number;
}

export interface DebitLedgerEntry {
  id: string;
  noteId: string;
  country: CountryCode;
  supplierId: string;
  supplierName: string;
  account: "Accounts Payable";
  debitAmount: number;
  status: DebitStatus;
  postedAt: string;
  postedBy: string;
}

export interface DebitNoteRecord {
  id: string;
  country: CountryCode;
  debitNoteNo: string;
  debitNoteDate: string;
  supplierId: string;
  supplierName: string;
  linkedPurchaseInvoiceId: string;
  linkedPurchaseInvoiceNo: string;
  linkedPurchaseInvoiceDate: string;
  reason: string;
  status: DebitStatus;
  debitType: DebitType;
  currency: string;
  placeOfSupply?: string;
  taxRate: number;
  registrationNumber?: string;
  hmrcReference?: string;
  salesTaxState?: string;
  internalNotes?: string;
  supplierNotes?: string;
  partialAmountCap?: number;
  priceAdjustmentAmount?: number;
  additionalChargesAmount?: number;
  taxAdjustmentAmount?: number;
  payableBalanceBefore: number;
  payableBalanceAfter: number;
  lines: DebitLineComputed[];
  totals: DebitTotals;
  audit: {
    createdBy: string;
    createdAt: string;
    modifiedBy: string;
    modifiedAt: string;
  };
  history: Array<{ status: DebitStatus; at: string; by: string; note: string }>;
}

export interface SaveDebitNotePayload {
  id?: string;
  country: CountryCode;
  debitNoteDate: string;
  supplierId: string;
  supplierName: string;
  linkedPurchaseInvoiceId: string;
  linkedPurchaseInvoiceNo: string;
  linkedPurchaseInvoiceDate: string;
  reason: string;
  debitType: DebitType;
  desiredStatus: DebitStatus;
  taxRate: number;
  placeOfSupply?: string;
  registrationNumber?: string;
  hmrcReference?: string;
  salesTaxState?: string;
  internalNotes?: string;
  supplierNotes?: string;
  partialAmountCap?: number;
  priceAdjustmentAmount?: number;
  additionalChargesAmount?: number;
  taxAdjustmentAmount?: number;
  payableBalanceBefore: number;
  lines: DebitLineDraft[];
  actor: string;
}

type SequenceStore = Partial<Record<CountryCode, number>>;

function nowIso() {
  return new Date().toISOString();
}

function normalizeCountryCode(value: unknown): CountryCode | null {
  if (!value) return null;
  const clean = String(value).trim();
  if (clean in COUNTRY_CONFIG) return clean as CountryCode;
  return COUNTRY_NAME_TO_CODE[clean] || null;
}

function toNumber(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function appliedPaymentOutForBill(billId: string) {
  if (!billId) return 0;
  const legacy = (lsGetOrganizationScoped(LS_KEYS.payments, []) as any[])
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "OUT")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PO:"))
    .filter((entry) => String(entry?.billId || entry?.bill_id || "") === String(billId))
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount)), 0);

  const premium = (lsGetOrganizationScoped(PAYMENT_OUT_PREMIUM_KEY, []) as any[])
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        (Array.isArray(entry?.allocations) ? entry.allocations : [])
          .filter((line: any) => String(line?.billId || "") === String(billId))
          .reduce((lineSum: number, line: any) => lineSum + Math.max(0, toNumber(line?.applyAmount)), 0),
      0
    );

  return legacy + premium;
}

function appliedDebitForBill(billId: string) {
  if (!billId) return 0;
  return getAllNotes()
    .filter((entry) => entry.status === "Applied")
    .filter((entry) => String(entry.linkedPurchaseInvoiceId || "") === String(billId))
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.totals?.total)), 0);
}

function getAllNotes(): DebitNoteRecord[] {
  return lsGetOrganizationScoped(DEBIT_NOTE_STORE_KEY, []);
}

function setAllNotes(list: DebitNoteRecord[]) {
  lsSetOrganizationScoped(DEBIT_NOTE_STORE_KEY, list);
}

function getAllLedgerEntries(): DebitLedgerEntry[] {
  return lsGetOrganizationScoped(DEBIT_NOTE_LEDGER_KEY, []);
}

function setAllLedgerEntries(list: DebitLedgerEntry[]) {
  lsSetOrganizationScoped(DEBIT_NOTE_LEDGER_KEY, list);
}

function getSequenceStore(): SequenceStore {
  return lsGetOrganizationScoped(DEBIT_NOTE_SEQUENCE_KEY, {});
}

function setSequenceStore(value: SequenceStore) {
  lsSetOrganizationScoped(DEBIT_NOTE_SEQUENCE_KEY, value);
}

function inferCurrentCountrySequence(country: CountryCode, notes: DebitNoteRecord[]) {
  const prefix = COUNTRY_CONFIG[country].numberPrefix;
  return notes
    .filter((note) => note.country === country && note.debitNoteNo.startsWith(prefix))
    .reduce((max, note) => {
      const chunk = note.debitNoteNo.replace(prefix, "");
      const n = Number(chunk);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
}

function nextDebitNoteNumber(country: CountryCode): string {
  const notes = getAllNotes();
  const store = getSequenceStore();
  const inferred = inferCurrentCountrySequence(country, notes);
  const current = Math.max(store[country] || 0, inferred);
  const next = current + 1;
  setSequenceStore({ ...store, [country]: next });
  return `${COUNTRY_CONFIG[country].numberPrefix}${String(next).padStart(5, "0")}`;
}

function computeLines(
  lines: DebitLineDraft[],
  _debitType: DebitType,
  _priceAdjustmentAmount = 0,
  _additionalChargesAmount = 0
) {
  const toCents = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
  const fromCents = (value: number) => value / 100;
  return lines.map((line, index) => {
    const quantity = Math.max(0, toNumber(line.quantity));
    const rate = Math.max(0, toNumber(line.rate));
    const taxRate = Math.max(0, toNumber(line.taxRate));
    const valueType = line.debitValueType === "Fixed" ? "Fixed" : "Percentage";
    const rawDebitValue = toNumber(line.debitValue);
    const debitValue = Math.max(0, rawDebitValue);
    const baseCents = toCents(quantity * rate);
    const taxCents = Math.round((baseCents * taxRate) / 100);
    const amountAfterTaxCents = baseCents + taxCents;
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
}

function computeTotals(
  country: CountryCode,
  lines: DebitLineComputed[],
  payableBalanceBefore: number,
  debitType: DebitType,
  partialAmountCap?: number,
  taxAdjustmentAmount?: number
): DebitTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.baseAmount, 0);
  let taxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  if (debitType === "Tax Adjustment") {
    taxTotal += Math.max(0, toNumber(taxAdjustmentAmount));
  }

  let total = lines.reduce((sum, line) => sum + line.debitAmount, 0);
  if (debitType === "Tax Adjustment") {
    total += Math.max(0, toNumber(taxAdjustmentAmount));
  }
  const cap = Math.max(0, toNumber(partialAmountCap));
  if (debitType === "Partial Debit" && cap > 0) {
    total = Math.min(total, cap);
  }

  const updatedPayable = Math.max(0, toNumber(payableBalanceBefore) + total);
  const cfg = COUNTRY_CONFIG[country];
  if (cfg.taxModel !== "GST" || country !== "IN") {
    return {
      subtotal,
      taxTotal,
      total,
      cgst: 0,
      sgst: 0,
      igst: 0,
      pendingAmount: total,
      updatedPayable
    };
  }

  return {
    subtotal,
    taxTotal,
    total,
    cgst: taxTotal / 2,
    sgst: taxTotal / 2,
    igst: 0,
    pendingAmount: total,
    updatedPayable
  };
}

function buildHistory(
  previous: DebitNoteRecord | undefined,
  status: DebitStatus,
  actor: string,
  now: string
) {
  const existingHistory = previous?.history || [];
  const lastStatus = existingHistory[existingHistory.length - 1]?.status;
  if (lastStatus === status) return existingHistory;
  return [...existingHistory, { status, by: actor, at: now, note: `Status moved to ${status}` }];
}

function postLedgerEntry(note: DebitNoteRecord, actor: string) {
  const ledger = getAllLedgerEntries();
  const exists = ledger.some((entry) => entry.noteId === note.id && entry.status === "Applied");
  if (exists) return;
  const entry: DebitLedgerEntry = {
    id: `dnl_${Date.now().toString(16)}`,
    noteId: note.id,
    country: note.country,
    supplierId: note.supplierId,
    supplierName: note.supplierName,
    account: "Accounts Payable",
    debitAmount: note.totals.total,
    status: note.status,
    postedAt: nowIso(),
    postedBy: actor
  };
  setAllLedgerEntries([entry, ...ledger]);
}

export function getSelectedDebitCountry(): CountryCode | "" {
  const saved = lsGetOrganizationScoped(SELECTED_COUNTRY_KEY, "");
  return normalizeCountryCode(saved) || "";
}

export function setSelectedDebitCountry(country: CountryCode) {
  lsSetOrganizationScoped(SELECTED_COUNTRY_KEY, country);
}

export function listDebitNotes(country?: CountryCode) {
  const notes = getAllNotes();
  if (!country) return notes;
  return notes.filter((note) => note.country === country);
}

export function getDebitNote(id: string) {
  return getAllNotes().find((note) => note.id === id) || null;
}

export function listDebitLedger(country?: CountryCode) {
  const entries = getAllLedgerEntries();
  if (!country) return entries;
  return entries.filter((entry) => entry.country === country);
}

export function mapPurchaseInvoicesByCountry(country: CountryCode): PurchaseInvoice[] {
  const rawInvoices = lsGetOrganizationScoped(LS_KEYS.purchases, []);
  const fromStorage: PurchaseInvoice[] = rawInvoices
    .map((invoice: any) => {
      const mappedCountry = normalizeCountryCode(invoice?.country);
      if (mappedCountry && mappedCountry !== country) return null;

      const lines = Array.isArray(invoice?.lines)
        ? invoice.lines.map((line: any, idx: number) => ({
            id: line.id || `line_${idx + 1}`,
            itemName: line.itemName || line.name || `Item ${idx + 1}`,
            quantity: Math.max(0, toNumber(line.qty ?? line.quantity ?? 0)),
            rate: Math.max(0, toNumber(line.rate)),
            taxRate: Math.max(0, toNumber(line.tax ?? line.taxRate)),
            hsnSac: line.hsn || line.sac || line.hsnSac || ""
          }))
        : [];

      return {
        id: invoice.id,
        invoiceNo: invoice.billNumber || invoice.invoiceNo || invoice.id,
        country,
        supplierId: invoice.partyId || invoice.supplierId || invoice.vendorId || invoice.partyName || "unknown_supplier",
        supplierName: invoice.partyName || invoice.supplierName || invoice.vendorName || "Supplier",
        invoiceDate: invoice.billDate || invoice.invoiceDate || invoice.date || "",
        remainingBalance: (() => {
          const billTotal = toNumber(
            invoice?.totals?.grandTotal ??
              invoice?.totals?.total ??
              invoice?.totals?.finalTotal ??
              invoice?.totals?.subTotal
          );
          const paymentApplied = appliedPaymentOutForBill(invoice?.id);
          const debitApplied = appliedDebitForBill(invoice?.id);
          const storedBalance = toNumber(
            invoice?.totals?.balance ?? invoice?.remainingBalance ?? billTotal
          );
          const hasLinkedActivity = paymentApplied > 0 || debitApplied > 0;
          return Math.max(
            0,
            hasLinkedActivity ? billTotal + debitApplied - paymentApplied : storedBalance
          );
        })(),
        placeOfSupply: invoice.placeOfSupply || invoice.state || "",
        lines
      } satisfies PurchaseInvoice;
    })
    .filter(Boolean);

  const fromMock = MOCK_PURCHASE_INVOICES.filter((invoice) => invoice.country === country);
  const merged = [...fromStorage, ...fromMock.filter((mock) => !fromStorage.some((stored) => stored.id === mock.id))];
  return merged.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));
}

export function mapSuppliersByCountry(country: CountryCode): SupplierOption[] {
  const parties = lsGetOrganizationScoped(LS_KEYS.parties, []);
  const purchaseInvoices = mapPurchaseInvoicesByCountry(country);

  const fromParties = parties
    .map((party: any) => {
      if (party?.type && String(party.type).toLowerCase() !== "supplier") return null;
      const mappedCountry = normalizeCountryCode(party.country);
      if (mappedCountry && mappedCountry !== country) return null;
      return {
        id: party.id,
        name: party.name,
        email: party.email || "",
        phone: party.phone || "",
        address: party.address || "",
        state: party.state || "",
        registrationNumber: party.gstin || party.trn || party.vatNo || "",
        country
      } satisfies SupplierOption;
    })
    .filter(Boolean) as SupplierOption[];

  const fromInvoices = purchaseInvoices.map((invoice) => ({
    id: invoice.supplierId,
    name: invoice.supplierName,
    state: invoice.placeOfSupply || "",
    country
  }));

  const fromMock = MOCK_SUPPLIERS.filter((supplier) => supplier.country === country);

  const byId = new Map<string, SupplierOption>();
  [...fromParties, ...fromInvoices, ...fromMock].forEach((entry) => {
    if (!entry?.id || !entry.name) return;
    const existing = byId.get(entry.id);
    byId.set(entry.id, { ...(existing || {}), ...entry });
  });

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ensureTransition(previous: DebitStatus, next: DebitStatus) {
  const allowed = STATUS_FLOW[previous] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition: ${previous} -> ${next}`);
  }
}

export function saveDebitNote(payload: SaveDebitNotePayload): DebitNoteRecord {
  const linkedInvoice = mapPurchaseInvoicesByCountry(payload.country).find(
    (invoice) => String(invoice.id) === String(payload.linkedPurchaseInvoiceId)
  );
  if (!linkedInvoice) {
    throw new Error("Linked purchase invoice is invalid for the selected country.");
  }
  if (String(linkedInvoice.supplierId) !== String(payload.supplierId)) {
    throw new Error(`Bill ${linkedInvoice.invoiceNo} belongs to a different supplier.`);
  }

  const list = getAllNotes();
  const existing = payload.id ? list.find((note) => note.id === payload.id) : undefined;
  const now = nowIso();
  const previousStatus: DebitStatus = existing?.status || "Draft";
  const nextStatus = payload.desiredStatus;
  ensureTransition(previousStatus, nextStatus);

  const lines = computeLines(
    payload.lines,
    payload.debitType,
    payload.priceAdjustmentAmount,
    payload.additionalChargesAmount
  );
  const totals = computeTotals(
    payload.country,
    lines,
    payload.payableBalanceBefore,
    payload.debitType,
    payload.partialAmountCap,
    payload.taxAdjustmentAmount
  );
  const debitNoteNo = existing?.debitNoteNo || nextDebitNoteNumber(payload.country);
  const id = existing?.id || `dnt_${Date.now().toString(16)}`;

  const note: DebitNoteRecord = {
    id,
    country: payload.country,
    debitNoteNo,
    debitNoteDate: payload.debitNoteDate,
    supplierId: payload.supplierId,
    supplierName: payload.supplierName,
    linkedPurchaseInvoiceId: payload.linkedPurchaseInvoiceId,
    linkedPurchaseInvoiceNo: payload.linkedPurchaseInvoiceNo,
    linkedPurchaseInvoiceDate: payload.linkedPurchaseInvoiceDate,
    reason: payload.reason,
    status: nextStatus,
    debitType: payload.debitType,
    currency: COUNTRY_CONFIG[payload.country].currency,
    placeOfSupply: payload.placeOfSupply || "",
    taxRate: toNumber(payload.taxRate),
    registrationNumber: payload.registrationNumber || "",
    hmrcReference: payload.hmrcReference || "",
    salesTaxState: payload.salesTaxState || "",
    internalNotes: payload.internalNotes || "",
    supplierNotes: payload.supplierNotes || "",
    partialAmountCap: toNumber(payload.partialAmountCap),
    priceAdjustmentAmount: toNumber(payload.priceAdjustmentAmount),
    additionalChargesAmount: toNumber(payload.additionalChargesAmount),
    taxAdjustmentAmount: toNumber(payload.taxAdjustmentAmount),
    payableBalanceBefore: toNumber(payload.payableBalanceBefore),
    payableBalanceAfter:
      nextStatus === "Applied"
        ? toNumber(payload.payableBalanceBefore) + totals.total
        : toNumber(payload.payableBalanceBefore),
    lines,
    totals: {
      ...totals,
      pendingAmount: nextStatus === "Applied" ? 0 : totals.total
    },
    audit: {
      createdBy: existing?.audit.createdBy || payload.actor,
      createdAt: existing?.audit.createdAt || now,
      modifiedBy: payload.actor,
      modifiedAt: now
    },
    history: buildHistory(existing, nextStatus, payload.actor, now)
  };

  if (note.status === "Applied") {
    postLedgerEntry(note, payload.actor);
  }

  const nextList = existing ? list.map((entry) => (entry.id === existing.id ? note : entry)) : [note, ...list];
  setAllNotes(nextList);
  return note;
}

export function summarizeDebitNotes(country: CountryCode) {
  const notes = listDebitNotes(country);
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
