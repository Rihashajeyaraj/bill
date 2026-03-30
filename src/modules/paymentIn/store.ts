import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "../../services/storage";
import { authGetRole } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, STATUS_FLOW, normalizePaymentStatus } from "./countryConfig";
import type { CountryCode, PaymentMode, PaymentStatus } from "./countryConfig";
import type { PaymentAttachmentMeta } from "./types";

const PAYMENT_STORE_KEY = "paymentInPremiumV1";
const PAYMENT_SEQUENCE_KEY = "paymentInPremiumSequenceV1";
const PAYMENT_LEDGER_KEY = "paymentInPremiumLedgerV1";
const SELECTED_COUNTRY_KEY = "paymentInSelectedCountryV1";
const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";
const SALES_PROFORMAS_KEY = LS_KEYS.sales_proformas;

export interface CustomerOpenInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  invoiceAmount: number;
  taxableAmount?: number;
  taxAmount?: number;
  balanceDue: number;
  documentType: "invoice" | "proforma";
}

export interface CustomerOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  state?: string;
  registrationNumber?: string;
  taxId?: string;
  country: CountryCode;
}

export interface PaymentAllocationDraft {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  balanceDue: number;
  applyAmount: number;
  documentType?: "invoice" | "proforma";
}

export interface PaymentInTotals {
  amountReceived: number;
  tdsAmount: number;
  totalSettled: number;
  amountApplied: number;
  unappliedAmount: number;
  customerOutstandingBefore: number;
  customerOutstandingAfter: number;
}

export interface PaymentInRecord {
  id: string;
  country: CountryCode;
  receiptNo: string;
  paymentDate: string;
  customerId: string;
  customerName: string;
  currency: string;
  paymentMode: PaymentMode;
  referenceNo?: string;
  chequeNo?: string;
  bankName?: string;
  bankAccount?: string;
  transactionId?: string;
  paymentReference?: string;
  registrationNumber?: string;
  tdsCategory?: string;
  tdsRate?: number;
  isManual?: boolean;
  internalNotes?: string;
  customerNotes?: string;
  attachment?: PaymentAttachmentMeta | null;
  status: PaymentStatus;
  allocations: PaymentAllocationDraft[];
  totals: PaymentInTotals;
  audit: {
    createdBy: string;
    createdAt: string;
    modifiedBy: string;
    modifiedAt: string;
  };
  history: Array<{ status: PaymentStatus; at: string; by: string; note: string }>;
}

export interface PaymentLedgerEntry {
  id: string;
  noteId: string;
  country: CountryCode;
  customerId: string;
  customerName: string;
  account: "Accounts Receivable";
  amountReceived: number;
  tdsAmount: number;
  totalSettled: number;
  amountApplied: number;
  unappliedAmount: number;
  status: PaymentStatus;
  postedBy: string;
  postedAt: string;
}

export interface SavePaymentInPayload {
  id?: string;
  country: CountryCode;
  paymentDate: string;
  customerId: string;
  customerName: string;
  paymentMode: PaymentMode;
  referenceNo?: string;
  chequeNo?: string;
  bankName?: string;
  bankAccount?: string;
  transactionId?: string;
  paymentReference?: string;
  registrationNumber?: string;
  tdsCategory?: string;
  tdsRate?: number;
  isManual?: boolean;
  internalNotes?: string;
  customerNotes?: string;
  attachment?: PaymentAttachmentMeta | null;
  desiredStatus: PaymentStatus;
  amountReceived: number;
  tdsAmount: number;
  allocations: PaymentAllocationDraft[];
  customerOutstandingBefore: number;
  actor: string;
}

type SequenceStore = Partial<Record<CountryCode, number>>;

function nowIso() {
  return new Date().toISOString();
}

function assertPaymentInWritePermission({ isEdit = false }: { isEdit?: boolean } = {}) {
  const role = authGetRole();
  if (isEdit) {
    if (!canEditEntries(role)) {
      throw new Error("You do not have permission to edit payment receipts.");
    }
    return;
  }
  if (!canCreateEntries(role)) {
    throw new Error("You do not have permission to create payment receipts.");
  }
}

function assertPaymentInDeletePermission() {
  const role = authGetRole();
  if (!canDeleteEntries(role)) {
    throw new Error("You do not have permission to delete payment receipts.");
  }
}

function toNumber(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCountryCode(value: unknown): CountryCode | null {
  if (!value) return null;
  const clean = String(value).trim();
  if (clean in COUNTRY_CONFIG) return clean as CountryCode;
  return COUNTRY_NAME_TO_CODE[clean] || null;
}

function getAllPayments(): PaymentInRecord[] {
  const stored = lsGetOrganizationScoped(PAYMENT_STORE_KEY, []);
  if (!Array.isArray(stored)) return [];

  return stored.map((entry: any) => ({
    ...entry,
    status: normalizePaymentStatus(entry?.status),
    history: Array.isArray(entry?.history)
      ? entry.history.map((item: any) => ({
          ...item,
          status: normalizePaymentStatus(item?.status)
        }))
      : []
  })) as PaymentInRecord[];
}

function setAllPayments(list: PaymentInRecord[]) {
  lsSetOrganizationScoped(PAYMENT_STORE_KEY, list);
}

function getLedgerEntries(): PaymentLedgerEntry[] {
  return lsGetOrganizationScoped(PAYMENT_LEDGER_KEY, []);
}

function setLedgerEntries(list: PaymentLedgerEntry[]) {
  lsSetOrganizationScoped(PAYMENT_LEDGER_KEY, list);
}

function isAppliedLikeStatus(status: unknown) {
  const normalized = String(status || "").toLowerCase();
  if (!normalized) return true;
  return normalized === "applied" || normalized === "issued" || normalized === "posted";
}

function documentKey(documentId: string, documentType: "invoice" | "proforma" = "invoice") {
  return `${documentType}:${String(documentId || "")}`;
}

function normalizedDocumentType(value: unknown): "invoice" | "proforma" {
  return String(value || "").trim().toLowerCase() === "proforma" ? "proforma" : "invoice";
}

export function paymentInAllocationTdsShare(record: Pick<PaymentInRecord, "allocations" | "totals">, line: Partial<PaymentAllocationDraft>) {
  const totalTdsAmount = Math.max(0, toNumber(record?.totals?.tdsAmount));
  if (totalTdsAmount <= 0) return 0;

  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];
  const positiveAllocations = allocations.filter((entry) => Math.max(0, toNumber(entry?.applyAmount)) > 0);
  if (!positiveAllocations.length) return 0;

  const totalApplied = positiveAllocations.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.applyAmount)), 0);
  const lineInvoiceId = String(line?.invoiceId || "").trim();
  const lineDocumentType = normalizedDocumentType(line?.documentType);

  const positiveIndex = positiveAllocations.findIndex(
    (entry) =>
      String(entry?.invoiceId || "").trim() === lineInvoiceId &&
      normalizedDocumentType(entry?.documentType) === lineDocumentType
  );
  if (positiveIndex < 0) return 0;

  const appliedAmount = Math.max(0, toNumber(line?.applyAmount));
  if (appliedAmount <= 0 || totalApplied <= 0) return 0;

  if (positiveAllocations.length === 1) {
    return totalTdsAmount;
  }

  const rawShare = (appliedAmount / totalApplied) * totalTdsAmount;
  if (positiveIndex === positiveAllocations.length - 1) {
    const allocatedBefore = positiveAllocations
      .slice(0, positiveIndex)
      .reduce((sum, entry) => sum + paymentInAllocationTdsShare(record, entry), 0);
    return Math.max(0, totalTdsAmount - allocatedBefore);
  }
  return Math.max(0, Number(rawShare.toFixed(2)));
}

export function paymentInAllocationSettledAmount(
  record: Pick<PaymentInRecord, "allocations" | "totals">,
  line: Partial<PaymentAllocationDraft>
) {
  return Math.max(0, toNumber(line?.applyAmount)) + paymentInAllocationTdsShare(record, line);
}

function appliedPaymentInForDocument(
  documentId: string,
  documentType: "invoice" | "proforma" = "invoice"
) {
  if (!documentId) return 0;
  const legacy = (lsGetOrganizationScoped(LS_KEYS.payments, []) as any[])
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "IN")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PI:"))
    .filter((entry) =>
      documentType === "invoice"
        ? String(entry?.invoiceId || entry?.invoice_id || "") === String(documentId)
        : false
    )
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount)), 0);

  const premium = getAllPayments()
    .filter((entry) => entry.status === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        entry.allocations
          .filter(
            (line) =>
              documentKey(line.invoiceId, line.documentType || "invoice") ===
              documentKey(documentId, documentType)
          )
          .reduce((lineSum, line) => lineSum + paymentInAllocationSettledAmount(entry, line), 0),
      0
    );

  return legacy + premium;
}

function appliedCreditForInvoice(invoiceId: string, documentType: "invoice" | "proforma" = "invoice") {
  if (!invoiceId || documentType !== "invoice") return 0;

  const legacy = (lsGetOrganizationScoped(LS_KEYS.creditNotes, []) as any[])
    .filter((entry) => isAppliedLikeStatus(entry?.status))
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

  const premium = (lsGetOrganizationScoped(CREDIT_NOTES_PREMIUM_KEY, []) as any[])
    .filter((entry) => String(entry?.status || "") === "Applied")
    .filter((entry) => String(entry?.linkedInvoiceId || "") === String(invoiceId))
    .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.totals?.total)), 0);

  return legacy + premium;
}

function getSequenceStore(): SequenceStore {
  return lsGetOrganizationScoped(PAYMENT_SEQUENCE_KEY, {});
}

function setSequenceStore(value: SequenceStore) {
  lsSetOrganizationScoped(PAYMENT_SEQUENCE_KEY, value);
}

function inferCurrentCountrySequence(country: CountryCode, notes: PaymentInRecord[]) {
  const prefix = COUNTRY_CONFIG[country].numberPrefix;
  return notes
    .filter((note) => note.country === country && note.receiptNo.startsWith(prefix))
    .reduce((max, note) => {
      const chunk = note.receiptNo.replace(prefix, "");
      const n = Number(chunk);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
}

function nextReceiptNumber(country: CountryCode) {
  const notes = getAllPayments();
  const store = getSequenceStore();
  const inferred = inferCurrentCountrySequence(country, notes);
  const current = Math.max(store[country] || 0, inferred);
  const next = current + 1;
  setSequenceStore({ ...store, [country]: next });
  return `${COUNTRY_CONFIG[country].numberPrefix}${String(next).padStart(5, "0")}`;
}

function buildHistory(
  previous: PaymentInRecord | undefined,
  status: PaymentStatus,
  actor: string,
  now: string
) {
  const existingHistory = previous?.history || [];
  const lastStatus = existingHistory[existingHistory.length - 1]?.status;
  if (lastStatus === status) return existingHistory;
  return [...existingHistory, { status, by: actor, at: now, note: `Status moved to ${status}` }];
}

function ensureTransition(previous: PaymentStatus, next: PaymentStatus) {
  const allowed = STATUS_FLOW[previous] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition: ${previous} -> ${next}`);
  }
}

function computeTotals(payload: SavePaymentInPayload) {
  const amountReceived = Math.max(0, toNumber(payload.amountReceived));
  const tdsAmount = Math.max(0, toNumber(payload.tdsAmount));
  if (amountReceived <= 0) {
    throw new Error("Amount received must be greater than zero.");
  }
  const allocations = payload.allocations.map((line) => ({
    ...line,
    invoiceAmount: Math.max(0, toNumber(line.invoiceAmount)),
    balanceDue: Math.max(0, toNumber(line.balanceDue)),
    applyAmount: Math.max(0, toNumber(line.applyAmount))
  }));

  allocations.forEach((line) => {
    if (line.applyAmount > line.balanceDue) {
      throw new Error(`Applied amount exceeds balance due for ${line.invoiceNo}.`);
    }
  });

  if (tdsAmount > amountReceived) {
    throw new Error("TDS amount cannot exceed amount received.");
  }

  const amountApplied = allocations.reduce((sum, line) => sum + line.applyAmount, 0);
  if (amountApplied > amountReceived) {
    throw new Error("Applied amount cannot exceed amount received.");
  }

  const totalSettled = amountReceived + tdsAmount;
  const unappliedAmount = Math.max(0, amountReceived - amountApplied);
  const customerOutstandingAfter = Math.max(0, toNumber(payload.customerOutstandingBefore) - totalSettled);

  return {
    allocations,
    totals: {
      amountReceived,
      tdsAmount,
      totalSettled,
      amountApplied,
      unappliedAmount,
      customerOutstandingBefore: Math.max(0, toNumber(payload.customerOutstandingBefore)),
      customerOutstandingAfter
    } satisfies PaymentInTotals
  };
}

function postLedgerEntry(note: PaymentInRecord, actor: string) {
  if (note.status === "Draft") return;
  const ledger = getLedgerEntries();
  const alreadyPosted = ledger.some((entry) => entry.noteId === note.id && entry.status === note.status);
  if (alreadyPosted) return;

  const entry: PaymentLedgerEntry = {
    id: `plg_${Date.now().toString(16)}`,
    noteId: note.id,
    country: note.country,
    customerId: note.customerId,
    customerName: note.customerName,
    account: "Accounts Receivable",
    amountReceived: note.totals.amountReceived,
    tdsAmount: note.totals.tdsAmount,
    totalSettled: note.totals.totalSettled,
    amountApplied: note.totals.amountApplied,
    unappliedAmount: note.totals.unappliedAmount,
    status: note.status,
    postedBy: actor,
    postedAt: nowIso()
  };
  setLedgerEntries([entry, ...ledger]);
}

export function getSelectedPaymentCountry(): CountryCode | "" {
  const saved = lsGetOrganizationScoped(SELECTED_COUNTRY_KEY, "");
  return normalizeCountryCode(saved) || "";
}

export function setSelectedPaymentCountry(country: CountryCode) {
  lsSetOrganizationScoped(SELECTED_COUNTRY_KEY, country);
}

export function listPaymentIn(country?: CountryCode) {
  const payments = getAllPayments();
  if (!country) return payments;
  return payments.filter((entry) => entry.country === country);
}

export function getPaymentIn(id: string) {
  return getAllPayments().find((entry) => entry.id === id) || null;
}

export function listPaymentLedger(country?: CountryCode) {
  const ledger = getLedgerEntries();
  if (!country) return ledger;
  return ledger.filter((entry) => entry.country === country);
}

function rawAdvanceWalletByCustomer(country: CountryCode, customerId: string) {
  if (!customerId) return 0;
  return listPaymentIn(country)
    .filter((entry) => entry.customerId === customerId)
    .filter((entry) => entry.status !== "Draft")
    .reduce((sum, entry) => sum + entry.totals.unappliedAmount, 0);
}

function mapOpenInvoicesByCountryInternal(
  country: CountryCode,
  { applyAdvance = true }: { applyAdvance?: boolean } = {}
): CustomerOpenInvoice[] {
  const rawInvoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  const rawProformas = lsGetOrganizationScoped(SALES_PROFORMAS_KEY, []);
  const fromStorage: CustomerOpenInvoice[] = (Array.isArray(rawInvoices) ? rawInvoices : [])
    .map((invoice: any) => {
      const mappedCountry = normalizeCountryCode(invoice?.country);
      if (mappedCountry && mappedCountry !== country) return null;
      const invoiceTotal = Math.max(
        0,
        toNumber(invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.totals?.subTotal)
      );
      const taxableAmount = Math.max(
        0,
        toNumber(invoice?.totals?.subTotal ?? invoice?.totals?.taxableTotal ?? invoiceTotal)
      );
      const taxAmount = Math.max(
        0,
        toNumber(invoice?.totals?.taxTotal ?? invoice?.totals?.taxAmount ?? invoiceTotal - taxableAmount)
      );
      const paymentApplied = appliedPaymentInForDocument(invoice?.id, "invoice");
      const creditApplied = appliedCreditForInvoice(invoice?.id, "invoice");
      const storedBalance = Math.max(
        0,
        toNumber(invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoiceTotal)
      );
      const hasLinkedActivity = paymentApplied > 0 || creditApplied > 0;
      const balanceDue = hasLinkedActivity
        ? Math.max(0, invoiceTotal - paymentApplied - creditApplied)
        : storedBalance;
      if (balanceDue <= 0) return null;
      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo || invoice.id,
        country,
        customerId: invoice.partyId || invoice.customerId || invoice.buyer?.id || invoice.partyName || "unknown_customer",
        customerName: invoice.partyName || invoice.customerName || invoice.buyer?.name || "Customer",
        invoiceDate: invoice.invoiceDate || invoice.date || "",
        invoiceAmount: invoiceTotal,
        taxableAmount,
        taxAmount,
        balanceDue,
        documentType: "invoice"
      } satisfies CustomerOpenInvoice;
    })
    .filter(Boolean) as CustomerOpenInvoice[];

  const fromProformas: CustomerOpenInvoice[] = (Array.isArray(rawProformas) ? rawProformas : [])
    .map((proforma: any) => {
      const mappedCountry = normalizeCountryCode(proforma?.country);
      if (mappedCountry && mappedCountry !== country) return null;
      const status = String(proforma?.status || "").toUpperCase();
      if (status === "CONVERTED" || status === "EXPIRED") return null;
      const invoiceAmount = Math.max(
        0,
        toNumber(
          proforma?.totals?.grandTotal ??
            proforma?.totals?.total ??
            proforma?.totals?.subTotal ??
            proforma?.grandTotal
        )
      );
      const taxableAmount = Math.max(
        0,
        toNumber(proforma?.totals?.subTotal ?? proforma?.totals?.taxableTotal ?? invoiceAmount)
      );
      const taxAmount = Math.max(
        0,
        toNumber(proforma?.totals?.taxTotal ?? proforma?.totals?.taxAmount ?? invoiceAmount - taxableAmount)
      );
      const paymentApplied = appliedPaymentInForDocument(proforma?.id, "proforma");
      const balanceDue = Math.max(0, invoiceAmount - paymentApplied);
      if (balanceDue <= 0) return null;
      return {
        id: proforma?.id,
        invoiceNo: proforma?.proformaNo || proforma?.id,
        country,
        customerId:
          proforma?.partyId || proforma?.customerId || proforma?.buyer?.id || proforma?.partyName || "unknown_customer",
        customerName: proforma?.partyName || proforma?.customerName || proforma?.buyer?.name || "Customer",
        invoiceDate: proforma?.proformaDate || proforma?.date || "",
        invoiceAmount,
        taxableAmount,
        taxAmount,
        balanceDue,
        documentType: "proforma"
      } satisfies CustomerOpenInvoice;
    })
    .filter(Boolean) as CustomerOpenInvoice[];

  const combined = [...fromStorage, ...fromProformas];
  if (!applyAdvance) {
    return combined.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));
  }

  const documentsByCustomer = new Map<string, CustomerOpenInvoice[]>();
  combined.forEach((document) => {
    const customerId = String(document?.customerId || "").trim();
    if (!customerId) return;
    const list = documentsByCustomer.get(customerId) || [];
    list.push({ ...document });
    documentsByCustomer.set(customerId, list);
  });

  const adjusted: CustomerOpenInvoice[] = [];
  documentsByCustomer.forEach((documents, customerId) => {
    let remainingAdvance = Math.max(0, rawAdvanceWalletByCustomer(country, customerId));
    const sortedDocuments = [...documents].sort((left, right) => {
      const leftDate = String(left?.invoiceDate || "");
      const rightDate = String(right?.invoiceDate || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left?.invoiceNo || "").localeCompare(String(right?.invoiceNo || ""));
    });

    sortedDocuments.forEach((document) => {
      const baseBalance = Math.max(0, toNumber(document?.balanceDue));
      const adjustedBalance = Math.max(0, baseBalance - remainingAdvance);
      const consumedAdvance = Math.min(baseBalance, remainingAdvance);
      remainingAdvance = Math.max(0, remainingAdvance - consumedAdvance);
      if (adjustedBalance <= 0) return;
      adjusted.push({
        ...document,
        balanceDue: adjustedBalance
      });
    });
  });

  return adjusted.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));
}

export function mapOpenInvoicesByCountry(country: CountryCode): CustomerOpenInvoice[] {
  return mapOpenInvoicesByCountryInternal(country, { applyAdvance: true });
}

export function mapCustomersByCountry(country: CountryCode): CustomerOption[] {
  const parties = lsGetOrganizationScoped(LS_KEYS.parties, []);

  const fromParties = (Array.isArray(parties) ? parties : [])
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
        taxId: party.taxId || party.gstin || party.vatNo || party.trn || "",
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

export function outstandingByCustomer(country: CountryCode, customerId: string) {
  if (!customerId) return 0;
  return mapOpenInvoicesByCountry(country)
    .filter((invoice) => invoice.customerId === customerId)
    .reduce((sum, invoice) => sum + invoice.balanceDue, 0);
}

export function paymentInsightsByCustomer(country: CountryCode, customerId: string) {
  if (!customerId) {
    return {
      lastPaymentDate: "",
      advanceWallet: 0,
      totalReceived: 0,
      paymentCount: 0
    };
  }

  const records = listPaymentIn(country).filter((entry) => entry.customerId === customerId);
  const sorted = [...records].sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1));
  const rawAdvanceWallet = rawAdvanceWalletByCustomer(country, customerId);
  const rawOutstandingBeforeAdvance = mapOpenInvoicesByCountryInternal(country, { applyAdvance: false })
    .filter((invoice) => invoice.customerId === customerId)
    .reduce((sum, invoice) => sum + invoice.balanceDue, 0);

  return {
    lastPaymentDate: sorted[0]?.paymentDate || "",
    advanceWallet: Math.max(0, rawAdvanceWallet - rawOutstandingBeforeAdvance),
    totalReceived: records
      .filter((entry) => entry.status !== "Draft")
      .reduce((sum, entry) => sum + entry.totals.amountReceived, 0),
    paymentCount: records.length
  };
}

export function savePaymentIn(payload: SavePaymentInPayload): PaymentInRecord {
  assertPaymentInWritePermission({ isEdit: !!payload?.id });
  const payments = getAllPayments();
  const existing = payload.id ? payments.find((entry) => entry.id === payload.id) : undefined;
  const existingAppliedByDocument = new Map<string, number>();
  existing?.allocations?.forEach((line) => {
    const key = documentKey(line.invoiceId, line.documentType || "invoice");
    const current = existingAppliedByDocument.get(key) || 0;
    existingAppliedByDocument.set(key, current + Math.max(0, toNumber(line.applyAmount)));
  });

  const openInvoices = mapOpenInvoicesByCountry(payload.country);
  const invoiceMap = new Map(
    openInvoices.map((invoice) => [documentKey(invoice.id, invoice.documentType), invoice])
  );
  payload.allocations.forEach((line) => {
    if (toNumber(line.applyAmount) <= 0) return;
    const type = line.documentType || "invoice";
    const key = documentKey(line.invoiceId, type);
    const linked = invoiceMap.get(key);
    const existingApplied = existingAppliedByDocument.get(key) || 0;
    const maxAllowed = Math.max(0, toNumber(linked?.balanceDue) + existingApplied);
    if (!linked && existingApplied <= 0) {
      throw new Error(`Invoice ${line.invoiceNo} is not valid for selected country.`);
    }
    if (linked && linked.customerId !== payload.customerId) {
      throw new Error(`Invoice ${line.invoiceNo} belongs to a different customer.`);
    }
    if (toNumber(line.applyAmount) > maxAllowed) {
      throw new Error(`Applied amount exceeds live balance due for ${line.invoiceNo}.`);
    }
  });

  const now = nowIso();
  const previousStatus: PaymentStatus = normalizePaymentStatus(existing?.status || "Draft");
  const nextStatus: PaymentStatus = normalizePaymentStatus(payload.desiredStatus);
  if (previousStatus === "Draft" && nextStatus === "Applied") {
    throw new Error("Confirm the payment before applying it.");
  }
  ensureTransition(previousStatus, nextStatus);

  const calculated = computeTotals(payload);
  if (nextStatus === "Applied" && calculated.totals.amountApplied <= 0) {
    throw new Error("Select an invoice or proforma and confirm the payment before applying it.");
  }
  const receiptNo = existing?.receiptNo || nextReceiptNumber(payload.country);
  const id = existing?.id || `pr_${Date.now().toString(16)}`;

  const note: PaymentInRecord = {
    id,
    country: payload.country,
    receiptNo,
    paymentDate: payload.paymentDate,
    customerId: payload.customerId,
    customerName: payload.customerName,
    currency: COUNTRY_CONFIG[payload.country].currency,
    paymentMode: payload.paymentMode,
    referenceNo: payload.referenceNo || "",
    chequeNo: payload.chequeNo || "",
    bankName: payload.bankName || "",
    bankAccount: payload.bankAccount || "",
    transactionId: payload.transactionId || "",
    paymentReference: payload.paymentReference || "",
    registrationNumber: payload.registrationNumber || "",
    tdsCategory: payload.tdsCategory || "",
    tdsRate: Math.max(0, toNumber(payload.tdsRate)),
    isManual: !!payload.isManual,
    internalNotes: payload.internalNotes || "",
    customerNotes: payload.customerNotes || "",
    attachment: payload.attachment || null,
    status: nextStatus,
    allocations: calculated.allocations,
    totals: calculated.totals,
    audit: {
      createdBy: existing?.audit.createdBy || payload.actor,
      createdAt: existing?.audit.createdAt || now,
      modifiedBy: payload.actor,
      modifiedAt: now
    },
    history: buildHistory(existing, nextStatus, payload.actor, now)
  };

  postLedgerEntry(note, payload.actor);
  const next = existing ? payments.map((entry) => (entry.id === existing.id ? note : entry)) : [note, ...payments];
  setAllPayments(next);
  return note;
}

export function removePaymentIn(id: string): PaymentInRecord {
  assertPaymentInDeletePermission();
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    throw new Error("Payment receipt id is required.");
  }
  const payments = getAllPayments();
  const existing = payments.find((entry) => String(entry?.id || "") === normalizedId);
  if (!existing) {
    throw new Error("Payment receipt not found.");
  }
  if (existing.status === "Applied") {
    throw new Error("Applied payment receipts cannot be deleted.");
  }
  setAllPayments(payments.filter((entry) => String(entry?.id || "") !== normalizedId));
  setLedgerEntries(getLedgerEntries().filter((entry) => String(entry?.noteId || "") !== normalizedId));
  return existing;
}

export function summarizePaymentIn(country: CountryCode) {
  const list = listPaymentIn(country);
  const totalReceived = list.reduce((sum, entry) => sum + entry.totals.amountReceived, 0);
  const totalTds = list.reduce((sum, entry) => sum + toNumber(entry?.totals?.tdsAmount), 0);
  const totalUnallocated = list.reduce((sum, entry) => sum + entry.totals.unappliedAmount, 0);
  return {
    count: list.length,
    totalReceived,
    totalTds,
    totalUnallocated
  };
}
