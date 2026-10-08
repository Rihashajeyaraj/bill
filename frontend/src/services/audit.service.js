import { authGetOrganizationId, authGetRole } from "./auth.service";
import { canAccessSettings } from "./roles";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const ACTIONS = new Set(["INSERT", "UPDATE", "DELETE"]);

function normalizeAction(value) {
  const action = String(value || "")
    .trim()
    .toUpperCase();
  return ACTIONS.has(action) ? action : "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function dateStartToIso(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function dateEndExclusiveToIso(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + 1);
  return parsed.toISOString();
}

function mapAuditRow(row) {
  return {
    id: row?.id || "",
    tableName: row?.table_name || "",
    recordId: row?.record_id || "",
    action: row?.action || "",
    actorUserId: row?.actor_user_id || "",
    beforeData: row?.before_data || null,
    afterData: row?.after_data || null,
    happenedAt: row?.happened_at || ""
  };
}

function ensureOwner() {
  if (!canAccessSettings(authGetRole())) {
    throw new Error("Only owner can view audit history.");
  }
}

function ensureOrgId(inputOrgId = "") {
  const orgId = normalizeText(inputOrgId) || normalizeText(authGetOrganizationId());
  if (!orgId) throw new Error("Organization is required.");
  return orgId;
}

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    return false;
  }
  return true;
}

export async function listAuditEvents(filters = {}) {
  ensureOwner();
  const organizationId = ensureOrgId(filters.organizationId);
  if (!ensureSupabase()) return [];

  const tableName = normalizeText(filters.tableName);
  const action = normalizeAction(filters.action);
  const actorUserIdRaw = normalizeText(filters.actorUserId);
  const actorUserId = actorUserIdRaw.toLowerCase() === "system" ? "system" : actorUserIdRaw;
  const fromIso = dateStartToIso(filters.fromDate);
  const toIsoExclusive = dateEndExclusiveToIso(filters.toDate);
  const safeLimit = Math.min(1000, Math.max(1, Number(filters.limit || 200)));

  let query = supabase
    .from("audit_events")
    .select("id,table_name,record_id,action,actor_user_id,before_data,after_data,happened_at")
    .eq("organization_id", organizationId)
    .order("happened_at", { ascending: false })
    .limit(safeLimit);

  if (tableName) query = query.eq("table_name", tableName);
  if (action) query = query.eq("action", action);
  if (actorUserId) {
    query =
      actorUserId === "system"
        ? query.is("actor_user_id", null)
        : query.eq("actor_user_id", actorUserId);
  }
  if (fromIso) query = query.gte("happened_at", fromIso);
  if (toIsoExclusive) query = query.lt("happened_at", toIsoExclusive);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || "Failed to load audit history.");
  }
  return (Array.isArray(data) ? data : []).map(mapAuditRow);
}

export async function listAuditFilterOptions(options = {}) {
  ensureOwner();
  const organizationId = ensureOrgId(options.organizationId);
  if (!ensureSupabase()) {
    return { tableNames: [], userIds: [], hasSystemActor: false };
  }

  const safeLimit = Math.min(5000, Math.max(1, Number(options.limit || 2000)));
  const { data, error } = await supabase
    .from("audit_events")
    .select("table_name,actor_user_id")
    .eq("organization_id", organizationId)
    .order("happened_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message || "Failed to load audit filter options.");
  }

  const tableSet = new Set();
  const userSet = new Set();
  let hasSystemActor = false;

  (Array.isArray(data) ? data : []).forEach((row) => {
    const tableName = normalizeText(row?.table_name);
    if (tableName) tableSet.add(tableName);
    const actorUserId = normalizeText(row?.actor_user_id);
    if (actorUserId) {
      userSet.add(actorUserId);
    } else {
      hasSystemActor = true;
    }
  });

  return {
    tableNames: Array.from(tableSet),
    userIds: Array.from(userSet),
    hasSystemActor
  };
}
