import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped,
  uid
} from "../../services/storage";
import { authGetOrganizationId, authGetUser } from "../../services/auth.service";
import { companyGetProfile } from "../../services/company.service";
import { listNotifications, pushNotification } from "../../services/activity.service";
import { isSupabaseConfigured, supabase } from "../../services/supabaseClient";
import { normalizeContactType, validateContactTax } from "../../services/customerTax";
import type {
  CreditLimitType,
  LedgerEntry,
  PartyDraft,
  PartyFinancials,
  PartyRecord,
  PartyType,
  StatementDocType
} from "./types";
import { defaultOpeningBalanceType, normalizeText, openingBalanceSigned, parseNumber, toIsoDate } from "./utils";

const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";
const PAYMENT_IN_PREMIUM_KEY = "paymentInPremiumV1";
const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";
const PAYMENT_OUT_PREMIUM_KEY = "paymentOutPremiumV1";
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

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

function normalizeCreditLimitType(value: unknown): CreditLimitType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "days") return "Days";
  return "Amount";
}

function normalizeParty(raw: any): PartyRecord {
  const typeValue = String(raw?.type || "").toLowerCase();
  const type: PartyType = typeValue === "supplier" ? "Supplier" : "Customer";
  const taxId = String(raw?.taxId || raw?.gstin || raw?.vatNo || raw?.trn || "").trim();
  const contactType = normalizeContactType(raw?.contactType ?? raw?.customerType ?? raw?.customer_type, taxId);
  const customerType = type === "Customer" ? contactType : "Business";
  const legacyBalance = raw?.openingBalance ?? raw?.balance ?? 0;
  const openingBalance = Math.abs(parseNumber(legacyBalance));
  const openingBalanceType =
    raw?.openingBalanceType || inferOpeningBalanceType(type, parseNumber(raw?.balance ?? null));
  const creditLimitType = normalizeCreditLimitType(raw?.creditLimitType ?? raw?.credit_limit_type);
  const creditLimit = Math.max(0, parseNumber(raw?.creditLimit ?? raw?.credit_limit));
  const creditLimitDays = Math.max(0, parseNumber(raw?.creditLimitDays ?? raw?.credit_limit_days));
  const creditLimitEnabled =
    typeof raw?.creditLimitEnabled === "boolean"
      ? raw.creditLimitEnabled
      : creditLimitType === "Days"
        ? creditLimitDays > 0
        : creditLimit > 0;
  const audit = raw?.audit || {
    createdAt: raw?.created_at || nowIso(),
    createdBy: raw?.created_by || SYSTEM_ACTOR,
    updatedAt: raw?.updated_at || raw?.created_at || nowIso(),
    updatedBy: raw?.updated_by || raw?.created_by || SYSTEM_ACTOR
  };

  return {
    id: raw?.id || uid("pty_"),
    type,
    contactType,
    customerType,
    name: raw?.name || "",
    phone: raw?.phone || "",
    email: raw?.email || "",
    country: raw?.country || "",
    state: raw?.state || "",
    address: raw?.address || "",
    taxId,
    taxIdType: raw?.taxIdType || "",
    gstin: raw?.gstin || taxId || "",
    vatNo: raw?.vatNo || "",
    trn: raw?.trn || "",
    openingBalance,
    openingBalanceType,
    creditLimit,
    creditLimitDays,
    creditLimitType,
    creditLimitEnabled,
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

function organizationTaxContext() {
  const profile = companyGetProfile() || {};
  return {
    ...profile,
    country: profile?.country || "",
    settings: profile?.settings || {}
  };
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
    creditLimitDays: parseNumber(row?.credit_limit_days),
    creditLimitType: normalizeCreditLimitType(row?.credit_limit_type),
    creditLimitEnabled:
      normalizeCreditLimitType(row?.credit_limit_type) === "Days"
        ? parseNumber(row?.credit_limit_days) > 0
        : row?.credit_limit !== null &&
          row?.credit_limit !== undefined &&
          parseNumber(row?.credit_limit) > 0,
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
  const creditLimitDays = Math.max(0, parseNumber(normalized.creditLimitDays));
  const useAmount = normalized.creditLimitEnabled && normalized.creditLimitType === "Amount";
  const useDays = normalized.creditLimitEnabled && normalized.creditLimitType === "Days";

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
    credit_limit: useAmount ? creditLimit : null,
    credit_limit_type: normalized.creditLimitEnabled ? normalized.creditLimitType.toLowerCase() : null,
    credit_limit_days: useDays ? creditLimitDays : null,
    notes: normalized.notes || null,
    is_active: true
  };
}

function toLegacyRemotePayload(payload: Record<string, unknown>) {
  const { credit_limit_type, credit_limit_days, ...legacyPayload } = payload;
  return legacyPayload;
}

function basePartyList() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.parties, []));
}

export function listParties(): PartyRecord[] {
  const list = basePartyList().map(normalizeParty);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function summarizePartyCounts(parties: Array<PartyRecord | { party_type?: string }>) {
  let customers = 0;
  let suppliers = 0;
  parties.forEach((party: any) => {
    const rawType = String(party?.type || party?.party_type || "customer").toLowerCase();
    if (rawType === "supplier") {
      suppliers += 1;
      return;
    }
    if (rawType === "both") {
      customers += 1;
      suppliers += 1;
      return;
    }
    customers += 1;
  });
  return {
    total: parties.length,
    customers,
    suppliers
  };
}

export async function fetchPartiesCount() {
  const local = summarizePartyCounts(listParties());
  if (!isSupabaseConfigured || !supabase) return local;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return local;

  const { data, error } = await supabase
    .from("parties")
    .select("party_type")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (error) return local;
  return summarizePartyCounts(ensureArray<any>(data));
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

  let incoming = normalizeParty(draft);
  const taxValidation = validateContactTax(incoming, organizationTaxContext());
  if (taxValidation.error) throw new Error(taxValidation.error);
  incoming = {
    ...incoming,
    contactType: taxValidation.contactType,
    customerType: taxValidation.contactType,
    taxId: taxValidation.normalizedTaxId,
    gstin: taxValidation.normalizedTaxId || incoming.gstin || ""
  };
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
      creditLimit: Math.max(0, parseNumber(incoming.creditLimit)),
      creditLimitDays: Math.max(0, parseNumber(incoming.creditLimitDays)),
      creditLimitType: incoming.creditLimitType
    };
    list[idx] = next;
    lsSetOrganizationScoped(LS_KEYS.parties, list);
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
    creditLimit: Math.max(0, parseNumber(incoming.creditLimit)),
    creditLimitDays: Math.max(0, parseNumber(incoming.creditLimitDays)),
    creditLimitType: incoming.creditLimitType
  };
  lsSetOrganizationScoped(LS_KEYS.parties, [next, ...list]);
  return normalizeParty(next);
}

export function removeParty(id: string) {
  lsSetOrganizationScoped(
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

  const localById = new Map(listParties().map((party) => [party.id, party]));
  const mapped = ensureArray<any>(data).map((row) => {
    const remote = mapRemoteParty(row);
    const local = localById.get(remote.id);
    if (!local) return remote;
    return normalizeParty({
      ...remote,
      contactType: local.contactType || remote.contactType,
      customerType: local.customerType || remote.customerType
    });
  });
  lsSetOrganizationScoped(LS_KEYS.parties, mapped);
  triggerCreditLimitNotifications(mapped);
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

  let incoming = normalizeParty(draft);
  const taxValidation = validateContactTax(incoming, organizationTaxContext());
  if (taxValidation.error) throw new Error(taxValidation.error);
  incoming = {
    ...incoming,
    contactType: taxValidation.contactType,
    customerType: taxValidation.contactType,
    taxId: taxValidation.normalizedTaxId,
    gstin: taxValidation.normalizedTaxId || incoming.gstin || ""
  };
  const payload = toRemotePayload(incoming);
  const actorUserId = authGetUser()?.id || null;
  let remoteRow: any = null;

  if (incoming.id && looksLikeUuid(incoming.id)) {
    let attempt = await supabase
      .from("parties")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", incoming.id)
      .select("*")
      .maybeSingle();

    if (attempt.error?.code === "42703") {
      attempt = await supabase
        .from("parties")
        .update(toLegacyRemotePayload(payload))
        .eq("organization_id", organizationId)
        .eq("id", incoming.id)
        .select("*")
        .maybeSingle();
    }

    if (attempt.error) {
      throw new Error(normalizeSupabaseError(attempt.error, "Failed to update party"));
    }
    remoteRow = attempt.data || null;
  }

  if (!remoteRow) {
    let attempt = await supabase
      .from("parties")
      .insert({
        organization_id: organizationId,
        created_by: actorUserId,
        ...payload
      })
      .select("*")
      .single();

    if (attempt.error?.code === "42703") {
      attempt = await supabase
        .from("parties")
        .insert({
          organization_id: organizationId,
          created_by: actorUserId,
          ...toLegacyRemotePayload(payload)
        })
        .select("*")
        .single();
    }

    if (attempt.error) {
      throw new Error(normalizeSupabaseError(attempt.error, "Failed to create party"));
    }
    remoteRow = attempt.data;
  }

  const saved = mapRemoteParty(remoteRow);
  const nextList = basePartyList().filter((party: any) => party.id !== saved.id && party.id !== incoming.id);
  lsSetOrganizationScoped(LS_KEYS.parties, [saved, ...nextList]);
  triggerCreditLimitNotifications([saved]);
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

function extractOutstandingAmount(record: any, fallbackAmount: number) {
  const explicitBalance = parseNumber(record?.totals?.balance ?? record?.remainingBalance ?? record?.balance);
  if (explicitBalance > 0) return explicitBalance;
  return Math.max(0, fallbackAmount);
}

function resolveDueDate(record: any, partyType: PartyType) {
  const candidates =
    partyType === "Supplier"
      ? [
          record?.dueDate,
          record?.billDueDate,
          record?.due_date,
          record?.bill_date,
          record?.billDate,
          record?.date
        ]
      : [
          record?.dueDate,
          record?.invoiceDueDate,
          record?.due_date,
          record?.invoiceDate,
          record?.invoice_date,
          record?.date
        ];
  for (const candidate of candidates) {
    const normalized = toIsoDate(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function listLegacyCreditNotes() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.creditNotes, []));
}

function listPremiumCreditNotes() {
  return ensureArray(lsGetOrganizationScoped(CREDIT_NOTES_PREMIUM_KEY, []));
}

function listPremiumDebitNotes() {
  return ensureArray(lsGetOrganizationScoped(DEBIT_NOTES_PREMIUM_KEY, []));
}

function listLegacyPayments() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.payments, []));
}

function listPremiumPayments() {
  return ensureArray(lsGetOrganizationScoped(PAYMENT_IN_PREMIUM_KEY, []));
}

function listPremiumPaymentOut() {
  return ensureArray(lsGetOrganizationScoped(PAYMENT_OUT_PREMIUM_KEY, []));
}

function listInvoices() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, []));
}

function listPurchases() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));
}

function customerTotals(party: PartyRecord) {
  const invoices = listInvoices().filter((record) => matchesParty(party, record));
  const paymentsLegacy = listLegacyPayments().filter(
    (record) =>
      record?.direction === "IN" &&
      matchesParty(party, record) &&
      !String(record?.referenceNo || record?.reference_no || "").startsWith("PI:") &&
      !!(record?.invoiceId || record?.invoice_id)
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
      sumRecords(paymentsPremium, (record) => parseNumber(record?.totals?.amountApplied)),
    creditNotes:
      sumRecords(creditLegacy, extractCreditAmount) +
      sumRecords(creditPremium, extractCreditAmount),
    debitNotes: 0
  };
}

function supplierTotals(party: PartyRecord) {
  const purchases = listPurchases().filter((record) => matchesParty(party, record));
  const paymentsLegacy = listLegacyPayments().filter(
    (record) =>
      record?.direction === "OUT" &&
      matchesParty(party, record) &&
      !String(record?.referenceNo || record?.reference_no || "").startsWith("PO:") &&
      !!(record?.billId || record?.bill_id)
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
      sumRecords(paymentsPremium, (record) => parseNumber(record?.totals?.amountApplied)),
    creditNotes: 0,
    debitNotes: sumRecords(debitPremium, extractDebitAmount)
  };
}

function computeMaxOverdueDays(party: PartyRecord) {
  const records = (party.type === "Supplier" ? listPurchases() : listInvoices()).filter((record) =>
    matchesParty(party, record)
  );
  if (!records.length) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let maxOverdueDays = 0;
  records.forEach((record) => {
    const status = String(record?.status || record?.paymentStatus || "").toLowerCase();
    if (status === "paid" || status === "cancelled" || status === "draft") return;

    const fallbackAmount =
      party.type === "Supplier" ? extractPurchaseAmount(record) : extractInvoiceAmount(record);
    const outstandingAmount = extractOutstandingAmount(record, fallbackAmount);
    if (outstandingAmount <= 0) return;

    const dueDateIso = resolveDueDate(record, party.type);
    if (!dueDateIso) return;

    const dueDate = new Date(`${dueDateIso}T00:00:00`);
    if (Number.isNaN(dueDate.getTime()) || dueDate >= today) return;

    const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > maxOverdueDays) maxOverdueDays = diffDays;
  });

  return Math.max(0, maxOverdueDays);
}

function hasRecentAlert(alertKey: string) {
  const cutoff = Date.now() - ALERT_COOLDOWN_MS;
  return listNotifications().some((entry) => {
    if (entry?.meta?.alertKey !== alertKey) return false;
    const createdAt = new Date(entry?.createdAt || 0).getTime();
    return createdAt >= cutoff;
  });
}

function notifyPartyLimitExceeded(party: PartyRecord, financials: PartyFinancials) {
  if (financials.amountExceeded !== true) return;
  const alertKey = `party-credit-amount-${party.id}`;
  if (hasRecentAlert(alertKey)) return;

  pushNotification({
    title: `${party.type} credit amount exceeded`,
    description: `${party.name} outstanding ${financials.outstanding.toLocaleString(undefined, {
      maximumFractionDigits: 2
    })} exceeds limit ${financials.creditLimit.toLocaleString(undefined, {
      maximumFractionDigits: 2
    })}.`,
    tone: "warning",
    link: `/app/parties/${party.id}/statement`,
    meta: {
      alertKey,
      partyId: party.id,
      type: "credit-amount"
    }
  });
}

function notifyPartyOverdueExceeded(party: PartyRecord, financials: PartyFinancials) {
  if (financials.overdueExceeded !== true) return;
  const alertKey = `party-credit-days-${party.id}`;
  if (hasRecentAlert(alertKey)) return;

  pushNotification({
    title: `${party.type} overdue days exceeded`,
    description: `${party.name} is overdue by ${financials.maxOverdueDays} days (allowed ${financials.creditLimitDays} days).`,
    tone: "warning",
    link: `/app/parties/${party.id}/statement`,
    meta: {
      alertKey,
      partyId: party.id,
      type: "credit-days"
    }
  });
}

export function triggerCreditLimitNotifications(parties?: PartyRecord[]) {
  const source = (Array.isArray(parties) && parties.length ? parties : listParties())
    .map(normalizeParty)
    .filter((party) => party.creditLimitEnabled);

  source.forEach((party) => {
    const financials = computePartyFinancials(party);
    notifyPartyLimitExceeded(party, financials);
    notifyPartyOverdueExceeded(party, financials);
  });
}

export function computePartyFinancials(party: PartyRecord): PartyFinancials {
  const openingBalance = openingBalanceSigned(party);
  const totals = party.type === "Supplier" ? supplierTotals(party) : customerTotals(party);
  const outstanding = openingBalance + totals.invoices - totals.payments - totals.creditNotes + totals.debitNotes;

  const creditLimit = Math.max(0, parseNumber(party.creditLimit));
  const creditLimitDays = Math.max(0, parseNumber(party.creditLimitDays));
  const creditLimitType = normalizeCreditLimitType(party.creditLimitType);
  const creditLimitEnabled = !!party.creditLimitEnabled;
  const maxOverdueDays = computeMaxOverdueDays(party);

  const amountExceeded =
    creditLimitEnabled &&
    creditLimitType === "Amount" &&
    creditLimit > 0 &&
    outstanding > creditLimit;
  const overdueExceeded =
    creditLimitEnabled &&
    creditLimitType === "Days" &&
    creditLimitDays > 0 &&
    maxOverdueDays > creditLimitDays;
  const creditExceeded = amountExceeded || overdueExceeded;
  const creditOverBy = amountExceeded ? outstanding - creditLimit : 0;
  const overdueByDays = overdueExceeded ? maxOverdueDays - creditLimitDays : 0;

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
    creditLimitDays,
    creditLimitType,
    creditLimitEnabled,
    maxOverdueDays,
    amountExceeded,
    overdueExceeded,
    creditExceeded,
    creditOverBy,
    overdueByDays
  };
}

export function getPartyCreditStatus(partyId?: string | null) {
  const party = getParty(partyId);
  if (!party) {
    return {
      party,
      blocked: false,
      outstanding: 0,
      creditLimit: 0,
      creditLimitDays: 0,
      creditLimitType: "Amount" as CreditLimitType,
      creditExceeded: false,
      creditOverBy: 0,
      overdueExceeded: false,
      overdueByDays: 0,
      maxOverdueDays: 0
    };
  }

  const financials = computePartyFinancials(party);
  return {
    party,
    blocked: false,
    outstanding: financials.outstanding,
    creditLimit: financials.creditLimit,
    creditLimitDays: financials.creditLimitDays,
    creditLimitType: financials.creditLimitType,
    creditExceeded: financials.creditExceeded,
    creditOverBy: financials.creditOverBy,
    overdueExceeded: financials.overdueExceeded,
    overdueByDays: financials.overdueByDays,
    maxOverdueDays: financials.maxOverdueDays
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
      .filter(
        (record) =>
          record?.direction === "IN" &&
          matchesParty(party, record) &&
          !String(record?.referenceNo || record?.reference_no || "").startsWith("PI:") &&
          !!(record?.invoiceId || record?.invoice_id)
      )
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
        const appliedAmount = parseNumber(record?.totals?.amountApplied);
        if (appliedAmount <= 0) return;
        addEntry(entries, {
          id: record.id || `pay_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.paymentDate || record.created_at),
          type: "Payment",
          documentNo: record.receiptNo || record.id || "",
          debit: 0,
          credit: appliedAmount
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
      .filter(
        (record) =>
          record?.direction === "OUT" &&
          matchesParty(party, record) &&
          !String(record?.referenceNo || record?.reference_no || "").startsWith("PO:") &&
          !!(record?.billId || record?.bill_id)
      )
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

    listPremiumPaymentOut()
      .filter((record) => record?.status !== "Draft" && matchesParty(party, record))
      .forEach((record) => {
        const appliedAmount = parseNumber(record?.totals?.amountApplied);
        if (appliedAmount <= 0) return;
        addEntry(entries, {
          id: record.id || `pay_${Math.random().toString(16).slice(2)}`,
          date: toIsoDate(record.paymentDate || record.created_at),
          type: "Payment",
          documentNo: record.paymentNo || record.id || "",
          debit: 0,
          credit: appliedAmount
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
          debit: extractDebitAmount(record),
          credit: 0
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
