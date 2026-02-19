import { LS_KEYS, lsGet, lsSet } from "../../services/storage";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, STATUS_FLOW } from "./countryConfig";
import type { CountryCode, CreditStatus, CreditType } from "./countryConfig";
import { MOCK_CUSTOMERS, MOCK_INVOICES } from "./mockData";

const CREDIT_NOTE_STORE_KEY = "creditNotesPremiumV1";
const CREDIT_NOTE_SEQUENCE_KEY = "creditNotesPremiumSequenceV1";
const SELECTED_COUNTRY_KEY = "creditNoteSelectedCountryV1";

export interface CreditInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
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
  state?: string;
  registrationNumber?: string;
  country: CountryCode;
}

export interface CreditLineDraft {
  id: string;
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

function normalizeCountryCode(value: unknown): CountryCode | null {
  if (!value) return null;
  const clean = String(value).trim();
  if (clean in COUNTRY_CONFIG) return clean as CountryCode;
  return COUNTRY_NAME_TO_CODE[clean] || null;
}

function getAllNotes(): CreditNoteRecord[] {
  return lsGet(CREDIT_NOTE_STORE_KEY, []);
}

function setAllNotes(list: CreditNoteRecord[]) {
  lsSet(CREDIT_NOTE_STORE_KEY, list);
}

function getSequenceStore(): SequenceStore {
  return lsGet(CREDIT_NOTE_SEQUENCE_KEY, {});
}

function setSequenceStore(value: SequenceStore) {
  lsSet(CREDIT_NOTE_SEQUENCE_KEY, value);
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
    const creditType = line.creditType === "Fixed" ? "Fixed" : "Percentage";
    const creditValue = Math.max(0, toNumber(line.creditValue));
    const baseCents = toCents(quantity * rate);
    const taxCents = Math.round((baseCents * taxRate) / 100);
    const afterTaxCents = baseCents + taxCents;
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
  partialAmountCap?: number
): CreditTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.baseAmount, 0);
  const taxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  let total = lines.reduce((sum, line) => sum + line.creditAmount, 0);
  const cap = toNumber(partialAmountCap);

  if (cap > 0) {
    total = Math.min(total, cap);
  }

  const cfg = COUNTRY_CONFIG[country];
  const pendingAmount = Math.max(0, toNumber(invoiceBalanceBefore) - total);

  if (cfg.taxModel !== "GST" || country !== "IN") {
    return { subtotal, taxTotal, total, cgst: 0, sgst: 0, igst: 0, pendingAmount };
  }

  return {
    subtotal,
    taxTotal,
    total,
    cgst: taxTotal / 2,
    sgst: taxTotal / 2,
    igst: 0,
    pendingAmount
  };
}

function applyInvoiceBalance(linkedInvoiceId: string, amount: number) {
  if (!linkedInvoiceId || amount <= 0) return;
  const invoices = lsGet(LS_KEYS.invoices, []);
  const idx = invoices.findIndex((invoice: any) => invoice.id === linkedInvoiceId);
  if (idx < 0) return;

  const invoice = invoices[idx];
  const currentBalance = toNumber(
    invoice?.totals?.balance ?? invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.remainingBalance
  );
  const nextBalance = Math.max(0, currentBalance - amount);
  invoices[idx] = {
    ...invoice,
    totals: { ...(invoice.totals || {}), balance: nextBalance },
    updated_at: nowIso()
  };
  lsSet(LS_KEYS.invoices, invoices);
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
  const saved = lsGet(SELECTED_COUNTRY_KEY, "");
  return normalizeCountryCode(saved) || "";
}

export function setSelectedCreditCountry(country: CountryCode) {
  lsSet(SELECTED_COUNTRY_KEY, country);
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
  const rawInvoices = lsGet(LS_KEYS.invoices, []);

  const fromStorage: CreditInvoice[] = rawInvoices
    .map((invoice: any) => {
      const mappedCountry = normalizeCountryCode(invoice?.country) || null;
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
        invoiceNo: invoice.invoiceNo || invoice.id,
        country,
        customerId: invoice.partyId || invoice.customerId || invoice.buyer?.id || invoice.customerName || "unknown_customer",
        customerName: invoice.partyName || invoice.customerName || invoice.buyer?.name || "Customer",
        invoiceDate: invoice.invoiceDate || invoice.date || "",
        remainingBalance: toNumber(
          invoice?.totals?.balance ?? invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.remainingBalance
        ),
        balanceAmount: toNumber(
          invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoice?.totals?.grandTotal ?? invoice?.totals?.total
        ),
        status: invoice?.status || invoice?.paymentStatus || "Issued",
        placeOfSupply: invoice.placeOfSupply || invoice.buyer?.state || "",
        lines
      } satisfies CreditInvoice;
    })
    .filter(Boolean);

  const fromMock = MOCK_INVOICES.filter((invoice) => invoice.country === country);

  const merged = [...fromStorage, ...fromMock.filter((mock) => !fromStorage.some((stored) => stored.id === mock.id))];
  return merged.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));
}

export function mapCustomersByCountry(country: CountryCode): CustomerOption[] {
  const parties = lsGet(LS_KEYS.parties, []);
  const invoices = mapInvoicesByCountry(country);

  const fromParties = parties
    .map((party: any) => {
      const mappedCountry = normalizeCountryCode(party.country);
      if (mappedCountry && mappedCountry !== country) return null;
      return {
        id: party.id,
        name: party.name,
        email: party.email || "",
        state: party.state || "",
        registrationNumber: party.gstin || party.trn || party.vatNo || "",
        country
      } satisfies CustomerOption;
    })
    .filter(Boolean) as CustomerOption[];

  const fromInvoices = invoices.map((invoice) => ({
    id: invoice.customerId,
    name: invoice.customerName,
    state: invoice.placeOfSupply || "",
    country
  }));

  const fromMock = MOCK_CUSTOMERS.filter((customer) => customer.country === country);

  const byId = new Map<string, CustomerOption>();
  [...fromParties, ...fromInvoices, ...fromMock].forEach((entry) => {
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
  const list = getAllNotes();
  const existing = payload.id ? list.find((note) => note.id === payload.id) : undefined;
  const now = nowIso();
  const previousStatus: CreditStatus = existing?.status || "Draft";
  const nextStatus = payload.desiredStatus;
  ensureTransition(previousStatus, nextStatus);

  const lines = computeLines(
    payload.lines,
    payload.creditType,
    payload.discountPercent,
    payload.priceAdjustmentAmount
  );
  const totals = computeTotals(payload.country, lines, payload.invoiceBalanceBefore, payload.partialAmountCap);
  const creditNoteNo = existing?.creditNoteNo || nextCreditNoteNumber(payload.country);
  const id = existing?.id || `crn_${Date.now().toString(16)}`;

  if (nextStatus === "Applied" && previousStatus !== "Applied") {
    applyInvoiceBalance(payload.linkedInvoiceId, totals.total);
  }

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
    returnToStock: !!payload.returnToStock,
    discountPercent: toNumber(payload.discountPercent),
    partialAmountCap: toNumber(payload.partialAmountCap),
    priceAdjustmentAmount: toNumber(payload.priceAdjustmentAmount),
    invoiceBalanceBefore: toNumber(payload.invoiceBalanceBefore),
    invoiceBalanceAfter: Math.max(
      0,
      toNumber(payload.invoiceBalanceBefore) - (nextStatus === "Applied" ? totals.total : 0)
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
  return note;
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
