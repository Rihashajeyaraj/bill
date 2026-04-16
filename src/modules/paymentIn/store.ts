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
  customerState?: string;
  invoiceDate: string;
  invoiceAmount: number;
  discountAmount?: number;
  taxableAmount?: number;
  taxAmount?: number;
  taxBreakup?: Record<string, unknown> | null;
  supplyType?: string | null;
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
  discountAmount?: number;
  taxableAmount?: number;
  taxAmount?: number;
  balanceDue: number;
  applyAmount: number;
  documentType?: "invoice" | "proforma";
  appliedFromAdvance?: boolean;
  appliedAt?: string;
  sourceReceiptNo?: string;
  sourcePaymentId?: string;
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

export interface CustomerAdvanceWalletHistoryEntry {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  receiptNo: string;
  invoiceId?: string;
  invoiceNo?: string;
  amountAdded: number;
  amountUsed: number;
  remainingBalance: number;
  entryType: "added" | "used";
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

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
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

function getLegacyPayments(): PaymentInRecord[] {
  const legacy = lsGetOrganizationScoped(LS_KEYS.payments, []) as any[];
  if (!Array.isArray(legacy)) return [];

  return legacy
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "IN")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PI:"))
    .map((entry: any, index: number) => {
      const amountReceived = Math.max(0, toNumber(entry?.amountReceived ?? entry?.amount));
      const tdsAmount = Math.max(0, toNumber(entry?.tdsAmount ?? entry?.tds_amount));
      const totalSettled = amountReceived + tdsAmount;
      const applyAmount = Math.max(0, toNumber(entry?.appliedAmount ?? entry?.amountApplied ?? entry?.amount));
      const invoiceId = String(entry?.invoiceId || entry?.invoice_id || "").trim();
      const invoiceNo = String(entry?.invoiceNo || entry?.invoice_no || invoiceId || "").trim();
      const paymentDate = String(entry?.paymentDate || entry?.payment_date || entry?.date || "").trim();

      return {
        id: `legacy_pi_${String(entry?.id || entry?.paymentNo || entry?.referenceNo || index + 1)}`,
        country: normalizeCountryCode(entry?.country) || "IN",
        receiptNo: String(entry?.receiptNo || entry?.paymentNo || entry?.referenceNo || `LEGACY-PR-${index + 1}`),
        paymentDate,
        customerId: String(entry?.partyId || entry?.party_id || entry?.customerId || entry?.customer_id || "").trim(),
        customerName: String(entry?.partyName || entry?.customerName || entry?.customer_name || "Customer"),
        currency: String(entry?.currency || ""),
        paymentMode: normalizePaymentMode(entry?.mode || entry?.paymentMode || entry?.payment_mode),
        referenceNo: String(entry?.referenceNo || entry?.reference_no || ""),
        chequeNo: String(entry?.chequeNo || entry?.cheque_no || ""),
        bankName: String(entry?.bankName || entry?.bank_name || ""),
        bankAccount: String(entry?.bankAccount || entry?.bank_account || ""),
        transactionId: String(entry?.transactionId || entry?.transaction_id || ""),
        paymentReference: String(entry?.paymentReference || ""),
        registrationNumber: String(entry?.registrationNumber || entry?.gstin || entry?.trn || entry?.vatNo || ""),
        tdsCategory: String(entry?.tdsCategory || "none"),
        tdsRate: Math.max(0, toNumber(entry?.tdsRate ?? entry?.tds_rate)),
        isManual: !!entry?.isManual || !!entry?.is_manual,
        internalNotes: String(entry?.note || entry?.notes || ""),
        customerNotes: String(entry?.customerNotes || ""),
        attachment: null,
        status: normalizePaymentStatus(entry?.status),
        allocations: invoiceId
          ? [
              {
                invoiceId,
                invoiceNo: invoiceNo || invoiceId,
                invoiceDate: String(entry?.invoiceDate || entry?.invoice_date || ""),
                invoiceAmount: totalSettled,
                balanceDue: totalSettled,
                applyAmount,
                documentType: "invoice"
              }
            ]
          : [],
        totals: {
          amountReceived,
          tdsAmount,
          totalSettled,
          amountApplied: applyAmount,
          unappliedAmount: Math.max(0, totalSettled - applyAmount),
          customerOutstandingBefore: 0,
          customerOutstandingAfter: 0
        },
        audit: {
          createdBy: String(entry?.createdBy || "Legacy Import"),
          createdAt: String(entry?.created_at || nowIso()),
          modifiedBy: String(entry?.modifiedBy || entry?.createdBy || "Legacy Import"),
          modifiedAt: String(entry?.modifiedAt || entry?.created_at || nowIso())
        },
        history: [
          {
            status: normalizePaymentStatus(entry?.status),
            at: String(entry?.created_at || nowIso()),
            by: String(entry?.createdBy || "Legacy Import"),
            note: "Imported from legacy payments"
          }
        ]
      } satisfies PaymentInRecord;
    });
}

function getMergedPayments(): PaymentInRecord[] {
  return [...getAllPayments(), ...getLegacyPayments()].sort((a, b) => {
    const left = String(a?.paymentDate || a?.audit?.modifiedAt || "");
    const right = String(b?.paymentDate || b?.audit?.modifiedAt || "");
    if (left !== right) return right.localeCompare(left);
    return String(b?.receiptNo || "").localeCompare(String(a?.receiptNo || ""));
  });
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

function invoiceLikeTotal(record: any) {
  return Math.max(
    0,
    toNumber(
      record?.totals?.grandTotal ??
        record?.totals?.finalTotal ??
        record?.totals?.total ??
        record?.totals?.subTotal ??
        record?.grandTotal ??
        record?.finalTotal ??
        record?.total ??
        record?.amount
    )
  );
}

function invoiceLikeStatus(totalAmount: number, balanceAmount: number) {
  const total = Math.max(0, toNumber(totalAmount));
  const balance = Math.max(0, toNumber(balanceAmount));
  if (total <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance < total) return "partial";
  return "issued";
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
    .reduce(
      (sum, entry) =>
        sum + Math.max(0, toNumber(entry?.amount)) + Math.max(0, toNumber(entry?.tdsAmount ?? entry?.tds_amount)),
      0
    );

  const premium = getAllPayments()
    .filter((entry) => entry.status !== "Draft")
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

function recalculateLocalInvoiceBalance(invoiceId: string) {
  const normalizedInvoiceId = String(invoiceId || "").trim();
  if (!normalizedInvoiceId) return;
  const invoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  if (!Array.isArray(invoices) || !invoices.length) return;

  const paymentApplied = appliedPaymentInForDocument(normalizedInvoiceId, "invoice");
  const creditApplied = appliedCreditForInvoice(normalizedInvoiceId, "invoice");

  const nextInvoices = invoices.map((invoice: any) => {
    if (String(invoice?.id || "").trim() !== normalizedInvoiceId) return invoice;
    const invoiceTotal = invoiceLikeTotal(invoice);
    const nextBalance = Math.max(0, invoiceTotal - paymentApplied - creditApplied);
    const nextStatus = invoiceLikeStatus(invoiceTotal, nextBalance);
    const nextTotals =
      invoice?.totals && typeof invoice.totals === "object"
        ? { ...invoice.totals, balance: nextBalance }
        : { balance: nextBalance };
    return {
      ...invoice,
      totals: nextTotals,
      remainingBalance: nextBalance,
      balanceAmount: nextBalance,
      status: nextStatus,
      paymentStatus: nextStatus
    };
  });

  lsSetOrganizationScoped(LS_KEYS.invoices, nextInvoices);
}

function recalculateLocalProformaBalance(proformaId: string) {
  const normalizedProformaId = String(proformaId || "").trim();
  if (!normalizedProformaId) return;
  const proformas = lsGetOrganizationScoped(SALES_PROFORMAS_KEY, []);
  if (!Array.isArray(proformas) || !proformas.length) return;

  const paymentApplied = appliedPaymentInForDocument(normalizedProformaId, "proforma");

  const nextProformas = proformas.map((proforma: any) => {
    if (String(proforma?.id || "").trim() !== normalizedProformaId) return proforma;
    const proformaTotal = invoiceLikeTotal(proforma);
    const nextBalance = Math.max(0, proformaTotal - paymentApplied);
    return {
      ...proforma,
      remainingBalance: nextBalance,
      balanceAmount: nextBalance
    };
  });

  lsSetOrganizationScoped(SALES_PROFORMAS_KEY, nextProformas);
}

function syncLinkedDocumentBalances(records: Array<Pick<PaymentInRecord, "allocations"> | undefined>) {
  const invoiceIds = new Set<string>();
  const proformaIds = new Set<string>();

  records.forEach((record) => {
    ensureArray(record?.allocations).forEach((line) => {
      const documentId = String(line?.invoiceId || "").trim();
      if (!documentId) return;
      if (normalizedDocumentType(line?.documentType) === "proforma") {
        proformaIds.add(documentId);
      } else {
        invoiceIds.add(documentId);
      }
    });
  });

  invoiceIds.forEach((invoiceId) => recalculateLocalInvoiceBalance(invoiceId));
  proformaIds.forEach((proformaId) => recalculateLocalProformaBalance(proformaId));
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
  const payments = getMergedPayments();
  if (!country) return payments;
  return payments.filter((entry) => entry.country === country);
}

export function getPaymentIn(id: string) {
  return getMergedPayments().find((entry) => entry.id === id) || null;
}

export function listPaymentLedger(country?: CountryCode) {
  const ledger = getLedgerEntries();
  if (!country) return ledger;
  return ledger.filter((entry) => entry.country === country);
}

function rawAdvanceWalletByCustomer(country: CountryCode, customerId: string) {
  if (!customerId) return 0;
  return Math.max(
    0,
    round2(
      listPaymentIn(country)
        .filter((entry) => entry.customerId === customerId)
        .filter((entry) => entry.status !== "Draft")
        .reduce(
          (sum, entry) =>
            sum +
            Math.max(0, toNumber(entry?.totals?.unappliedAmount)) -
            round2(
              ensureArray(entry?.allocations)
                .filter((line) => line?.appliedFromAdvance === true)
                .reduce((lineSum, line) => lineSum + Math.max(0, toNumber(line?.applyAmount)), 0)
            ),
          0
        )
    )
  );
}

function mapOpenInvoicesByCountryInternal(
  country: CountryCode,
  { applyAdvance = true }: { applyAdvance?: boolean } = {}
): CustomerOpenInvoice[] {
  const rawInvoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  const rawProformas = lsGetOrganizationScoped(SALES_PROFORMAS_KEY, []);
  const fromStorage: CustomerOpenInvoice[] = (Array.isArray(rawInvoices) ? rawInvoices : [])
    .map((invoice: any) => {
      const mappedCountry = normalizeCountryCode(invoice?.country || invoice?.country_code);
      if (mappedCountry && mappedCountry !== country) return null;
      const invoiceId = String(invoice?.id || invoice?.invoiceId || invoice?.invoice_id || "").trim();
      if (!invoiceId) return null;
      const invoiceTotal = invoiceLikeTotal(invoice);
      const taxableAmount = Math.max(
        0,
        toNumber(invoice?.totals?.subTotal ?? invoice?.totals?.taxableTotal ?? invoice?.taxableTotal ?? invoiceTotal)
      );
      const discountAmount = Math.max(
        0,
        toNumber(invoice?.totals?.discountTotal ?? invoice?.totals?.discount ?? invoice?.discountTotal ?? 0)
      );
      const taxAmount = Math.max(
        0,
        toNumber(invoice?.totals?.taxTotal ?? invoice?.totals?.taxAmount ?? invoice?.taxTotal ?? invoiceTotal - taxableAmount)
      );
      const paymentApplied = appliedPaymentInForDocument(invoiceId, "invoice");
      const creditApplied = appliedCreditForInvoice(invoiceId, "invoice");
      const storedBalance = Math.max(
        0,
        toNumber(invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoice?.balanceAmount ?? invoiceTotal)
      );
      const hasLinkedActivity = paymentApplied > 0 || creditApplied > 0;
      const balanceDue = hasLinkedActivity
        ? Math.max(0, invoiceTotal - paymentApplied - creditApplied)
        : storedBalance;
      if (balanceDue <= 0) return null;
      return {
        id: invoiceId,
        invoiceNo: invoice.invoiceNo || invoice?.invoice_no || invoiceId,
        country,
        customerId:
          invoice.partyId ||
          invoice.party_id ||
          invoice.customerId ||
          invoice.customer_id ||
          invoice.buyer?.id ||
          invoice.partyName ||
          invoice.customerName ||
          "unknown_customer",
        customerName:
          invoice.partyName || invoice.party_name || invoice.customerName || invoice.customer_name || invoice.buyer?.name || "Customer",
        customerState: invoice?.buyer?.state || invoice?.partyState || invoice?.party_state || invoice?.customerState || "",
        invoiceDate: invoice.invoiceDate || invoice.invoice_date || invoice.date || "",
        invoiceAmount: invoiceTotal,
        discountAmount,
        taxableAmount,
        taxAmount,
        taxBreakup:
          invoice?.totals?.taxBreakup && typeof invoice.totals.taxBreakup === "object"
            ? invoice.totals.taxBreakup
            : invoice?.taxBreakup && typeof invoice.taxBreakup === "object"
              ? invoice.taxBreakup
              : null,
        supplyType:
          invoice?.supplyType ||
          invoice?.totals?.tax?.supplyType ||
          invoice?.totals?.taxBreakup?.supplyType ||
          null,
        balanceDue,
        documentType: "invoice"
      } satisfies CustomerOpenInvoice;
    })
    .filter(Boolean) as CustomerOpenInvoice[];

  const fromProformas: CustomerOpenInvoice[] = (Array.isArray(rawProformas) ? rawProformas : [])
    .map((proforma: any) => {
      const mappedCountry = normalizeCountryCode(proforma?.country || proforma?.country_code);
      if (mappedCountry && mappedCountry !== country) return null;
      const status = String(proforma?.status || "").toUpperCase();
      if (status === "CONVERTED" || status === "EXPIRED") return null;
      const proformaId = String(proforma?.id || proforma?.proformaId || proforma?.proforma_id || "").trim();
      if (!proformaId) return null;
      const invoiceAmount = invoiceLikeTotal(proforma);
      const taxableAmount = Math.max(
        0,
        toNumber(proforma?.totals?.subTotal ?? proforma?.totals?.taxableTotal ?? proforma?.taxableTotal ?? invoiceAmount)
      );
      const discountAmount = Math.max(
        0,
        toNumber(proforma?.totals?.discountTotal ?? proforma?.totals?.discount ?? proforma?.discountTotal ?? 0)
      );
      const taxAmount = Math.max(
        0,
        toNumber(proforma?.totals?.taxTotal ?? proforma?.totals?.taxAmount ?? proforma?.taxTotal ?? invoiceAmount - taxableAmount)
      );
      const paymentApplied = appliedPaymentInForDocument(proformaId, "proforma");
      const balanceDue = Math.max(0, invoiceAmount - paymentApplied);
      if (balanceDue <= 0) return null;
      return {
        id: proformaId,
        invoiceNo: proforma?.proformaNo || proforma?.proforma_no || proformaId,
        country,
        customerId:
          proforma?.partyId ||
          proforma?.party_id ||
          proforma?.customerId ||
          proforma?.customer_id ||
          proforma?.buyer?.id ||
          proforma?.partyName ||
          proforma?.customerName ||
          "unknown_customer",
        customerName:
          proforma?.partyName || proforma?.party_name || proforma?.customerName || proforma?.customer_name || proforma?.buyer?.name || "Customer",
        customerState: proforma?.buyer?.state || proforma?.partyState || proforma?.party_state || proforma?.customerState || "",
        invoiceDate: proforma?.proformaDate || proforma?.proforma_date || proforma?.date || "",
        invoiceAmount,
        discountAmount,
        taxableAmount,
        taxAmount,
        taxBreakup:
          proforma?.totals?.taxBreakup && typeof proforma.totals.taxBreakup === "object"
            ? proforma.totals.taxBreakup
            : proforma?.taxBreakup && typeof proforma.taxBreakup === "object"
              ? proforma.taxBreakup
              : null,
        supplyType:
          proforma?.supplyType ||
          proforma?.totals?.tax?.supplyType ||
          proforma?.totals?.taxBreakup?.supplyType ||
          null,
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
  return mapOpenInvoicesByCountryInternal(country, { applyAdvance: false });
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

  return {
    lastPaymentDate: sorted[0]?.paymentDate || "",
    advanceWallet: Math.max(0, rawAdvanceWallet),
    totalReceived: records
      .filter((entry) => entry.status !== "Draft")
      .reduce((sum, entry) => sum + entry.totals.amountReceived, 0),
    paymentCount: records.length
  };
}

function round2(value: unknown) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function listCustomerAdvanceWalletHistory(country: CountryCode, customerId: string) {
  const safeCustomerId = String(customerId || "").trim();
  if (!safeCustomerId) return [] as CustomerAdvanceWalletHistoryEntry[];

  const events: CustomerAdvanceWalletHistoryEntry[] = [];

  listPaymentIn(country)
    .filter((entry) => entry.status !== "Draft")
    .filter((entry) => String(entry?.customerId || "") === safeCustomerId)
    .forEach((entry) => {
      const allocations = Array.isArray(entry?.allocations) ? entry.allocations : [];
      const advanceUsageLines = allocations.filter(
        (line) => line?.appliedFromAdvance === true && Math.max(0, toNumber(line?.applyAmount)) > 0
      );
      const advanceUsed = round2(
        advanceUsageLines.reduce((sum, line) => sum + Math.max(0, toNumber(line?.applyAmount)), 0)
      );
      const advanceAdded = round2(Math.max(0, toNumber(entry?.totals?.unappliedAmount)));

      if (advanceAdded > 0) {
        events.push({
          id: `adv_add_${entry.id}`,
          customerId: safeCustomerId,
          customerName: entry.customerName || "Customer",
          date: entry.paymentDate || "",
          receiptNo: entry.receiptNo || entry.id,
          amountAdded: advanceAdded,
          amountUsed: 0,
          remainingBalance: 0,
          entryType: "added"
        });
      }

      advanceUsageLines.forEach((line, index) => {
        events.push({
          id: `adv_use_${entry.id}_${line.invoiceId || index}`,
          customerId: safeCustomerId,
          customerName: entry.customerName || "Customer",
          date: line?.appliedAt || line?.invoiceDate || entry.paymentDate || "",
          receiptNo: entry.receiptNo || entry.id,
          invoiceId: line?.invoiceId || "",
          invoiceNo: line?.invoiceNo || "",
          amountAdded: 0,
          amountUsed: round2(line?.applyAmount),
          remainingBalance: 0,
          entryType: "used"
        });
      });
    });

  const sorted = events.sort((left, right) => {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.entryType !== right.entryType) return left.entryType === "added" ? -1 : 1;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });

  let runningBalance = 0;
  return sorted
    .map((event) => {
      runningBalance = round2(runningBalance + event.amountAdded - event.amountUsed);
      return {
        ...event,
        remainingBalance: runningBalance
      };
    })
    .sort((left, right) => {
      const leftDate = String(left?.date || "");
      const rightDate = String(right?.date || "");
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right.id || "").localeCompare(String(left.id || ""));
    });
}

export function applyAdvanceWalletToCustomerInvoice({
  country,
  customerId,
  invoiceId,
  invoiceNo,
  invoiceDate,
  invoiceAmount,
  maxApplyAmount,
  actor
}: {
  country: CountryCode;
  customerId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  maxApplyAmount?: number;
  actor: string;
}) {
  const normalizedCustomerId = String(customerId || "").trim();
  const normalizedInvoiceId = String(invoiceId || "").trim();
  const normalizedInvoiceNo = String(invoiceNo || normalizedInvoiceId).trim();
  const safeInvoiceAmount = Math.max(0, toNumber(invoiceAmount));
  const safeMaxApplyAmount = Math.max(0, toNumber(maxApplyAmount || safeInvoiceAmount));

  if (!normalizedCustomerId || !normalizedInvoiceId || safeInvoiceAmount <= 0 || safeMaxApplyAmount <= 0) {
    return [] as PaymentInRecord[];
  }

  const existingAppliedAmount = listPaymentIn(country)
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .reduce(
      (sum, entry) =>
        sum +
        ensureArray(entry?.allocations)
          .filter((line) => String(line?.invoiceId || "") === normalizedInvoiceId)
          .reduce((lineSum, line) => lineSum + Math.max(0, toNumber(line?.applyAmount)), 0),
      0
    );

  let remainingBalance = Math.max(0, Math.min(safeInvoiceAmount - existingAppliedAmount, safeMaxApplyAmount));
  if (remainingBalance <= 0) return [] as PaymentInRecord[];

  const records = listPaymentIn(country)
    .filter((entry) => String(entry?.customerId || "") === normalizedCustomerId)
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .filter((entry) => Math.max(0, toNumber(entry?.totals?.unappliedAmount)) > 0)
    .sort((left, right) => {
      const leftDate = String(left?.paymentDate || "");
      const rightDate = String(right?.paymentDate || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left?.receiptNo || "").localeCompare(String(right?.receiptNo || ""));
    });

  const updatedRecords: PaymentInRecord[] = [];

  records.forEach((record) => {
    if (remainingBalance <= 0) return;

    const availableAdvance = Math.max(0, toNumber(record?.totals?.unappliedAmount));
    if (availableAdvance <= 0) return;

    const applyAmount = Math.min(availableAdvance, remainingBalance);
    const nextAllocations = [
      ...ensureArray(record?.allocations),
      {
        invoiceId: normalizedInvoiceId,
        invoiceNo: normalizedInvoiceNo,
        invoiceDate: invoiceDate || "",
        invoiceAmount: safeInvoiceAmount,
        balanceDue: remainingBalance,
        applyAmount,
        documentType: "invoice" as const,
        appliedFromAdvance: true,
        appliedAt: nowIso(),
        sourceReceiptNo: record?.receiptNo || "",
        sourcePaymentId: record?.id || ""
      }
    ];

    const updated = savePaymentIn({
      id: record.id,
      country: record.country || country,
      paymentDate: record.paymentDate,
      customerId: record.customerId,
      customerName: record.customerName,
      paymentMode: record.paymentMode,
      referenceNo: record.referenceNo || "",
      chequeNo: record.chequeNo || "",
      bankName: record.bankName || "",
      bankAccount: record.bankAccount || "",
      transactionId: record.transactionId || "",
      paymentReference: record.paymentReference || "",
      registrationNumber: record.registrationNumber || "",
      internalNotes: record.internalNotes || "",
      customerNotes: record.customerNotes || "",
      attachment: record.attachment || null,
      desiredStatus: "Applied",
      amountReceived: record?.totals?.amountReceived ?? 0,
      tdsAmount: record?.totals?.tdsAmount ?? 0,
      tdsCategory: record?.tdsCategory || "",
      tdsRate: record?.tdsRate ?? 0,
      isManual: !!record?.isManual,
      allocations: nextAllocations,
      customerOutstandingBefore: record?.totals?.customerOutstandingBefore ?? safeInvoiceAmount,
      actor: actor || "System User"
    });

    updatedRecords.push(updated);
    remainingBalance = Math.max(0, remainingBalance - applyAmount);
  });

  return updatedRecords;
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
  syncLinkedDocumentBalances([existing, note]);
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
  syncLinkedDocumentBalances([existing]);
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
