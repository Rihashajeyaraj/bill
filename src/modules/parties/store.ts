import { LS_KEYS, lsGet, lsSet, uid } from "../../services/storage";
import { authGetOrganizationId, authGetUser } from "../../services/auth.service";
import { isSupabaseConfigured, supabase } from "../../services/supabaseClient";
import type { LedgerEntry, PartyDraft, PartyFinancials, PartyRecord, PartyType, StatementDocType } from "./types";
import { defaultOpeningBalanceType, normalizeText, openingBalanceSigned, parseNumber, toIsoDate } from "./utils";

const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";
const PAYMENT_IN_PREMIUM_KEY = "paymentInPremiumV1";
const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";
const PAYMENT_OUT_PREMIUM_KEY = "paymentOutPremiumV1";

const SYSTEM_ACTOR = "System";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  india: "IN",
  "sri lanka": "LK",
  uae: "AE",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  ireland: "IE"
};

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  IN: "India",
  LK: "Sri Lanka",
  AE: "UAE",
  US: "USA",
  GB: "United Kingdom",
  IE: "Ireland"
};

function nowIso() {
  return new Date().toISOString();
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function inferOpeningBalanceType(type: PartyType, balance: number | null) {
  if (balance === null || Number.isNaN(balance)) return defaultOpeningBalanceType(type);
  if (type === "Supplier") return balance >= 0 ? "Payable" : "Receivable";
  return balance >= 0 ? "Receivable" : "Payable";
}

function normalizeParty(raw: any): PartyRecord {
  const typeValue = String(raw?.type || "").toLowerCase();
  const type: PartyType = typeValue === "supplier" ? "Supplier" : "Customer";
  const legacyBalance = raw?.openingBalance ?? raw?.balance ?? 0;
  const openingBalance = Math.abs(parseNumber(legacyBalance));
  const openingBalanceType =
    raw?.openingBalanceType || inferOpeningBalanceType(type, parseNumber(raw?.balance ?? null));
  const creditLimit = parseNumber(raw?.creditLimit);
  const creditLimitEnabled =
    typeof raw?.creditLimitEnabled === "boolean" ? raw.creditLimitEnabled : creditLimit > 0;
  const autoBlock =
    typeof raw?.autoBlock === "boolean" ? raw.autoBlock : true;
  const audit = raw?.audit || {
    createdAt: raw?.created_at || nowIso(),
    createdBy: raw?.created_by || SYSTEM_ACTOR,
    updatedAt: raw?.updated_at || raw?.created_at || nowIso(),
    updatedBy: raw?.updated_by || raw?.created_by || SYSTEM_ACTOR
  };

  return {
    id: raw?.id || uid("pty_"),
    type,
    name: raw?.name || "",
    phone: raw?.phone || "",
    email: raw?.email || "",
    country: raw?.country || "",
    state: raw?.state || "",
    address: raw?.address || "",
    taxId: raw?.taxId || raw?.gstin || raw?.vatNo || raw?.trn || "",
    taxIdType: raw?.taxIdType || "",
    gstin: raw?.gstin || raw?.taxId || "",
    vatNo: raw?.vatNo || "",
    trn: raw?.trn || "",
    openingBalance,
    openingBalanceType,
    creditLimit,
    creditLimitEnabled,
    autoBlock,
    notes: raw?.notes || "",
    attachments: ensureArray(raw?.attachments),
    audit
  };
}

function looksLikeUuid(value?: string | null) {
  return UUID_PATTERN.test(String(value || ""));
}

function countryToCode(country?: string | null) {
  const normalized = normalizeText(country || "");
  return COUNTRY_NAME_TO_CODE[normalized] || "IN";
}

function codeToCountry(code?: string | null) {
  const normalized = String(code || "IN").trim().toUpperCase();
  return COUNTRY_CODE_TO_NAME[normalized] || "India";
}

function normalizeSupabaseError(error: any, fallback: string) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function mapRemoteParty(row: any): PartyRecord {
  const typeRaw = String(row?.party_type || "customer").toLowerCase();
  const type: PartyType = typeRaw === "supplier" ? "Supplier" : "Customer";
  const openingBalanceSigned = parseNumber(row?.opening_balance);
  const address = [row?.billing_address_line1, row?.billing_address_line2]
    .filter(Boolean)
    .join(", ");

  return normalizeParty({
    id: row?.id,
    type,
    name: row?.display_name || row?.legal_name || "",
    phone: row?.phone || "",
    email: row?.email || "",
    country: codeToCountry(row?.country_code),
    state: row?.state_name || "",
    address,
    taxId: row?.tax_id || row?.gstin || row?.vat_number || "",
    gstin: row?.gstin || "",
    vatNo: row?.vat_number || "",
    openingBalance: Math.abs(openingBalanceSigned),
    openingBalanceType: inferOpeningBalanceType(type, openingBalanceSigned),
    creditLimit: parseNumber(row?.credit_limit),
    creditLimitEnabled: row?.credit_limit !== null && row?.credit_limit !== undefined && parseNumber(row?.credit_limit) > 0,
    autoBlock: true,
    notes: row?.notes || "",
    attachments: [],
    created_at: row?.created_at,
    created_by: row?.created_by || SYSTEM_ACTOR,
    updated_at: row?.updated_at
  });
}

function toRemotePayload(draft: PartyDraft) {
  const normalized = normalizeParty(draft);
  const signedOpeningBalance = openingBalanceSigned(normalized);
  const creditLimit = Math.max(0, parseNumber(normalized.creditLimit));

  return {
    party_type: normalized.type === "Supplier" ? "supplier" : "customer",
    display_name: normalized.name,
    legal_name: normalized.name,
    phone: normalized.phone || null,
    email: normalized.email || null,
    billing_address_line1: normalized.address || null,
    state_name: normalized.state || null,
    country_code: countryToCode(normalized.country),
    gstin: normalized.gstin || normalized.taxId || null,
    vat_number: normalized.vatNo || null,
    tax_id: normalized.taxId || normalized.gstin || null,
    opening_balance: signedOpeningBalance,
    credit_limit: normalized.creditLimitEnabled ? creditLimit : null,
    notes: normalized.notes || null,
    is_active: true
  };
}

function basePartyList() {
  return ensureArray(lsGet(LS_KEYS.parties, []));
}

export function listParties(): PartyRecord[] {
  const list = basePartyList().map(normalizeParty);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function getParty(id?: string | null): PartyRecord | null {
  if (!id) return null;
  const found = basePartyList().find((party: any) => party.id === id);
  return found ? normalizeParty(found) : null;
}

export function upsertParty(draft: PartyDraft, actor?: string): PartyRecord {
  const list = basePartyList();
  const now = nowIso();
  const actorName = actor || SYSTEM_ACTOR;

  const incoming = normalizeParty(draft);
  const idx = list.findIndex((party: any) => party.id === incoming.id);
  if (idx >= 0) {
    const previous = normalizeParty(list[idx]);
    const audit = {
      createdAt: previous.audit.createdAt,
      createdBy: previous.audit.createdBy,
      updatedAt: now,
      updatedBy: actorName
    };
    const next = {
      ...list[idx],
      ...incoming,
      audit,
      updated_at: now,
      updated_by: actorName,
      gstin: incoming.taxId || incoming.gstin || list[idx]?.gstin || "",
      taxId: incoming.taxId || incoming.gstin || "",
      openingBalance: Math.abs(parseNumber(incoming.openingBalance)),
      creditLimit: Math.max(0, parseNumber(incoming.creditLimit))
    };
    list[idx] = next;
    lsSet(LS_KEYS.parties, list);
    return normalizeParty(next);
  }

  const createdAudit = {
    createdAt: now,
    createdBy: actorName,
    updatedAt: now,
    updatedBy: actorName
  };
  const next = {
    ...incoming,
    id: incoming.id || uid("pty_"),
    audit: createdAudit,
    created_at: now,
    created_by: actorName,
    updated_at: now,
    updated_by: actorName,
    gstin: incoming.taxId || incoming.gstin || "",
    taxId: incoming.taxId || incoming.gstin || "",
    openingBalance: Math.abs(parseNumber(incoming.openingBalance)),
    creditLimit: Math.max(0, parseNumber(incoming.creditLimit))
  };
  lsSet(LS_KEYS.parties, [next, ...list]);
  return normalizeParty(next);
}

export function removeParty(id: string) {
  lsSet(
    LS_KEYS.parties,
    basePartyList().filter((party: any) => party.id !== id)
  );
}

export async function syncPartiesFromRemote(): Promise<PartyRecord[]> {
  if (!isSupabaseConfigured || !supabase) return listParties();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return listParties();

  const { data, error } = await supabase
    .from("parties")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load parties"));
  }

  const mapped = ensureArray<any>(data).map(mapRemoteParty);
  lsSet(LS_KEYS.parties, mapped);
  return mapped.sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertPartyRemote(draft: PartyDraft, actor?: string): Promise<PartyRecord> {
  if (!isSupabaseConfigured || !supabase) {
    return upsertParty(draft, actor);
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    return upsertParty(draft, actor);
  }

  const incoming = normalizeParty(draft);
  const payload = toRemotePayload(incoming);
  const actorUserId = authGetUser()?.id || null;
  let remoteRow: any = null;

  if (incoming.id && looksLikeUuid(incoming.id)) {
    const { data, error } = await supabase
      .from("parties")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", incoming.id)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to update party"));
    }
    remoteRow = data || null;
  }

  if (!remoteRow) {
    const { data, error } = await supabase
      .from("parties")
      .insert({
        organization_id: organizationId,
        created_by: actorUserId,
        ...payload
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to create party"));
    }
    remoteRow = data;
  }

  const saved = mapRemoteParty(remoteRow);
  const nextList = basePartyList().filter((party: any) => party.id !== saved.id && party.id !== incoming.id);
  lsSet(LS_KEYS.parties, [saved, ...nextList]);
  return saved;
}

export async function removePartyRemote(id: string): Promise<void> {
  if (!id) return;

  if (!isSupabaseConfigured || !supabase) {
    removeParty(id);
    return;
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId || !looksLikeUuid(id)) {
    removeParty(id);
    return;
  }

  const { error } = await supabase
    .from("parties")
    .update({ is_active: false, updated_at: nowIso() })
    .eq("organization_id", organizationId)
    .eq("id", id);

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to delete party"));
  }

  removeParty(id);
}

function matchesParty(party: PartyRecord, record: any) {
  if (!record) return false;
  const idFields = [
    record.partyId,
    record.customerId,
    record.supplierId,
    record.vendorId,
    record.buyer?.id,
    record.seller?.id
  ].filter(Boolean);
  if (idFields.includes(party.id)) return true;

  const recordName =
    record.partyName ||
    record.customerName ||
    record.supplierName ||
    record.vendorName ||
    record.buyer?.name ||
    record.name ||
    "";
  if (!recordName) return false;
  return normalizeText(recordName) === normalizeText(party.name);
}

function sumRecords(records: any[], amountFn: (record: any) => number) {
  return records.reduce((sum, record) => sum + amountFn(record), 0);
}

function extractInvoiceAmount(record: any) {
  return parseNumber(
    record?.totals?.grandTotal ??
      record?.totals?.total ??
      record?.totals?.finalTotal ??
      record?.totals?.subTotal ??
      record?.grandTotal ??
      record?.total ??
      record?.amount
  );
}

function extractPurchaseAmount(record: any) {
  return parseNumber(
    record?.totals?.finalTotal ??
      record?.totals?.grandTotal ??
      record?.totals?.total ??
      record?.totals?.subTotal ??
      record?.grandTotal ??
      record?.total ??
      record?.amount
  );
}

function extractCreditAmount(record: any) {
  return parseNumber(
    record?.totals?.total ??
      record?.totals?.grandTotal ??
      record?.totals?.amount ??
      record?.amount ??
      record?.total
  );
}

function extractDebitAmount(record: any) {
  return parseNumber(record?.totals?.total ?? record?.amount ?? record?.total);
}

function listLegacyCreditNotes() {
  return ensureArray(lsGet(LS_KEYS.creditNotes, []));
}

function listPremiumCreditNotes() {
  return ensureArray(lsGet(CREDIT_NOTES_PREMIUM_KEY, []));
}

function listPremiumDebitNotes() {
  return ensureArray(lsGet(DEBIT_NOTES_PREMIUM_KEY, []));
}

function listLegacyPayments() {
  return ensureArray(lsGet(LS_KEYS.payments, []));
}

function listPremiumPayments() {
  return ensureArray(lsGet(PAYMENT_IN_PREMIUM_KEY, []));
}

function listPremiumPaymentOut() {
  return ensureArray(lsGet(PAYMENT_OUT_PREMIUM_KEY, []));
}

function listInvoices() {
  return ensureArray(lsGet(LS_KEYS.invoices, []));
}

function listPurchases() {
  return ensureArray(lsGet(LS_KEYS.purchases, []));
}

function customerTotals(party: PartyRecord) {
  const invoices = listInvoices().filter((record) => matchesParty(party, record));
  const paymentsLegacy = listLegacyPayments().filter(
    (record) => record?.direction === "IN" && matchesParty(party, record)
  );
  const paymentsPremium = listPremiumPayments().filter(
    (record) => record?.status !== "Draft" && matchesParty(party, record)
  );
  const creditLegacy = listLegacyCreditNotes().filter((record) => matchesParty(party, record));
  const creditPremium = listPremiumCreditNotes().filter(
    (record) => record?.status === "Applied" && matchesParty(party, record)
  );

  return {
    invoices: sumRecords(invoices, extractInvoiceAmount),
    payments:
      sumRecords(paymentsLegacy, (record) => parseNumber(record?.amount)) +
      sumRecords(paymentsPremium, (record) => parseNumber(record?.totals?.amountReceived)),
    creditNotes:
      sumRecords(creditLegacy, extractCreditAmount) +
      sumRecords(creditPremium, extractCreditAmount),
    debitNotes: 0
  };
}

function supplierTotals(party: PartyRecord) {
  const purchases = listPurchases().filter((record) => matchesParty(party, record));
  const paymentsLegacy = listLegacyPayments().filter(
    (record) => record?.direction === "OUT" && matchesParty(party, record)
  );
  const paymentsPremium = listPremiumPaymentOut().filter(
    (record) => record?.status !== "Draft" && matchesParty(party, record)
  );
  const debitPremium = listPremiumDebitNotes().filter(
    (record) => record?.status === "Applied" && matchesParty(party, record)
  );

  return {
    invoices: sumRecords(purchases, extractPurchaseAmount),
    payments:
      sumRecords(paymentsLegacy, (record) => parseNumber(record?.amount)) +
      sumRecords(paymentsPremium, (record) => parseNumber(record?.totals?.amountPaid)),
    creditNotes: 0,
    debitNotes: sumRecords(debitPremium, extractDebitAmount)
  };
}

export function computePartyFinancials(party: PartyRecord): PartyFinancials {
  const openingBalance = openingBalanceSigned(party);
  const totals = party.type === "Supplier" ? supplierTotals(party) : customerTotals(party);
  const outstanding =
    party.type === "Supplier"
      ? openingBalance +
        totals.invoices -
        totals.payments -
        totals.debitNotes +
        totals.creditNotes
      : openingBalance +
        totals.invoices -
        totals.payments -
        totals.creditNotes +
        totals.debitNotes;

  const creditLimit = Math.max(0, parseNumber(party.creditLimit));
  const creditLimitEnabled = !!party.creditLimitEnabled;
  const autoBlock = !!party.autoBlock;
  const creditExceeded =
    party.type === "Customer" &&
    creditLimitEnabled &&
    creditLimit > 0 &&
    outstanding > creditLimit;
  const creditOverBy = creditExceeded ? outstanding - creditLimit : 0;

  return {
    outstanding,
    breakdown: {
      openingBalance,
      invoices: totals.invoices,
      payments: totals.payments,
      creditNotes: totals.creditNotes,
      debitNotes: totals.debitNotes
    },
    creditLimit,
    creditLimitEnabled,
    autoBlock,
    creditExceeded,
    creditOverBy
  };
}

export function getPartyCreditStatus(partyId?: string | null) {
  const party = getParty(partyId);
  if (!party || party.type !== "Customer") {
    return {
      party: party,
      blocked: false,
      outstanding: 0,
      creditLimit: 0,
      creditExceeded: false,
      creditOverBy: 0
    };
  }
  const financials = computePartyFinancials(party);
  return {
    party,
    blocked: financials.creditExceeded && financials.autoBlock,
    outstanding: financials.outstanding,
    creditLimit: financials.creditLimit,
    creditExceeded: financials.creditExceeded,
    creditOverBy: financials.creditOverBy
  };
}

function addEntry(
  entries: LedgerEntry[],
  entry: Omit<LedgerEntry, "balance">,
  typeFilter?: StatementDocType | ""
) {
  if (typeFilter && entry.type !== typeFilter) return;
  entries.push(entry);
}

export function buildPartyLedger(
  party: PartyRecord,
  options?: { typeFilter?: StatementDocType | "" }
) {
  const typeFilter = options?.typeFilter || "";
  const entries: LedgerEntry[] = [];

  if (party.type === "Customer") {
    listInvoices()
      .filter((record) => matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `inv_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.invoiceDate || record.date || record.created_at),
          type: "Invoice",
          documentNo: record.invoiceNo || record.id || "",
          debit: extractInvoiceAmount(record),
          credit: 0
        }, typeFilter);
      });

    listLegacyPayments()
      .filter((record) => record?.direction === "IN" && matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `pay_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.date || record.created_at),
          type: "Payment",
          documentNo: record.referenceNo || record.id || "",
          debit: 0,
          credit: parseNumber(record?.amount)
        }, typeFilter);
      });

    listPremiumPayments()
      .filter((record) => record?.status !== "Draft" && matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `pay_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.paymentDate || record.created_at),
          type: "Payment",
          documentNo: record.receiptNo || record.id || "",
          debit: 0,
          credit: parseNumber(record?.totals?.amountReceived)
        }, typeFilter);
      });

    listLegacyCreditNotes()
      .filter((record) => matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `cr_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.creditDate || record.created_at),
          type: "Credit Note",
          documentNo: record.creditNoteNo || record.id || "",
          debit: 0,
          credit: extractCreditAmount(record)
        }, typeFilter);
      });

    listPremiumCreditNotes()
      .filter((record) => record?.status === "Applied" && matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `cr_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.creditNoteDate || record.created_at),
          type: "Credit Note",
          documentNo: record.creditNoteNo || record.id || "",
          debit: 0,
          credit: extractCreditAmount(record)
        }, typeFilter);
      });
  } else {
    listPurchases()
      .filter((record) => matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `pur_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.billDate || record.invoiceDate || record.date || record.created_at),
          type: "Invoice",
          documentNo: record.billNumber || record.invoiceNo || record.id || "",
          debit: extractPurchaseAmount(record),
          credit: 0
        }, typeFilter);
      });

    listLegacyPayments()
      .filter((record) => record?.direction === "OUT" && matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `pay_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.date || record.created_at),
          type: "Payment",
          documentNo: record.referenceNo || record.id || "",
          debit: 0,
          credit: parseNumber(record?.amount)
        }, typeFilter);
      });

    listPremiumDebitNotes()
      .filter((record) => record?.status === "Applied" && matchesParty(party, record))
      .forEach((record) => {
        addEntry(entries, {
          id: record.id || `dn_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.debitNoteDate || record.created_at),
          type: "Debit Note",
          documentNo: record.debitNoteNo || record.id || "",
          debit: 0,
          credit: extractDebitAmount(record)
        }, typeFilter);
      });
  }

  return entries;
}

export function buildPartyStatement(
  party: PartyRecord,
  options?: { from?: string; to?: string; typeFilter?: StatementDocType | "" }
) {
  const entries = buildPartyLedger(party);
  const sortedAll = entries.sort((a, b) => {
    const aTime = new Date(a.date || 0).getTime();
    const bTime = new Date(b.date || 0).getTime();
    if (aTime === bTime) return a.type.localeCompare(b.type);
    return aTime - bTime;
  });

  const openingBase = openingBalanceSigned(party);
  const fromDate = options?.from ? toIsoDate(options.from) : "";
  const toDate = options?.to ? toIsoDate(options.to) : "";

  const withinRange = (entry: LedgerEntry) => {
    if (fromDate && entry.date && entry.date < fromDate) return false;
    if (toDate && entry.date && entry.date > toDate) return false;
    return true;
  };

  let openingBalance = openingBase;
  if (fromDate) {
    sortedAll
      .filter((entry) => entry.date && entry.date < fromDate)
      .forEach((entry) => {
        openingBalance += entry.debit - entry.credit;
      });
  }

  const filteredByType = options?.typeFilter
    ? sortedAll.filter((entry) => entry.type === options.typeFilter)
    : sortedAll;
  const filtered = filteredByType.filter(withinRange);
  const results: LedgerEntry[] = [];
  if (openingBalance !== 0) {
    results.push({
      id: `open_${party.id}`,
      date: fromDate || toIsoDate(party.audit?.createdAt) || "",
      type: "Opening Balance",
      documentNo: "-",
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance
    });
  }

  let running = openingBalance;
  filtered.forEach((entry) => {
    running += entry.debit - entry.credit;
    results.push({ ...entry, balance: running });
  });

  return {
    entries: results,
    openingBalance,
    closingBalance: running
  };
}
