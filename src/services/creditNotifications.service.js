import { authGetOrganizationId } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";

const CREDIT_NOTIFICATION_EVENT = "credit-notifications-updated";
const SYSTEM_ACTOR = "System";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function toSupabaseFailure(error, fallback) {
  const wrapped = new Error(normalizeSupabaseError(error, fallback));
  wrapped.code = error?.code || "";
  return wrapped;
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toIsoDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (text.length >= 10 && text[4] === "-" && text[7] === "-") return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizePartyType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "supplier" ? "supplier" : "customer";
}

function normalizeAlertType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "days" ? "days" : "amount";
}

function normalizeDocumentType(value, partyType) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bill") return "bill";
  if (normalized === "invoice") return "invoice";
  return normalizePartyType(partyType) === "supplier" ? "bill" : "invoice";
}

function normalizeLimitValue(value, alertType) {
  const numeric = Math.max(0, parseNumber(value));
  if (alertType === "days") return Math.trunc(numeric);
  return Number(numeric.toFixed(2));
}

function sortByDate(list) {
  return [...list].sort(
    (a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
  );
}

function normalizeAlertDetails(raw, alertType, limitValue, currentValue, partyType) {
  const base = raw && typeof raw === "object" ? raw : {};
  const exceededByDefault =
    alertType === "amount" ? Math.max(0, parseNumber(currentValue) - parseNumber(limitValue)) : 0;
  const overdueByDefault =
    alertType === "days" ? Math.max(0, parseNumber(currentValue) - parseNumber(limitValue)) : 0;

  return {
    documentId: String(base?.documentId || base?.document_id || "").trim(),
    documentNo: String(base?.documentNo || base?.document_no || "").trim(),
    documentType: normalizeDocumentType(base?.documentType || base?.document_type, partyType),
    documentDate: toIsoDate(base?.documentDate || base?.document_date),
    dueDate: toIsoDate(base?.dueDate || base?.due_date),
    lastDueDate: toIsoDate(base?.lastDueDate || base?.last_due_date || base?.dueDate || base?.due_date),
    pendingAmount: normalizeLimitValue(base?.pendingAmount ?? base?.pending_amount, "amount"),
    totalAmount: normalizeLimitValue(base?.totalAmount ?? base?.total_amount, "amount"),
    createdBy: String(base?.createdBy || base?.created_by || "").trim(),
    exceededBy: normalizeLimitValue(base?.exceededBy ?? base?.exceeded_by ?? exceededByDefault, "amount"),
    overdueDays: normalizeLimitValue(
      base?.overdueDays ?? base?.overdue_days ?? (alertType === "days" ? currentValue : 0),
      "days"
    ),
    overdueByDays: normalizeLimitValue(
      base?.overdueByDays ?? base?.overdue_by_days ?? overdueByDefault,
      "days"
    )
  };
}

function normalizeStoredRecord(raw) {
  const alertType = normalizeAlertType(raw?.alertType || raw?.alert_type);
  const partyType = normalizePartyType(raw?.partyType || raw?.party_type);
  const limitValue = normalizeLimitValue(raw?.limitValue ?? raw?.limit_value, alertType);
  const currentValue = normalizeLimitValue(raw?.currentValue ?? raw?.current_value, alertType);
  const details = normalizeAlertDetails(raw, alertType, limitValue, currentValue, partyType);
  return {
    id: raw?.id || uid("cnf_"),
    partyId: String(raw?.partyId || raw?.party_id || ""),
    partyName: String(raw?.partyName || raw?.party_name || raw?.parties?.display_name || "").trim(),
    partyType,
    alertType,
    limitValue,
    currentValue,
    ...details,
    isRead: !!(raw?.isRead ?? raw?.is_read),
    createdAt: toIso(raw?.createdAt || raw?.created_at)
  };
}

function toEpoch(dateValue) {
  const iso = toIsoDate(dateValue);
  if (!iso) return 0;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

function isOpenStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized !== "paid" && normalized !== "cancelled" && normalized !== "draft";
}

function resolveRecordNo(record, partyType) {
  const normalizedPartyType = normalizePartyType(partyType);
  const value =
    normalizedPartyType === "supplier"
      ? record?.billNumber || record?.billNo || record?.invoiceNo || record?.id
      : record?.invoiceNo || record?.billNumber || record?.id;
  return String(value || "").trim();
}

function resolveRecordDate(record, partyType) {
  const normalizedPartyType = normalizePartyType(partyType);
  const candidates =
    normalizedPartyType === "supplier"
      ? [record?.billDate, record?.bill_date, record?.date, record?.created_at]
      : [record?.invoiceDate, record?.invoice_date, record?.date, record?.created_at];
  for (const candidate of candidates) {
    const normalized = toIsoDate(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function resolveRecordDueDate(record, partyType) {
  const normalizedPartyType = normalizePartyType(partyType);
  const candidates =
    normalizedPartyType === "supplier"
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

function resolveRecordTotal(record, partyType) {
  const normalizedPartyType = normalizePartyType(partyType);
  if (normalizedPartyType === "supplier") {
    return Math.max(
      0,
      parseNumber(
        record?.totals?.finalTotal ??
          record?.totals?.grandTotal ??
          record?.totals?.total ??
          record?.totals?.subTotal ??
          record?.grandTotal ??
          record?.total ??
          record?.amount
      )
    );
  }
  return Math.max(
    0,
    parseNumber(
      record?.totals?.grandTotal ??
        record?.totals?.total ??
        record?.totals?.finalTotal ??
        record?.totals?.subTotal ??
        record?.grandTotal ??
        record?.total ??
        record?.amount
    )
  );
}

function resolveRecordOutstanding(record, fallbackTotal) {
  const explicitBalance = parseNumber(
    record?.totals?.balance ?? record?.remainingBalance ?? record?.balance
  );
  if (explicitBalance > 0) return explicitBalance;
  return Math.max(0, parseNumber(fallbackTotal));
}

function resolveRecordCreatedBy(record) {
  const value =
    record?.createdBy ||
    record?.createdByName ||
    record?.audit?.createdBy ||
    record?.metadata?.createdByName ||
    record?.created_by ||
    record?.createdByUserId;
  const text = String(value || "").trim();
  return text || SYSTEM_ACTOR;
}

function listPartyDocuments(partyId, partyType) {
  const normalizedPartyType = normalizePartyType(partyType);
  const sourceKey = normalizedPartyType === "supplier" ? LS_KEYS.purchases : LS_KEYS.invoices;
  const records = ensureArray(lsGetOrganizationScoped(sourceKey, []));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEpoch = today.getTime();

  return records
    .filter((record) => String(record?.partyId || "") === String(partyId || ""))
    .map((record) => {
      if (!isOpenStatus(record?.status || record?.paymentStatus)) return null;
      const totalAmount = resolveRecordTotal(record, normalizedPartyType);
      const pendingAmount = resolveRecordOutstanding(record, totalAmount);
      if (pendingAmount <= 0) return null;

      const dueDate = resolveRecordDueDate(record, normalizedPartyType);
      const dueEpoch = toEpoch(dueDate);
      const overdueDays =
        dueEpoch > 0 && dueEpoch < todayEpoch
          ? Math.floor((todayEpoch - dueEpoch) / (24 * 60 * 60 * 1000))
          : 0;

      return {
        documentId: String(record?.id || ""),
        documentNo: resolveRecordNo(record, normalizedPartyType),
        documentType: normalizedPartyType === "supplier" ? "bill" : "invoice",
        documentDate: resolveRecordDate(record, normalizedPartyType),
        dueDate,
        lastDueDate: dueDate,
        pendingAmount: normalizeLimitValue(pendingAmount, "amount"),
        totalAmount: normalizeLimitValue(totalAmount, "amount"),
        createdBy: resolveRecordCreatedBy(record),
        overdueDays: normalizeLimitValue(overdueDays, "days"),
        overdueByDays: 0,
        exceededBy: 0
      };
    })
    .filter(Boolean);
}

function pickLatestDocument(documents) {
  if (!documents.length) return null;
  return [...documents].sort((a, b) => {
    const aDate = toEpoch(a?.documentDate || a?.dueDate || "");
    const bDate = toEpoch(b?.documentDate || b?.dueDate || "");
    if (bDate !== aDate) return bDate - aDate;
    return parseNumber(b?.pendingAmount) - parseNumber(a?.pendingAmount);
  })[0];
}

function pickMostOverdueDocument(documents) {
  const overdueDocs = documents.filter((entry) => parseNumber(entry?.overdueDays) > 0);
  if (!overdueDocs.length) return null;
  return [...overdueDocs].sort((a, b) => {
    const overdueDiff = parseNumber(b?.overdueDays) - parseNumber(a?.overdueDays);
    if (overdueDiff !== 0) return overdueDiff;
    const aDue = toEpoch(a?.dueDate || "");
    const bDue = toEpoch(b?.dueDate || "");
    if (aDue !== bDue) return aDue - bDue;
    return parseNumber(b?.pendingAmount) - parseNumber(a?.pendingAmount);
  })[0];
}

function deriveContext(entry) {
  if (!entry?.partyId) return null;
  const documents = listPartyDocuments(entry.partyId, entry.partyType);
  if (!documents.length) return null;

  if (normalizeAlertType(entry.alertType) === "days") {
    const picked = pickMostOverdueDocument(documents);
    if (!picked) return null;
    const overdueByDays = Math.max(
      0,
      normalizeLimitValue(entry?.currentValue, "days") - normalizeLimitValue(entry?.limitValue, "days")
    );
    return {
      ...picked,
      overdueByDays: normalizeLimitValue(overdueByDays, "days")
    };
  }

  const picked = pickLatestDocument(documents);
  if (!picked) return null;
  const exceededBy = Math.max(
    0,
    normalizeLimitValue(entry?.currentValue, "amount") -
      normalizeLimitValue(entry?.limitValue, "amount")
  );
  return {
    ...picked,
    exceededBy: normalizeLimitValue(exceededBy, "amount")
  };
}

function enrichNotificationRecord(entry) {
  const base = normalizeStoredRecord(entry);
  const context = deriveContext(base);
  const alertType = normalizeAlertType(base.alertType);

  const merged = {
    ...base,
    documentId: base.documentId || context?.documentId || "",
    documentNo: base.documentNo || context?.documentNo || "",
    documentType: normalizeDocumentType(base.documentType || context?.documentType, base.partyType),
    documentDate: base.documentDate || context?.documentDate || "",
    dueDate: base.dueDate || context?.dueDate || "",
    lastDueDate: base.lastDueDate || base.dueDate || context?.lastDueDate || context?.dueDate || "",
    pendingAmount:
      parseNumber(base.pendingAmount) > 0
        ? normalizeLimitValue(base.pendingAmount, "amount")
        : normalizeLimitValue(context?.pendingAmount, "amount"),
    totalAmount:
      parseNumber(base.totalAmount) > 0
        ? normalizeLimitValue(base.totalAmount, "amount")
        : normalizeLimitValue(context?.totalAmount, "amount"),
    createdBy: String(base.createdBy || context?.createdBy || SYSTEM_ACTOR).trim()
  };

  if (alertType === "days") {
    const overdueDays =
      parseNumber(base.overdueDays) > 0
        ? normalizeLimitValue(base.overdueDays, "days")
        : normalizeLimitValue(base.currentValue, "days");
    return {
      ...merged,
      overdueDays,
      overdueByDays: normalizeLimitValue(
        parseNumber(base.overdueByDays) > 0
          ? base.overdueByDays
          : Math.max(0, overdueDays - normalizeLimitValue(base.limitValue, "days")),
        "days"
      ),
      exceededBy: normalizeLimitValue(base.exceededBy, "amount")
    };
  }

  const exceededBy =
    parseNumber(base.exceededBy) > 0
      ? normalizeLimitValue(base.exceededBy, "amount")
      : normalizeLimitValue(Math.max(0, base.currentValue - base.limitValue), "amount");
  return {
    ...merged,
    exceededBy,
    overdueDays: normalizeLimitValue(base.overdueDays, "days"),
    overdueByDays: normalizeLimitValue(base.overdueByDays, "days")
  };
}

function enrichNotificationList(list) {
  return ensureArray(list).map((entry) => enrichNotificationRecord(entry));
}

function localList() {
  const stored = ensureArray(lsGetOrganizationScoped(LS_KEYS.credit_notifications, []));
  const normalized = sortByDate(stored).map(normalizeStoredRecord);
  return enrichNotificationList(normalized);
}

function emitNotificationUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CREDIT_NOTIFICATION_EVENT));
}

function setLocalList(list, options = {}) {
  const shouldEmit = options.emit !== false;
  lsSetOrganizationScoped(LS_KEYS.credit_notifications, sortByDate(ensureArray(list)).slice(0, 500));
  if (shouldEmit) emitNotificationUpdate();
}

function hasRemoteConnection() {
  return !!(isSupabaseConfigured && supabase && authGetOrganizationId());
}

async function ensureOwnerMembershipIfPossible(organizationId) {
  if (!supabase || !organizationId) return false;
  const { error } = await supabase.rpc("ensure_owner_membership", {
    p_organization_id: organizationId
  });
  if (!error) return true;
  if (error?.code === "PGRST202") return false;
  return false;
}

function candidateKey(item) {
  return `${String(item?.partyId || "")}::${normalizeAlertType(item?.alertType)}`;
}

function normalizeEvaluation(raw) {
  if (!raw?.partyId) return null;
  const partyType = normalizePartyType(raw?.partyType);
  const amountLimit = normalizeLimitValue(raw?.amount?.limitValue, "amount");
  const amountCurrent = normalizeLimitValue(raw?.amount?.currentValue, "amount");
  const daysLimit = normalizeLimitValue(raw?.days?.limitValue, "days");
  const daysCurrent = normalizeLimitValue(raw?.days?.currentValue, "days");
  return {
    partyId: String(raw.partyId),
    partyName: String(raw?.partyName || "").trim(),
    partyType,
    monitoringEnabled: !!raw?.monitoringEnabled,
    amount: {
      exceeded: !!raw?.amount?.exceeded,
      limitValue: amountLimit,
      currentValue: amountCurrent,
      details: normalizeAlertDetails(raw?.amount?.details || raw?.amount?.context, "amount", amountLimit, amountCurrent, partyType)
    },
    days: {
      exceeded: !!raw?.days?.exceeded,
      limitValue: daysLimit,
      currentValue: daysCurrent,
      details: normalizeAlertDetails(raw?.days?.details || raw?.days?.context, "days", daysLimit, daysCurrent, partyType)
    }
  };
}

function buildCandidates(evaluations) {
  const candidates = [];
  evaluations.forEach((entry) => {
    if (!entry.monitoringEnabled) return;
    if (entry.amount.exceeded && entry.amount.limitValue > 0) {
      candidates.push({
        partyId: entry.partyId,
        partyName: entry.partyName,
        partyType: entry.partyType,
        alertType: "amount",
        limitValue: entry.amount.limitValue,
        currentValue: entry.amount.currentValue,
        ...(entry.amount.details || {})
      });
    }
    if (entry.days.exceeded && entry.days.limitValue > 0) {
      candidates.push({
        partyId: entry.partyId,
        partyName: entry.partyName,
        partyType: entry.partyType,
        alertType: "days",
        limitValue: entry.days.limitValue,
        currentValue: entry.days.currentValue,
        ...(entry.days.details || {})
      });
    }
  });
  return candidates;
}

async function ensureRemoteNotification(candidate) {
  const organizationId = authGetOrganizationId();
  const alertType = normalizeAlertType(candidate.alertType);
  const partyType = normalizePartyType(candidate.partyType);
  const notificationPayload = {
    party_type: partyType,
    alert_type: alertType,
    limit_value: candidate.limitValue,
    current_value: candidate.currentValue,
    is_read: false,
    created_at: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: unreadRow, error: unreadError } = await supabase
      .from("credit_monitor_notifications")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("party_id", candidate.partyId)
      .eq("alert_type", alertType)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (unreadError) {
      if (attempt === 0 && unreadError?.code === "42501") {
        const repaired = await ensureOwnerMembershipIfPossible(organizationId);
        if (repaired) continue;
      }
      throw toSupabaseFailure(unreadError, "Failed to check unread credit notification");
    }

    if (unreadRow?.id) {
      const { error: updateUnreadError } = await supabase
        .from("credit_monitor_notifications")
        .update(notificationPayload)
        .eq("organization_id", organizationId)
        .eq("id", unreadRow.id);
      if (updateUnreadError) {
        if (attempt === 0 && updateUnreadError?.code === "42501") {
          const repaired = await ensureOwnerMembershipIfPossible(organizationId);
          if (repaired) continue;
        }
        throw toSupabaseFailure(updateUnreadError, "Failed to refresh unread credit notification");
      }
      console.log("[CreditMonitoring] Existing unread notification refreshed", {
        partyId: candidate.partyId,
        alertType
      });
      return { created: false, reason: "updated_unread" };
    }

    const { error: insertError } = await supabase.from("credit_monitor_notifications").insert({
      organization_id: organizationId,
      party_id: candidate.partyId,
      ...notificationPayload
    });

    if (insertError) {
      if (attempt === 0 && insertError?.code === "42501") {
        const repaired = await ensureOwnerMembershipIfPossible(organizationId);
        if (repaired) continue;
      }
      if (insertError?.code === "23505") {
        const { data: existingRow, error: existingError } = await supabase
          .from("credit_monitor_notifications")
          .select("id,is_read")
          .eq("organization_id", organizationId)
          .eq("party_id", candidate.partyId)
          .eq("alert_type", alertType)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) {
          throw toSupabaseFailure(existingError, "Failed to resolve duplicate credit notification");
        }
        if (existingRow?.id) {
          const { error: adoptError } = await supabase
            .from("credit_monitor_notifications")
            .update(notificationPayload)
            .eq("organization_id", organizationId)
            .eq("id", existingRow.id);
          if (adoptError) {
            throw toSupabaseFailure(adoptError, "Failed to reconcile duplicate credit notification");
          }
          console.log("[CreditMonitoring] Duplicate notification reconciled", {
            partyId: candidate.partyId,
            alertType
          });
          return { created: false, reason: "reconciled_duplicate" };
        }
      }
      throw toSupabaseFailure(insertError, "Failed to create credit notification");
    }

    console.log("[CreditMonitoring] Notification created", {
      partyId: candidate.partyId,
      alertType,
      limitValue: candidate.limitValue,
      currentValue: candidate.currentValue
    });
    return { created: true, reason: "inserted" };
  }

  throw new Error("Failed to create credit notification");
}

function ensureLocalNotification(candidate) {
  const list = localList();
  const existingUnread = list.find(
    (entry) =>
      !entry.isRead &&
      String(entry.partyId) === String(candidate.partyId) &&
      normalizeAlertType(entry.alertType) === normalizeAlertType(candidate.alertType)
  );

  const candidateRecord = normalizeStoredRecord({
    ...candidate,
    partyType: normalizePartyType(candidate.partyType),
    alertType: normalizeAlertType(candidate.alertType)
  });

  const rotated = existingUnread
    ? list.map((entry) => (entry.id === existingUnread.id ? { ...entry, isRead: true } : entry))
    : list;

  const next = [
    {
      ...candidateRecord,
      id: uid("cnf_"),
      isRead: false,
      createdAt: new Date().toISOString()
    },
    ...rotated
  ];
  setLocalList(next);
  console.log("[CreditMonitoring] Local notification created", {
    partyId: candidate.partyId,
    alertType: candidate.alertType
  });
  return { created: true, reason: "inserted" };
}

function mergeCandidateContext(records, candidates) {
  const byKey = new Map();
  ensureArray(candidates).forEach((candidate) => {
    byKey.set(candidateKey(candidate), candidate);
  });
  if (!byKey.size) return records;
  return records.map((record) => {
    const candidate = byKey.get(candidateKey(record));
    if (!candidate) return record;
    return enrichNotificationRecord({
      ...record,
      ...candidate,
      id: record.id,
      createdAt: record.createdAt,
      isRead: record.isRead
    });
  });
}

export const CREDIT_NOTIFICATION_EVENT_NAME = CREDIT_NOTIFICATION_EVENT;

export function listCreditNotificationsCached() {
  return localList();
}

export async function syncCreditNotificationsFromRemote() {
  const local = localList();
  if (!hasRemoteConnection()) return local;

  const organizationId = authGetOrganizationId();
  let data = null;
  let error = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await supabase
      .from("credit_monitor_notifications")
      .select(
        "id,party_id,party_type,alert_type,limit_value,current_value,is_read,created_at,parties(display_name)"
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    data = result?.data || null;
    error = result?.error || null;
    if (!error) break;
    if (attempt === 0 && error?.code === "42501") {
      const repaired = await ensureOwnerMembershipIfPossible(organizationId);
      if (repaired) continue;
    }
    break;
  }

  if (error) {
    throw toSupabaseFailure(error, "Failed to load credit notifications");
  }

  const mapped = ensureArray(data).map((row) =>
    normalizeStoredRecord({
      ...row,
      party_name: row?.parties?.display_name || ""
    })
  );
  setLocalList(mapped, { emit: false });
  return localList();
}

export async function markCreditNotificationRead(id) {
  if (!id) return;

  const next = localList().map((entry) =>
    String(entry.id) === String(id) ? { ...entry, isRead: true } : entry
  );
  setLocalList(next);

  if (!hasRemoteConnection()) return;

  const organizationId = authGetOrganizationId();
  const { error } = await supabase
    .from("credit_monitor_notifications")
    .update({ is_read: true })
    .eq("organization_id", organizationId)
    .eq("id", id);

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to mark notification as read"));
  }
}

export async function markAllCreditNotificationsRead() {
  const next = localList().map((entry) => ({ ...entry, isRead: true }));
  setLocalList(next);

  if (!hasRemoteConnection()) return;

  const organizationId = authGetOrganizationId();
  const { error } = await supabase
    .from("credit_monitor_notifications")
    .update({ is_read: true })
    .eq("organization_id", organizationId)
    .eq("is_read", false);

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to mark notifications as read"));
  }
}

export async function syncCreditMonitoringNotifications(evaluations, options = {}) {
  const source = String(options?.source || "unknown");
  const normalized = ensureArray(evaluations).map(normalizeEvaluation).filter(Boolean);
  const candidates = buildCandidates(normalized);

  console.log("[CreditMonitoring] Notification evaluation started", {
    source,
    evaluations: normalized.length,
    candidates: candidates.length,
    remote: hasRemoteConnection()
  });

  if (!candidates.length) {
    return hasRemoteConnection() ? syncCreditNotificationsFromRemote() : localList();
  }

  if (hasRemoteConnection()) {
    try {
      for (const candidate of candidates) {
        await ensureRemoteNotification(candidate);
      }
      const synced = await syncCreditNotificationsFromRemote();
      const merged = mergeCandidateContext(synced, candidates);
      // Emit once so UI (bell/panel/page) updates immediately after invoice save.
      setLocalList(merged, { emit: true });
      return merged;
    } catch (error) {
      console.warn("Credit notification remote sync failed, using local fallback", error);
    }
  }

  const deduped = new Map();
  candidates.forEach((candidate) => {
    deduped.set(candidateKey(candidate), candidate);
  });
  deduped.forEach((candidate) => {
    ensureLocalNotification(candidate);
  });
  return localList();
}
