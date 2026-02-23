import {
  LS_KEYS,
  lsGet,
  lsGetUserScoped,
  lsRemove,
  lsSet,
  lsSetUserScoped,
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

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
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
    window.dispatchEvent(new CustomEvent("organization:updated", { detail: null }));
  }
}

function clearAuthState() {
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
  lsSetUserScoped(LS_KEYS.organization_id, organizationId || "", safeUser.id);
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, !!companySetupCompleted, safeUser.id);
  lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, !!invoiceTemplateCompleted, safeUser.id);
  markSharedSessionActivity(Date.now(), true);
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
    invoiceTemplateCompleted: resolveInvoiceTemplateCompleted(organization)
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

async function fetchAllMemberships(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("organization_members")
    .select("organization_id,role,status,created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (memberError || !Array.isArray(memberRows) || !memberRows.length) return [];

  const organizationIds = [...new Set(memberRows.map((row) => row.organization_id).filter(Boolean))];
  if (!organizationIds.length) return [];

  const { data: organizationRows, error: organizationError } = await supabase
    .from("organizations")
    .select("id,company_name,country_code,is_setup_completed,settings,created_at,updated_at")
    .in("id", organizationIds);
  if (organizationError || !Array.isArray(organizationRows)) return [];

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
  const found = users.find(
    (u) => normalizeEmail(u.email) === normalizeEmail(email) && u.password === password
  );
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

function localRegister({ name, email, password, role, registerCode }) {
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
  const next = {
    id: localUserId,
    name: safeName,
    email: safeEmail,
    password,
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

export async function authListOrganizations() {
  if (!isSupabaseConfigured || !supabase) {
    const organizationId = authGetOrganizationId();
    if (!organizationId) return [];
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
  const memberships = await fetchAllMemberships(user.id);
  return memberships.map(mapMembershipSummary);
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

  const memberships = await fetchAllMemberships(sessionUser.id);
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
    if (hasLocalAuthState()) return true;
    clearAuthState();
    return false;
  }

  if (!session?.user) {
    if (hasLocalAuthState()) return true;
    clearAuthState();
    return false;
  }

  await upsertProfileRow(session.user);
  const fallbackRole = normalizeRoleLabel(
    session.user.user_metadata?.default_role || ROLE_LABELS.owner
  );
  const memberships = await fetchAllMemberships(session.user.id);
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
  const memberships = await fetchAllMemberships(user.id);
  const isOwner = isOwnerRole(fallbackRole);

  let selectedMembership = null;
  if (memberships.length === 1) {
    selectedMembership = memberships[0];
  } else if (!isOwner && memberships.length > 1) {
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
    isOwner && memberships.length > 1
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

export async function authLogout() {
  if (isSupabaseConfigured && supabase) {
    await supabase.auth.signOut();
  }
  clearLegacyOrganizationCache();
  clearAuthState();
}
