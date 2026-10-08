import {
  LS_KEYS,
  lsGet,
  lsGetUserScoped,
  lsRemove,
  lsRemoveOrganizationScoped,
  lsRemoveUserScoped,
  lsSet,
  lsSetSafe,
  lsSetUserScoped,
  lsSetUserScopedSafe,
  ssGet,
  ssRemove,
  ssSet
} from "./storage";
import {
  fromDbRole,
  isOwnerRole,
  normalizeRoleLabel,
  ROLE_LABELS,
  toDbRole
} from "./roles";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import {
  clearSharedSessionActivity,
  markSharedSessionActivity
} from "./sessionActivity.service";
import {
  clearCurrentTabAuthSession,
  hasCurrentTabAuthSession,
  markCurrentTabAuthSession
} from "./browserSession.service";

const DEMO_USERS = [
  {
    id: "local_owner_demo",
    email: "owner@demo.com",
    password: "owner123",
    name: "Owner User",
    role: ROLE_LABELS.owner
  },
  {
    id: "local_accounter_demo",
    email: "accounter@demo.com",
    password: "accounter123",
    name: "Accounter User",
    role: ROLE_LABELS.accounter
  },
  {
    id: "local_staff_demo",
    email: "staff@demo.com",
    password: "staff123",
    name: "Staff User",
    role: ROLE_LABELS.staff
  }
];

const ORGANIZATION_SCOPED_KEYS_TO_CLEAR = [
  LS_KEYS.company_profile,
  LS_KEYS.companyProfileCompleted,
  LS_KEYS.invoiceTemplateConfig,
  LS_KEYS.invoiceTemplateCompleted,
  LS_KEYS.parties,
  LS_KEYS.items,
  LS_KEYS.invoices,
  LS_KEYS.creditNotes,
  LS_KEYS.purchases,
  LS_KEYS.payments,
  LS_KEYS.expenses,
  LS_KEYS.app_notifications,
  LS_KEYS.credit_notifications,
  LS_KEYS.stock_notifications,
  LS_KEYS.activity_logs
];

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

function nowMs() {
  return Date.now();
}

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createSecureToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Hex(value) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashLocalPassword(password, salt = "") {
  const safeSalt = String(salt || createSecureToken(16));
  const hash = await sha256Hex(`${safeSalt}:${String(password || "")}`);
  return { salt: safeSalt, hash };
}

async function verifyLocalPassword(user, password) {
  const safePassword = String(password || "");
  if (String(user?.password || "") && String(user.password) === safePassword) {
    return true;
  }
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const candidate = await sha256Hex(`${user.passwordSalt}:${safePassword}`);
  return candidate === String(user.passwordHash || "");
}

function sanitizeStoredLocalUser(user) {
  if (!user || typeof user !== "object") return user;
  const next = { ...user };
  delete next.password;
  return next;
}

function replaceStoredLocalUser(nextUser) {
  const safeEmail = normalizeEmail(nextUser?.email);
  if (!safeEmail) return;
  const users = getStoredUsers();
  const nextList = users.map((entry) =>
    normalizeEmail(entry?.email) === safeEmail ? sanitizeStoredLocalUser(nextUser) : sanitizeStoredLocalUser(entry)
  );
  setStoredUsers(nextList);
}

function buildPasswordResetLink(token, baseUrl = "") {
  const safeToken = String(token || "").trim();
  const safeBaseUrl = String(baseUrl || "").trim() || (typeof window !== "undefined" ? window.location.origin : "");
  if (!safeToken || !safeBaseUrl) return "";
  const url = new URL("/reset-password", safeBaseUrl);
  url.searchParams.set("token", safeToken);
  return url.toString();
}

function normalizePasswordResetFunctionError(error, fallbackMessage) {
  const message = String(error?.message || "").trim();
  const status = Number(error?.context?.status || error?.status || 0);
  if (
    status === 404 ||
    /function was not found/i.test(message) ||
    /failed to send a request to the edge function/i.test(message)
  ) {
    return "Password reset service is not deployed yet. Deploy the Supabase Edge Function `password-reset` and run the reset-token SQL migration.";
  }
  return message || fallbackMessage;
}

function normalizeOrganizationSettings(settings) {
  if (settings && typeof settings === "object") return settings;
  if (typeof settings === "string") {
    try {
      const parsed = JSON.parse(settings);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isOrganizationSoftDeleted(organization) {
  const settings = normalizeOrganizationSettings(organization?.settings);
  return !!settings.is_deleted;
}

function filterActiveMemberships(memberships) {
  return (Array.isArray(memberships) ? memberships : []).filter(
    (entry) => entry?.organization_id && entry?.organization && !isOrganizationSoftDeleted(entry?.organization)
  );
}

function clearOrganizationScopedCache(organizationId) {
  const safeOrganizationId = String(organizationId || "").trim();
  if (!safeOrganizationId) return;
  ORGANIZATION_SCOPED_KEYS_TO_CLEAR.forEach((key) => {
    lsRemoveOrganizationScoped(key, safeOrganizationId);
  });
}

function listDeletedOrganizationIds(userId = "") {
  const raw = lsGetUserScoped(LS_KEYS.deleted_organization_ids, [], userId);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function isOrganizationDeletedLocally(organizationId, userId = "") {
  const safeOrganizationId = String(organizationId || "").trim();
  if (!safeOrganizationId) return false;
  return listDeletedOrganizationIds(userId).includes(safeOrganizationId);
}

function rememberDeletedOrganizationId(organizationId, userId = "") {
  const safeOrganizationId = String(organizationId || "").trim();
  if (!safeOrganizationId) return;
  const next = Array.from(new Set([...listDeletedOrganizationIds(userId), safeOrganizationId]));
  lsSetUserScopedSafe(
    LS_KEYS.deleted_organization_ids,
    next,
    userId,
    "deleted_organization_ids(remember)"
  );
}

function filterDeletedMembershipsLocal(memberships = [], userId = "") {
  return (Array.isArray(memberships) ? memberships : []).filter(
    (entry) => !isOrganizationDeletedLocally(entry?.organization_id, userId)
  );
}

function getStoredUsers() {
  return lsGet(LS_KEYS.auth_users, []);
}

function setStoredUsers(list) {
  lsSet(LS_KEYS.auth_users, list);
}

function toLocalUserId(email) {
  const safe = normalizeEmail(email).replace(/[^a-z0-9]/g, "_");
  return `local_${safe || "user"}`;
}

function resolveInvoiceTemplateCompleted(organization) {
  const settings = organization?.settings || {};
  return !!(
    settings.invoice_template_selected ||
    settings.invoiceTemplateSelected ||
    settings.invoiceTemplate?.templateId
  );
}

function clearLegacyOrganizationCache() {
  lsRemove(LS_KEYS.company_profile);
  lsRemove(LS_KEYS.companyProfileCompleted);
  lsRemove(LS_KEYS.invoiceTemplateConfig);
  lsRemove(LS_KEYS.invoiceTemplateCompleted);
  if (typeof window !== "undefined") {
    // Force consumers to reset immediately in the current tab without falling back to stale profile cache.
    window.dispatchEvent(new CustomEvent("organization:updated", { detail: {} }));
  }
}

function clearAuthState() {
  lsRemove(LS_KEYS.auth_token);
  lsRemove(LS_KEYS.auth_user);
  lsRemove(LS_KEYS.role);
  lsRemove(LS_KEYS.organization_id);
  lsRemove(LS_KEYS.companyProfileCompleted);
  lsRemove(LS_KEYS.invoiceTemplateCompleted);
  ssRemove(LS_KEYS.auth_token);
  ssRemove(LS_KEYS.auth_user);
  ssRemove(LS_KEYS.role);
  ssRemove(LS_KEYS.organization_id);
  ssRemove(LS_KEYS.companyProfileCompleted);
  ssRemove(LS_KEYS.invoiceTemplateCompleted);
  clearSharedSessionActivity();
  clearCurrentTabAuthSession();
}

function hasLocalAuthState() {
  const token = ssGet(LS_KEYS.auth_token, "");
  const user = ssGet(LS_KEYS.auth_user, null);
  return Boolean(token && (user?.id || user?.email));
}

function setAuthState({
  token,
  user,
  role,
  organizationId,
  companySetupCompleted,
  invoiceTemplateCompleted
}) {
  const safeUser = {
    id: user?.id || toLocalUserId(user?.email),
    email: user?.email || "",
    name: user?.name || user?.email?.split("@")[0] || ""
  };

  ssSet(LS_KEYS.auth_token, token || "");
  ssSet(LS_KEYS.auth_user, safeUser);
  ssSet(LS_KEYS.role, normalizeRoleLabel(role));
  ssSet(LS_KEYS.organization_id, organizationId || "");
  ssSet(LS_KEYS.companyProfileCompleted, !!companySetupCompleted);
  ssSet(LS_KEYS.invoiceTemplateCompleted, !!invoiceTemplateCompleted);
  const localWrites = [
    lsSetSafe(LS_KEYS.auth_user, safeUser, "auth_user"),
    lsSetSafe(LS_KEYS.role, normalizeRoleLabel(role), "role"),
    lsSetSafe(LS_KEYS.organization_id, organizationId || "", "organization_id"),
    lsSetSafe(
      LS_KEYS.companyProfileCompleted,
      !!companySetupCompleted,
      "companyProfileCompleted"
    ),
    lsSetSafe(
      LS_KEYS.invoiceTemplateCompleted,
      !!invoiceTemplateCompleted,
      "invoiceTemplateCompleted"
    ),
    lsSetUserScopedSafe(
      LS_KEYS.organization_id,
      organizationId || "",
      safeUser.id,
      "organization_id(user-scoped)"
    ),
    lsSetUserScopedSafe(
      LS_KEYS.companyProfileCompleted,
      !!companySetupCompleted,
      safeUser.id,
      "companyProfileCompleted(user-scoped)"
    ),
    lsSetUserScopedSafe(
      LS_KEYS.invoiceTemplateCompleted,
      !!invoiceTemplateCompleted,
      safeUser.id,
      "invoiceTemplateCompleted(user-scoped)"
    )
  ];
  if (localWrites.some((ok) => !ok)) {
    console.warn("[Auth] Some local auth persistence writes were skipped due storage limits.");
  }
  try {
    markSharedSessionActivity(Date.now(), true);
  } catch (error) {
    console.warn("Failed to persist shared session activity", error);
  }
  markCurrentTabAuthSession();
}

function mapSessionUser(user) {
  return {
    id: user?.id || "",
    email: user?.email || "",
    name: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || ""
  };
}

function resolveNextStep(role, organization) {
  const safeRole = normalizeRoleLabel(role);
  if (!isOwnerRole(safeRole)) return "dashboard";
  if (!organization) return "organization_setup";
  if (!organization?.is_setup_completed) return "organization_setup";
  if (!resolveInvoiceTemplateCompleted(organization)) return "invoice_template_setup";
  return "dashboard";
}

function mapMembershipSummary(entry) {
  const organization = entry?.organization || null;
  return {
    organizationId: entry?.organization_id || "",
    role: normalizeRoleLabel(entry?.role),
    companyName: organization?.company_name || "Untitled Company",
    countryCode: String(organization?.country_code || "IN").toUpperCase(),
    companySetupCompleted: !!organization?.is_setup_completed,
    invoiceTemplateCompleted: resolveInvoiceTemplateCompleted(organization),
    deleted: isOrganizationSoftDeleted(organization)
  };
}

async function upsertProfileRow(user) {
  if (!isSupabaseConfigured || !supabase || !user?.id) return;
  const payload = {
    id: user.id,
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "",
    email: user.email || "",
    updated_at: new Date().toISOString()
  };
  await supabase.from("profiles").upsert(payload, { onConflict: "id" });
}

async function fetchPrimaryMembership(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  const { data, error } = await supabase.rpc("get_my_membership_snapshot");
  if (error || !data) return null;

  const organization = data?.organization || null;
  return {
    organization_id: data?.organization_id || "",
    role: fromDbRole(data?.role),
    organization
  };
}

async function fetchOwnerOrganizations(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return [];
  const { data: ownerRows, error: ownerError } = await supabase
    .from("organizations")
    .select("id,company_name,country_code,is_setup_completed,settings,created_at,updated_at")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  if (ownerError || !Array.isArray(ownerRows) || !ownerRows.length) return [];
  return ownerRows
    .filter((row) => !!row?.id && !isOrganizationSoftDeleted(row))
    .map((row) => ({
      organization_id: row.id,
      role: ROLE_LABELS.owner,
      created_at: row.created_at,
      organization: row
    }));
}

async function fetchAllMemberships(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("organization_members")
    .select("organization_id,role,status,created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (memberError || !Array.isArray(memberRows)) {
    return fetchOwnerOrganizations(userId);
  }
  if (!memberRows.length) {
    return fetchOwnerOrganizations(userId);
  }

  const organizationIds = [...new Set(memberRows.map((row) => row.organization_id).filter(Boolean))];
  if (!organizationIds.length) return fetchOwnerOrganizations(userId);

  const { data: organizationRows, error: organizationError } = await supabase
    .from("organizations")
    .select("id,company_name,country_code,is_setup_completed,settings,created_at,updated_at")
    .in("id", organizationIds);
  if (organizationError || !Array.isArray(organizationRows)) {
    return fetchOwnerOrganizations(userId);
  }

  const byOrgId = new Map(organizationRows.map((row) => [row.id, row]));
  return memberRows
    .map((row) => ({
      organization_id: row.organization_id,
      role: fromDbRole(row.role),
      created_at: row.created_at,
      organization: byOrgId.get(row.organization_id) || null
    }))
    .filter((row) => row.organization_id);
}

async function localLogin({ email, password }) {
  const users = [...DEMO_USERS, ...getStoredUsers()];
  let found = null;
  for (const user of users) {
    if (normalizeEmail(user?.email) !== normalizeEmail(email)) continue;
    // Support both legacy plain-text passwords and new hashed local passwords.
    // Demo users continue to work with their bundled plain-text passwords.
    if (await verifyLocalPassword(user, password)) {
      found = user;
      break;
    }
  }
  if (!found) {
    const err = new Error("Invalid email or password");
    err.code = "AUTH_INVALID";
    throw err;
  }

  const localUserId = found.id || toLocalUserId(found.email);
  const companySetupCompleted = lsGetUserScoped(
    LS_KEYS.companyProfileCompleted,
    !isOwnerRole(found.role),
    localUserId
  );
  const invoiceTemplateCompleted = lsGetUserScoped(
    LS_KEYS.invoiceTemplateCompleted,
    !isOwnerRole(found.role),
    localUserId
  );
  const organizationId = lsGetUserScoped(LS_KEYS.organization_id, "", localUserId);
  const token = `mock_${btoa(`${found.email}:${Date.now()}`)}`;

  setAuthState({
    token,
    user: { id: localUserId, email: found.email, name: found.name },
    role: found.role,
    organizationId,
    companySetupCompleted,
    invoiceTemplateCompleted
  });

  return {
    token,
    user: { id: localUserId, email: found.email, name: found.name },
    role: found.role,
    organizationId,
    companySetupCompleted,
    invoiceTemplateCompleted,
    next: resolveNextStep(found.role, {
      is_setup_completed: !!companySetupCompleted,
      settings: { invoice_template_selected: !!invoiceTemplateCompleted }
    })
  };
}

async function localRegister({ name, email, password, role, registerCode }) {
  const safeEmail = normalizeEmail(email);
  const safeName = (name || "").trim() || safeEmail.split("@")[0] || "User";
  const safeRole = normalizeRoleLabel(role || ROLE_LABELS.owner);

  if (!safeEmail || !password) {
    const err = new Error("Email and password are required");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (safeRole !== ROLE_LABELS.owner && !String(registerCode || "").trim()) {
    const err = new Error("Register code is required for Accounter or Staff");
    err.code = "INVITE_CODE_REQUIRED";
    throw err;
  }

  const users = [...DEMO_USERS, ...getStoredUsers()];
  const exists = users.some((u) => normalizeEmail(u.email) === safeEmail);
  if (exists) {
    const err = new Error("Email already registered");
    err.code = "AUTH_EXISTS";
    throw err;
  }

  const localUserId = toLocalUserId(safeEmail);
  const passwordState = await hashLocalPassword(password);
  const next = {
    id: localUserId,
    name: safeName,
    email: safeEmail,
    passwordHash: passwordState.hash,
    passwordSalt: passwordState.salt,
    role: safeRole
  };
  setStoredUsers([next, ...getStoredUsers()]);

  const token = `mock_${btoa(`${safeEmail}:${Date.now()}`)}`;
  setAuthState({
    token,
    user: { id: localUserId, email: safeEmail, name: safeName },
    role: safeRole,
    organizationId: "",
    companySetupCompleted: safeRole !== ROLE_LABELS.owner,
    invoiceTemplateCompleted: safeRole !== ROLE_LABELS.owner
  });

  return {
    user: { id: localUserId, email: safeEmail, name: safeName },
    role: safeRole,
    next: safeRole === ROLE_LABELS.owner ? "organization_setup" : "dashboard"
  };
}

export function authGetToken() {
  if (!hasCurrentTabAuthSession()) return "";
  return ssGet(LS_KEYS.auth_token, "");
}

export function authGetUser() {
  if (!hasCurrentTabAuthSession()) return null;
  return ssGet(LS_KEYS.auth_user, null);
}

export function authGetRole() {
  if (!hasCurrentTabAuthSession()) return ROLE_LABELS.staff;
  return normalizeRoleLabel(ssGet(LS_KEYS.role, ROLE_LABELS.staff));
}

export function authGetOrganizationId() {
  if (!hasCurrentTabAuthSession()) return "";
  return ssGet(LS_KEYS.organization_id, "");
}

export function authUsingSupabase() {
  return isSupabaseConfigured;
}

async function localRequestPasswordReset({ email, baseUrl = "" }) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) {
    throw new Error("Email is required.");
  }

  const users = getStoredUsers();
  const matchedUser = users.find((entry) => normalizeEmail(entry?.email) === safeEmail) || null;
  if (!matchedUser) {
    return { delivered: true };
  }

  const resetToken = createSecureToken(32);
  const tokenHash = await sha256Hex(resetToken);
  const expiresAt = new Date(nowMs() + 60 * 60 * 1000).toISOString();

  replaceStoredLocalUser({
    ...matchedUser,
    passwordResetTokenHash: tokenHash,
    passwordResetTokenExpiresAt: expiresAt,
    passwordResetRequestedAt: new Date().toISOString(),
    passwordResetUsedAt: ""
  });

  return {
    delivered: true,
    resetLink: buildPasswordResetLink(resetToken, baseUrl)
  };
}

async function localValidatePasswordResetToken(token) {
  const safeToken = String(token || "").trim();
  if (!safeToken) {
    throw new Error("Reset token is required.");
  }

  const tokenHash = await sha256Hex(safeToken);
  const matchedUser =
    getStoredUsers().find(
      (entry) =>
        String(entry?.passwordResetTokenHash || "") === tokenHash &&
        !String(entry?.passwordResetUsedAt || "").trim()
    ) || null;

  if (!matchedUser) {
    throw new Error("Reset link is invalid or already used.");
  }

  const expiresAt = new Date(matchedUser.passwordResetTokenExpiresAt || "").getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs()) {
    throw new Error("Reset link has expired.");
  }

  return {
    valid: true,
    email: matchedUser.email || ""
  };
}

async function localResetPassword({ token, password }) {
  const safeToken = String(token || "").trim();
  const safePassword = String(password || "");
  if (!safeToken) throw new Error("Reset token is required.");
  if (!safePassword) throw new Error("Password is required.");

  const tokenHash = await sha256Hex(safeToken);
  const matchedUser =
    getStoredUsers().find(
      (entry) =>
        String(entry?.passwordResetTokenHash || "") === tokenHash &&
        !String(entry?.passwordResetUsedAt || "").trim()
    ) || null;

  if (!matchedUser) {
    throw new Error("Reset link is invalid or already used.");
  }

  const expiresAt = new Date(matchedUser.passwordResetTokenExpiresAt || "").getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs()) {
    throw new Error("Reset link has expired.");
  }

  const passwordState = await hashLocalPassword(safePassword);
  replaceStoredLocalUser({
    ...matchedUser,
    passwordHash: passwordState.hash,
    passwordSalt: passwordState.salt,
    passwordResetTokenHash: "",
    passwordResetTokenExpiresAt: "",
    passwordResetRequestedAt: matchedUser.passwordResetRequestedAt || "",
    passwordResetUsedAt: new Date().toISOString()
  });

  return { updated: true };
}

export async function authRequestPasswordReset({ email, baseUrl = "" }) {
  if (!isSupabaseConfigured || !supabase) {
    return localRequestPasswordReset({ email, baseUrl });
  }

  const { data, error } = await supabase.functions.invoke("password-reset", {
    body: {
      action: "request",
      email: normalizeEmail(email),
      base_url: String(baseUrl || "").trim()
    }
  });
  if (error) {
    throw new Error(normalizePasswordResetFunctionError(error, "Failed to send password reset email."));
  }
  return data || { delivered: true };
}

export async function authValidatePasswordResetToken(token) {
  if (!isSupabaseConfigured || !supabase) {
    return localValidatePasswordResetToken(token);
  }

  const { data, error } = await supabase.functions.invoke("password-reset", {
    body: {
      action: "validate",
      token: String(token || "").trim()
    }
  });
  if (error) {
    throw new Error(normalizePasswordResetFunctionError(error, "Failed to validate reset link."));
  }
  if (!data?.valid) {
    throw new Error(data?.error || "Reset link is invalid or expired.");
  }
  return data;
}

export async function authResetPassword({ token, password }) {
  if (!isSupabaseConfigured || !supabase) {
    return localResetPassword({ token, password });
  }

  const { data, error } = await supabase.functions.invoke("password-reset", {
    body: {
      action: "reset",
      token: String(token || "").trim(),
      password: String(password || "")
    }
  });
  if (error) {
    throw new Error(normalizePasswordResetFunctionError(error, "Failed to reset password."));
  }
  if (!data?.updated) {
    throw new Error(data?.error || "Failed to reset password.");
  }
  return data;
}

export async function authEnsureOrganizationAccess(preferredOrganizationId = "") {
  const requestedOrgId = String(preferredOrganizationId || authGetOrganizationId() || "").trim();
  if (!isSupabaseConfigured || !supabase) {
    return requestedOrgId;
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();
  const sessionUser = session?.user || authGetUser();
  if (!sessionUser?.id) return requestedOrgId;

  const memberships = filterDeletedMembershipsLocal(
    filterActiveMemberships(await fetchAllMemberships(sessionUser.id)),
    sessionUser.id
  );
  const selectedMembership =
    memberships.find((entry) => String(entry?.organization_id || "") === requestedOrgId) ||
    memberships[0] ||
    null;

  if (!selectedMembership?.organization_id) {
    return requestedOrgId;
  }

  if (String(selectedMembership.organization_id) !== requestedOrgId) {
    setAuthState({
      token: session?.access_token || authGetToken(),
      user: mapSessionUser(sessionUser),
      role: selectedMembership.role,
      organizationId: selectedMembership.organization_id,
      companySetupCompleted: !!selectedMembership.organization?.is_setup_completed,
      invoiceTemplateCompleted: resolveInvoiceTemplateCompleted(selectedMembership.organization)
    });
  }

  return String(selectedMembership.organization_id || "");
}

export async function authListOrganizations() {
  const currentUserId = String(authGetUser()?.id || "").trim();
  if (!isSupabaseConfigured || !supabase) {
    const organizationId = authGetOrganizationId();
    if (!organizationId || isOrganizationDeletedLocally(organizationId, currentUserId)) return [];
    return [
      {
        organizationId,
        role: authGetRole(),
        companyName: lsGetUserScoped(LS_KEYS.company_profile, null)?.companyName || "Local Company",
        countryCode: "IN",
        companySetupCompleted: !!lsGetUserScoped(LS_KEYS.companyProfileCompleted, false),
        invoiceTemplateCompleted: !!lsGetUserScoped(LS_KEYS.invoiceTemplateCompleted, false)
      }
    ];
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const memberships = filterDeletedMembershipsLocal(
    filterActiveMemberships(await fetchAllMemberships(user.id)),
    user.id
  );
  const summaries = memberships.map(mapMembershipSummary);
  return summaries.filter(
    (entry) => !entry?.deleted && !isOrganizationDeletedLocally(entry?.organizationId, user.id)
  );
}

export async function authSelectOrganization(organizationId) {
  const safeOrganizationId = String(organizationId || "").trim();
  if (!safeOrganizationId) throw new Error("Organization selection is required.");

  const currentUser = authGetUser();
  const currentToken = authGetToken();
  const fallbackRole = authGetRole();

  if (!isSupabaseConfigured || !supabase) {
    const companySetupCompleted = !!lsGetUserScoped(LS_KEYS.companyProfileCompleted, false);
    const invoiceTemplateCompleted = !!lsGetUserScoped(LS_KEYS.invoiceTemplateCompleted, false);
    setAuthState({
      token: currentToken,
      user: currentUser,
      role: fallbackRole,
      organizationId: safeOrganizationId,
      companySetupCompleted,
      invoiceTemplateCompleted
    });
    return {
      organizationId: safeOrganizationId,
      role: normalizeRoleLabel(fallbackRole),
      next: resolveNextStep(fallbackRole, {
        is_setup_completed: companySetupCompleted,
        settings: { invoice_template_selected: invoiceTemplateCompleted }
      })
    };
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();
  const sessionUser = session?.user || currentUser;
  if (!sessionUser?.id) throw new Error("Login required.");
  if (isOrganizationDeletedLocally(safeOrganizationId, sessionUser.id)) {
    throw new Error("Selected company is no longer available.");
  }

  const memberships = filterDeletedMembershipsLocal(
    filterActiveMemberships(await fetchAllMemberships(sessionUser.id)),
    sessionUser.id
  );
  const selected = memberships.find(
    (entry) => String(entry?.organization_id || "") === safeOrganizationId
  );
  if (!selected) {
    throw new Error("Selected organization is not available for this user.");
  }

  setAuthState({
    token: session?.access_token || currentToken,
    user: mapSessionUser(sessionUser),
    role: selected.role,
    organizationId: selected.organization_id,
    companySetupCompleted: !!selected.organization?.is_setup_completed,
    invoiceTemplateCompleted: resolveInvoiceTemplateCompleted(selected.organization)
  });

  return {
    organizationId: selected.organization_id,
    role: normalizeRoleLabel(selected.role),
    next: resolveNextStep(selected.role, selected.organization)
  };
}

export async function authBootstrapSession() {
  if (!isSupabaseConfigured || !supabase) {
    if (!hasCurrentTabAuthSession()) return false;
    if (!hasLocalAuthState()) {
      clearAuthState();
      return false;
    }
    return true;
  }

  if (!hasCurrentTabAuthSession()) return false;

  let session = null;
  try {
    const {
      data: { session: fetchedSession }
    } = await supabase.auth.getSession();
    session = fetchedSession;
  } catch {
    clearAuthState();
    return false;
  }

  if (!session?.user) {
    clearAuthState();
    return false;
  }

  await upsertProfileRow(session.user);
  const fallbackRole = normalizeRoleLabel(
    session.user.user_metadata?.default_role || ROLE_LABELS.owner
  );
  const memberships = filterDeletedMembershipsLocal(
    filterActiveMemberships(await fetchAllMemberships(session.user.id)),
    session.user.id
  );
  const storedOrganizationId =
    ssGet(LS_KEYS.organization_id, "") || lsGetUserScoped(LS_KEYS.organization_id, "", session.user.id);
  const selectedMembership =
    memberships.find(
      (entry) => String(entry?.organization_id || "") === String(storedOrganizationId || "")
    ) ||
    (memberships.length === 1 ? memberships[0] : null);

  setAuthState({
    token: session.access_token,
    user: mapSessionUser(session.user),
    role: selectedMembership?.role || fallbackRole,
    organizationId: selectedMembership?.organization_id || "",
    companySetupCompleted: !!selectedMembership?.organization?.is_setup_completed,
    invoiceTemplateCompleted: resolveInvoiceTemplateCompleted(selectedMembership?.organization)
  });

  return true;
}

export async function authLogin({ email, password }) {
  if (!isSupabaseConfigured || !supabase) {
    return localLogin({ email, password });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message || "Login failed");
  }

  const session = data?.session;
  const user = session?.user;
  if (!user) {
    throw new Error("Login failed. Session not available.");
  }

  await upsertProfileRow(user);
  const fallbackRole = normalizeRoleLabel(user.user_metadata?.default_role || ROLE_LABELS.owner);
  const memberships = filterDeletedMembershipsLocal(
    filterActiveMemberships(await fetchAllMemberships(user.id)),
    user.id
  );

  let selectedMembership = null;
  if (memberships.length === 1) {
    selectedMembership = memberships[0];
  }

  const role = selectedMembership?.role || fallbackRole;
  const organizationId = selectedMembership?.organization_id || "";
  const companySetupCompleted = !!selectedMembership?.organization?.is_setup_completed;
  const invoiceTemplateCompleted = resolveInvoiceTemplateCompleted(
    selectedMembership?.organization
  );

  setAuthState({
    token: session.access_token,
    user: mapSessionUser(user),
    role,
    organizationId,
    companySetupCompleted,
    invoiceTemplateCompleted
  });

  const organizationSummaries = memberships.map(mapMembershipSummary);
  const next =
    memberships.length > 1
      ? "organization_select"
      : resolveNextStep(role, selectedMembership?.organization);

  return {
    token: session.access_token,
    user: authGetUser(),
    role: normalizeRoleLabel(role),
    organizationId,
    companySetupCompleted,
    invoiceTemplateCompleted,
    organizations: organizationSummaries,
    next
  };
}

export async function authRegister({ name, email, password, role, registerCode }) {
  const roleLabel = normalizeRoleLabel(role || ROLE_LABELS.owner);
  clearLegacyOrganizationCache();
  clearAuthState();

  if (!isSupabaseConfigured || !supabase) {
    return localRegister({ name, email, password, role: roleLabel, registerCode });
  }

  if (roleLabel !== ROLE_LABELS.owner && !String(registerCode || "").trim()) {
    const err = new Error("Register code is required for Accounter or Staff");
    err.code = "INVITE_CODE_REQUIRED";
    throw err;
  }

  const signUpPayload = {
    email,
    password,
    options: {
      data: {
        full_name: (name || "").trim(),
        default_role: toDbRole(roleLabel)
      }
    }
  };

  const { data, error } = await supabase.auth.signUp(signUpPayload);
  if (error) {
    throw new Error(error.message || "Registration failed");
  }

  const signedUser = data?.user;
  if (!signedUser) {
    throw new Error("Registration failed. User record missing.");
  }

  let session = data?.session || null;
  if (!session) {
    const signInAttempt = await supabase.auth.signInWithPassword({ email, password });
    if (!signInAttempt.error && signInAttempt.data?.session) {
      session = signInAttempt.data.session;
    }
  }

  if (!session) {
    return {
      requiresEmailVerification: true,
      next: "login"
    };
  }

  const user = session.user;
  await upsertProfileRow(user);

  if (roleLabel === ROLE_LABELS.owner) {
    setAuthState({
      token: session.access_token,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email?.split("@")[0]
      },
      role: ROLE_LABELS.owner,
      organizationId: "",
      companySetupCompleted: false,
      invoiceTemplateCompleted: false
    });

    return {
      user: authGetUser(),
      role: ROLE_LABELS.owner,
      next: "organization_setup"
    };
  }

  const { data: orgId, error: consumeError } = await supabase.rpc("consume_invite_code", {
    p_code: String(registerCode || "").trim().toUpperCase(),
    p_user_id: user.id,
    p_role: toDbRole(roleLabel)
  });

  if (consumeError || !orgId) {
    await supabase.auth.signOut();
    clearAuthState();
    throw new Error(consumeError?.message || "Invalid or expired register code");
  }

  const membership = await fetchPrimaryMembership(user.id);
  const companySetupCompleted = membership?.organization?.is_setup_completed || false;
  const invoiceTemplateCompleted = resolveInvoiceTemplateCompleted(membership?.organization);

  setAuthState({
    token: session.access_token,
    user: {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.email?.split("@")[0]
    },
    role: membership?.role || roleLabel,
    organizationId: membership?.organization_id || orgId,
    companySetupCompleted,
    invoiceTemplateCompleted
  });

  return {
    user: authGetUser(),
    role: authGetRole(),
    organizationId: authGetOrganizationId(),
    next: companySetupCompleted ? "dashboard" : "organization_setup"
  };
}

export async function authDeleteOrganization(organizationId) {
  const safeOrganizationId = String(organizationId || "").trim();
  if (!safeOrganizationId) throw new Error("Organization selection is required.");

  const currentOrganizationId = String(authGetOrganizationId() || "").trim();
  const currentUserId = String(authGetUser()?.id || "").trim();

  const clearSelectionIfNeeded = () => {
    if (currentOrganizationId !== safeOrganizationId) return;
    ssSet(LS_KEYS.organization_id, "");
    lsSetSafe(LS_KEYS.organization_id, "", "organization_id(clearSelection)");
    if (currentUserId) {
      lsSetUserScopedSafe(
        LS_KEYS.organization_id,
        "",
        currentUserId,
        "organization_id(clearSelection-user)"
      );
      lsSetUserScopedSafe(
        LS_KEYS.companyProfileCompleted,
        false,
        currentUserId,
        "companyProfileCompleted(clearSelection-user)"
      );
      lsSetUserScopedSafe(
        LS_KEYS.invoiceTemplateCompleted,
        false,
        currentUserId,
        "invoiceTemplateCompleted(clearSelection-user)"
      );
      lsRemoveUserScoped(LS_KEYS.company_profile, currentUserId);
    }
    lsSetSafe(LS_KEYS.companyProfileCompleted, false, "companyProfileCompleted(clearSelection)");
    ssSet(LS_KEYS.companyProfileCompleted, false);
    lsSetSafe(LS_KEYS.invoiceTemplateCompleted, false, "invoiceTemplateCompleted(clearSelection)");
    ssSet(LS_KEYS.invoiceTemplateCompleted, false);
    clearLegacyOrganizationCache();
  };

  if (!isSupabaseConfigured || !supabase) {
    clearOrganizationScopedCache(safeOrganizationId);
    rememberDeletedOrganizationId(safeOrganizationId, currentUserId);
    clearSelectionIfNeeded();
    return { deleted: true, mode: "local" };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Login required.");

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id,owner_user_id,settings")
    .eq("id", safeOrganizationId)
    .maybeSingle();

  if (orgError) {
    throw new Error(orgError?.message || "Failed to load company details.");
  }
  if (!organization?.id) {
    throw new Error("Company not found.");
  }
  if (String(organization.owner_user_id || "") !== String(user.id || "")) {
    throw new Error("Only owner can delete this company.");
  }

  // Always soft-delete first (via UPDATE which is granted by RLS).
  // Hard DELETE is not granted on the organizations table, so attempting it
  // first would silently succeed with 0 rows deleted and skip soft-delete,
  // causing the company to reappear after page refresh.
  const nextSettings = {
    ...normalizeOrganizationSettings(organization?.settings),
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: user.id
  };
  const { error: softDeleteError } = await supabase
    .from("organizations")
    .update({ settings: nextSettings, updated_at: new Date().toISOString() })
    .eq("id", safeOrganizationId)
    .eq("owner_user_id", user.id);
  if (softDeleteError) {
    throw new Error(softDeleteError?.message || "Failed to delete company.");
  }

  // Attempt hard delete as optional cleanup - if it fails, soft delete already
  // ensures the organization is hidden from all queries.
  let mode = "soft";
  try {
    const { error: hardDeleteError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", safeOrganizationId)
      .eq("owner_user_id", user.id);
    if (!hardDeleteError) {
      mode = "hard";
    }
  } catch {
    // Hard delete not available - soft delete is sufficient.
  }

  clearOrganizationScopedCache(safeOrganizationId);
  rememberDeletedOrganizationId(safeOrganizationId, user.id);
  clearSelectionIfNeeded();
  return { deleted: true, mode };
}

export async function authLogout() {
  if (isSupabaseConfigured && supabase) {
    await supabase.auth.signOut();
  }
  clearLegacyOrganizationCache();
  clearAuthState();
}
