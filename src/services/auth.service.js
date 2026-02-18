import { LS_KEYS, lsGet, lsRemove, lsSet } from "./storage";
import { fromDbRole, normalizeRoleLabel, ROLE_LABELS, toDbRole } from "./roles";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const DEMO_USERS = [
  { email: "owner@demo.com", password: "owner123", name: "Owner User", role: ROLE_LABELS.owner },
  { email: "accounter@demo.com", password: "accounter123", name: "Accounter User", role: ROLE_LABELS.accounter },
  { email: "staff@demo.com", password: "staff123", name: "Staff User", role: ROLE_LABELS.staff }
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

function clearAuthState() {
  lsRemove(LS_KEYS.auth_token);
  lsRemove(LS_KEYS.auth_user);
  lsRemove(LS_KEYS.role);
  lsRemove(LS_KEYS.organization_id);
}

function hasLocalAuthState() {
  const token = lsGet(LS_KEYS.auth_token, "");
  const user = lsGet(LS_KEYS.auth_user, null);
  return Boolean(token && (user?.id || user?.email));
}

function setAuthState({ token, user, role, organizationId, companySetupCompleted }) {
  lsSet(LS_KEYS.auth_token, token || "");
  lsSet(LS_KEYS.auth_user, {
    id: user?.id || "",
    email: user?.email || "",
    name: user?.name || user?.email?.split("@")[0] || ""
  });
  lsSet(LS_KEYS.role, normalizeRoleLabel(role));
  lsSet(LS_KEYS.organization_id, organizationId || "");
  lsSet(LS_KEYS.companyProfileCompleted, !!companySetupCompleted);
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

  const token = `mock_${btoa(`${found.email}:${Date.now()}`)}`;
  setAuthState({
    token,
    user: { email: found.email, name: found.name },
    role: found.role,
    organizationId: lsGet(LS_KEYS.organization_id, ""),
    companySetupCompleted: lsGet(LS_KEYS.companyProfileCompleted, false)
  });

  return {
    token,
    user: { email: found.email, name: found.name },
    role: found.role,
    organizationId: authGetOrganizationId(),
    companySetupCompleted: lsGet(LS_KEYS.companyProfileCompleted, false)
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

  const next = { name: safeName, email: safeEmail, password, role: safeRole };
  setStoredUsers([next, ...getStoredUsers()]);

  const token = `mock_${btoa(`${safeEmail}:${Date.now()}`)}`;
  setAuthState({
    token,
    user: { email: safeEmail, name: safeName },
    role: safeRole,
    organizationId: authGetOrganizationId(),
    companySetupCompleted: safeRole !== ROLE_LABELS.owner
  });

  return {
    user: { email: safeEmail, name: safeName },
    role: safeRole,
    next: safeRole === ROLE_LABELS.owner ? "organization_setup" : "dashboard"
  };
}

export function authGetToken() {
  return lsGet(LS_KEYS.auth_token, "");
}

export function authGetUser() {
  return lsGet(LS_KEYS.auth_user, null);
}

export function authGetRole() {
  return normalizeRoleLabel(lsGet(LS_KEYS.role, ROLE_LABELS.staff));
}

export function authGetOrganizationId() {
  return lsGet(LS_KEYS.organization_id, "");
}

export function authUsingSupabase() {
  return isSupabaseConfigured;
}

export async function authBootstrapSession() {
  if (!isSupabaseConfigured || !supabase) return false;

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
  const membership = await fetchPrimaryMembership(session.user.id);

  setAuthState({
    token: session.access_token,
    user: {
      id: session.user.id,
      email: session.user.email,
      name:
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.email?.split("@")[0]
    },
    role: membership?.role || session.user.user_metadata?.default_role || ROLE_LABELS.owner,
    organizationId: membership?.organization_id || "",
    companySetupCompleted: membership?.organization?.is_setup_completed || false
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
  const membership = await fetchPrimaryMembership(user.id);

  const role = membership?.role || user.user_metadata?.default_role || ROLE_LABELS.owner;
  const organizationId = membership?.organization_id || "";
  const companySetupCompleted = membership?.organization?.is_setup_completed || false;

  setAuthState({
    token: session.access_token,
    user: {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0]
    },
    role,
    organizationId,
    companySetupCompleted
  });

  return {
    token: session.access_token,
    user: authGetUser(),
    role: normalizeRoleLabel(role),
    organizationId,
    companySetupCompleted
  };
}

export async function authRegister({ name, email, password, role, registerCode }) {
  const roleLabel = normalizeRoleLabel(role || ROLE_LABELS.owner);

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
      companySetupCompleted: false
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

  setAuthState({
    token: session.access_token,
    user: {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.email?.split("@")[0]
    },
    role: membership?.role || roleLabel,
    organizationId: membership?.organization_id || orgId,
    companySetupCompleted
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
  clearAuthState();
}
