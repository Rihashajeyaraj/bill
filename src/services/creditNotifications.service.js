import { authGetOrganizationId } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";

const CREDIT_NOTIFICATION_EVENT = "credit-notifications-updated";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
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

function normalizePartyType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "supplier" ? "supplier" : "customer";
}

function normalizeAlertType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "days" ? "days" : "amount";
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

function normalizeStoredRecord(raw) {
  const alertType = normalizeAlertType(raw?.alertType || raw?.alert_type);
  return {
    id: raw?.id || uid("cnf_"),
    partyId: String(raw?.partyId || raw?.party_id || ""),
    partyName: String(raw?.partyName || raw?.party_name || raw?.parties?.display_name || "").trim(),
    partyType: normalizePartyType(raw?.partyType || raw?.party_type),
    alertType,
    limitValue: normalizeLimitValue(raw?.limitValue ?? raw?.limit_value, alertType),
    currentValue: normalizeLimitValue(raw?.currentValue ?? raw?.current_value, alertType),
    isRead: !!(raw?.isRead ?? raw?.is_read),
    createdAt: toIso(raw?.createdAt || raw?.created_at)
  };
}

function localList() {
  return sortByDate(ensureArray(lsGetOrganizationScoped(LS_KEYS.credit_notifications, [])).map(normalizeStoredRecord));
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

function candidateKey(item) {
  return `${String(item?.partyId || "")}::${normalizeAlertType(item?.alertType)}`;
}

function normalizeEvaluation(raw) {
  if (!raw?.partyId) return null;
  const partyType = normalizePartyType(raw?.partyType);
  return {
    partyId: String(raw.partyId),
    partyName: String(raw?.partyName || "").trim(),
    partyType,
    monitoringEnabled: !!raw?.monitoringEnabled,
    amount: {
      exceeded: !!raw?.amount?.exceeded,
      limitValue: normalizeLimitValue(raw?.amount?.limitValue, "amount"),
      currentValue: normalizeLimitValue(raw?.amount?.currentValue, "amount")
    },
    days: {
      exceeded: !!raw?.days?.exceeded,
      limitValue: normalizeLimitValue(raw?.days?.limitValue, "days"),
      currentValue: normalizeLimitValue(raw?.days?.currentValue, "days")
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
        currentValue: entry.amount.currentValue
      });
    }
    if (entry.days.exceeded && entry.days.limitValue > 0) {
      candidates.push({
        partyId: entry.partyId,
        partyName: entry.partyName,
        partyType: entry.partyType,
        alertType: "days",
        limitValue: entry.days.limitValue,
        currentValue: entry.days.currentValue
      });
    }
  });
  return candidates;
}

async function ensureRemoteNotification(candidate) {
  const organizationId = authGetOrganizationId();
  const alertType = normalizeAlertType(candidate.alertType);
  const partyType = normalizePartyType(candidate.partyType);

  const { data: unreadRow, error: unreadError } = await supabase
    .from("credit_monitor_notifications")
    .select("id,current_value,limit_value")
    .eq("organization_id", organizationId)
    .eq("party_id", candidate.partyId)
    .eq("alert_type", alertType)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (unreadError) {
    throw new Error(normalizeSupabaseError(unreadError, "Failed to check unread credit notification"));
  }

  if (unreadRow?.id) {
    const { error: updateError } = await supabase
      .from("credit_monitor_notifications")
      .update({
        current_value: candidate.currentValue,
        limit_value: candidate.limitValue,
        party_type: partyType
      })
      .eq("organization_id", organizationId)
      .eq("id", unreadRow.id);
    if (updateError) {
      throw new Error(normalizeSupabaseError(updateError, "Failed to refresh unread credit notification"));
    }
    console.log("[CreditMonitoring] Unread notification already exists, skipping insert", {
      partyId: candidate.partyId,
      alertType
    });
    return { created: false, reason: "existing_unread" };
  }

  const { error: insertError } = await supabase.from("credit_monitor_notifications").insert({
    organization_id: organizationId,
    party_id: candidate.partyId,
    party_type: partyType,
    alert_type: alertType,
    limit_value: candidate.limitValue,
    current_value: candidate.currentValue,
    is_read: false
  });

  if (insertError) {
    throw new Error(normalizeSupabaseError(insertError, "Failed to create credit notification"));
  }

  console.log("[CreditMonitoring] Notification created", {
    partyId: candidate.partyId,
    alertType,
    limitValue: candidate.limitValue,
    currentValue: candidate.currentValue
  });
  return { created: true, reason: "inserted" };
}

function ensureLocalNotification(candidate) {
  const list = localList();
  const existingUnread = list.find(
    (entry) =>
      !entry.isRead &&
      String(entry.partyId) === String(candidate.partyId) &&
      normalizeAlertType(entry.alertType) === normalizeAlertType(candidate.alertType)
  );

  if (existingUnread) {
    const next = list.map((entry) =>
      entry.id === existingUnread.id
        ? {
            ...entry,
            partyName: candidate.partyName || entry.partyName,
            partyType: normalizePartyType(candidate.partyType),
            limitValue: candidate.limitValue,
            currentValue: candidate.currentValue
          }
        : entry
    );
    setLocalList(next);
    console.log("[CreditMonitoring] Local unread notification exists, skipping insert", {
      partyId: candidate.partyId,
      alertType: candidate.alertType
    });
    return { created: false, reason: "existing_unread" };
  }

  const next = [
    {
      id: uid("cnf_"),
      partyId: candidate.partyId,
      partyName: candidate.partyName || "",
      partyType: normalizePartyType(candidate.partyType),
      alertType: normalizeAlertType(candidate.alertType),
      limitValue: candidate.limitValue,
      currentValue: candidate.currentValue,
      isRead: false,
      createdAt: new Date().toISOString()
    },
    ...list
  ];
  setLocalList(next);
  console.log("[CreditMonitoring] Local notification created", {
    partyId: candidate.partyId,
    alertType: candidate.alertType
  });
  return { created: true, reason: "inserted" };
}

export const CREDIT_NOTIFICATION_EVENT_NAME = CREDIT_NOTIFICATION_EVENT;

export function listCreditNotificationsCached() {
  return localList();
}

export async function syncCreditNotificationsFromRemote() {
  const local = localList();
  if (!hasRemoteConnection()) return local;

  const organizationId = authGetOrganizationId();
  const { data, error } = await supabase
    .from("credit_monitor_notifications")
    .select(
      "id,party_id,party_type,alert_type,limit_value,current_value,is_read,created_at,parties(display_name)"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load credit notifications"));
  }

  const mapped = ensureArray(data).map((row) =>
    normalizeStoredRecord({
      ...row,
      party_name: row?.parties?.display_name || ""
    })
  );
  setLocalList(mapped, { emit: false });
  return mapped;
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
    for (const candidate of candidates) {
      await ensureRemoteNotification(candidate);
    }
    return syncCreditNotificationsFromRemote();
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
