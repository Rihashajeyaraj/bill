import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authEnsureOrganizationAccess, authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { triggerCreditLimitNotifications } from "../modules/parties/store";
import {
  annotateWithFinancialYear,
  financialYearsEnsureForDate,
  financialYearsResolveForDate,
  matchesFinancialYearFilter,
  resolveFinancialYearFilterRange
} from "./financialYears.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_IN_PREMIUM_KEY = "paymentInPremiumV1";
const PAYMENT_OUT_PREMIUM_KEY = "paymentOutPremiumV1";

const COUNTRY_NAME_TO_CODE = {
  india: "IN",
  uae: "AE",
  "united arab emirates": "AE",
  singapore: "SG",
  uk: "UK",
  "united kingdom": "UK",
  ireland: "IE",
  usa: "US",
  us: "US",
  "united states": "US",
  "sri lanka": "SL"
};

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.payments, []);
}
function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.payments, list);
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function isOrganizationAccessError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "P0001" && message.includes("access denied for organization");
}

function isPermissionLikeError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42501" ||
    isOrganizationAccessError(error) ||
    message.includes("rls denied access") ||
    message.includes("access denied for organization")
  );
}

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function isUniqueConstraintError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "23505" ||
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("already exists")
  );
}

function normalizePaymentDateOrNull(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildRemotePaymentNo(base, suffix = "") {
  const trimmedBase = String(base || "").trim() || `PAY-${Date.now()}`;
  const trimmedSuffix = String(suffix || "").trim();
  return trimmedSuffix ? `${trimmedBase}-${trimmedSuffix}` : trimmedBase;
}

function referenceFromEntry(entry) {
  return String(entry?.referenceNo || entry?.reference_no || "");
}

function normalizeCountryCode(value, fallback = "IN") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (upper === "LK") return "SL";
  if (upper === "GB") return "UK";
  if (["IN", "AE", "SG", "UK", "IE", "US", "SL"].includes(upper)) return upper;
  return COUNTRY_NAME_TO_CODE[raw.toLowerCase()] || fallback;
}

function inferCountryFromPaymentNo(paymentNo = "", fallback = "") {
  const raw = String(paymentNo || "").trim().toUpperCase();
  if (!raw) return fallback;
  const parts = raw.split("-");
  const candidate = parts.length >= 2 ? parts[1] : "";
  return normalizeCountryCode(candidate, fallback || "IN");
}

function getOrganizationCountryProfile() {
  const profile = lsGetOrganizationScoped(LS_KEYS.company_profile, {}) || {};
  return {
    country: normalizeCountryCode(profile?.countryCode || profile?.country || profile?.country_name, "IN"),
    currency: String(profile?.currency || profile?.base_currency || "INR").trim().toUpperCase() || "INR"
  };
}

function sourceRecordIdFromReference(referenceNo, prefix) {
  const raw = String(referenceNo || "").trim();
  if (!raw.startsWith(prefix)) return "";
  const remainder = raw.slice(prefix.length);
  const separatorIndex = remainder.indexOf(":");
  return separatorIndex >= 0 ? remainder.slice(0, separatorIndex) : remainder;
}

function buildPartyLookup() {
  const rows = lsGetOrganizationScoped(LS_KEYS.parties, []);
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id)
      .map((row) => [
        String(row.id),
        {
          name: row?.name || row?.display_name || "",
          country: row?.country || row?.country_code || ""
        }
      ])
  );
}

function buildInvoiceLookup() {
  const rows = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id)
      .map((row) => [
        String(row.id),
        {
          invoiceNo: row?.invoiceNo || row?.invoice_no || row?.id || "",
          invoiceDate: row?.invoiceDate || row?.invoice_date || row?.date || "",
          invoiceAmount:
            parseNumber(
              row?.totals?.grandTotal ??
                row?.totals?.finalTotal ??
                row?.totals?.total ??
                row?.grandTotal ??
                row?.finalTotal ??
                row?.amount
            ) || 0
        }
      ])
  );
}

function buildBillLookup() {
  const rows = lsGetOrganizationScoped(LS_KEYS.purchases, []);
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id)
      .map((row) => [
        String(row.id),
        {
          billNo: row?.billNumber || row?.bill_no || row?.invoiceNo || row?.id || "",
          billDate: row?.billDate || row?.invoiceDate || row?.date || "",
          billAmount:
            parseNumber(
              row?.totals?.grandTotal ??
                row?.totals?.finalTotal ??
                row?.totals?.total ??
                row?.grandTotal ??
                row?.finalTotal ??
                row?.amount
            ) || 0
        }
      ])
  );
}

function mergeRemotePremiumRecords(storageKey, remoteRecords) {
  const existing = lsGetOrganizationScoped(storageKey, []);
  const current = Array.isArray(existing) ? existing : [];
  const remoteIds = new Set(remoteRecords.map((entry) => String(entry?.id || "")).filter(Boolean));
  const preservedDrafts = current.filter(
    (entry) => String(entry?.status || "").toLowerCase() === "draft" && !remoteIds.has(String(entry?.id || ""))
  );
  lsSetOrganizationScoped(storageKey, [...remoteRecords, ...preservedDrafts]);
}

function replaceLocalPaymentOutNumber(recordId, nextPaymentNo) {
  const normalizedId = String(recordId || "").trim();
  const normalizedPaymentNo = String(nextPaymentNo || "").trim();
  if (!normalizedId || !normalizedPaymentNo) return;
  const current = lsGetOrganizationScoped(PAYMENT_OUT_PREMIUM_KEY, []);
  if (!Array.isArray(current) || !current.length) return;
  lsSetOrganizationScoped(
    PAYMENT_OUT_PREMIUM_KEY,
    current.map((entry) =>
      String(entry?.id || "").trim() === normalizedId ? { ...entry, paymentNo: normalizedPaymentNo } : entry
    )
  );
}

function buildRetryPaymentNo(basePaymentNo = "", country = "") {
  const base = String(basePaymentNo || "").trim();
  if (base) return `${base}-R${Date.now().toString().slice(-6)}`;
  const code = normalizeCountryCode(country, "IN");
  return `PO-${code}-${Date.now().toString().slice(-8)}`;
}

function hydratePremiumPaymentStores(remoteRows) {
  const rows = Array.isArray(remoteRows) ? remoteRows : [];
  const partyLookup = buildPartyLookup();
  const invoiceLookup = buildInvoiceLookup();
  const billLookup = buildBillLookup();
  const organizationProfile = getOrganizationCountryProfile();

  const paymentInGroups = new Map();
  const paymentOutGroups = new Map();
  rows.forEach((row) => {
    const status = String(row?.status || "").toLowerCase();
    if (status === "cancelled" || status === "draft") return;
    const referenceNo = String(row?.reference_no || "");
    const paymentInId = sourceRecordIdFromReference(referenceNo, "PI:");
    const paymentOutId = sourceRecordIdFromReference(referenceNo, "PO:");
    if (paymentInId) {
      const list = paymentInGroups.get(paymentInId) || [];
      list.push(row);
      paymentInGroups.set(paymentInId, list);
    } else if (paymentOutId) {
      const list = paymentOutGroups.get(paymentOutId) || [];
      list.push(row);
      paymentOutGroups.set(paymentOutId, list);
    }
  });

  const paymentInRecords = Array.from(paymentInGroups.entries())
    .map(([id, group]) => {
      const row = group
        .slice()
        .sort((left, right) => String(right?.created_at || "").localeCompare(String(left?.created_at || "")))[0];
      if (!row) return null;
      const party = partyLookup.get(String(row?.party_id || "")) || {};
      const country = inferCountryFromPaymentNo(
        row?.payment_no,
        normalizeCountryCode(party?.country, organizationProfile.country)
      );
      const invoiceId = String(row?.invoice_id || "").trim();
      const invoice = invoiceLookup.get(invoiceId) || {};
      const amountReceived = parseNumber(row?.amount_received ?? row?.amount);
      const tdsAmount = parseNumber(row?.tds_amount);
      const amountApplied = invoiceId ? amountReceived : 0;
      const totalSettled = amountReceived + tdsAmount;
      const paymentDate = row?.payment_date || "";
      const receiptNo = String(row?.payment_no || id).replace(/-ENTRY$/i, "");
      return {
        id,
        country,
        receiptNo,
        paymentDate,
        customerId: String(row?.party_id || ""),
        customerName: String(party?.name || "Customer"),
        currency: organizationProfile.currency,
        paymentMode: row?.payment_mode || "Cash",
        referenceNo: row?.reference_no || "",
        chequeNo: "",
        bankName: "",
        bankAccount: "",
        transactionId: "",
        paymentReference: "",
        registrationNumber: "",
        tdsCategory: tdsAmount > 0 ? "custom" : "",
        tdsRate: parseNumber(row?.tds_rate),
        isManual: !!row?.is_manual,
        internalNotes: row?.notes || "",
        customerNotes: "",
        attachment: null,
        status: invoiceId ? "Applied" : "Confirmed",
        allocations: invoiceId
          ? [
              {
                invoiceId,
                invoiceNo: String(invoice?.invoiceNo || invoiceId),
                invoiceDate: String(invoice?.invoiceDate || paymentDate),
                invoiceAmount: parseNumber(invoice?.invoiceAmount || totalSettled),
                balanceDue: parseNumber(invoice?.invoiceAmount || totalSettled),
                applyAmount: amountReceived,
                documentType: "invoice"
              }
            ]
          : [],
        totals: {
          amountReceived,
          tdsAmount,
          totalSettled,
          amountApplied,
          unappliedAmount: Math.max(0, amountReceived - amountApplied),
          customerOutstandingBefore: 0,
          customerOutstandingAfter: 0
        },
        audit: {
          createdBy: "Remote Sync",
          createdAt: row?.created_at || new Date().toISOString(),
          modifiedBy: "Remote Sync",
          modifiedAt: row?.updated_at || row?.created_at || new Date().toISOString()
        },
        history: [
          {
            status: invoiceId ? "Applied" : "Confirmed",
            at: row?.updated_at || row?.created_at || new Date().toISOString(),
            by: "Remote Sync",
            note: "Hydrated from payments table"
          }
        ]
      };
    })
    .filter(Boolean);

  const paymentOutRecords = Array.from(paymentOutGroups.entries())
    .map(([id, group]) => {
      const ordered = group
        .slice()
        .sort((left, right) => String(left?.created_at || "").localeCompare(String(right?.created_at || "")));
      const head = ordered[0];
      if (!head) return null;
      const party = partyLookup.get(String(head?.party_id || "")) || {};
      const country = inferCountryFromPaymentNo(
        head?.payment_no,
        normalizeCountryCode(party?.country, organizationProfile.country)
      );
      const allocations = ordered
        .filter((row) => row?.bill_id)
        .map((row) => {
          const billId = String(row?.bill_id || "");
          const bill = billLookup.get(billId) || {};
          return {
            billId,
            billNo: String(bill?.billNo || billId),
            billDate: String(bill?.billDate || head?.payment_date || ""),
            billAmount: parseNumber(bill?.billAmount || row?.amount),
            balanceDue: parseNumber(bill?.billAmount || row?.amount),
            applyAmount: parseNumber(row?.amount)
          };
        });
      const amountPaid = ordered.reduce((sum, row) => sum + parseNumber(row?.amount), 0);
      const tdsAmount = ordered.reduce((sum, row) => sum + parseNumber(row?.tds_amount), 0);
      const amountApplied = allocations.reduce((sum, row) => sum + parseNumber(row?.applyAmount), 0);
      const totalSettled = amountPaid + tdsAmount;
      const paymentNo = String(head?.payment_no || id).replace(/-(\d+|UNAPPLIED|PAID)$/i, "");
      return {
        id,
        country,
        paymentNo,
        paymentDate: head?.payment_date || "",
        supplierId: String(head?.party_id || ""),
        supplierName: String(party?.name || "Supplier"),
        currency: organizationProfile.currency,
        paymentMode: head?.payment_mode || "Cash",
        referenceNo: head?.reference_no || "",
        chequeNo: "",
        bankName: "",
        transactionId: "",
        paymentReference: "",
        internalNotes: head?.notes || "",
        attachment: null,
        status: allocations.length ? "Applied" : "Paid",
        allocations,
        totals: {
          amountPaid,
          tdsAmount,
          totalSettled,
          amountApplied,
          unappliedAmount: Math.max(0, amountPaid - amountApplied)
        },
        tdsRate: ordered.reduce((maxRate, row) => Math.max(maxRate, parseNumber(row?.tds_rate)), 0),
        isManual: ordered.some((row) => !!row?.is_manual),
        audit: {
          createdBy: "Remote Sync",
          createdAt: head?.created_at || new Date().toISOString(),
          modifiedBy: "Remote Sync",
          modifiedAt: head?.updated_at || head?.created_at || new Date().toISOString()
        },
        history: [
          {
            status: allocations.length ? "Applied" : "Paid",
            at: head?.updated_at || head?.created_at || new Date().toISOString(),
            by: "Remote Sync",
            note: "Hydrated from payments table"
          }
        ]
      };
    })
    .filter(Boolean);

  mergeRemotePremiumRecords(PAYMENT_IN_PREMIUM_KEY, paymentInRecords);
  mergeRemotePremiumRecords(PAYMENT_OUT_PREMIUM_KEY, paymentOutRecords);
}

function mergeSourceRowsToLocalPayments(sourcePrefix, rows) {
  const keep = getAll().filter((entry) => !referenceFromEntry(entry).startsWith(sourcePrefix));
  if (!Array.isArray(rows) || !rows.length) {
    setAll(keep);
    return;
  }

  const mapped = rows.map((row, index) => ({
    ...annotateWithFinancialYear(
      {
    id: uid("pay_"),
    date: row?.payment_date || "",
    paymentNo: row?.payment_no || `PAY-${Date.now()}`,
    direction: String(row?.direction || "").toUpperCase() === "OUT" ? "OUT" : "IN",
    partyId: row?.party_id || "",
    invoiceId: row?.invoice_id || "",
    billId: row?.bill_id || "",
    amount: parseNumber(row?.amount),
    amountReceived: parseNumber(row?.amount_received ?? row?.amount),
    tdsAmount: parseNumber(row?.tds_amount),
    tdsRate: parseNumber(row?.tds_rate),
    isManual: !!row?.is_manual,
    mode: row?.payment_mode || "",
    referenceNo: row?.reference_no || `${sourcePrefix}${index + 1}`,
    note: row?.notes || "",
    status: row?.status || "posted",
    created_at: row?.created_at || new Date().toISOString()
      },
      row?.payment_date || row?.created_at
    )
  }));

  setAll([...mapped, ...keep]);
}

async function findInvoiceIdByNumber(organizationId, invoiceNo) {
  if (!supabase || !organizationId || !invoiceNo) return null;
  const { data } = await supabase
    .from("invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("invoice_no", invoiceNo)
    .maybeSingle();
  return data?.id || null;
}

async function findBillIdByNumber(organizationId, billNo) {
  if (!supabase || !organizationId || !billNo) return null;
  const { data } = await supabase
    .from("purchase_bills")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("bill_no", billNo)
    .maybeSingle();
  return data?.id || null;
}

function paymentDateForFilter(entry) {
  return entry?.paymentDate || entry?.payment_date || entry?.date || entry?.created_at;
}

export function paymentsList(range) {
  const rows = getAll();
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);
  if (!fromDate && !toDate) return rows;
  return rows.filter((entry) => matchesFinancialYearFilter(paymentDateForFilter(entry), { fromDate, toDate }));
}

export async function paymentsSyncFromRemote(range) {
  if (!isSupabaseConfigured || !supabase) return paymentsList(range);

  const organizationId = authGetOrganizationId();
  if (!organizationId) return paymentsList(range);
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);

  let query = supabase
    .from("payments")
    .select("*")
    .eq("organization_id", organizationId);
  if (fromDate) query = query.gte("payment_date", fromDate);
  if (toDate) query = query.lte("payment_date", toDate);

  const { data, error } = await query
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load payments"));
  }

  const mapped = (Array.isArray(data) ? data : []).map((row) =>
    annotateWithFinancialYear(
      {
        id: row?.id || uid("pay_"),
        date: row?.payment_date || "",
        paymentNo: row?.payment_no || "",
        direction: String(row?.direction || "").toUpperCase(),
        partyId: row?.party_id || "",
        invoiceId: row?.invoice_id || "",
        billId: row?.bill_id || "",
        amount: parseNumber(row?.amount),
        amountReceived: parseNumber(row?.amount_received ?? row?.amount),
        tdsAmount: parseNumber(row?.tds_amount),
        tdsRate: parseNumber(row?.tds_rate),
        isManual: !!row?.is_manual,
        mode: row?.payment_mode || "",
        referenceNo: row?.reference_no || "",
        note: row?.notes || "",
        status: row?.status || "posted",
        financialYearId: row?.financial_year_id || "",
        created_at: row?.created_at || new Date().toISOString()
      },
      row?.payment_date || row?.created_at
    )
  );

  if (!fromDate && !toDate) {
    setAll(mapped);
    hydratePremiumPaymentStores(data);
  }
  return mapped;
}

export function paymentsCreate(payment) {
  const id = uid("pay_");
  const paymentDate = payment?.date || payment?.paymentDate || "";
  const matchedFinancialYear = financialYearsResolveForDate(paymentDate);
  const next = annotateWithFinancialYear(
    { ...payment, id, created_at: new Date().toISOString() },
    paymentDate
  );
  setAll([next, ...getAll()]);

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const actorUserId = authGetUser()?.id || null;
      void (async () => {
        const persistedFinancialYear =
          (await financialYearsEnsureForDate(paymentDate).catch(() => null)) || matchedFinancialYear;
        const remotePayload = {
          organization_id: organizationId,
          financial_year_id: looksLikeUuid(persistedFinancialYear?.id) ? persistedFinancialYear.id : null,
          payment_no: payment?.paymentNo || `PAY-${Date.now()}`,
          payment_date: normalizePaymentDateOrNull(paymentDate),
          direction: String(payment?.direction || "IN").toUpperCase() === "OUT" ? "out" : "in",
          party_id: looksLikeUuid(payment?.partyId) ? payment.partyId : null,
          invoice_id: looksLikeUuid(payment?.invoiceId) ? payment.invoiceId : null,
          bill_id: looksLikeUuid(payment?.billId) ? payment.billId : null,
          amount: parseNumber(payment?.amount),
          amount_received: parseNumber(payment?.amountReceived ?? payment?.amount),
          tds_amount: parseNumber(payment?.tdsAmount),
          tds_rate: parseNumber(payment?.tdsRate),
          is_manual: !!payment?.isManual,
          payment_mode: payment?.mode || payment?.paymentMode || null,
          reference_no: payment?.referenceNo || payment?.paymentReference || null,
          notes: payment?.note || payment?.notes || null,
          status: "posted",
          created_by: actorUserId
        };
        let insertResult = await supabase.from("payments").insert(remotePayload);
        if (insertResult.error && isMissingColumnError(insertResult.error)) {
          const { financial_year_id, amount_received, tds_rate, is_manual, ...legacyPayload } = remotePayload;
          insertResult = await supabase.from("payments").insert(legacyPayload);
        }
      })();
    }
  }

  console.log("[CreditMonitoring] Triggering notification check from paymentsCreate", {
    paymentId: id,
    direction: String(payment?.direction || "").toUpperCase(),
    partyId: payment?.partyId || null
  });
  void triggerCreditLimitNotifications();
  return id;
}

export async function syncPaymentInRemote(record) {
  if (!record) return;

  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  const actorUserId = authGetUser()?.id || null;
  const sourcePrefix = `PI:${record.id}:`;
  const shouldApply = String(record?.status || "").toLowerCase() === "applied";
  const shouldPost = String(record?.status || "").toLowerCase() !== "draft";
  const rows = [];
  const partyId = record?.customerId || null;
  const paymentDate = record?.paymentDate || "";
  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];

  if (shouldPost) {
    const amountReceived = Math.max(0, parseNumber(record?.totals?.amountReceived ?? record?.amountReceived));
    const tdsAmount = Math.max(0, parseNumber(record?.totals?.tdsAmount ?? record?.tdsAmount));
    const tdsRate = Math.max(0, parseNumber(record?.tdsRate));
    const amountApplied = Math.max(0, parseNumber(record?.totals?.amountApplied));
    const unappliedAmount = Math.max(0, parseNumber(record?.totals?.unappliedAmount));
    const primaryAllocation = allocations.find((line) => Math.max(0, parseNumber(line?.applyAmount)) > 0) || null;
    const isProforma = String(primaryAllocation?.documentType || "").toLowerCase() === "proforma";
    let invoiceId = null;
    if (shouldApply && primaryAllocation && !isProforma) {
      invoiceId = looksLikeUuid(primaryAllocation?.invoiceId) ? primaryAllocation.invoiceId : null;
      if (!invoiceId && primaryAllocation?.invoiceNo && organizationId) {
        invoiceId = await findInvoiceIdByNumber(organizationId, primaryAllocation.invoiceNo);
      }
    }

    if (amountReceived > 0) {
      const noteParts = [];
      if (record?.internalNotes) noteParts.push(record.internalNotes);
      else noteParts.push(`Payment in ${record?.status || "confirmed"}`);
      if (shouldApply && primaryAllocation?.invoiceNo) {
        noteParts.push(`${isProforma ? "Proforma" : "Invoice"} ${primaryAllocation.invoiceNo}`);
      }
      if (shouldApply) {
        noteParts.push(`Applied ${amountApplied.toFixed(2)}`);
      }
      if (tdsAmount > 0) {
        noteParts.push(`TDS ${tdsAmount.toFixed(2)}`);
      }
      if (unappliedAmount > 0) {
        noteParts.push(`Advance ${unappliedAmount.toFixed(2)}`);
      }

      rows.push({
        payment_no: buildRemotePaymentNo(record?.receiptNo || `RCPT-${Date.now()}`, "ENTRY"),
        payment_date: normalizePaymentDateOrNull(paymentDate),
        direction: "in",
        party_id: partyId,
        invoice_id: shouldApply && !isProforma ? invoiceId || primaryAllocation?.invoiceId || null : null,
        amount: amountReceived,
        amount_received: amountReceived,
        tds_amount: tdsAmount,
        tds_rate: tdsRate,
        is_manual: !!record?.isManual,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}ENTRY`,
        notes: noteParts.filter(Boolean).join(" | "),
        status: "posted"
      });
    }
  }

  let savedLocallyOnly = false;
  let remoteSyncMessage = "";

  if (isSupabaseConfigured && supabase && organizationId) {
    try {
      const { data: existingRows, error: fetchError } = await supabase
        .from("payments")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("reference_no", `${sourcePrefix}%`);
      if (fetchError) {
        throw fetchError;
      }

      const matchingRows = Array.isArray(existingRows) ? existingRows : [];
      const [primaryRow, ...extraRows] = matchingRows;
      const timestamp = new Date().toISOString();

      if (rows.length) {
        const baseRow = rows[0];
        const remoteRow = {
          organization_id: organizationId,
          payment_no: baseRow?.payment_no || `RCPT-${Date.now()}`,
          payment_date: normalizePaymentDateOrNull(baseRow?.payment_date),
          direction: "in",
          party_id: looksLikeUuid(baseRow?.party_id) ? baseRow.party_id : null,
          invoice_id: looksLikeUuid(baseRow?.invoice_id) ? baseRow.invoice_id : null,
          bill_id: null,
          amount: parseNumber(baseRow?.amount),
          amount_received: parseNumber(baseRow?.amount_received ?? baseRow?.amount),
          tds_amount: parseNumber(baseRow?.tds_amount),
          tds_rate: parseNumber(baseRow?.tds_rate),
          is_manual: !!baseRow?.is_manual,
          payment_mode: baseRow?.payment_mode || null,
          reference_no: baseRow?.reference_no || `${sourcePrefix}ENTRY`,
          notes: baseRow?.notes || null,
          status: "posted",
          updated_at: timestamp
        };

        if (primaryRow?.id) {
          const { error: updateError } = await supabase
            .from("payments")
            .update(remoteRow)
            .eq("organization_id", organizationId)
            .eq("id", primaryRow.id);
          if (updateError && isMissingColumnError(updateError)) {
            const { amount_received, tds_rate, is_manual, ...legacyRow } = remoteRow;
            const { error: legacyUpdateError } = await supabase
              .from("payments")
              .update(legacyRow)
              .eq("organization_id", organizationId)
              .eq("id", primaryRow.id);
            if (legacyUpdateError) {
              throw legacyUpdateError;
            }
          } else if (updateError) {
            throw updateError;
          }
        } else {
          let insertResult = await supabase.from("payments").insert({
            ...remoteRow,
            created_by: actorUserId
          });
          if (insertResult.error && isMissingColumnError(insertResult.error)) {
            const { amount_received, tds_rate, is_manual, ...legacyRow } = remoteRow;
            insertResult = await supabase.from("payments").insert({
              ...legacyRow,
              created_by: actorUserId
            });
          }
          if (insertResult.error) {
            if (isUniqueConstraintError(insertResult.error)) {
              const { data: duplicateRow, error: duplicateFetchError } = await supabase
                .from("payments")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("payment_no", remoteRow.payment_no)
                .maybeSingle();
              if (duplicateFetchError) throw duplicateFetchError;
              if (duplicateRow?.id) {
                const { error: duplicateUpdateError } = await supabase
                  .from("payments")
                  .update(remoteRow)
                  .eq("organization_id", organizationId)
                  .eq("id", duplicateRow.id);
                if (duplicateUpdateError) throw duplicateUpdateError;
              } else {
                throw insertResult.error;
              }
            } else {
              throw insertResult.error;
            }
          }
        }

        if (extraRows.length) {
          const { error: cleanupError } = await supabase
            .from("payments")
            .update({
              status: "cancelled",
              notes: `Cancelled duplicate payment-in rows (${timestamp})`,
              updated_at: timestamp
            })
            .eq("organization_id", organizationId)
            .in(
              "id",
              extraRows.map((row) => row.id).filter(Boolean)
            );
          if (cleanupError) {
            throw cleanupError;
          }
        }
      } else if (matchingRows.length) {
        const { error: cancelError } = await supabase
          .from("payments")
          .update({
            status: "cancelled",
            notes: `Superseded by latest payment-in update (${timestamp})`,
            updated_at: timestamp
          })
          .eq("organization_id", organizationId)
          .ilike("reference_no", `${sourcePrefix}%`);
        if (cancelError) {
          throw cancelError;
        }
      }
    } catch (error) {
      if (!isPermissionLikeError(error)) {
        throw new Error(normalizeSupabaseError(error, "Failed to save payment-in row"));
      }
      savedLocallyOnly = true;
      remoteSyncMessage = normalizeSupabaseError(
        error,
        "Saved locally only because Supabase denied access"
      );
    }
  }

  mergeSourceRowsToLocalPayments(sourcePrefix, rows);
  console.log("[CreditMonitoring] Triggering notification check from syncPaymentInRemote", {
    paymentId: record?.id || null,
    status: record?.status || null,
    partyId: record?.customerId || null,
    postedRows: rows.length
  });
  await triggerCreditLimitNotifications();
  return { savedLocallyOnly, remoteSyncMessage };
}

export async function syncPaymentOutRemote(record) {
  if (!record) return;

  const organizationId = authGetOrganizationId();
  const actorUserId = authGetUser()?.id || null;
  const sourcePrefix = `PO:${record.id}:`;
  const shouldApply = String(record?.status || "").toLowerCase() === "applied";
  const shouldPost = String(record?.status || "").toLowerCase() !== "draft";
  let workingRecord = record;
  let rows = [];
  const partyId = record?.supplierId || null;
  const paymentDate = record?.paymentDate || "";
  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];
  const tdsAmount = Math.max(0, parseNumber(record?.totals?.tdsAmount ?? record?.tdsAmount));
  const tdsRate = Math.max(0, parseNumber(record?.tdsRate));

  async function buildRows(activeRecord) {
    const nextRows = [];
    if (shouldPost && shouldApply) {
      for (let index = 0; index < allocations.length; index += 1) {
        const line = allocations[index];
        const amount = Math.max(0, parseNumber(line?.applyAmount));
        if (!amount) continue;
        let billId = looksLikeUuid(line?.billId) ? line.billId : null;
        if (!billId && line?.billNo && organizationId) {
          billId = await findBillIdByNumber(organizationId, line.billNo);
        }
        nextRows.push({
          payment_no: buildRemotePaymentNo(activeRecord?.paymentNo || `PAY-${Date.now()}`, `${index + 1}`),
          payment_date: normalizePaymentDateOrNull(paymentDate),
          direction: "out",
          party_id: partyId,
          bill_id: billId || line?.billId || null,
          amount,
          tds_amount: index === 0 ? tdsAmount : 0,
          tds_rate: index === 0 ? tdsRate : 0,
          is_manual: index === 0 ? !!activeRecord?.isManual : false,
          payment_mode: activeRecord?.paymentMode || null,
          reference_no: `${sourcePrefix}${index + 1}`,
          notes:
            [
              activeRecord?.internalNotes || `Payment out ${activeRecord?.status || "paid"}`,
              index === 0 && tdsAmount > 0 ? `TDS ${tdsAmount.toFixed(2)}` : ""
            ]
              .filter(Boolean)
              .join(" | "),
          status: "posted"
        });
      }

      const unappliedAmount = Math.max(0, parseNumber(activeRecord?.totals?.unappliedAmount));
      if (unappliedAmount > 0) {
        nextRows.push({
          payment_no: buildRemotePaymentNo(activeRecord?.paymentNo || `PAY-${Date.now()}`, "UNAPPLIED"),
          payment_date: normalizePaymentDateOrNull(paymentDate),
          direction: "out",
          party_id: partyId,
          bill_id: null,
          amount: unappliedAmount,
          tds_amount: nextRows.length ? 0 : tdsAmount,
          tds_rate: nextRows.length ? 0 : tdsRate,
          is_manual: nextRows.length ? false : !!activeRecord?.isManual,
          payment_mode: activeRecord?.paymentMode || null,
          reference_no: `${sourcePrefix}UNAPPLIED`,
          notes:
            [
              activeRecord?.internalNotes || `Unapplied payment out ${activeRecord?.status || "paid"}`,
              !nextRows.length && tdsAmount > 0 ? `TDS ${tdsAmount.toFixed(2)}` : ""
            ]
              .filter(Boolean)
              .join(" | "),
          status: "posted"
        });
      }
    } else if (shouldPost) {
      const amountPaid = Math.max(0, parseNumber(activeRecord?.totals?.amountPaid ?? activeRecord?.amountPaid));
      if (amountPaid > 0) {
        nextRows.push({
          payment_no: buildRemotePaymentNo(activeRecord?.paymentNo || `PAY-${Date.now()}`, "PAID"),
          payment_date: normalizePaymentDateOrNull(paymentDate),
          direction: "out",
          party_id: partyId,
          bill_id: null,
          amount: amountPaid,
          tds_amount: tdsAmount,
          tds_rate: tdsRate,
          is_manual: !!activeRecord?.isManual,
          payment_mode: activeRecord?.paymentMode || null,
          reference_no: `${sourcePrefix}PAID`,
          notes:
            [activeRecord?.internalNotes || `Payment out ${activeRecord?.status || "paid"}`, tdsAmount > 0 ? `TDS ${tdsAmount.toFixed(2)}` : ""]
              .filter(Boolean)
              .join(" | "),
          status: "posted"
        });
      }
    }
    return nextRows;
  }

  rows = await buildRows(workingRecord);

  if (isSupabaseConfigured && supabase && organizationId) {
    const { error: cancelError } = await supabase
      .from("payments")
      .update({
        status: "cancelled",
        notes: `Superseded by latest payment-out update (${new Date().toISOString()})`,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId)
      .ilike("reference_no", `${sourcePrefix}%`);
    if (cancelError) {
      throw new Error(normalizeSupabaseError(cancelError, "Failed to archive previous payment-out rows"));
    }

    if (rows.length) {
      let remoteRows = rows.map((row) => ({
        ...row,
        organization_id: organizationId,
        party_id: looksLikeUuid(row?.party_id) ? row.party_id : null,
        invoice_id: looksLikeUuid(row?.invoice_id) ? row.invoice_id : null,
        bill_id: looksLikeUuid(row?.bill_id) ? row.bill_id : null,
        created_by: actorUserId
      }));
      let { error: insertError } = await supabase.from("payments").insert(remoteRows);
      if (insertError && isUniqueConstraintError(insertError)) {
        const nextPaymentNo = buildRetryPaymentNo(workingRecord?.paymentNo, workingRecord?.country);
        replaceLocalPaymentOutNumber(workingRecord?.id, nextPaymentNo);
        workingRecord = { ...workingRecord, paymentNo: nextPaymentNo };
        rows = await buildRows(workingRecord);
        remoteRows = rows.map((row) => ({
          ...row,
          organization_id: organizationId,
          party_id: looksLikeUuid(row?.party_id) ? row.party_id : null,
          invoice_id: looksLikeUuid(row?.invoice_id) ? row.invoice_id : null,
          bill_id: looksLikeUuid(row?.bill_id) ? row.bill_id : null,
          created_by: actorUserId
        }));
        ({ error: insertError } = await supabase.from("payments").insert(remoteRows));
      }
      if (insertError) {
        throw new Error(normalizeSupabaseError(insertError, "Failed to save payment-out rows"));
      }
    }
  }

  mergeSourceRowsToLocalPayments(sourcePrefix, rows);
  console.log("[CreditMonitoring] Triggering notification check from syncPaymentOutRemote", {
    paymentId: record?.id || null,
    status: record?.status || null,
    partyId: record?.supplierId || null,
    postedRows: rows.length
  });
  await triggerCreditLimitNotifications();
}

export async function deletePaymentInRemote(recordId) {
  const id = String(recordId || "").trim();
  if (!id) return;
  const sourcePrefix = `PI:${id}:`;
  const organizationId = authGetOrganizationId();

  if (isSupabaseConfigured && supabase && organizationId) {
    const { error } = await supabase
      .from("payments")
      .update({
        status: "cancelled",
        notes: `Cancelled from Payment In (${new Date().toISOString()})`,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId)
      .ilike("reference_no", `${sourcePrefix}%`);
    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to cancel payment-in rows"));
    }
  }

  mergeSourceRowsToLocalPayments(sourcePrefix, []);
  await triggerCreditLimitNotifications();
}

export async function deletePaymentOutRemote(recordId) {
  const id = String(recordId || "").trim();
  if (!id) return;
  const sourcePrefix = `PO:${id}:`;
  const organizationId = authGetOrganizationId();

  if (isSupabaseConfigured && supabase && organizationId) {
    const { error } = await supabase
      .from("payments")
      .update({
        status: "cancelled",
        notes: `Cancelled from Payment Out (${new Date().toISOString()})`,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId)
      .ilike("reference_no", `${sourcePrefix}%`);
    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to cancel payment-out rows"));
    }
  }

  mergeSourceRowsToLocalPayments(sourcePrefix, []);
  await triggerCreditLimitNotifications();
}
