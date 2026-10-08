import { authGetOrganizationId, authGetToken } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";

const STOCK_NOTIFICATION_EVENT = "stock-notifications-updated";
const STOCK_ALERT_TYPE = "low_stock";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_LIMIT = 500;

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return nowIso();
  return parsed.toISOString();
}

function sortByDate(list) {
  return [...ensureArray(list)].sort(
    (a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
  );
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function isMissingTableError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    (message.includes("does not exist") && message.includes("inventory_notifications"))
  );
}

function isMissingRelationError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "PGRST200" ||
    code === "PGRST201" ||
    (message.includes("relationship") && message.includes("inventory_notifications"))
  );
}

function candidateKey(entry) {
  return `${String(entry?.itemId || "").trim()}::${STOCK_ALERT_TYPE}`;
}

function normalizeStoredRecord(raw) {
  const snapshot = raw?.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {};
  const joinedItem = Array.isArray(raw?.items) ? raw.items[0] || {} : raw?.items || {};
  const itemId = String(raw?.itemId || raw?.item_id || "").trim();
  const createdAt = toIso(raw?.createdAt || raw?.created_at);
  const updatedAt = toIso(raw?.updatedAt || raw?.updated_at || createdAt);
  return {
    id: raw?.id || uid("snf_"),
    notificationType: "stock",
    alertType: STOCK_ALERT_TYPE,
    itemId,
    itemName: String(
      raw?.itemName ||
        raw?.item_name ||
        snapshot?.itemName ||
        snapshot?.item_name ||
        joinedItem?.item_name ||
        joinedItem?.itemName ||
        ""
    ).trim(),
    itemCode: String(
      raw?.itemCode ||
        raw?.item_code ||
        snapshot?.itemCode ||
        snapshot?.item_code ||
        joinedItem?.item_code ||
        joinedItem?.itemCode ||
        ""
    ).trim(),
    limitValue: Math.max(0, parseNumber(raw?.limitValue ?? raw?.limit_value)),
    currentValue: Math.max(0, parseNumber(raw?.currentValue ?? raw?.current_value)),
    country: String(raw?.country || snapshot?.country || "").trim(),
    isRead: !!(raw?.isRead ?? raw?.is_read),
    isActive: raw?.isActive ?? raw?.is_active ?? true,
    createdAt,
    updatedAt,
    link: "/app/items"
  };
}

function normalizeEvaluation(raw) {
  const itemId = String(raw?.itemId || "").trim();
  if (!itemId) return null;
  const limitValue = Math.max(0, parseNumber(raw?.limitValue));
  const currentValue = Math.max(0, parseNumber(raw?.currentValue));
  const exceeded = raw?.exceeded === true || (limitValue > 0 && currentValue <= limitValue);
  return {
    itemId,
    itemName: String(raw?.itemName || "").trim(),
    itemCode: String(raw?.itemCode || "").trim(),
    limitValue,
    currentValue,
    exceeded,
    country: String(raw?.country || "").trim()
  };
}

function mergeStateIntoRecord(existing, state) {
  const previous = existing ? normalizeStoredRecord(existing) : null;
  const createdAt = previous?.createdAt || nowIso();
  return normalizeStoredRecord({
    id: previous?.id || uid("snf_"),
    item_id: state.itemId,
    item_name: state.itemName || previous?.itemName || "",
    item_code: state.itemCode || previous?.itemCode || "",
    limit_value: state.limitValue,
    current_value: state.currentValue,
    country: state.country || previous?.country || "",
    is_read: previous?.isRead || false,
    is_active: true,
    created_at: createdAt,
    updated_at: nowIso(),
    snapshot: {
      itemName: state.itemName || previous?.itemName || "",
      itemCode: state.itemCode || previous?.itemCode || "",
      country: state.country || previous?.country || ""
    }
  });
}

function nextActiveFromStates(existingList, states) {
  const existingByKey = new Map();
  ensureArray(existingList).forEach((entry) => {
    const normalized = normalizeStoredRecord(entry);
    if (!normalized.itemId || normalized.isActive === false) return;
    existingByKey.set(candidateKey(normalized), normalized);
  });

  const next = [];
  ensureArray(states).forEach((state) => {
    if (!state?.itemId || state.exceeded !== true) return;
    const key = candidateKey(state);
    next.push(mergeStateIntoRecord(existingByKey.get(key), state));
  });
  return sortByDate(next);
}

function normalizeForStorage(list) {
  return sortByDate(ensureArray(list))
    .map(normalizeStoredRecord)
    .filter((entry) => entry.itemId && entry.isActive !== false)
    .slice(0, LOCAL_LIMIT);
}

function emitNotificationUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STOCK_NOTIFICATION_EVENT));
}

function localList() {
  const stored = ensureArray(lsGetOrganizationScoped(LS_KEYS.stock_notifications, []));
  return normalizeForStorage(stored);
}

function setLocalList(list, options = {}) {
  const next = normalizeForStorage(list);
  try {
    lsSetOrganizationScoped(LS_KEYS.stock_notifications, next);
  } catch (error) {
    console.warn("[StockMonitoring] Failed to persist local stock notifications", error);
  }
  if (options.emit !== false) emitNotificationUpdate();
}

function hasRemoteConnection() {
  const organizationId = authGetOrganizationId();
  const token = authGetToken();
  return !!(isSupabaseConfigured && supabase && looksLikeUuid(organizationId) && token);
}

async function fetchRemoteActiveRows(organizationId) {
  let data = null;
  let error = null;

  const withJoin = await supabase
    .from("inventory_notifications")
    .select("id,item_id,alert_type,limit_value,current_value,is_read,is_active,created_at,updated_at,snapshot,items(item_name,item_code)")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  data = withJoin?.data || null;
  error = withJoin?.error || null;

  if (error && isMissingRelationError(error)) {
    const fallback = await supabase
      .from("inventory_notifications")
      .select("id,item_id,alert_type,limit_value,current_value,is_read,is_active,created_at,updated_at,snapshot")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    data = fallback?.data || null;
    error = fallback?.error || null;
  }

  if (error) throw error;
  return ensureArray(data);
}

function hasMeaningfulRemoteChange(row, state) {
  const currentLimit = Math.max(0, parseNumber(row?.limit_value));
  const currentValue = Math.max(0, parseNumber(row?.current_value));
  const snapshot = row?.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const nameChanged = String(snapshot?.itemName || "").trim() !== String(state.itemName || "").trim();
  const codeChanged = String(snapshot?.itemCode || "").trim() !== String(state.itemCode || "").trim();
  return (
    Math.abs(currentLimit - state.limitValue) > 0.0001 ||
    Math.abs(currentValue - state.currentValue) > 0.0001 ||
    nameChanged ||
    codeChanged
  );
}

function mergeLists(listA, listB) {
  const merged = new Map();
  [...ensureArray(listA), ...ensureArray(listB)].forEach((entry) => {
    const normalized = normalizeStoredRecord(entry);
    if (!normalized.itemId || normalized.isActive === false) return;
    merged.set(candidateKey(normalized), normalized);
  });
  return sortByDate([...merged.values()]);
}

async function syncRemoteStates(states) {
  const organizationId = authGetOrganizationId();
  const remoteRows = await fetchRemoteActiveRows(organizationId);
  const remoteByKey = new Map();
  remoteRows.forEach((row) => {
    const itemId = String(row?.item_id || "").trim();
    if (!itemId) return;
    remoteByKey.set(`${itemId}::${STOCK_ALERT_TYPE}`, row);
  });

  const stateByKey = new Map();
  ensureArray(states).forEach((state) => {
    stateByKey.set(candidateKey(state), state);
  });

  const rowsToResolve = [];
  const rowsToUpdate = [];
  const rowsToInsert = [];

  remoteRows.forEach((row) => {
    const key = `${String(row?.item_id || "").trim()}::${STOCK_ALERT_TYPE}`;
    const state = stateByKey.get(key);
    if (!state || state.exceeded !== true) {
      rowsToResolve.push(row);
      return;
    }
    if (hasMeaningfulRemoteChange(row, state)) {
      rowsToUpdate.push({ row, state });
    }
  });

  ensureArray(states).forEach((state) => {
    if (!state?.itemId || state.exceeded !== true) return;
    const key = candidateKey(state);
    if (!remoteByKey.has(key)) rowsToInsert.push(state);
  });

  if (rowsToResolve.length) {
    const resolveIds = rowsToResolve.map((row) => row.id).filter(Boolean);
    if (resolveIds.length) {
      const { error } = await supabase
        .from("inventory_notifications")
        .update({
          is_active: false,
          updated_at: nowIso()
        })
        .eq("organization_id", organizationId)
        .in("id", resolveIds);
      if (error) throw error;
    }
  }

  for (const entry of rowsToUpdate) {
    const { row, state } = entry;
    const { error } = await supabase
      .from("inventory_notifications")
      .update({
        limit_value: state.limitValue,
        current_value: state.currentValue,
        snapshot: {
          itemName: state.itemName,
          itemCode: state.itemCode,
          country: state.country
        },
        updated_at: nowIso()
      })
      .eq("organization_id", organizationId)
      .eq("id", row.id);
    if (error) throw error;
  }

  if (rowsToInsert.length) {
    const inserts = rowsToInsert.map((state) => ({
      organization_id: organizationId,
      item_id: state.itemId,
      alert_type: STOCK_ALERT_TYPE,
      limit_value: state.limitValue,
      current_value: state.currentValue,
      is_read: false,
      is_active: true,
      snapshot: {
        itemName: state.itemName,
        itemCode: state.itemCode,
        country: state.country
      }
    }));
    const { error } = await supabase.from("inventory_notifications").insert(inserts);
    if (error) throw error;
  }
}

export const STOCK_NOTIFICATION_EVENT_NAME = STOCK_NOTIFICATION_EVENT;

export function listStockNotificationsCached() {
  return localList();
}

export async function syncStockNotificationsFromRemote() {
  const cached = localList();
  if (!hasRemoteConnection()) return cached;

  const organizationId = authGetOrganizationId();
  try {
    const rows = await fetchRemoteActiveRows(organizationId);
    const mapped = rows.map((row) =>
      normalizeStoredRecord({
        ...row,
        item_id: row?.item_id,
        limit_value: row?.limit_value,
        current_value: row?.current_value
      })
    );
    setLocalList(mapped, { emit: false });
    return localList();
  } catch (error) {
    if (isMissingTableError(error)) return cached;
    throw new Error(normalizeSupabaseError(error, "Failed to load stock notifications"));
  }
}

export async function markStockNotificationRead(id) {
  if (!id) return;

  const next = localList().map((entry) =>
    String(entry.id) === String(id) ? { ...entry, isRead: true } : entry
  );
  setLocalList(next);

  if (!hasRemoteConnection() || !looksLikeUuid(id)) return;
  const organizationId = authGetOrganizationId();
  const { error } = await supabase
    .from("inventory_notifications")
    .update({ is_read: true, updated_at: nowIso() })
    .eq("organization_id", organizationId)
    .eq("id", id);

  if (error && !isMissingTableError(error)) {
    throw new Error(normalizeSupabaseError(error, "Failed to mark stock notification as read"));
  }
}

export async function markAllStockNotificationsRead() {
  const next = localList().map((entry) => ({ ...entry, isRead: true }));
  setLocalList(next);

  if (!hasRemoteConnection()) return;
  const organizationId = authGetOrganizationId();
  const { error } = await supabase
    .from("inventory_notifications")
    .update({ is_read: true, updated_at: nowIso() })
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_read", false);

  if (error && !isMissingTableError(error)) {
    throw new Error(normalizeSupabaseError(error, "Failed to mark stock notifications as read"));
  }
}

export async function syncLowStockNotifications(evaluations, options = {}) {
  const source = String(options?.source || "unknown");
  const normalizedStates = ensureArray(evaluations).map(normalizeEvaluation).filter(Boolean);
  const dedupedByKey = new Map();
  normalizedStates.forEach((state) => {
    dedupedByKey.set(candidateKey(state), state);
  });
  const states = [...dedupedByKey.values()];

  const existing = localList();
  const localOnlyStates = states.filter((state) => !looksLikeUuid(state?.itemId));
  const remoteStates = states.filter((state) => looksLikeUuid(state?.itemId));
  const existingLocalOnly = existing.filter((entry) => !looksLikeUuid(entry?.itemId));
  const nextLocalOnlyActive = nextActiveFromStates(existingLocalOnly, localOnlyStates);

  if (!hasRemoteConnection()) {
    const nextActive = nextActiveFromStates(existing, states);
    setLocalList(nextActive, { emit: true });
    return nextActive;
  }

  try {
    await syncRemoteStates(remoteStates);
    const remoteActive = await syncStockNotificationsFromRemote();
    const merged = mergeLists(remoteActive, nextLocalOnlyActive);
    setLocalList(merged, { emit: true });
    return merged;
  } catch (error) {
    if (isMissingTableError(error)) {
      const nextActive = nextActiveFromStates(existing, states);
      setLocalList(nextActive, { emit: true });
      return nextActive;
    }
    console.warn("[StockMonitoring] Remote sync failed. Falling back to local cache.", {
      source,
      error
    });
    const nextFallback = nextActiveFromStates(existing, states);
    setLocalList(nextFallback, { emit: true });
    return nextFallback;
  }
}
