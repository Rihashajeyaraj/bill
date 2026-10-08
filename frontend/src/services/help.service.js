import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { lsGet, lsSet, uid } from "./storage";
import { listActivities } from "./activity.service";

const SUPPORT_LOCAL_KEY = "helpSupportRequestsV1";

export const HELP_RESOURCES = [
  {
    id: "full-guide",
    title: "Full Application Instructions",
    description: "Complete process and module flow guide.",
    path: "docs/FULL_APPLICATION_INSTRUCTIONS.md"
  },
  {
    id: "page-guide",
    title: "Page Wise Explanation",
    description: "Why each page exists and how to use it.",
    path: "docs/PAGE_WISE_FULL_EXPLANATION.md"
  },
  {
    id: "staff-guide",
    title: "1-Day Staff Training",
    description: "Simple onboarding steps for new staff.",
    path: "docs/ONE_DAY_STAFF_TRAINING_SIMPLE_STEPS.md"
  },
  {
    id: "accountant-guide",
    title: "Staff & Accountant Manual",
    description: "Daily non-technical operational checklist.",
    path: "docs/END_USER_MANUAL_STAFF_ACCOUNTANT.md"
  }
];

export const SUPPORT_CATEGORIES = [
  "General",
  "Sales Invoice",
  "Purchase & Expenses",
  "Payment In/Out",
  "Reports",
  "Data Backup"
];

export const SUPPORT_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapSupportRecord(record) {
  return {
    id: record?.id || uid("sup_"),
    subject: record?.subject || "Support Request",
    category: record?.category || "General",
    priority: record?.priority || "Medium",
    message: record?.message || "",
    status: record?.status || "Open",
    contactEmail: record?.contactEmail || "",
    createdAt: record?.createdAt || new Date().toISOString(),
    createdBy: record?.createdBy || ""
  };
}

export async function listSupportRequests(limit = 25) {
  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, action, payload, created_at, actor_user_id, entity_name")
        .eq("organization_id", organizationId)
        .eq("entity_name", "support_request")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to load support requests"));
      }

      return ensureArray(data).map((row) => {
        const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
        return mapSupportRecord({
          id: row?.id,
          subject: payload.subject || row?.action || "Support Request",
          category: payload.category || "General",
          priority: payload.priority || "Medium",
          message: payload.message || "",
          status: payload.status || "Open",
          contactEmail: payload.contactEmail || "",
          createdAt: row?.created_at,
          createdBy: row?.actor_user_id || ""
        });
      });
    }
  }

  return ensureArray(lsGet(SUPPORT_LOCAL_KEY, [])).slice(0, limit).map(mapSupportRecord);
}

export async function submitSupportRequest(payload) {
  const subject = String(payload?.subject || "").trim();
  const message = String(payload?.message || "").trim();
  const category = String(payload?.category || "General").trim() || "General";
  const priority = String(payload?.priority || "Medium").trim() || "Medium";
  const contactEmail = String(payload?.contactEmail || "").trim();

  if (!subject) throw new Error("Subject is required.");
  if (!message) throw new Error("Message is required.");

  const actor = authGetUser();

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const requestPayload = {
        subject,
        category,
        priority,
        message,
        status: "Open",
        contactEmail,
        source: "help_support"
      };

      const { data, error } = await supabase
        .from("activity_logs")
        .insert({
          organization_id: organizationId,
          actor_user_id: actor?.id || null,
          action: `Support Request: ${subject}`,
          entity_name: "support_request",
          entity_id: null,
          payload: requestPayload
        })
        .select("id, created_at, payload")
        .single();

      if (error || !data) {
        throw new Error(normalizeSupabaseError(error, "Failed to submit support request"));
      }

      return mapSupportRecord({
        id: data.id,
        subject: requestPayload.subject,
        category: requestPayload.category,
        priority: requestPayload.priority,
        message: requestPayload.message,
        status: requestPayload.status,
        contactEmail: requestPayload.contactEmail,
        createdAt: data.created_at,
        createdBy: actor?.email || actor?.id || ""
      });
    }
  }

  const entry = mapSupportRecord({
    id: uid("sup_"),
    subject,
    category,
    priority,
    message,
    status: "Open",
    contactEmail,
    createdAt: new Date().toISOString(),
    createdBy: actor?.email || actor?.id || ""
  });

  const next = [entry, ...ensureArray(lsGet(SUPPORT_LOCAL_KEY, []))].slice(0, 200);
  lsSet(SUPPORT_LOCAL_KEY, next);
  return entry;
}

export async function listSystemActivity(limit = 20) {
  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, action, entity_name, payload, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to load activity logs"));
      }

      return ensureArray(data).map((row) => ({
        id: row?.id || uid("act_"),
        action: row?.action || "Activity",
        entity: row?.entity_name || "system",
        details: row?.payload || {},
        createdAt: row?.created_at || new Date().toISOString()
      }));
    }
  }

  return listActivities(limit).map((entry) => ({
    id: entry?.id || uid("act_"),
    action: entry?.action || "Activity",
    entity: entry?.details?.module || "local",
    details: entry?.details || {},
    createdAt: entry?.createdAt || new Date().toISOString()
  }));
}
